// Insel-Wiki Cloud Functions
//
// projectYjsToMarkdown: the authoritative server-side projection of the Yjs CRDT
// document onto the page's `content` markdown field. This guarantees that
// full-text search, history snapshots, and cold-load fallback can never drift
// from the live collaborative document, regardless of which client (if any) is
// elected leader — superseding the best-effort client-side projection in
// editor.js.
//
// Trigger: writes to pages/{pageId}/yjs_state/{stateId}. That document is only
// (re)written by FirestoreYjsProvider.compact(), which folds all pending
// incremental updates into the compacted state — i.e. the natural, deduplicated
// projection point. We additionally read any updates written *since* the last
// compaction so a busy page's content stays current between compactions.
//
// Loop safety: this writes the parent `pages/{pageId}` doc, NOT the yjs_state
// subcollection, so it does not retrigger itself.

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { projectToMarkdown } from './lib/convert.js';
import { BatchCommitter } from './lib/batch-committer.js';
import {
  normalizeEmail, normalizeCode, generateCode, emailDocId, defaultDisplayName,
  dayKey, planSend, checkCode, buildCodeMail, MAX_SENDS_PER_DAY, MAIL_PICKUP_TIMEOUT_MS,
} from './lib/login-code.js';

initializeApp();
const db = getFirestore();

// The previous model, text-embedding-004, was retired and now 404s.
// getEmbedding swallows that into a null, so semantic search degraded to
// keyword-only silently — page_embeddings sat at 0 docs for 125 pages.
//
// 768 dimensions rather than gemini-embedding-001's 3072 default: searchPages
// loads *every* page embedding on *every* query, so vector width is a direct
// per-search cost. The cosine similarity normalises, so shorter vectors compare
// fine.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS = 768;

async function getEmbedding(text, apiKey) {
  if (!text || !apiKey) return null;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://insel-wiki.web.app/'
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: {
          parts: [{ text: text.slice(0, 8000) }]
        },
        outputDimensionality: EMBEDDING_DIMS
      })
    });
    if (!res.ok) {
      const errorText = await res.text();
      logger.error(`[embedding] API error: ${res.status}`, errorText);
      return null;
    }
    const data = await res.json();
    return data?.embedding?.values || null;
  } catch (err) {
    logger.error('[embedding] Failed to get embedding', err);
    return null;
  }
}

function checkAcl(pageData, user) {
  if (user.isBot) return true;
  const allowedEmails = (pageData.allowedEmails && pageData.allowedEmails.length > 0) ? pageData.allowedEmails : ['*'];
  return allowedEmails.includes('*') || allowedEmails.includes(user.email);
}

