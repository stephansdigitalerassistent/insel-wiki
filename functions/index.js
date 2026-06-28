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

initializeApp();
const db = getFirestore();

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
    const updatesSnap = await db
      .collection('pages').doc(pageId)
      .collection('yjs_updates')
      .get();
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

    // Write only content + a projection marker. Deliberately does NOT touch
    // lastSavedBy/lastSavedByName/Photo, so the "last edited by" badge keeps
    // showing the human author rather than the projector.
    await pageRef.update({
      content: markdown,
      contentProjectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

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
      
      const model = 'gemini-3.1-flash-lite-preview';
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
        headers: { 'Content-Type': 'application/json' },
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
