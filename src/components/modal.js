import { getAllPages } from './sidebar.js';
import { slugify } from '../utils/string.js';
import { getCurrentPageId } from '../controllers/page.js';
import i18next from '../i18n.js';

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