export const projectYjsToMarkdown = onDocumentWritten(
  {
    document: 'pages/{pageId}/yjs_state/{stateId}',
    region: 'europe-west1',
    // Serialize per-page so two rapid compactions can't write content out of
    // order. Tune memory up if very large docs OOM the default 256MiB.
    memory: '512MiB',
    timeoutSeconds: 120,
    retry: false,
  },
  async (event) => {
    const { pageId } = event.params;
    const after = event.data?.after;

    // State doc deleted (e.g. page purge) — nothing to project.
    if (!after || !after.exists) return;

    const stateBytes = after.data()?.state;
    if (!stateBytes) return;

    // Pull updates written since the last compaction so we don't lag the live
    // document between compaction events.
    let queryRef = db
      .collection('pages')
      .doc(pageId)
      .collection('yjs_updates')
      .orderBy('timestamp', 'asc');

    const updatesSnap = await queryRef.limit(1000).get();
    const updateBlobs = updatesSnap.docs
      .map(d => d.data().update)
      .filter(Boolean);

    let markdown;
    try {
      markdown = projectToMarkdown(stateBytes, updateBlobs);
    } catch (err) {
      logger.error(`[projection] failed to project ${pageId}`, err);
      return; // retry:false — a malformed doc shouldn't hot-loop
    }

    const pageRef = db.collection('pages').doc(pageId);
    const pageSnap = await pageRef.get();
    if (!pageSnap.exists) return; // page gone

    // Skip the write if the projection is unchanged — avoids write storms and
    // needless updatedAt churn on every compaction of an idle page.
    if (pageSnap.data()?.content === markdown) return;

    // Get API Key and compute embedding
    const apiKey = process.env.GEMINI_API_KEY;
    let embedding = null;
    if (apiKey) {
      const title = pageSnap.data()?.title || '';
      embedding = await getEmbedding(`${title}\n\n${markdown}`, apiKey);
    }

    const updateData = {
      content: markdown,
      contentProjectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Write content + a projection marker.
    await pageRef.update(updateData);

    if (embedding) {
      await db.collection('page_embeddings').doc(pageId).set({
        embedding,
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    logger.info(`[projection] ${pageId}: wrote ${markdown.length} chars`);
  }
);

export const spellcheck = onRequest(
  {
    region: 'europe-west1',
  },
  async (req, res) => {
    // 1. Verify Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).send('Unauthorized: Missing token');
      return;
    }
    const token = authHeader.split('Bearer ')[1];
    
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      const email = decodedToken.email;
      
      // 2. Validate email domain (gate)
      const isBot = email && (email === 'stephansdigitalassistent+wiki@gmail.com' || email === 'stephansdigitalassistent@gmail.com');
      const isInsel = email && email.endsWith('@insel.ch');
      
      if (!isInsel && !isBot) {
        res.status(403).send('Forbidden: Unauthorized email domain');
        return;
      }
      
      // 3. Process parameters
      const { word, contextBefore, contextAfter } = req.body;
      if (!word) {
        res.status(400).send('Bad Request: Missing word parameter');
        return;
      }
      
      // 4. Retrieve API key
      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).send('Internal Server Error: Gemini API key not configured');
        return;
      }
      
      const model = 'gemini-3.5-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      // The two failure modes are not equal. A typo left alone is a typo; a
      // "corrected" surname puts a wrong word into a colleague's page, and the
      // person who most needs this feature is least able to catch it. So the
      // prompt makes "unchanged" the default and gives the model a numbered test
      // instead of a judgement call — the old one asked it to "ignore names" and
      // it turned Heuscher into Heusler, Bracher into Braucher, Anken into Enkel.
      //
      // Scored by tests/spellcheck-eval (see its README) over three sets: ordinary
      // words, a held-out set, and Swiss surnames one edit from a common word.
      // Old prompt 17-25/25 on words to leave alone; this one 25/25 on every set
      // and every repeat, with all real typos still corrected.
      const systemPrompt = `You correct dyslexia typos in one German or English word, for a hospital wiki
written in Swiss German.

Output ONLY the word, nothing else. No punctuation, quotes, or explanation.

Apply this test to the Target:
1. Is the Target already an ordinary dictionary word? -> unchanged.
2. Could it be a surname, place, clinic, brand, product, project, drug name or
   abbreviation? -> unchanged. Do not "correct" it towards a more familiar name.
3. Otherwise: is it ONE dyslexia slip away from a common dictionary word
   (swapped letters, missing letter, doubled letter, b/d/p/q, ei/ie)?
   -> output that word.
4. Unsure for any reason -> unchanged.

Leaving a typo alone is harmless. Changing a word that was already correct puts
a wrong word into someone else's page, so when the two are balanced, leave it.

Examples:
  Bänziger -> Bänziger      (a surname, not a typo for Bäninger)
  Candesartan -> Candesartan  (a drug)
  Solothurn -> Solothurn    (a place)
  Feirtag -> Feiertag       (one missing letter)
  Nachrichtne -> Nachrichten  (two letters swapped)

Keep the original capitalisation. Keep umlauts (ä, ö, ü) — never ae/oe/ue.
Swiss German: 'ß' becomes 'ss'.`;

      const promptText = `Target: ${word}\nContext before: ${contextBefore}\nContext after: ${contextAfter}`;
      
      const geminiRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://insel-wiki.web.app/'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [{
            parts: [{ text: promptText }]
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 30,
            candidateCount: 1
          }
        })
      });
      
      if (!geminiRes.ok) {
        const errorBody = await geminiRes.text().catch(() => '');
        logger.error(`[spellcheck] Gemini API error: ${geminiRes.status}`, errorBody);
        res.status(502).send(`Bad Gateway: Gemini API returned ${geminiRes.status}`);
        return;
      }
      
      const data = await geminiRes.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        res.status(502).send('Bad Gateway: No text returned from Gemini API');
        return;
      }
      
      res.json({ corrected: text });
      
    } catch (err) {
      logger.error('[spellcheck] Error verifying token or calling Gemini', err);
      res.status(500).send('Internal Server Error');
    }
  }
);

