import { getAllPages } from './sidebar.js';
import { slugify } from '../utils/string.js';
import { getCurrentPageId } from '../controllers/page.js';
import i18next from '../i18n.js';
import { auth } from '../firebase/config.js';

/**
 * Custom Promise-based modal for confirming actions.
 * Replaces the native and ugly `window.confirm()`.
 */
export function confirmModal(title, message = '', confirmLabel = i18next.t('common.delete')) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal-box';
    
    const header = document.createElement('h3');
    header.className = 'modal-title';
    header.textContent = title;
    
    const text = document.createElement('p');
    text.className = 'modal-message';
    text.style.marginBottom = '1.5rem';
    text.textContent = message;
    
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = i18next.t('common.cancel');
    
    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-danger';
    submitBtn.textContent = confirmLabel;
    
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    
    modal.appendChild(header);
    if (message) modal.appendChild(text);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    setTimeout(() => submitBtn.focus(), 10);

    const cleanup = () => {
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    const submit = () => {
      cleanup();
      resolve(true);
    };

    const cancel = () => {
      cleanup();
      resolve(false);
    };

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel();
    });
  });
}

/**
 * Custom Promise-based modal for getting user inputs.
 * Replaces the native and ugly `window.prompt()`.
 */
export function promptModal(title, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    // 1. Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    // 2. Create modal box
    const modal = document.createElement('div');
    modal.className = 'modal-box';
    
    // 3. Title
    const header = document.createElement('h3');
    header.className = 'modal-title';
    header.textContent = title;
    
    // 4. Input field
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'prompt-modal-input';
    input.className = 'modal-input';
    input.placeholder = placeholder;
    input.value = defaultValue;
    
    // 5. Buttons container
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    // 6. Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = i18next.t('common.cancel');

    // 7. Submit button
    const submitBtn = document.createElement('button');
    submitBtn.id = 'prompt-modal-submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = i18next.t('common.ok');
    // Assemble
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    modal.appendChild(header);
    modal.appendChild(input);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Focus input immediately
    // Small timeout ensures it works after being appended to DOM
    setTimeout(() => {
      input.focus();
      input.select();
    }, 10);

    // Cleanup function
    const cleanup = () => {
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    // Event listeners
    const submit = () => {
      cleanup();
      resolve(input.value.trim() || null); // Return null if empty
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });

    // Close on click outside
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel();
    });
  });
}

/**
 * Advanced modal for inserting and editing links.
 * Features: display text editing, page search, and recently visited pages.
 */
