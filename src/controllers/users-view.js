/**
 * @module controllers/users-view
 * @description
 * Dynamic, read-only view for the Users / Participants page ('hanspecathon-teilnehmende').
 * Automatically subscribes to the Firestore `users` collection in real-time and renders
 * all registered event participants with search/filter, live counts, and invitation link.
 */

import { subscribeToUsers } from '../firebase/firestore.js';
import { getColorForEmail, getInitials, formatDefaultName } from '../utils/string.js';
import { showToast } from '../components/toast.js';
import i18next from '../i18n.js';

let isUsersViewActive = false;
let usersUnsub = null;
let currentUsers = [];
let searchQuery = '';
let viewRefs = {};

function getJoinLink() {
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return 'https://insel-wiki.web.app';
}

/**
 * Escapes HTML to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a Firestore timestamp or date string into a friendly German date/time string.
 */
function formatJoinDate(val) {
  if (!val) return '—';
  let date;
  if (typeof val.toDate === 'function') {
    date = val.toDate();
  } else if (val._seconds) {
    date = new Date(val._seconds * 1000);
  } else if (val.seconds) {
    date = new Date(val.seconds * 1000);
  } else {
    date = new Date(val);
  }
  if (isNaN(date.getTime())) return '—';

  return date.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' Uhr';
}

/**
 * Initialize DOM references for the users view.
 */
export function initUsersView(refs = {}) {
  viewRefs = refs;
}

/**
 * Checks if the users view is currently active.
 */
export function getIsUsersViewActive() {
  return isUsersViewActive;
}

/**
 * Enters the read-only, auto-updating users view.
 */
export function enterUsersView(pageData = {}) {
  isUsersViewActive = true;
  searchQuery = '';

  // 1. Hide real editor and raw markdown editor
  if (viewRefs.editorEl) viewRefs.editorEl.style.display = 'none';
  if (viewRefs.markdownEditor) viewRefs.markdownEditor.classList.add('hidden');
  if (viewRefs.translationPreviewEl) viewRefs.translationPreviewEl.classList.add('hidden');
  if (viewRefs.translationBanner) viewRefs.translationBanner.classList.add('hidden');

  // 2. Lock title input to read-only
  if (viewRefs.pageTitleInput) {
    viewRefs.pageTitleInput.value = pageData.title || '👥 Teilnehmende';
    viewRefs.pageTitleInput.readOnly = true;
  }

  // 3. Hide editing toolbars and markdown toggle button
  if (typeof viewRefs.getFormatToolbar === 'function') {
    const toolbar = viewRefs.getFormatToolbar();
    if (toolbar) toolbar.style.display = 'none';
  }
  if (viewRefs.markdownToggleBtn) viewRefs.markdownToggleBtn.style.display = 'none';
  if (viewRefs.translatePageBtn) viewRefs.translatePageBtn.style.display = 'none';

  // 4. Update save status indicator to Read-only / Live badge
  if (viewRefs.saveStatus) {
    viewRefs.saveStatus.classList.remove('saving', 'error', 'offline');
    viewRefs.saveStatus.className = 'save-status read-only-live-badge';
    viewRefs.saveStatus.innerHTML = '<span class="status-dot-pulse"></span> ' + i18next.t('editor.readOnlyLive', { defaultValue: 'Live synchronisiert (Schreibgeschützt)' });
  }

  // 5. Show container and start listener
  if (viewRefs.usersPreviewEl) {
    viewRefs.usersPreviewEl.classList.remove('hidden');
    viewRefs.usersPreviewEl.style.display = 'block';
    renderUsersView();
  }

  // 6. Subscribe to users collection
  if (usersUnsub) usersUnsub();
  usersUnsub = subscribeToUsers((users) => {
    // Sort chronologically (earliest joined first)
    currentUsers = [...users].sort((a, b) => {
      const getMs = (u) => {
        if (u.joinedAt?.toMillis) return u.joinedAt.toMillis();
        if (u.joinedAt?._seconds) return u.joinedAt._seconds * 1000;
        if (u.joinedAt?.seconds) return u.joinedAt.seconds * 1000;
        if (u.updatedAt?.toMillis) return u.updatedAt.toMillis();
        return 0;
      };
      return getMs(a) - getMs(b);
    });

    if (isUsersViewActive) {
      renderUsersView();
    }
  });
}

/**
 * Exits users view mode and cleans up listeners.
 */
export function exitUsersView() {
  if (!isUsersViewActive) return;

  isUsersViewActive = false;

  if (usersUnsub) {
    usersUnsub();
    usersUnsub = null;
  }

  if (viewRefs.usersPreviewEl) {
    viewRefs.usersPreviewEl.classList.add('hidden');
    viewRefs.usersPreviewEl.style.display = 'none';
    viewRefs.usersPreviewEl.innerHTML = '';
  }

  if (viewRefs.editorEl) {
    viewRefs.editorEl.style.display = 'block';
  }

  if (viewRefs.translatePageBtn) {
    viewRefs.translatePageBtn.style.display = 'inline-flex';
  }

  if (typeof viewRefs.recomputeSaveStatus === 'function') {
    viewRefs.recomputeSaveStatus();
  }
}

/**
 * Renders the users list view UI.
 */