export const translateContent = onRequest(
  {
    region: 'europe-west1',
    timeoutSeconds: 300,
  },
  async (req, res) => {
    // 1. Verify Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).send('Unauthorized: Missing token');
      return;
    }
    const token = authHeader.split('Bearer ')[1];
    if (!token || !token.trim()) {
      res.status(401).send('Unauthorized: Missing token');
      return;
    }

    let decodedToken;
    try {
      decodedToken = await getAuth().verifyIdToken(token);
    } catch (err) {
      logger.error('[translateContent] Token verification failed', err);
      res.status(401).send('Unauthorized: Invalid token');
      return;
    }

    const email = decodedToken?.email;

    // 2. Validate email domain (gate)
    const isBot = email && (email === 'stephansdigitalassistent+wiki@gmail.com' || email === 'stephansdigitalassistent@gmail.com');
    const isInsel = email && email.endsWith('@insel.ch');

    if (!isInsel && !isBot) {
      res.status(403).send('Forbidden: Unauthorized email domain');
      return;
    }

    try {
      // 3. Process parameters
      const { title = '', content = '', targetLanguage = 'en' } = req.body || {};
      const safeTitle = typeof title === 'string' ? title : '';
      const safeContent = typeof content === 'string' ? content : '';

      if (!safeTitle.trim() && !safeContent.trim()) {
        res.status(400).send('Bad Request: Nothing to translate');
        return;
      }

      if (safeContent.length > 100000) {
        res.status(413).send('Payload Too Large: Page exceeds translation limit');
        return;
      }

      const supportedLanguages = ['de', 'en', 'fr', 'it'];
      if (!supportedLanguages.includes(targetLanguage)) {
        res.status(400).send('Bad Request: Unsupported target language');
        return;
      }

      // 4. Retrieve API key
      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).send('Internal Server Error: Gemini API key not configured');
        return;
      }

      const model = 'gemini-3.5-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const targetLangName = {
        de: 'German (Swiss German conventions: replace ß with ss, keep umlauts ä, ö, ü)',
        en: 'English',
        fr: 'French',
        it: 'Italian'
      }[targetLanguage];

      const systemPrompt = `You are a professional translator for the Inselspital Bern wiki.
Translate the provided title and markdown content accurately and fluently into ${targetLangName}.
Preserve all Markdown formatting precisely, including headers (#, ##, ###), bold (**), italic (*), code blocks, inline code, links, tables, bullet points, checklists (- [ ] / - [x]), and @mentions.
If German is the target language, use Swiss German (replace 'ß' with 'ss') and keep German umlauts (ä, ö, ü).
Return ONLY a valid JSON object matching this schema:
{
  "translatedTitle": "translated title string",
  "translatedContent": "translated markdown content string"
}`;

      const geminiRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://insel-wiki.web.app/'
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [{
            parts: [{ text: JSON.stringify({ title: safeTitle, content: safeContent }) }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 65536,
            responseMimeType: "application/json"
          }
        })
      });

      if (!geminiRes.ok) {
        const errorBody = await geminiRes.text().catch(() => '');
        logger.error(`[translateContent] Gemini API error: ${geminiRes.status}`, errorBody);
        res.status(502).send(`Bad Gateway: Gemini API returned ${geminiRes.status}`);
        return;
      }

      const data = await geminiRes.json();
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason !== 'STOP') {
        logger.error(`[translateContent] Translation truncated (finishReason: ${finishReason})`);
        res.status(502).send(`Bad Gateway: Translation truncated (finishReason: ${finishReason})`);
        return;
      }

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        res.status(502).send('Bad Gateway: No text returned from Gemini API');
        return;
      }

      try {
        const parsed = JSON.parse(rawText);
        res.json({
          translatedTitle: parsed.translatedTitle ?? safeTitle,
          translatedContent: parsed.translatedContent ?? safeContent
        });
      } catch (parseErr) {
        logger.error('[translateContent] JSON parse error', parseErr);
        res.status(502).send('Bad Gateway: Malformed translation response');
      }
    } catch (err) {
      logger.error('[translateContent] Error calling Gemini', err);
      res.status(500).send('Internal Server Error');
    }
  }
);

