import { getAllPages } from './sidebar.js';
import { slugify } from '../utils/string.js';

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
    cancelBtn.textContent = 'Abbrechen';
    
    // 7. Submit button
    const submitBtn = document.createElement('button');
    submitBtn.id = 'prompt-modal-submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'OK';
    
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
      document.body.removeChild(overlay);
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
      recentPages = JSON.parse(localStorage.getItem('recent_pages') || '[]');
    } catch(e) {}

    const updateDropdown = (inputEl) => {
      const filter = inputEl.value;
      dropdown.innerHTML = '';
      let results = [];

      if (!filter) {
        // Show recent pages if no filter
        if (recentPages.length > 0) {
          const dHeader = document.createElement('div');
          dHeader.className = 'dropdown-header';
          dHeader.textContent = 'Zuletzt besucht';
          dropdown.appendChild(dHeader);
          results = recentPages.slice(0, 5);
        }
      } else {
        const f = filter.toLowerCase();
        results = allPages.filter(p => p.title.toLowerCase().includes(f)).slice(0, 8);
      }

      if (results.length > 0) {
        results.forEach(p => {
          const item = document.createElement('div');
          item.className = 'dropdown-item';
          item.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${p.title}</span>
          `;
          item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent blur on input
            urlInput.value = `#/${p.id}/${slugify(p.title)}`;
            if (!textInput.value || textInput.value === filter) {
               textInput.value = p.title;
            }
            dropdown.classList.add('hidden');
          });
          dropdown.appendChild(item);
        });
        
        // Position dropdown below the current input field
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

    [textInput, urlInput].forEach(el => {
      el.addEventListener('focus', () => updateDropdown(el));
      el.addEventListener('input', () => updateDropdown(el));
      el.addEventListener('blur', () => {
        // Small delay to allow click on dropdown items
        setTimeout(() => dropdown.classList.add('hidden'), 200);
      });
    });

    const cleanup = () => document.body.removeChild(overlay);
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

    submitBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    [textInput, urlInput].forEach(el => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    }));

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
    header.textContent = 'Neue Seite erstellen';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'new-page-modal-input';
    input.className = 'modal-input';
    input.placeholder = 'Seitentitel…';
    input.value = 'Neue Seite';

    // Options container
    const options = document.createElement('div');
    options.className = 'modal-options';

    // Option: Sub-page
    const childOption = document.createElement('label');
    childOption.className = 'modal-checkbox-label';
    childOption.innerHTML = `
      <input type="checkbox" id="modal-opt-child" ${canBeChild ? 'checked' : ''} ${!canBeChild ? 'disabled' : ''}>
      <span style="${!canBeChild ? 'opacity: 0.5' : ''}">Als Unterseite der aktuellen Seite erstellen</span>
    `;

    // Option: Insert link
    const linkOption = document.createElement('label');
    linkOption.className = 'modal-checkbox-label';
    linkOption.innerHTML = `
      <input type="checkbox" id="modal-opt-link">
      <span>Link in aktuelle Seite einfügen</span>
    `;

    options.appendChild(childOption);
    options.appendChild(linkOption);
    
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Abbrechen';
    
    const submitBtn = document.createElement('button');
    submitBtn.id = 'new-page-modal-submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Erstellen';
    
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
      document.body.removeChild(overlay);
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
