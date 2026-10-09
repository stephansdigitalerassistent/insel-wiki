import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import tippy from 'tippy.js';
import { tableModal } from '../components/modal.js';
import i18next from '../i18n.js';

/**
 * @module editor/SlashCommands
 * @description
 * Tiptap extension that displays a slash command palette when typing '/' at the beginning of a line or after whitespace.
 * Provides fast keyboard shortcuts for creating follow-up meetings, inserting tables, dates, tasks, headings, etc.
 */

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        // No palette inside code, where a slash is ordinary text.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        // Its own key: the default one would collide with any other Suggestion plugin.
        pluginKey: new PluginKey('slashCommands'),
        ...this.options.suggestion,
        items: ({ query }) => {
          const q = (query || '').toLowerCase().trim();
          const commands = [
            {
              id: 'next-meeting',
              title: i18next.t('slash.nextMeetingTitle') || 'Nächstes Meeting / Folge-Seite',
              description: i18next.t('slash.nextMeetingDesc') || 'Erstellt automatisch das nächste Meeting (z.B. micha-12) mit Pendenzen & Struktur',
              icon: '📅',
              badge: 'Smart',
              keywords: ['next', 'meeting', 'folge', '1:1', 'termin', 'sync', 'standup', 'jour fixe', 'notes'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).run();
                window.dispatchEvent(new CustomEvent('wiki:create-followup-meeting'));
              }
            },
            {
              id: 'table',
              title: i18next.t('slash.tableTitle') || 'Tabelle',
              description: i18next.t('slash.tableDesc') || 'Fügt eine anpassbare Tabelle ein',
              icon: '📊',
              keywords: ['table', 'tabelle', 'grid', 'spalten', 'zeilen'],
              command: async ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).run();
                const res = await tableModal(3, 3, true);
                if (res) {
                  editor.chain().focus().insertTable({ rows: res.rows, cols: res.cols, withHeaderRow: res.withHeaderRow }).run();
                }
              }
            },
            {
              id: 'date',
              title: i18next.t('slash.dateTitle') || 'Datum (Pille)',
              description: i18next.t('slash.dateDesc') || 'Fügt ein interaktives Datumselement ein',
              icon: '🗓️',
              keywords: ['date', 'datum', 'today', 'heute', 'calendar', 'kalender'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).insertContent({ type: 'dateNode' }).run();
              }
            },
            {
              id: 'task',
              title: i18next.t('slash.taskTitle') || 'Aufgabe / To-Do',
              description: i18next.t('slash.taskDesc') || 'Fügt eine Checkliste mit Kontrollkästchen ein',
              icon: '☑️',
              keywords: ['task', 'todo', 'aufgabe', 'check', 'checkbox', 'pendenzen'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).toggleTaskList().run();
              }
            },
            {
              id: 'h1',
              title: i18next.t('slash.h1Title') || 'Überschrift 1',
              description: i18next.t('slash.h1Desc') || 'Grosse Hauptüberschrift',
              icon: 'H1',
              keywords: ['h1', 'heading', 'titel', 'header', 'überschrift'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
              }
            },
            {
              id: 'h2',
              title: i18next.t('slash.h2Title') || 'Überschrift 2',
              description: i18next.t('slash.h2Desc') || 'Mittlere Zwischenüberschrift',
              icon: 'H2',
              keywords: ['h2', 'heading', 'untertitel', 'header', 'überschrift'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
              }
            },
            {
              id: 'h3',
              title: i18next.t('slash.h3Title') || 'Überschrift 3',
              description: i18next.t('slash.h3Desc') || 'Kleine Abschnittsüberschrift',
              icon: 'H3',
              keywords: ['h3', 'heading', 'abschnitt', 'header', 'überschrift'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
              }
            },
            {
              id: 'bulletList',
              title: i18next.t('slash.bulletListTitle') || 'Aufzählungsliste',
              description: i18next.t('slash.bulletListDesc') || 'Einfache Liste mit Aufzählungspunkten',
              icon: '•',
              keywords: ['bullet', 'list', 'liste', 'punkte', 'aufzählung'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).toggleBulletList().run();
              }
            },
            {
              id: 'orderedList',
              title: i18next.t('slash.orderedListTitle') || 'Nummerierte Liste',
              description: i18next.t('slash.orderedListDesc') || 'Geordnete Liste mit fortlaufenden Nummern',
              icon: '1.',
              keywords: ['ordered', 'list', 'nummeriert', 'zahlen', 'liste'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).toggleOrderedList().run();
              }
            },
            {
              id: 'divider',
              title: i18next.t('slash.dividerTitle') || 'Trennlinie',
              description: i18next.t('slash.dividerDesc') || 'Horizontale visuelle Trennung',
              icon: '—',
              keywords: ['divider', 'linie', 'hr', 'separator', 'trennlinie'],
              command: ({ editor, range }) => {
                editor.chain().focus().deleteRange(range).setHorizontalRule().run();
              }
            }
          ];

          if (!q) return commands;

          return commands.filter(cmd => {
            const titleMatch = cmd.title.toLowerCase().includes(q);
            const descMatch = cmd.description.toLowerCase().includes(q);
            const keywordMatch = cmd.keywords.some(k => k.toLowerCase().includes(q));
            return titleMatch || descMatch || keywordMatch;
          });
        },
        render: () => {
          let component;
          let popup;
          let selectedIndex = 0;
          let currentItems = [];
          let currentCommand = null;
          // After Escape the suggestion stays active until the cursor leaves it;
          // Enter and the arrows must go back to the editor meanwhile.
          let dismissed = false;

          const renderItems = () => {
            if (currentItems.length === 0) {
              component.innerHTML = `<div class="slash-item no-result">${i18next.t('slash.noResult')}</div>`;
              return;
            }

            component.innerHTML = currentItems.map((item, index) => `
              <button type="button" class="slash-item ${index === selectedIndex ? 'is-selected' : ''}" data-index="${index}">
                <div class="slash-item-icon">${item.icon}</div>
                <div class="slash-item-content">
                  <div class="slash-item-title-row">
                    <span class="slash-item-title">${item.title}</span>
                    ${item.badge ? `<span class="slash-item-badge">${item.badge}</span>` : ''}
                  </div>
                  <div class="slash-item-desc">${item.description}</div>
                </div>
              </button>
            `).join('');

            component.querySelectorAll('.slash-item').forEach((btn) => {
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index, 10);
                const item = currentItems[idx];
                if (item && currentCommand) {
                  currentCommand(item);
                }
              });
            });
          };

          return {
            onStart: (props) => {
              component = document.createElement('div');
              component.className = 'slash-suggestions';

              currentItems = props.items || [];
              currentCommand = props.command;
              selectedIndex = 0;
              dismissed = false;

              renderItems();

              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                zIndex: 9999,
              });
            },

            onUpdate: (props) => {
              currentItems = props.items || [];
              currentCommand = props.command;
              selectedIndex = 0;

              renderItems();

              if (popup && !dismissed) {
                popup.setProps({
                  getReferenceClientRect: props.clientRect,
                });
              }
            },

            onKeyDown: (props) => {
              if (dismissed) return false;

              if (props.event.key === 'Escape') {
                dismissed = true;
                if (popup) popup.hide();
                return true;
              }

              if (props.event.key === 'ArrowUp') {
                if (!currentItems.length) return false;
                selectedIndex = (selectedIndex + currentItems.length - 1) % currentItems.length;
                renderItems();
                const selectedBtn = component.querySelector('.slash-item.is-selected');
                if (selectedBtn) selectedBtn.scrollIntoView({ block: 'nearest' });
                return true;
              }

              if (props.event.key === 'ArrowDown') {
                if (!currentItems.length) return false;
                selectedIndex = (selectedIndex + 1) % currentItems.length;
                renderItems();
                const selectedBtn = component.querySelector('.slash-item.is-selected');
                if (selectedBtn) selectedBtn.scrollIntoView({ block: 'nearest' });
                return true;
              }

              if (props.event.key === 'Enter') {
                if (!currentItems.length) return false;
                const item = currentItems[selectedIndex];
                if (item && currentCommand) {
                  currentCommand(item);
                }
                return true;
              }

              return false;
            },

            onExit: () => {
              if (popup) {
                popup.destroy();
              }
            },
          };
        }
      }),
    ];
  },
});