export const searchPages = onRequest(
  {
    region: 'europe-west1',
  },
  async (req, res) => {
    // 1. Verify Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).send('Unauthorized: Missing token');
      return;
    }
    const token = authHeader.split('Bearer ')[1];
    
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      const email = decodedToken.email;
      
      // 2. Validate email domain (gate)
      const isBot = email && (email === 'stephansdigitalassistent+wiki@gmail.com' || email === 'stephansdigitalassistent@gmail.com');
      const isInsel = email && email.endsWith('@insel.ch');
      
      if (!isInsel && !isBot) {
        res.status(403).send('Forbidden: Unauthorized email domain');
        return;
      }
      
      // 3. Process parameters
      const searchQuery = req.body ? req.body.query : null;
      if (!searchQuery || typeof searchQuery !== 'string') {
        res.status(400).send('Bad Request: Missing query parameter');
        return;
      }
      
      const apiKey = process.env.GEMINI_API_KEY;
      
      // Fetch all non-deleted pages and embeddings in parallel
      const [pagesSnap, embeddingsSnap] = await Promise.all([
        db.collection('pages').where('deleted', '==', false).get(),
        db.collection('page_embeddings').get()
      ]);
      
      const embeddingsMap = new Map(
        embeddingsSnap.docs.map(d => [d.id, d.data().embedding])
      );

      const pages = pagesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const allowedPages = pages.filter(page => checkAcl(page, { email, isBot }));

      // If we have an API key and query, try to do semantic search
      let queryEmbedding = null;
      if (apiKey) {
        queryEmbedding = await getEmbedding(searchQuery, apiKey);
      }

      const results = [];
      const queryLower = searchQuery.toLowerCase();

      for (const page of allowedPages) {
        let similarity = 0;
        let isSemantic = false;

        // Keyword match
        const inTitle = page.title && page.title.toLowerCase().includes(queryLower);
        const inContent = page.content && page.content.toLowerCase().includes(queryLower);
        const keywordMatch = inTitle || inContent;

        const pageEmbedding = embeddingsMap.get(page.id);
        if (queryEmbedding && pageEmbedding && Array.isArray(pageEmbedding) && pageEmbedding.length === queryEmbedding.length) {
          // Calculate cosine similarity
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;
          for (let i = 0; i < queryEmbedding.length; i++) {
            dotProduct += queryEmbedding[i] * pageEmbedding[i];
            normA += queryEmbedding[i] * queryEmbedding[i];
            normB += pageEmbedding[i] * pageEmbedding[i];
          }
          similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
          isSemantic = true;
        }

        // If it matches via keyword or has a high similarity score, include it.
        //
        // 0.65, not 0.45: that value was tuned for the retired
        // text-embedding-004. Measured against gemini-embedding-001 (768d) on
        // German wiki text, related queries score >= 0.706 while clearly
        // unrelated ones still reach 0.569 — at 0.45 every query matched every
        // page.
        if (keywordMatch || (isSemantic && similarity > 0.65)) {
          results.push({
            id: page.id,
            title: page.title || '',
            score: keywordMatch ? (similarity + 0.5) : similarity, // boost keyword match slightly for relevance
            isSemantic,
            similarity
          });
        }
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score);

      // Return top 20 results
      res.json({ results: results.slice(0, 20) });
    } catch (err) {
      logger.error('[searchPages] Error searching pages', err);
      res.status(500).send('Internal Server Error');
    }
  }
);



