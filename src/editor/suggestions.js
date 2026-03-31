// Mention suggestions — dropdown list logic
import tippy from 'tippy.js';
import { getUsers } from '../firebase/firestore.js';
import { auth } from '../firebase/config.js';
import { formatDefaultName } from '../utils/string.js';

export default {
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
        };
      })
      .filter(item => 
        item.label.toLowerCase().includes(query.toLowerCase())
      )
      // Sort so "(Ich)" comes first if it matches
      .sort((a, b) => {
        if (a.label.includes('(Ich)')) return -1;
        if (b.label.includes('(Ich)')) return 1;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 10);
  },

  render: () => {
    let component;
    let popup;
    let selectedIndex = 0;

    const renderItems = (props) => {
      if (props.items.length === 0) {
        component.innerHTML = '<div class="mention-item no-result">Keine Benutzer gefunden</div>';
        return;
      }

      component.innerHTML = props.items.map((item, index) => `
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
          const item = props.items[index];
          if (item) props.command({ id: item.id, label: item.label });
        });
      });
    };

    return {
      onStart: props => {
        component = document.createElement('div');
        component.className = 'mention-suggestions';
        selectedIndex = 0;
        renderItems(props);

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
        selectedIndex = 0;
        renderItems(props);

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
        
        const { items, command } = props;

        if (props.event.key === 'ArrowUp') {
          selectedIndex = (selectedIndex + items.length - 1) % items.length;
          renderItems(props);
          return true;
        }

        if (props.event.key === 'ArrowDown') {
          selectedIndex = (selectedIndex + 1) % items.length;
          renderItems(props);
          return true;
        }

        if (props.event.key === 'Enter') {
          const item = items[selectedIndex];
          if (item) {
            command({ id: item.id, label: item.label });
          }
          return true;
        }

        return false;
      },

      onExit() {
        if (popup) {
          popup.destroy();
        }
      },
    };
  },
};
