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