async function checkAuthAndPageAccess(req, res, pageId) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).send('Unauthorized: Missing token');
    return null;
  }
  const token = authHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    const email = decodedToken.email;
    
    const isBot = email && (email === 'stephansdigitalassistent+wiki@gmail.com' || email === 'stephansdigitalassistent@gmail.com');
    const isInsel = email && email.endsWith('@insel.ch');
    
    if (!isInsel && !isBot) {
      res.status(403).send('Forbidden: Unauthorized email domain');
      return null;
    }
    
    if (isBot) {
      let pageSnap = null;
      if (pageId) {
        pageSnap = await db.collection('pages').doc(pageId).get();
        if (!pageSnap.exists) {
          res.status(404).send('Not Found: Page does not exist');
          return null;
        }
      }
      return { user: { email, isBot: true }, pageSnap };
    }
    
    const userSnap = await db.collection('users').doc(decodedToken.uid).get();
    if (!userSnap.exists || userSnap.data().isActive !== true) {
      res.status(403).send('Forbidden: User is not active');
      return null;
    }

    let pageSnap = null;
    if (pageId) {
      pageSnap = await db.collection('pages').doc(pageId).get();
      if (!pageSnap.exists) {
        res.status(404).send('Not Found: Page does not exist');
        return null;
      }
      const pageData = pageSnap.data();
      if (!checkAcl(pageData, { email, isBot })) {
        res.status(403).send('Forbidden: Insufficient permissions for this page');
        return null;
      }
    }
    
    return { user: { email, isBot: false }, pageSnap };
  } catch (err) {
    logger.error('[auth] Verification failed', err);
    res.status(401).send('Unauthorized');
    return null;
  }
}

export const deletePagePrivileged = onRequest(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (req, res) => {
    const { pageId } = req.body;
    if (!pageId) {
      res.status(400).send('Bad Request: Missing pageId');
      return;
    }
    
    const authResult = await checkAuthAndPageAccess(req, res, pageId);
    if (!authResult) return;
    const { user, pageSnap } = authResult;
    
    try {
      const committer = new BatchCommitter(db);
      await _recursiveSoftDelete(pageSnap, user, committer);
      await committer.commit();
      res.json({ success: true });
    } catch (err) {
      logger.error(`[deletePagePrivileged] Failed for page ${pageId}`, err);
      if (err.message && err.message.includes('Forbidden')) {
        res.status(403).send(err.message);
      } else {
        res.status(500).send('Internal Server Error');
      }
    }
  }
);

async function _recursiveSoftDelete(pageSnap, user, committer) {
  const pageData = pageSnap.data();
  if (!checkAcl(pageData, user)) {
    throw new Error(`Forbidden: Insufficient permissions for page ${pageSnap.id}`);
  }

  const snapshot = await db.collection('pages').where('parentId', '==', pageSnap.id).get();
  await Promise.all(snapshot.docs.map(child => _recursiveSoftDelete(child, user, committer)));
  
  committer.update(pageSnap.ref, {
    deleted: true,
    deletedAt: FieldValue.serverTimestamp()
  });
}

export const restorePagePrivileged = onRequest(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (req, res) => {
    const { pageId } = req.body;
    if (!pageId) {
      res.status(400).send('Bad Request: Missing pageId');
      return;
    }
    
    const authResult = await checkAuthAndPageAccess(req, res, pageId);
    if (!authResult) return;
    const { user, pageSnap } = authResult;
    
    try {
      const committer = new BatchCommitter(db);
      await _recursiveRestore(pageSnap, user, committer);
      await committer.commit();
      res.json({ success: true });
    } catch (err) {
      logger.error(`[restorePagePrivileged] Failed for page ${pageId}`, err);
      if (err.message && err.message.includes('Forbidden')) {
        res.status(403).send(err.message);
      } else {
        res.status(500).send('Internal Server Error');
      }
    }
  }
);

