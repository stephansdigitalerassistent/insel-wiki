// Mention suggestions — dropdown list logic
import tippy from 'tippy.js';
import { getUsers } from '../firebase/firestore.js';

export default {
  items: async ({ query }) => {
    // 1. Fetch users from Firestore
    const users = await getUsers();
    
    // 2. Map to mention format and filter by query
    return users
      .map(u => ({
        id: u.id,
        label: u.displayName || u.email || 'Unbekannt',
        photoURL: u.photoURL,
      }))
      .filter(item => 
        item.label.toLowerCase().startsWith(query.toLowerCase())
      )
      .slice(0, 10);
  },

  render: () => {
    let component;
    let popup;

    return {
      onStart: props => {
        // Create the dropdown element
        component = document.createElement('div');
        component.className = 'mention-suggestions';
        
        // Initial render
        updateComponent(component, props);

        // Setup Tippy popup
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

      onUpdate(props) {
        updateComponent(component, props);

        if (popup) {
          popup.setProps({
            getReferenceClientRect: props.clientRect,
          });
        }
      },

      onKeyDown(props) {
        if (props.event.key === 'Escape') {
          popup.hide();
          return true;
        }

        return handleKeyDown(component, props);
      },

      onExit() {
        if (popup) {
          popup.destroy();
        }
      },
    };
  },
};

function updateComponent(container, props) {
  if (props.items.length === 0) {
    container.innerHTML = '<div class="mention-item no-result">Keine Benutzer gefunden</div>';
    return;
  }

  container.innerHTML = props.items.map((item, index) => `
    <button class="mention-item ${index === props.selectedIndex ? 'is-selected' : ''}" data-id="${item.id}">
      ${item.photoURL 
        ? `<img src="${item.photoURL}" class="mention-avatar" />` 
        : `<div class="mention-avatar-placeholder">${item.label.charAt(0).toUpperCase()}</div>`
      }
      <span class="mention-label">${item.label}</span>
    </button>
  `).join('');

  // Bind click events to items
  container.querySelectorAll('.mention-item').forEach((item, index) => {
    item.onclick = () => props.command({ id: item.dataset.id, label: item.textContent.trim() });
  });
}

function handleKeyDown(container, props) {
  const { event, items, selectedIndex, command } = props;

  if (event.key === 'ArrowUp') {
    const nextIndex = (selectedIndex + items.length - 1) % items.length;
    props.updateProps({ selectedIndex: nextIndex });
    return true;
  }

  if (event.key === 'ArrowDown') {
    const nextIndex = (selectedIndex + 1) % items.length;
    props.updateProps({ selectedIndex: nextIndex });
    return true;
  }

  if (event.key === 'Enter') {
    const item = items[selectedIndex];
    if (item) {
      command({ id: item.id, label: item.label });
    }
    return true;
  }

  return false;
}