export function linkModal(initialUrl = '', initialText = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal-box link-modal-box';
    
    const header = document.createElement('h3');
    header.className = 'modal-title';
    header.textContent = initialUrl ? 'Link bearbeiten' : 'Link einfügen';
    
    // 1. Text Field
    const textGroup = document.createElement('div');
    textGroup.className = 'form-group';
    textGroup.innerHTML = '<label>Anzeigetext</label>';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'modal-input';
    textInput.placeholder = 'Link-Text…';
    textInput.value = initialText;
    textGroup.appendChild(textInput);

    // 2. URL/Search Field
    const urlGroup = document.createElement('div');
    urlGroup.className = 'form-group';
    urlGroup.innerHTML = '<label>Ziel (URL oder Seite suchen)</label>';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'modal-input';
    urlInput.placeholder = 'https://... oder Seitentitel…';
    urlInput.value = initialUrl;
    urlGroup.appendChild(urlInput);

    // 3. Dropdown Container
    const dropdown = document.createElement('div');
    dropdown.className = 'link-search-dropdown hidden';
    modal.style.position = 'relative'; // modal is now the anchor for the absolute dropdown
    modal.appendChild(dropdown);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Abbrechen';
    
    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Speichern';
    
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);

    modal.appendChild(header);
    modal.appendChild(textGroup);
    modal.appendChild(urlGroup);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const allPages = getAllPages() || [];
    let recentPages = [];
    try {
      const currentPageId = getCurrentPageId();
      recentPages = JSON.parse(localStorage.getItem('recent_pages') || '[]')
        .filter(p => p.id !== currentPageId);
    } catch(e) {}

    let selectedIndex = -1;
    let currentResults = [];

    const selectResult = (p, filterValue) => {
      urlInput.value = `#/${p.id}/${slugify(p.title)}`;
      if (!textInput.value || textInput.value === filterValue) {
         textInput.value = p.title;
      }
      dropdown.classList.add('hidden');
      selectedIndex = -1;
    };

    const updateDropdown = (inputEl) => {
      const filter = inputEl.value;
      dropdown.innerHTML = '';
      let results = [];

      if (!filter) {
        if (recentPages.length > 0) {
          const dHeader = document.createElement('div');
          dHeader.className = 'dropdown-header';
          dHeader.textContent = 'Zuletzt besucht';
          dropdown.appendChild(dHeader);
          results = recentPages.slice(0, 5);
        }
      } else {
        const f = filter.toLowerCase();
        // Sort by whether it's in recent pages first
        const matched = allPages.filter(p => p.title.toLowerCase().includes(f));
        const matchedRecent = recentPages.filter(p => p.title.toLowerCase().includes(f));
        
        // Merge and deduplicate
        const recentIds = new Set(matchedRecent.map(p => p.id));
        const others = matched.filter(p => !recentIds.has(p.id));
        
        results = [...matchedRecent, ...others].slice(0, 10);
      }

      currentResults = results;
      selectedIndex = -1;

      if (results.length > 0) {
        results.forEach((p, idx) => {
          const item = document.createElement('div');
          item.className = 'dropdown-item';
          item.dataset.index = idx;
          item.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${p.title}</span>
          `;
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectResult(p, filter);
          });
          dropdown.appendChild(item);
        });
        
        const rect = inputEl.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom - modalRect.top + 5}px`;
        dropdown.style.left = `${rect.left - modalRect.left}px`;
        dropdown.style.width = `${rect.width}px`;
        dropdown.classList.remove('hidden');
      } else {
        dropdown.classList.add('hidden');
      }
    };

    const updateHighlight = () => {
      const items = dropdown.querySelectorAll('.dropdown-item');
      items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === selectedIndex);
        if (idx === selectedIndex) {
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    };

    const handleKeyNavigation = (e, inputEl) => {
      if (dropdown.classList.contains('hidden')) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % currentResults.length;
        updateHighlight();
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
        updateHighlight();
        return true;
      }
      if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        selectResult(currentResults[selectedIndex], inputEl.value);
        return true;
      }
      if (e.key === 'Tab' && selectedIndex >= 0) {
         // Auto-complete on Tab if something is selected
         e.preventDefault();
         selectResult(currentResults[selectedIndex], inputEl.value);
         return true;
      }
      return false;
    };

    const cleanup = () => {
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    const submit = () => {
      const url = urlInput.value.trim();
      const text = textInput.value.trim();
      cleanup();
      resolve(url ? { url, text: text || url } : null);
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    [textInput, urlInput].forEach(el => {
      el.addEventListener('focus', () => updateDropdown(el));
      el.addEventListener('input', () => updateDropdown(el));
      el.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 200);
      });
      el.addEventListener('keydown', (e) => {
        if (handleKeyNavigation(e, el)) return;
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') cancel();
      });
    });

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);

    setTimeout(() => {
      if (initialText) {
        urlInput.focus();
        urlInput.select();
      } else {
        textInput.focus();
      }
    }, 10);
  });
}

/**
 * Specialized modal for creating a new page with options
 */