async function _recursiveRestore(pageSnap, user, committer) {
  const pageData = pageSnap.data();
  if (!checkAcl(pageData, user)) {
    throw new Error(`Forbidden: Insufficient permissions for page ${pageSnap.id}`);
  }

  committer.update(pageSnap.ref, {
    deleted: false,
    deletedAt: null
  });
  
  const snapshot = await db.collection('pages')
    .where('parentId', '==', pageSnap.id)
    .where('deleted', '==', true)
    .get();
  await Promise.all(snapshot.docs.map(child => _recursiveRestore(child, user, committer)));
}

export const updatePageAclPrivileged = onRequest(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (req, res) => {
    const { pageId, allowedEmails } = req.body;
    if (!pageId || !allowedEmails || !Array.isArray(allowedEmails) || allowedEmails.length === 0) {
      res.status(400).send('Bad Request: Missing or invalid parameters');
      return;
    }
    
    const authResult = await checkAuthAndPageAccess(req, res, pageId);
    if (!authResult) return;
    const { user, pageSnap } = authResult;
    
    try {
      const committer = new BatchCommitter(db);
      await _recursiveUpdateAcl(pageSnap, allowedEmails, user, committer);
      await committer.commit();
      res.json({ success: true });
    } catch (err) {
      logger.error(`[updatePageAclPrivileged] Failed for page ${pageId}`, err);
      if (err.message && err.message.includes('Forbidden')) {
        res.status(403).send(err.message);
      } else {
        res.status(500).send('Internal Server Error');
      }
    }
  }
);

async function _recursiveUpdateAcl(pageSnap, allowedEmails, user, committer) {
  const pageData = pageSnap.data();
  if (!checkAcl(pageData, user)) {
    throw new Error(`Forbidden: Insufficient permissions for page ${pageSnap.id}`);
  }

  committer.update(pageSnap.ref, {
    allowedEmails,
    updatedAt: FieldValue.serverTimestamp()
  });

  const snapshot = await db.collection('pages').where('parentId', '==', pageSnap.id).get();
  await Promise.all(snapshot.docs.map(child => _recursiveUpdateAcl(child, allowedEmails, user, committer)));
}

export const permanentlyDeletePagePrivileged = onRequest(
  { region: 'europe-west1', timeoutSeconds: 300 },
  async (req, res) => {
    const { pageId } = req.body;
    if (!pageId) {
      res.status(400).send('Bad Request: Missing pageId');
      return;
    }
    
    const authResult = await checkAuthAndPageAccess(req, res, pageId);
    if (!authResult) return;
    const { user, pageSnap } = authResult;
    
    try {
      const committer = new BatchCommitter(db);
      await _recursivePermanentDelete(pageSnap, user, committer);
      await committer.commit();
      res.json({ success: true });
    } catch (err) {
      logger.error(`[permanentlyDeletePagePrivileged] Failed for page ${pageId}`, err);
      if (err.message && err.message.includes('Forbidden')) {
        res.status(403).send(err.message);
      } else {
        res.status(500).send('Internal Server Error');
      }
    }
  }
);

