/**
 * @module editor/suggestions
 * @description
 * Suggestion provider for the Tiptap `@mention` extension — supplies the candidate list and owns
 * the dropdown's lifecycle.
 *
 * ### Candidate Sourcing
 * - **Roster from Firestore:** Candidates come from `getUsers()`. The signed-in user is folded in
 *   (or appended if missing from the roster) and labelled `… (Ich)` so people can mention
 *   themselves.
 * - **Display-name fallback chain:** `displayName` → e-mail formatted via `formatDefaultName()` →
 *   `'Unbekannt'`, so a user without a profile name is still addressable.
 * - **Filtering:** Case-insensitive substring match against the label of whatever follows the `@`.
 *
 * ### Frequency-Based Ranking
 * Every accepted mention increments a per-user counter kept in `localStorage` under
 * `mention-frequencies-<uid>` (see {@link getFrequencies} / {@link incrementFrequency}). Results are
 * ordered by that count (descending), then the self-entry, then alphabetically, and capped at 7
 * entries. The store is deliberately local and best-effort: it is per device, never synced, and all
 * reads/writes are wrapped so a disabled or full `localStorage` degrades to unranked results rather
 * than breaking mentions.
 *
 * ### Dropdown Lifecycle
 * {@link render} returns the handler set Tiptap drives (`onStart`, `onUpdate`, `onKeyDown`,
 * `onExit`). The list is a plain DOM element positioned by a manually triggered `tippy` popup that
 * tracks the caret through `props.clientRect`. Keyboard handling claims ArrowUp/ArrowDown/Enter only
 * while items exist — returning `false` otherwise lets the keystroke fall through to normal editing
 * — and Escape hides the popup. `onExit` destroys the popup so no tippy instance leaks.
 */
import tippy from 'tippy.js';
import { getUsers } from '../firebase/firestore.js';
import { auth } from '../firebase/config.js';
import { formatDefaultName } from '../utils/string.js';

/**
 * `localStorage` key prefix for per-user mention frequency maps; the owner's uid is appended.
 * @type {string}
 */
const FREQUENCY_KEY_PREFIX = 'mention-frequencies-';

/**
 * @typedef {Object} MentionItem
 * @property {string} id Firestore user id, written into the mention node's attributes.
 * @property {string} label Resolved display name shown in the dropdown.
 * @property {string|null} [photoURL] Avatar URL; a letter placeholder is rendered when absent.
 * @property {number} frequency How often this user was mentioned on this device — the primary sort key.
 */

/**
 * Reads the mention frequency map for a user from `localStorage`.
 *
 * @param {string|undefined} userId Uid of the signed-in user; falsy yields an empty map.
 * @returns {Object<string, number>} Mentioned-user id → count. Returns `{}` when nothing is stored
 *   or when storage is unavailable / holds corrupt JSON — ranking then simply falls back to
 *   alphabetical order.
 */