function renderUsersView() {
  const container = viewRefs.usersPreviewEl;
  if (!container) return;

  const totalCount = currentUsers.length;
  const filteredUsers = currentUsers.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    const name = (u.displayName || formatDefaultName(u.email) || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  container.innerHTML = `
    <div class="users-view-container">
      <div class="users-view-header">
        <div class="users-view-title-row">
          <div>
            <h2 class="users-view-heading">Registrierte Teilnehmende 👥</h2>
            <p class="users-view-subtext">
              Diese Übersicht wird <strong>automatisch in Echtzeit</strong> aktualisiert, sobald sich jemand über den Einladungslink anmeldet.
            </p>
          </div>
          <div class="users-count-badge">
            <span class="pulse-dot"></span>
            <strong>${totalCount}</strong> Teilnehmende registriert
          </div>
        </div>

        <!-- Invite Card -->
        <div class="users-invite-card">
          <div class="users-invite-info">
            <div class="users-invite-title">🚀 Kolleginnen und Kollegen einladen</div>
            <div class="users-invite-desc">
              Leite diesen Zugangslink weiter. Bei der ersten Anmeldung mit der <code>@insel.ch</code> Adresse wird das Konto sofort aktiviert:
            </div>
            <div class="users-invite-link-row">
              <input type="text" class="users-invite-input" readonly value="${getJoinLink()}" id="users-join-link-input" />
              <button class="btn btn-primary users-copy-btn" id="users-copy-link-btn">
                📋 Link kopieren
              </button>
            </div>
          </div>
        </div>

        <!-- Search Bar -->
        <div class="users-search-row">
          <div class="users-search-wrapper">
            <svg class="users-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input 
              type="text" 
              id="users-search-input" 
              class="users-search-input" 
              placeholder="Teilnehmende nach Name oder E-Mail durchsuchen…" 
              value="${escapeHtml(searchQuery)}" 
            />
            ${searchQuery ? `<button id="users-search-clear" class="users-search-clear">&times;</button>` : ''}
          </div>
        </div>
      </div>

      <!-- Users Table / Roster -->
      <div class="users-table-wrapper">
        <table class="users-table">
          <thead>
            <tr>
              <th style="width: 48px; text-align: center;">#</th>
              <th>Person</th>
              <th>E-Mail</th>
              <th>Status</th>
              <th>Registriert am</th>
              <th style="width: 110px; text-align: center;">Erwähnen</th>
            </tr>
          </thead>
          <tbody>
            ${filteredUsers.length > 0 ? filteredUsers.map((user, idx) => {
              const name = user.displayName || formatDefaultName(user.email);
              const initials = getInitials(name);
              const color = getColorForEmail(user.email || name);
              const joinDate = formatJoinDate(user.joinedAt || user.updatedAt);
              const isStephan = user.email === 'stephan.heuscher@insel.ch';

              return `
                <tr class="user-row">
                  <td class="user-cell-index">${idx + 1}</td>
                  <td class="user-cell-profile">
                    <div class="user-avatar-wrap">
                      ${user.photoURL ? `
                        <img src="${escapeHtml(user.photoURL)}" class="user-avatar-img" alt="${escapeHtml(name)}" />
                      ` : `
                        <div class="user-avatar-initials" style="background-color: ${color};">
                          ${escapeHtml(initials)}
                        </div>
                      `}
                    </div>
                    <div class="user-name-col">
                      <div class="user-display-name">
                        ${escapeHtml(name)}
                        ${isStephan ? '<span class="user-role-badge orga">Orga / WikiBot</span>' : ''}
                      </div>
                    </div>
                  </td>
                  <td class="user-cell-email">
                    <code class="user-email-code">${escapeHtml(user.email || '—')}</code>
                  </td>
                  <td class="user-cell-status">
                    <span class="user-status-pill active">
                      <span class="status-dot"></span> Aktiv
                    </span>
                  </td>
                  <td class="user-cell-date">
                    ${escapeHtml(joinDate)}
                  </td>
                  <td class="user-cell-action" style="text-align: center;">
                    <button class="btn-mention-tag" data-name="${escapeHtml(name)}" title="@${escapeHtml(name)} kopieren">
                      @${escapeHtml(name.split(' ')[0])}
                    </button>
                  </td>
                </tr>
              `;
            }).join('') : `
              <tr>
                <td colspan="6" class="users-empty-row">
                  Keine Teilnehmenden für "<strong>${escapeHtml(searchQuery)}</strong>" gefunden.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Attach search events
  const searchInput = container.querySelector('#users-search-input');
  if (searchInput) {
    searchInput.focus();
    // Keep cursor at end of input
    const len = searchInput.value.length;
    searchInput.setSelectionRange(len, len);

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderUsersView();
    });
  }

  const clearBtn = container.querySelector('#users-search-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchQuery = '';
      renderUsersView();
    });
  }

  // Copy link button
  const copyBtn = container.querySelector('#users-copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getJoinLink());
        showToast('Einladungslink in die Zwischenablage kopiert! 📋', 'success');
      } catch (err) {
        showToast('Kopieren fehlgeschlagen.', 'error');
      }
    });
  }

  // Mention buttons
  container.querySelectorAll('.btn-mention-tag').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mentionName = `@${btn.dataset.name}`;
      try {
        await navigator.clipboard.writeText(mentionName);
        showToast(`${mentionName} in Zwischenablage kopiert!`, 'info');
      } catch (e) {
        showToast(`${mentionName}`, 'info');
      }
    });
  });
}