async function _recursivePermanentDelete(pageSnap, user, committer) {
  const pageData = pageSnap.data();
  if (!checkAcl(pageData, user)) {
    throw new Error(`Forbidden: Insufficient permissions for page ${pageSnap.id}`);
  }

  const pageId = pageSnap.id;
  const pageRef = pageSnap.ref;

  // 1. Archive children first (recursive) in parallel
  const snapshot = await db.collection('pages').where('parentId', '==', pageId).get();
  await Promise.all(snapshot.docs.map(child => _recursivePermanentDelete(child, user, committer)));

  // 2. Fetch subcollections in parallel
  const [
    historySnaps,
    commentSnaps,
    yjsUpdatesSnaps,
    yjsAwarenessSnaps,
    yjsStateSnaps,
    presenceSnaps
  ] = await Promise.all([
    pageRef.collection('history').get(),
    pageRef.collection('comments').get(),
    pageRef.collection('yjs_updates').get(),
    pageRef.collection('yjs_awareness').get(),
    pageRef.collection('yjs_state').get(),
    pageRef.collection('presence').get()
  ]);

  // 3. Process subcollection documents
  const archivedHistoryRef = db.collection('archive').doc(pageId).collection('history');
  for (const snap of historySnaps.docs) {
    committer.set(archivedHistoryRef.doc(snap.id), {
      ...snap.data(),
      archivedAt: FieldValue.serverTimestamp()
    });
    committer.delete(snap.ref);
  }

  const archivedCommentsRef = db.collection('archive').doc(pageId).collection('comments');
  for (const snap of commentSnaps.docs) {
    committer.set(archivedCommentsRef.doc(snap.id), {
      ...snap.data(),
      archivedAt: FieldValue.serverTimestamp()
    });
    committer.delete(snap.ref);
  }

  for (const snap of yjsUpdatesSnaps.docs) {
    committer.delete(snap.ref);
  }

  for (const snap of yjsAwarenessSnaps.docs) {
    committer.delete(snap.ref);
  }

  for (const snap of yjsStateSnaps.docs) {
    committer.delete(snap.ref);
  }

  for (const snap of presenceSnaps.docs) {
    committer.delete(snap.ref);
  }

  // 4. Archive the main page document
  const archiveRef = db.collection('archive').doc(pageId);
  committer.set(archiveRef, {
    ...pageData,
    archivedAt: FieldValue.serverTimestamp(),
    originalCollection: 'pages'
  });

  // 5. Delete the page document
  committer.delete(pageRef);
}

// ---------------------------------------------------------------------------
// Email one-time login codes
//
// Registration and sign-in are one flow: the user types an @insel.ch address,
// we mail a 6-digit code to it, they type it back and receive a custom token.
// Reading the code proves control of the mailbox — the same guarantee the old
// "send us an empty mail from your Insel account" activation gave, with the
// direction reversed so nobody has to leave the page or pick a password.
//
// Both endpoints are unauthenticated by nature, so every limit lives here:
// per-address resend cooldown and hourly cap, a global daily cap, five guesses
// per code. `login_codes` and `login_code_stats` are matched by no Firestore
// rule, i.e. only the Admin SDK can touch them.
//
// The function holds no mail credential. It queues the message in `mail_queue`
// and WikiBot — which already owns the wiki mailbox's Gmail access on the
// cluster — claims it, sends it and reports back on the same document.
// ---------------------------------------------------------------------------

function readJsonBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

/**
 * Waits for WikiBot to send a queued mail. Resolves 'sent' or 'failed' as the
 * bot reports it, or 'timeout' when nothing picked the mail up — in which case
 * the pending mail is withdrawn here, inside a transaction, so the bot cannot
 * claim it at the same instant and send a code we are about to disown.
 */
function awaitMailOutcome(mailRef) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(outcome);
    };
    const timer = setTimeout(async () => {
      try {
        const outcome = await db.runTransaction(async (tx) => {
          const snap = await tx.get(mailRef);
          const status = snap.exists ? snap.data().status : 'sent';
          if (status === 'pending') {
            tx.delete(mailRef);
            return 'timeout';
          }
          // Claimed in the last moment: the bot is mid-send, count it as delivered.
          return status === 'failed' ? 'failed' : 'sent';
        });
        finish(outcome);
      } catch (err) {
        logger.error('[requestLoginCode] Could not withdraw unsent mail', err);
        finish('timeout');
      }
    }, MAIL_PICKUP_TIMEOUT_MS);
    unsubscribe = mailRef.onSnapshot(
      (snap) => {
        // The bot deletes the document once the mail is out.
        if (!snap.exists) finish('sent');
        else if (snap.data().status === 'failed') finish('failed');
      },
      (err) => logger.warn('[requestLoginCode] mail_queue listener error', err)
    );
  });
}

