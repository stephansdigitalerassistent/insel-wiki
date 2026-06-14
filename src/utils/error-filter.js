// Shared filtering for client error logging.
// Centralizes the drop-list that was previously duplicated (as substring
// checks) across firestore.js and toast.js, so it stays in one testable place.

/**
 * Messages matching any of these substrings are NOT logged to the database.
 * These are expected/transient noise (Firebase offline behaviour, internal
 * Firestore diagnostics) and the recursion sentinel from our own logger.
 */
export const IGNORED_ERROR_PATTERNS = [
  'Failed to get document',
  'unavailable',
  'BloomFilter error',
  '[Firestore] Failed to log client error',
];

/**
 * Decide whether an error message should be persisted to `client_errors`.
 * @param {string} message
 * @returns {boolean}
 */
export function shouldLogError(message) {
  if (!message || typeof message !== 'string') return false;
  return !IGNORED_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
