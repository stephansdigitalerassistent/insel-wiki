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
import { logger } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
