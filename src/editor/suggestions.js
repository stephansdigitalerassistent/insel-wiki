// Mention suggestions — dropdown list logic
import tippy from 'tippy.js';
import { getUsers } from '../firebase/firestore.js';
import { auth } from '../firebase/config.js';
import { formatDefaultName } from '../utils/string.js';

const FREQUENCY_KEY_PREFIX = 'mention-frequencies-';

function getFrequencies(userId) {
  if (!userId) return {};
  try {
    const data = localStorage.getItem(FREQUENCY_KEY_PREFIX + userId);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

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

  render: () => {
    let component;
    let popup;
    let selectedIndex = 0;
    let currentItems = [];
    let currentCommand = null;

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

      onExit() {
        if (popup) {
          popup.destroy();
        }
      },
    };
  },
};