function getFrequencies(userId) {
  if (!userId) return {};
  try {
    const data = localStorage.getItem(FREQUENCY_KEY_PREFIX + userId);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Records that `optionId` was mentioned by `userId`, bumping its ranking in future lookups.
 *
 * Failures are swallowed on purpose: ranking is a convenience, and a full or disabled
 * `localStorage` must never block inserting a mention.
 *
 * @param {string|undefined} userId Uid of the signed-in user; a falsy value is a no-op.
 * @param {string} optionId Id of the user that was just mentioned.
 * @returns {void}
 */
function incrementFrequency(userId, optionId) {
  if (!userId) return;
  try {
    const frequencies = getFrequencies(userId);
    frequencies[optionId] = (frequencies[optionId] || 0) + 1;
    localStorage.setItem(FREQUENCY_KEY_PREFIX + userId, JSON.stringify(frequencies));
  } catch (e) {
    // ignore
  }
}

/**
 * Suggestion configuration object consumed by `@tiptap/extension-mention`.
 *
 * @type {{ items: Function, render: Function }}
 */
export default {
  /**
   * Resolves the candidate list for the text typed after `@`.
   *
   * @param {Object} props Suggestion props from Tiptap.
   * @param {string} props.query Text typed after the `@` trigger.
   * @returns {Promise<MentionItem[]>} At most 7 matches, sorted by local mention frequency, then the
   *   self-entry (`… (Ich)`), then alphabetically.
   */
  items: async ({ query }) => {
    // 1. Fetch users from Firestore
    let users = await getUsers();
    
    // 2. Identify current user and append '(Ich)'
    const currentUser = auth.currentUser;
    if (currentUser) {
      // Check if user is already in the list
      const existingUserIndex = users.findIndex(u => u.id === currentUser.uid);
      
      const meLabel = (currentUser.displayName || formatDefaultName(currentUser.email) || 'Unbekannt') + ' (Ich)';
      
      if (existingUserIndex >= 0) {
        // Update existing entry
        users[existingUserIndex].displayName = meLabel;
      } else {
        // Add if completely missing
        users.push({
          id: currentUser.uid,
          displayName: meLabel,
          email: currentUser.email,
          photoURL: currentUser.photoURL
        });
      }
    }
    
    // 3. Map to mention format and filter by query
    const frequencies = getFrequencies(currentUser?.uid);

    return users
      .map(u => {
        // Preference: displayName > Formatted Email > 'Unbekannt'
        let name = u.displayName;
        if (!name && u.email) {
          name = formatDefaultName(u.email);
        }
        if (!name) name = 'Unbekannt';

        return {
          id: u.id,
          label: name,
          photoURL: u.photoURL,
          frequency: frequencies[u.id] || 0,
        };
      })
      .filter(item => 
        item.label.toLowerCase().includes(query.toLowerCase())
      )
      // Sort by frequency (desc), then "(Ich)", then alphabetical
      .sort((a, b) => {
        if (a.frequency !== b.frequency) {
          return b.frequency - a.frequency;
        }
        if (a.label.includes('(Ich)')) return -1;
        if (b.label.includes('(Ich)')) return 1;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 7);
  },

  /**
   * Creates the dropdown renderer for one suggestion session.
   *
   * All state (DOM node, popup, highlighted index, current items and command) is captured in this
   * closure, so each `@` trigger gets its own isolated instance.
   *
   * @returns {{ onStart: Function, onUpdate: Function, onKeyDown: Function, onExit: Function }}
   *   The lifecycle handlers Tiptap invokes while the suggestion is active.
   */
  render: () => {
    /** @type {HTMLElement|undefined} Container holding the rendered item buttons. */
    let component;
    /** @type {Object|undefined} tippy instance positioning the list at the caret. */
    let popup;
    /** @type {number} Index of the keyboard-highlighted item. */
    let selectedIndex = 0;
    /** @type {MentionItem[]} Items currently shown. */
    let currentItems = [];
    /** @type {Function|null} Wrapped accept callback: records frequency, then inserts the mention. */
    let currentCommand = null;

    /**
     * Repaints the list from `currentItems` and rebinds the per-item click handlers.
     * Renders an empty-state row when nothing matches.
     *
     * @returns {void}
     */
    const renderItems = () => {
      if (currentItems.length === 0) {
        component.innerHTML = '<div class="mention-item no-result">Keine Benutzer gefunden</div>';
        return;
      }

      component.innerHTML = currentItems.map((item, index) => `
        <button class="mention-item ${index === selectedIndex ? 'is-selected' : ''}" data-id="${item.id}">
          ${item.photoURL 
            ? `<img src="${item.photoURL}" class="mention-avatar" />` 
            : `<div class="mention-avatar-placeholder">${item.label.charAt(0).toUpperCase()}</div>`
          }
          <span class="mention-label">${item.label}</span>
        </button>
      `).join('');

      // Bind click events
      component.querySelectorAll('.mention-item').forEach((btn, index) => {
        btn.addEventListener('click', () => {
          const item = currentItems[index];
          if (item && currentCommand) currentCommand({ id: item.id, label: item.label });
        });
      });
    };

    return {
      /**
       * Builds the list element and shows the popup when the `@` trigger fires.
       *
       * @param {Object} props Tiptap suggestion props.
       * @param {MentionItem[]} props.items Initial candidates.
       * @param {Function} props.command Callback that inserts the chosen mention.
       * @param {Function} props.clientRect Returns the caret rect used to anchor the popup.
       * @returns {void}
       */
      onStart: props => {
        component = document.createElement('div');
        component.className = 'mention-suggestions';
        
        currentItems = props.items || [];
        currentCommand = (item) => {
          const userId = auth.currentUser?.uid;
          if (userId) incrementFrequency(userId, item.id);
          props.command(item);
        };
        selectedIndex = 0;
        
        renderItems();

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })[0];
      },

      /**
       * Re-renders the list as the query changes and re-anchors the popup to the moved caret.
       * The highlight resets to the first item so the top-ranked match stays the default.
       *
       * @param {Object} props Tiptap suggestion props (same shape as in `onStart`).
       * @returns {void}
       */
      onUpdate(props) {
        currentItems = props.items || [];
        currentCommand = (item) => {
          const userId = auth.currentUser?.uid;
          if (userId) incrementFrequency(userId, item.id);
          props.command(item);
        };
        selectedIndex = 0;
        
        renderItems();

        if (popup) {
          popup.setProps({
            getReferenceClientRect: props.clientRect,
          });
        }
      },

      /**
       * Handles navigation keys while the dropdown is open.
       *
       * Escape hides the popup; ArrowUp/ArrowDown wrap around the list; Enter accepts the
       * highlighted item.
       *
       * @param {Object} props Tiptap key props.
       * @param {KeyboardEvent} props.event The originating keyboard event.
       * @returns {boolean} `true` when the key was consumed. Returns `false` for every key while the
       *   list is empty, so arrows and Enter keep their normal editing behaviour.
       */
      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          popup.hide();
          return true;
        }
        
        if (props.event.key === 'ArrowUp') {
          if (!currentItems.length) return false;
          selectedIndex = (selectedIndex + currentItems.length - 1) % currentItems.length;
          renderItems();
          return true;
        }

        if (props.event.key === 'ArrowDown') {
          if (!currentItems.length) return false;
          selectedIndex = (selectedIndex + 1) % currentItems.length;
          renderItems();
          return true;
        }

        if (props.event.key === 'Enter') {
          if (!currentItems.length) return false;
          const item = currentItems[selectedIndex];
          if (item && currentCommand) {
            currentCommand({ id: item.id, label: item.label });
          }
          return true;
        }

        return false;
      },

      /**
       * Tears the session down — destroys the tippy instance so no popup or listener leaks.
       *
       * @returns {void}
       */
      onExit() {
        if (popup) {
          popup.destroy();
        }
      },
    };
  },
};
