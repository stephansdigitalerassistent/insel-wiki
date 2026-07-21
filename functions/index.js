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

initializeApp();
const db = getFirestore();

async function getEmbedding(text, apiKey) {
  if (!text || !apiKey) return null;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://insel-wiki.web.app/'
      },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: {
          parts: [{ text: text.slice(0, 8000) }]
        }
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
      
      const model = 'gemini-3.1-flash-lite';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const systemPrompt = `Fix dyslexia typos (transpositions, omissions, duplicates, b/d/p/q/ei/ie swaps) for the Target word using Context.
Output ONLY corrected Target word. No punctuation, quotes, or explanation.
If correct, output as is.
Keep original case unless you are very sure it needs changing (use carefully).
Keep German umlauts (ä,ö,ü). Do NOT replace with ae/oe/ue.
Use Swiss German (replace 'ß' with 'ss').
Ignore medical terms, acronyms, names.
Lang: DE/EN.`;

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

        // If it matches via keyword or has a high similarity score, include it
        if (keywordMatch || (isSemantic && similarity > 0.45)) {
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