export function newPageModal(canBeChild = false) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal-box';
    
    const header = document.createElement('h3');
    header.className = 'modal-title';
    header.textContent = i18next.t('navigation.newPage.title');
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'new-page-modal-input';
    input.className = 'modal-input';
    input.placeholder = i18next.t('navigation.newPage.placeholder');
    input.value = i18next.t('navigation.newPage.defaultTitle');

    // Options container
    const options = document.createElement('div');
    options.className = 'modal-options';

    // Option: Sub-page
    const childOption = document.createElement('label');
    childOption.className = 'modal-checkbox-label';
    childOption.innerHTML = `
      <input type="checkbox" id="modal-opt-child" ${canBeChild ? 'checked' : ''} ${!canBeChild ? 'disabled' : ''}>
      <span style="${!canBeChild ? 'opacity: 0.5' : ''}">${i18next.t('navigation.newPage.asSubpage')}</span>
    `;

    // Option: Insert link
    const linkOption = document.createElement('label');
    linkOption.className = 'modal-checkbox-label';
    linkOption.innerHTML = `
      <input type="checkbox" id="modal-opt-link">
      <span>${i18next.t('navigation.newPage.insertLink')}</span>
    `;

    options.appendChild(childOption);
    options.appendChild(linkOption);
    
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = i18next.t('common.cancel');
    
    const submitBtn = document.createElement('button');
    submitBtn.id = 'new-page-modal-submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = i18next.t('navigation.newPage.submit');
    
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    modal.appendChild(header);
    modal.appendChild(input);
    modal.appendChild(options);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    setTimeout(() => {
      input.focus();
      input.select();
    }, 10);

    const cleanup = () => {
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    const submit = () => {
      const title = input.value.trim();
      if (!title) return;
      
      const isChild = document.getElementById('modal-opt-child').checked;
      const copyLink = document.getElementById('modal-opt-link').checked;
      
      cleanup();
      resolve({ title, isChild, copyLink });
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel();
    });
  });
}

/**
 * Modal to manage page-level access control list (ACL).
 */
