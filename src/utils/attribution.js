/**
 * History-snapshot attribution.
 *
 * Every open client runs its own snapshot loop, so the client that *writes* a history
 * entry is not necessarily the client whose user *made* the edit. This module decides,
 * from the contributors a provider observed since the last snapshot, whether this client
 * may write a snapshot at all and whose name goes on it.
 *
 * Kept free of DOM and Firebase imports so it can be unit-tested under plain node.
 */

import { formatDefaultName } from './string.js';

/**
 * Normalises a contributor record, filling a missing name from the e-mail.
 *
 * @param {{ email: string, name?: string }} entry
 * @returns {{ email: string, name: string }}
 */
function normalize(entry) {
  return {
    email: entry.email,
    name: entry.name || formatDefaultName(entry.email)
  };
}

/**
 * Decides who a history snapshot should be attributed to.
 *
 * `contributors` is expected in the order the edits were observed (oldest first), which is
 * the insertion order of the provider's contributor map. The most recently observed editor
 * is the one whose work the pending content actually represents, so that editor — not the
 * first one the provider ever saw — becomes the primary author when this client did not
 * edit anything itself.
 *
 * @param {Object} params
 * @param {boolean} params.hasLocalEdits Whether this client's user edited since the last snapshot.
 * @param {Array<{ email: string, name?: string }>} [params.contributors] Editors observed since the last snapshot, oldest first.
 * @param {{ email?: string, name?: string, displayName?: string }} [params.currentUser] The signed-in user of this client.
 * @returns {{ primaryEmail: string, contributors: Array<{ email: string, name: string }> } | null}
 *   `null` when this client must not write a snapshot at all (a passive viewer that saw no editor).
 */
export function resolveSnapshotAttribution({ hasLocalEdits, contributors, currentUser }) {
  const seen = (Array.isArray(contributors) ? contributors : [])
    .filter(entry => entry && entry.email)
    .map(normalize);

  if (!hasLocalEdits) {
    // A passive viewer with no observed editor would be signing someone else's edit,
    // or an edit that no longer has an author on record. Let another client write it.
    if (seen.length === 0) return null;
    const primary = seen[seen.length - 1];
    return { primaryEmail: primary.email, contributors: primaryFirst(seen, primary.email) };
  }

  const localEmail = currentUser?.email || '';
  if (!localEmail) {
    // Signed-in user without an e-mail: the edit is ours but unattributable.
    return { primaryEmail: '', contributors: seen };
  }

  const local = normalize({
    email: localEmail,
    name: currentUser?.name || currentUser?.displayName || ''
  });
  const merged = seen.some(entry => entry.email === localEmail) ? seen : [...seen, local];
  return { primaryEmail: localEmail, contributors: primaryFirst(merged, localEmail) };
}

/**
 * Moves the primary author to the head of the list, preserving the order of the rest.
 *
 * @param {Array<{ email: string, name: string }>} entries
 * @param {string} primaryEmail
 * @returns {Array<{ email: string, name: string }>}
 */
function primaryFirst(entries, primaryEmail) {
  const primary = entries.filter(entry => entry.email === primaryEmail);
  const others = entries.filter(entry => entry.email !== primaryEmail);
  return [...primary, ...others];
}