export const requestLoginCode = onRequest(
  { region: 'europe-west1', timeoutSeconds: 30, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    const body = readJsonBody(req);
    const email = normalizeEmail(body.email);
    if (!email) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    const now = Date.now();
    const code = generateCode();
    const codeRef = db.collection('login_codes').doc(emailDocId(email));
    const statsRef = db.collection('login_code_stats').doc(dayKey(now));
    const mailRef = db.collection('mail_queue').doc();

    try {
      const plan = await db.runTransaction(async (tx) => {
        const [codeSnap, statsSnap] = await Promise.all([tx.get(codeRef), tx.get(statsRef)]);
        const decision = planSend(codeSnap.exists ? codeSnap.data() : null, now, email, code);
        if (!decision.ok) return decision;
        if ((statsSnap.exists ? statsSnap.data().sent || 0 : 0) >= MAX_SENDS_PER_DAY) {
          return { ok: false, reason: 'daily_limit', retryAfterSec: 3600 };
        }
        tx.set(codeRef, decision.record);
        tx.set(statsRef, { sent: FieldValue.increment(1) }, { merge: true });
        tx.set(mailRef, { to: email, ...buildCodeMail(code, body.lang), status: 'pending', createdAt: now });
        return decision;
      });

      if (!plan.ok) {
        if (plan.reason === 'daily_limit') logger.error('[requestLoginCode] Daily mail cap reached');
        res.status(429).json({ error: plan.reason, retryAfterSec: plan.retryAfterSec });
        return;
      }

      const outcome = await awaitMailOutcome(mailRef);
      if (outcome !== 'sent') {
        // Withdraw the code so the cooldown does not lock the user out of retrying,
        // and the mail so a late bot cannot deliver a code that no longer works.
        logger.error(`[requestLoginCode] Mail not sent (${outcome})`);
        await Promise.all([codeRef.delete().catch(() => {}), mailRef.delete().catch(() => {})]);
        res.status(outcome === 'failed' ? 502 : 503).json({ error: outcome === 'failed' ? 'mail_failed' : 'mail_unavailable' });
        return;
      }

      res.json({ success: true });
    } catch (err) {
      logger.error('[requestLoginCode] Failed', err);
      res.status(500).json({ error: 'internal' });
    }
  }
);

export const verifyLoginCode = onRequest(
  { region: 'europe-west1', timeoutSeconds: 30, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    const body = readJsonBody(req);
    const email = normalizeEmail(body.email);
    const code = normalizeCode(body.code);
    if (!email) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    if (!code) {
      res.status(400).json({ error: 'invalid_code' });
      return;
    }

    const now = Date.now();
    const codeRef = db.collection('login_codes').doc(emailDocId(email));

    try {
      const verdict = await db.runTransaction(async (tx) => {
        const snap = await tx.get(codeRef);
        const result = checkCode(snap.exists ? snap.data() : null, now, email, code);
        if (result.consume) {
          // Keep the send-rate fields: consuming a code must not reset the cooldown.
          tx.update(codeRef, { codeHash: FieldValue.delete(), attempts: 0 });
        } else if (result.attempts) {
          tx.update(codeRef, { attempts: result.attempts });
        }
        return result;
      });

      if (!verdict.ok) {
        res.status(verdict.reason === 'too_many_attempts' ? 429 : 400).json({ error: verdict.reason });
        return;
      }

      const auth = getAuth();
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(email);
      } catch (lookupErr) {
        if (lookupErr.code !== 'auth/user-not-found') throw lookupErr;
        userRecord = await auth.createUser({
          email,
          emailVerified: true,
          displayName: defaultDisplayName(email),
        });
        logger.info('[verifyLoginCode] Created account', { uid: userRecord.uid });
      }
      if (userRecord.disabled) {
        res.status(403).json({ error: 'account_disabled' });
        return;
      }

      // `isActive` is what the client gates the session on and what puts the
      // user into the @mention directory; only the server may set it true.
      const userRef = db.collection('users').doc(userRecord.uid);
      const userSnap = await userRef.get();
      const profile = { email, isActive: true, updatedAt: FieldValue.serverTimestamp() };
      if (!userSnap.exists || !userSnap.data().displayName) {
        profile.displayName = userRecord.displayName || defaultDisplayName(email);
      }
      await userRef.set(profile, { merge: true });

      const token = await auth.createCustomToken(userRecord.uid);
      res.json({ token });
    } catch (err) {
      logger.error('[verifyLoginCode] Failed', err);
      res.status(500).json({ error: 'internal' });
    }
  }
);