export function openAclModal(page) {
  return new Promise((resolve) => {
    const pageId = page.id;
    let allowedEmails = Array.isArray(page.allowedEmails) ? [...page.allowedEmails] : ['*'];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-box acl-modal-box';
    modal.style.maxWidth = '500px';

    const titleEl = document.createElement('h3');
    titleEl.className = 'modal-title';
    titleEl.textContent = i18next.t('profile.aclTitle') || 'Zugriffsberechtigungen';

    const descEl = document.createElement('p');
    descEl.className = 'modal-message';
    descEl.style.marginBottom = '1rem';
    descEl.textContent = i18next.t('profile.aclDesc', { title: page.title }) || `Verwalten Sie, wer auf "${page.title}" und alle Unterseiten zugreifen darf.`;

    // Type Selector (Public vs Restricted)
    const typeGroup = document.createElement('div');
    typeGroup.className = 'form-group';
    typeGroup.style.marginBottom = '1.5rem';
    typeGroup.innerHTML = `<label style="display:block; margin-bottom: 0.5rem; font-weight:600;">Sichtbarkeit</label>`;

    const radioPublic = document.createElement('label');
    radioPublic.style.cssText = 'display:inline-flex; align-items:center; margin-right: 1.5rem; cursor:pointer; font-size:0.9rem; margin-bottom: 0.5rem;';
    radioPublic.innerHTML = `<input type="radio" name="acl-type" value="public" style="margin-right:0.5rem;" ${allowedEmails.includes('*') ? 'checked' : ''}> Öffentlich (Alle mit @insel.ch)`;

    const radioRestricted = document.createElement('label');
    radioRestricted.style.cssText = 'display:inline-flex; align-items:center; cursor:pointer; font-size:0.9rem; margin-bottom: 0.5rem;';
    radioRestricted.innerHTML = `<input type="radio" name="acl-type" value="restricted" style="margin-right:0.5rem;" ${!allowedEmails.includes('*') ? 'checked' : ''}> Eingeschränkt (Nur bestimmte Personen)`;

    typeGroup.appendChild(radioPublic);
    typeGroup.appendChild(radioRestricted);

    // Restricted Section (emails list & input)
    const restrictedSection = document.createElement('div');
    restrictedSection.style.display = allowedEmails.includes('*') ? 'none' : 'block';

    const emailInputGroup = document.createElement('div');
    emailInputGroup.className = 'form-group';
    emailInputGroup.style.marginBottom = '1rem';
    emailInputGroup.innerHTML = `<label style="display:block; margin-bottom: 0.25rem; font-weight:600;">E-Mail hinzufügen</label>`;

    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'display:flex; gap: 0.5rem;';

    const inputWrapper = document.createElement('div');
    inputWrapper.style.cssText = 'position:relative; flex:1;';

    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.className = 'modal-input';
    emailInput.placeholder = 'vorname.name@insel.ch';
    emailInput.style.cssText = 'width:100%; margin-bottom:0;';

    const suggestionList = document.createElement('div');
    suggestionList.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      box-shadow: var(--glass-shadow);
      z-index: 100;
      max-height: 180px;
      overflow-y: auto;
      display: none;
      margin-top: 4px;
    `;

    inputWrapper.appendChild(emailInput);
    inputWrapper.appendChild(suggestionList);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-secondary';
    addBtn.textContent = 'Hinzufügen';
    
    inputContainer.appendChild(inputWrapper);
    inputContainer.appendChild(addBtn);
    emailInputGroup.appendChild(inputContainer);

    const listGroup = document.createElement('div');
    listGroup.className = 'form-group';
    listGroup.innerHTML = `<label style="display:block; margin-bottom: 0.5rem; font-weight:600;">Personen mit Zugriff</label>`;

    const emailList = document.createElement('div');
    emailList.style.cssText = 'max-height: 150px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.5rem; background: var(--bg-root); margin-bottom: 1rem;';

    function renderEmails() {
      emailList.innerHTML = '';
      const listEmails = allowedEmails.filter(e => e !== '*');
      if (listEmails.length === 0) {
        emailList.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; font-style:italic; padding: 0.25rem;">Noch keine E-Mails hinzugefügt. Die Seite wird für alle gesperrt sein.</div>`;
        return;
      }
      listEmails.forEach(email => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); font-size:0.9rem;';
        if (email === listEmails[listEmails.length - 1]) item.style.borderBottom = 'none';

        const u = allUsers.find(x => x.email && x.email.toLowerCase() === email);

        const person = document.createElement('div');
        person.style.cssText = 'display:flex; align-items:center; gap:8px; min-width:0;';

        if (u && u.photoURL) {
          const img = document.createElement('img');
          img.src = u.photoURL;
          img.style.cssText = 'width:24px; height:24px; border-radius:50%; object-fit:cover; flex-shrink:0;';
          person.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.style.cssText = 'width:24px; height:24px; border-radius:50%; background:var(--accent-subtle); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:600; flex-shrink:0;';
          placeholder.textContent = ((u && u.displayName) || email || 'U').charAt(0).toUpperCase();
          person.appendChild(placeholder);
        }

        const text = document.createElement('div');
        text.style.cssText = 'display:flex; flex-direction:column; min-width:0;';
        if (u && u.displayName) {
          const nameEl = document.createElement('span');
          nameEl.style.cssText = 'font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
          nameEl.textContent = u.displayName;
          const emailEl = document.createElement('span');
          emailEl.style.cssText = 'font-size:0.75rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
          emailEl.textContent = email;
          text.appendChild(nameEl);
          text.appendChild(emailEl);
        } else {
          const emailEl = document.createElement('span');
          emailEl.style.cssText = 'white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
          emailEl.textContent = email;
          text.appendChild(emailEl);
        }
        person.appendChild(text);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.style.cssText = 'background:none; border:none; color:var(--danger); cursor:pointer; font-size:0.85rem; display:flex; align-items:center; justify-content:center; padding: 2px 6px; flex-shrink:0;';
        delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        delBtn.addEventListener('click', () => {
          allowedEmails = allowedEmails.filter(e => e !== email);
          renderEmails();
        });

        item.appendChild(person);
        item.appendChild(delBtn);
        emailList.appendChild(item);
      });
    }

    listGroup.appendChild(emailList);
    restrictedSection.appendChild(emailInputGroup);
    restrictedSection.appendChild(listGroup);

    // Event listeners for Radios
    const handleRadioChange = (e) => {
      if (e.target.value === 'public') {
        restrictedSection.style.display = 'none';
        if (!allowedEmails.includes('*')) {
          allowedEmails.push('*');
        }
      } else {
        restrictedSection.style.display = 'block';
        allowedEmails = allowedEmails.filter(e => e !== '*');
        renderEmails();
      }
    };
    radioPublic.querySelector('input').addEventListener('change', handleRadioChange);
    radioRestricted.querySelector('input').addEventListener('change', handleRadioChange);

    // Autocomplete Logic
    let allUsers = [];
    let selectedSuggestionIndex = -1;
    let filteredUsersList = [];

    import('../firebase/firestore.js').then(async (firestore) => {
      allUsers = await firestore.getUsers();
      // Refresh the access list so already-listed emails pick up names/avatars.
      renderEmails();
    }).catch(err => {
      console.warn('[ACL Modal] Failed to load users for autocomplete:', err);
    });

    function renderSuggestions(filtered) {
      filteredUsersList = filtered;
      suggestionList.innerHTML = '';
      if (filtered.length === 0) {
        suggestionList.style.display = 'none';
        selectedSuggestionIndex = -1;
        return;
      }
      suggestionList.style.display = 'block';
      filtered.forEach((u, index) => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 8px 12px;
          cursor: pointer;
          font-size: 0.9rem;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--border);
          transition: background 0.15s ease;
          color: var(--text-primary);
        `;
        if (index === filtered.length - 1) {
          item.style.borderBottom = 'none';
        }
        if (index === selectedSuggestionIndex) {
          item.style.background = 'var(--bg-hover)';
        }

        if (u.photoURL) {
          const img = document.createElement('img');
          img.src = u.photoURL;
          img.style.cssText = 'width: 24px; height: 24px; border-radius: 50%; object-fit: cover;';
          item.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.style.cssText = `
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--accent-subtle);
            color: var(--accent);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 600;
            flex-shrink: 0;
          `;
          placeholder.textContent = (u.displayName || u.email || 'U').charAt(0).toUpperCase();
          item.appendChild(placeholder);
        }

        const info = document.createElement('div');
        info.style.cssText = 'display: flex; flex-direction: column; text-align: left;';
        
        const nameEl = document.createElement('span');
        nameEl.style.fontWeight = '500';
        nameEl.textContent = u.displayName || u.email.split('@')[0];
        
        const emailEl = document.createElement('span');
        emailEl.style.fontSize = '0.75rem';
        emailEl.style.color = 'var(--text-muted)';
        emailEl.textContent = u.email;

        info.appendChild(nameEl);
        info.appendChild(emailEl);
        item.appendChild(info);

        item.addEventListener('mouseenter', () => {
          selectedSuggestionIndex = index;
          Array.from(suggestionList.children).forEach((child, cIdx) => {
            child.style.background = cIdx === selectedSuggestionIndex ? 'var(--bg-hover)' : '';
          });
        });

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectUser(u);
        });

        suggestionList.appendChild(item);
      });
    }

    emailInput.addEventListener('input', () => {
      const val = emailInput.value.trim().toLowerCase();
      if (!val) {
        renderSuggestions([]);
        return;
      }
      const filtered = allUsers.filter(u => {
        if (!u.email || u.isActive === false) return false;
        if (allowedEmails.includes(u.email.toLowerCase())) return false;
        const nameMatch = u.displayName && u.displayName.toLowerCase().includes(val);
        const emailMatch = u.email.toLowerCase().includes(val);
        return nameMatch || emailMatch;
      });
      selectedSuggestionIndex = filtered.length > 0 ? 0 : -1;
      renderSuggestions(filtered.slice(0, 5));
    });

    const hideSuggestions = (e) => {
      if (e.target !== emailInput && !suggestionList.contains(e.target)) {
        suggestionList.style.display = 'none';
        selectedSuggestionIndex = -1;
      }
    };
    document.addEventListener('click', hideSuggestions);

    // Add a known user picked from the autocomplete list directly.
    const selectUser = (u) => {
      const email = (u.email || '').trim().toLowerCase();
      if (!email) return;
      if (!allowedEmails.includes(email)) {
        allowedEmails.push(email);
        renderEmails();
      }
      emailInput.value = '';
      renderSuggestions([]);
      emailInput.focus();
    };

    // Add email event
    const addEmail = () => {
      const email = emailInput.value.trim().toLowerCase();
      if (!email) return;
      if (!email.endsWith('@insel.ch') && email !== 'stephansdigitalassistent+wiki@gmail.com' && email !== 'stephansdigitalassistent@gmail.com') {
        alert('Bitte geben Sie eine gültige @insel.ch E-Mail-Adresse ein.');
        return;
      }
      if (allowedEmails.includes(email)) {
        emailInput.value = '';
        renderSuggestions([]);
        return;
      }
      allowedEmails.push(email);
      emailInput.value = '';
      renderSuggestions([]);
      renderEmails();
    };
    addBtn.addEventListener('click', addEmail);

    emailInput.addEventListener('keydown', (e) => {
      if (suggestionList.style.display === 'block') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedSuggestionIndex = (selectedSuggestionIndex + 1) % filteredUsersList.length;
          renderSuggestions(filteredUsersList);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedSuggestionIndex = (selectedSuggestionIndex - 1 + filteredUsersList.length) % filteredUsersList.length;
          renderSuggestions(filteredUsersList);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < filteredUsersList.length) {
            selectUser(filteredUsersList[selectedSuggestionIndex]);
          } else {
            addEmail();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          suggestionList.style.display = 'none';
          selectedSuggestionIndex = -1;
        }
      } else {
        if (e.key === 'Enter') {
          e.preventDefault();
          addEmail();
        }
      }
    });

    // Buttons
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    actions.style.marginTop = '1.5rem';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = i18next.t('common.cancel');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = i18next.t('common.save');

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    modal.appendChild(titleEl);
    modal.appendChild(descEl);
    modal.appendChild(typeGroup);
    modal.appendChild(restrictedSection);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = () => {
      document.removeEventListener('click', hideSuggestions);
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Wird gespeichert...';
      try {
        const isPublic = radioPublic.querySelector('input').checked;
        const finalAcl = isPublic ? ['*'] : allowedEmails.filter(e => e !== '*');
        
        // Ensure at least the current user remains in the list if restricted
        const currentUser = auth.currentUser;
        if (!isPublic && currentUser && currentUser.email && !finalAcl.includes(currentUser.email.toLowerCase())) {
          finalAcl.push(currentUser.email.toLowerCase());
        }

        let firestore;
        try {
          firestore = await import('../firebase/firestore.js');
        } catch (importErr) {
          console.error(importErr);
          alert('Fehler beim Laden der Datenbank-Module.');
          saveBtn.disabled = false;
          saveBtn.textContent = i18next.t('common.save');
          return;
        }

        try {
          await firestore.updatePageAcl(pageId, finalAcl);
          cleanup();
          resolve(true);
        } catch (saveErr) {
          console.error(saveErr);
          alert(`Fehler beim Speichern der Berechtigungen: ${saveErr.message || saveErr}`);
          saveBtn.disabled = false;
          saveBtn.textContent = i18next.t('common.save');
        }
      } catch (err) {
        console.error(err);
        alert('Fehler beim Speichern der Berechtigungen.');
        saveBtn.disabled = false;
        saveBtn.textContent = i18next.t('common.save');
      }
    });

    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(false);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(false);
      }
    });
    
    // Initial render
    renderEmails();
  });
}

/**
 * Custom Promise-based modal for inserting a new table with custom dimensions.
 *
 * @param {number} [defaultRows=3] Initial row count (1-20).
 * @param {number} [defaultCols=3] Initial column count (1-10).
 * @param {boolean} [defaultHeader=true] Whether to include a header row.
 * @returns {Promise<{ rows: number, cols: number, withHeaderRow: boolean }|null>}
 */
export function tableModal(defaultRows = 3, defaultCols = 3, defaultHeader = true) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-box table-modal-box';

    const header = document.createElement('h3');
    header.className = 'modal-title';
    header.textContent = i18next.t('editor.insertTable') || 'Tabelle einfügen';

    const form = document.createElement('div');
    form.className = 'table-modal-form';

    // Rows group
    const rowsGroup = document.createElement('div');
    rowsGroup.className = 'form-group';
    const rowsLabel = document.createElement('label');
    rowsLabel.textContent = i18next.t('editor.tableRows') || 'Zeilen (1-20)';
    const rowsInput = document.createElement('input');
    rowsInput.type = 'number';
    rowsInput.className = 'modal-input';
    rowsInput.id = 'table-modal-rows';
    rowsInput.min = '1';
    rowsInput.max = '20';
    rowsInput.value = String(defaultRows);
    rowsGroup.appendChild(rowsLabel);
    rowsGroup.appendChild(rowsInput);

    // Cols group
    const colsGroup = document.createElement('div');
    colsGroup.className = 'form-group';
    const colsLabel = document.createElement('label');
    colsLabel.textContent = i18next.t('editor.tableCols') || 'Spalten (1-10)';
    const colsInput = document.createElement('input');
    colsInput.type = 'number';
    colsInput.className = 'modal-input';
    colsInput.id = 'table-modal-cols';
    colsInput.min = '1';
    colsInput.max = '10';
    colsInput.value = String(defaultCols);
    colsGroup.appendChild(colsLabel);
    colsGroup.appendChild(colsInput);

    // Header checkbox group
    const headerGroup = document.createElement('div');
    headerGroup.className = 'form-group checkbox-group';
    const headerLabel = document.createElement('label');
    headerLabel.style.display = 'flex';
    headerLabel.style.alignItems = 'center';
    headerLabel.style.gap = '8px';
    headerLabel.style.cursor = 'pointer';
    const headerInput = document.createElement('input');
    headerInput.type = 'checkbox';
    headerInput.id = 'table-modal-header';
    headerInput.checked = defaultHeader;
    const headerSpan = document.createElement('span');
    headerSpan.textContent = i18next.t('editor.withHeaderRow') || 'Kopfzeile verwenden';
    headerLabel.appendChild(headerInput);
    headerLabel.appendChild(headerSpan);
    headerGroup.appendChild(headerLabel);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = i18next.t('common.cancel') || 'Abbrechen';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.id = 'table-modal-submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = i18next.t('common.confirm') || 'Einfügen';

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);

    form.appendChild(rowsGroup);
    form.appendChild(colsGroup);
    form.appendChild(headerGroup);

    modal.appendChild(header);
    modal.appendChild(form);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => {
      rowsInput.focus();
      rowsInput.select();
    }, 10);

    const cleanup = () => {
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    const submit = () => {
      let r = parseInt(rowsInput.value, 10);
      let c = parseInt(colsInput.value, 10);
      if (isNaN(r) || r < 1) r = 1;
      if (r > 20) r = 20;
      if (isNaN(c) || c < 1) c = 1;
      if (c > 10) c = 10;
      const h = headerInput.checked;
      cleanup();
      resolve({ rows: r, cols: c, withHeaderRow: h });
    };

    const cancel = () => {
      cleanup();
      resolve(null);
    };

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel();
    });
  });
}

/**
 * Multi-choice modal warning the user about complex elements (tables, comments, mentions)
 * before entering raw Markdown editing mode.
 *
 * Offers three actions:
 * - 'readonly': safe read-only markdown view (no edits, no data corruption)
 * - 'edit': proceed with editable markdown view (user accepts potential element stripping)
 * - 'cancel': abort and stay in WYSIWYG mode
 *
 * @param {{ tables?: number, comments?: number, mentions?: number }} elements
 * @returns {Promise<'readonly'|'edit'|'cancel'>}
 */
export function markdownWarningModal(elements = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-box markdown-warning-modal-box';

    const header = document.createElement('h3');
    header.className = 'modal-title';
    header.textContent = i18next.t('messages.markdownWarningTitle') || 'Warnung: Komplexe Elemente';

    const message = document.createElement('p');
    message.className = 'modal-message';
    message.style.marginBottom = '1rem';
    message.textContent = i18next.t('messages.markdownWarningDesc') || 'Diese Seite enthält Elemente, die beim Bearbeiten im Raw-Markdown-Modus verloren gehen oder verändert werden:';

    const list = document.createElement('ul');
    list.className = 'markdown-warning-list';

    if (elements.tables && elements.tables > 0) {
      const li = document.createElement('li');
      const tableText = elements.tables === 1
        ? (i18next.t('messages.markdownWarningTableSingle') || '1 Tabelle (Struktur und Formatierung können verändert werden)')
        : (i18next.t('messages.markdownWarningTables', { count: elements.tables }) || `${elements.tables} Tabellen (Struktur und Formatierung können verändert werden)`);
      li.textContent = tableText;
      list.appendChild(li);
    }

    if (elements.comments && elements.comments > 0) {
      const li = document.createElement('li');
      const commentText = elements.comments === 1
        ? (i18next.t('messages.markdownWarningCommentSingle') || '1 Inline-Kommentar (wird beim Bearbeiten im Markdown-Modus gelöscht)')
        : (i18next.t('messages.markdownWarningComments', { count: elements.comments }) || `${elements.comments} Inline-Kommentare (werden beim Bearbeiten im Markdown-Modus gelöscht)`);
      li.textContent = commentText;
      list.appendChild(li);
    }

    if (elements.mentions && elements.mentions > 0) {
      const li = document.createElement('li');
      const mentionText = elements.mentions === 1
        ? (i18next.t('messages.markdownWarningMentionSingle') || '1 Erwähnung (wird in einfachen @Text umgewandelt)')
        : (i18next.t('messages.markdownWarningMentions', { count: elements.mentions }) || `${elements.mentions} Erwähnungen (werden in einfachen @Text umgewandelt)`);
      li.textContent = mentionText;
      list.appendChild(li);
    }

    const notice = document.createElement('p');
    notice.className = 'modal-message';
    notice.style.fontSize = '0.85rem';
    notice.style.color = 'var(--text-muted)';
    notice.style.marginBottom = '1.5rem';
    notice.textContent = i18next.t('messages.markdownWarningLossNotice') || 'Wählen Sie «Nur lesen», um den Markdown-Quelltext sicher anzuzeigen oder zu kopieren.';

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.id = 'md-warning-cancel';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = i18next.t('common.cancel') || 'Abbrechen';

    const readOnlyBtn = document.createElement('button');
    readOnlyBtn.type = 'button';
    readOnlyBtn.id = 'md-warning-readonly';
    readOnlyBtn.className = 'btn btn-secondary';
    readOnlyBtn.textContent = i18next.t('messages.markdownWarningReadOnly') || 'Nur lesen';

    const editAnywayBtn = document.createElement('button');
    editAnywayBtn.type = 'button';
    editAnywayBtn.id = 'md-warning-edit';
    editAnywayBtn.className = 'btn btn-danger';
    editAnywayBtn.textContent = i18next.t('messages.markdownWarningEditAnyway') || 'Trotzdem bearbeiten';

    actions.appendChild(cancelBtn);
    actions.appendChild(readOnlyBtn);
    actions.appendChild(editAnywayBtn);

    modal.appendChild(header);
    modal.appendChild(message);
    modal.appendChild(list);
    modal.appendChild(notice);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    setTimeout(() => {
      readOnlyBtn.focus();
    }, 10);

    const cleanup = () => {
      if (overlay.parentNode === document.body) {
        document.body.removeChild(overlay);
      }
    };

    const choose = (choice) => {
      cleanup();
      resolve(choice);
    };

    cancelBtn.addEventListener('click', () => choose('cancel'));
    readOnlyBtn.addEventListener('click', () => choose('readonly'));
    editAnywayBtn.addEventListener('click', () => choose('edit'));

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        choose('cancel');
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        choose('cancel');
      }
    });
  });
}


