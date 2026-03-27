// Tiptap WYSIWYG Editor with Yjs collaboration
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { CodeBlock } from '@tiptap/extension-code-block';
import { CharacterCount } from '@tiptap/extension-character-count';
import * as Y from 'yjs';
import { FirestoreYjsProvider } from './FirestoreYjsProvider.js';

// For Markdown conversion
import TurndownService from 'turndown';
import { marked } from 'marked';
import { promptModal } from '../components/modal.js';
import { uploadImageFile } from '../firebase/storage.js';

let editor = null;
let ydoc = null;
let provider = null;
let currentPageId = null;
let saveCallback = null;
let saveTimeout = null;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

/**
 * Initialize the editor for a given page
 */
export function createEditor(element, pageId, user, onSave) {
  // Clean up previous editor
  destroyEditor();

  currentPageId = pageId;
  saveCallback = onSave;

  // Create Yjs document
  ydoc = new Y.Doc();

  // Create Custom Firestore Provider for robust serverless sync
  provider = new FirestoreYjsProvider(pageId, ydoc, user);
  provider.setLoadCallback((hasYjsState) => {
    // Page loaded successfully
  });

  const extensions = [
    StarterKit.configure({
      history: false, // Yjs handles undo/redo
      undoRedo: false, // Collaboration extension provides its own
      codeBlock: false, // We use the standalone extension
      link: false, // We configure Link separately below
    }),
    CodeBlock,
    Placeholder.configure({
      placeholder: 'Beginne hier zu schreiben…',
    }),
    Image.configure({
      inline: true,
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'editable-link',
      },
    }),
    BubbleMenu.configure({
      element: document.getElementById('link-bubble-menu'),
      shouldShow: ({ editor, from, to }) => {
        // Only show bubble menu when a link is active
        return editor.isActive('link');
      },
    }),
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    CharacterCount.configure({
      limit: 100000,
    }),
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider,
      user: {
        name: user.name,
        color: user.color,
      },
      render(cursorUser) {
        const cursor = document.createElement('span');
        cursor.classList.add('collaboration-cursor__caret');
        cursor.setAttribute('style', `border-color: ${cursorUser.color}`);

        const label = document.createElement('div');
        label.classList.add('collaboration-cursor__label');
        label.setAttribute('style', `background-color: ${cursorUser.color}`);
        
        // Show full name on cursor
        const displayName = cursorUser.name || 'Gast';
        label.insertBefore(document.createTextNode(displayName), null);

        cursor.insertBefore(label, null);
        return cursor;
      },
    }),
  ];

  editor = new Editor({
    element,
    extensions,
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
      handleClick: (view, pos, event) => {
        const { schema } = view.state;
        const attrs = view.state.doc.resolve(pos).marks().find(mark => mark.type === schema.marks.link)?.attrs;
        
        if (attrs?.href && (event.ctrlKey || event.metaKey)) {
          window.open(attrs.href, '_blank');
          return true;
        }
        return false;
      },
      handlePaste: (view, event, slice) => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItems = items.filter(item => item.type.startsWith('image/'));
        if (imageItems.length > 0) {
          event.preventDefault();
          imageItems.forEach(async item => {
            const file = item.getAsFile();
            if (!file) return;
            try {
              const url = await uploadImageFile(file, user?.uid || 'guest');
              if (editor && url) {
                editor.chain().focus().setImage({ src: url }).run();
              }
            } catch (err) {
              console.error('Image upload failed', err);
              alert('Fehler beim Hochladen des Bildes: ' + err.message);
            }
          });
          return true; // prevent default tiptap paste
        }
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
          const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/'));
          if (files.length > 0) {
            event.preventDefault();
            files.forEach(async file => {
              try {
                const url = await uploadImageFile(file, user?.uid || 'guest');
                if (editor && url) {
                  editor.chain().focus().setImage({ src: url }).run();
                }
              } catch (err) {
                console.error('Image upload failed', err);
                alert('Fehler beim Hochladen des Bildes: ' + err.message);
              }
            });
            return true;
          }
        }
        return false;
      }
    },
    onUpdate: ({ editor: ed }) => {
      // Debounced auto-save
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (saveCallback && currentPageId) {
          const html = ed.getHTML();
          let markdown = turndown.turndown(html);
          if (markdown.length > 100000) {
            markdown = markdown.substring(0, 100000);
            console.warn('[Insel-Wiki] Saved content exceeded 100,000 characters and was truncated.');
          }
          saveCallback(currentPageId, markdown);
        }
      }, 1500);
    },
    onTransaction: ({ editor: ed }) => {
      const bubbleUrl = document.getElementById('bubble-link-url');
      if (bubbleUrl && ed.isActive('link')) {
        const { href } = ed.getAttributes('link');
        bubbleUrl.href = href;
        bubbleUrl.textContent = href;
      }
    },
  });

  // Setup Bubble Menu button handlers
  const bubbleEdit = document.getElementById('bubble-link-edit');
  const bubbleUnlink = document.getElementById('bubble-link-unlink');

  if (bubbleEdit) {
    bubbleEdit.onclick = async () => {
      const { href } = editor.getAttributes('link');
      const newUrl = await promptModal('Link bearbeiten:', href);
      if (newUrl !== null) {
        editor.chain().focus().extendMarkRange('link').setLink({ href: newUrl }).run();
      }
    };
  }

  if (bubbleUnlink) {
    bubbleUnlink.onclick = () => {
      editor.chain().focus().unsetLink().run();
    };
  }

  // Start initialization of async Provider load
  provider.init();

  return editor;
}

/**
 * Set editor content from Markdown. 
 * Only runs on initial empty load if no Yjs state exists.
 */
export function setContent(markdown) {
  if (!editor) return;
  const html = marked.parse(markdown || '');
  editor.commands.setContent(html, false);
}

/**
 * Get current content as Markdown
 */
export function getMarkdown() {
  if (!editor) return '';
  const html = editor.getHTML();
  return turndown.turndown(html);
}

/**
 * Get current content as HTML
 */
export function getHTML() {
  if (!editor) return '';
  return editor.getHTML();
}

/**
 * Set editor editable state
 */
export function setEditable(editable) {
  if (editor) {
    editor.setEditable(editable);
  }
}

/**
 * Destroy the editor instance and cleanup sync
 */
export function destroyEditor() {
  clearTimeout(saveTimeout);
  if (editor) {
    editor.destroy();
    editor = null;
  }
  if (provider) {
    provider.destroy();
    provider = null;
  }
  if (ydoc) {
    ydoc.destroy();
    ydoc = null;
  }
  currentPageId = null;
}

/**
 * Get the current Websocket provider
 */
export function getProvider() {
  return provider;
}

/**
 * Get the editor instance (for toolbar actions)
 */
export function getEditor() {
  return editor;
}

/**
 * Create the formatting toolbar HTML and bind actions
 */
export function createFormatToolbar(container) {
  const toolbar = document.createElement('div');
  toolbar.className = 'format-toolbar';
  toolbar.innerHTML = `
    <button class="format-btn" data-action="bold" title="Fett (Ctrl+B)"><b>B</b></button>
    <button class="format-btn" data-action="italic" title="Kursiv (Ctrl+I)"><i>I</i></button>
    <button class="format-btn" data-action="strike" title="Durchgestrichen">S̶</button>
    <button class="format-btn" data-action="code" title="Code">&lt;&gt;</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="h1" title="Überschrift 1">H1</button>
    <button class="format-btn" data-action="h2" title="Überschrift 2">H2</button>
    <button class="format-btn" data-action="h3" title="Überschrift 3">H3</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="bulletList" title="Aufzählung">•</button>
    <button class="format-btn" data-action="orderedList" title="Nummerierung">1.</button>
    <button class="format-btn" data-action="taskList" title="Aufgabenliste">☑</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="blockquote" title="Zitat">❝</button>
    <button class="format-btn" data-action="codeBlock" title="Code-Block">▤</button>
    <button class="format-btn" data-action="horizontalRule" title="Trennlinie">—</button>
    <div class="divider"></div>
    <button class="format-btn" data-action="link" title="Link">🔗</button>
    <button class="format-btn" data-action="image" title="Bild">🖼</button>
  `;

  container.insertBefore(toolbar, container.firstChild);

  // Bind click events
  toolbar.addEventListener('click', async (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn || !editor) return;

    const action = btn.dataset.action;
    const chain = editor.chain().focus();

    switch (action) {
      case 'bold': chain.toggleBold().run(); break;
      case 'italic': chain.toggleItalic().run(); break;
      case 'strike': chain.toggleStrike().run(); break;
      case 'code': chain.toggleCode().run(); break;
      case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
      case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
      case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
      case 'bulletList': chain.toggleBulletList().run(); break;
      case 'orderedList': chain.toggleOrderedList().run(); break;
      case 'taskList': chain.toggleTaskList().run(); break;
      case 'blockquote': chain.toggleBlockquote().run(); break;
      case 'codeBlock': chain.toggleCodeBlock().run(); break;
      case 'horizontalRule': chain.setHorizontalRule().run(); break;
      case 'link': {
        const url = await promptModal('URL eingeben:', 'https://...');
        if (url) chain.setLink({ href: url }).run();
        break;
      }
      case 'image': {
        const src = await promptModal('Bild-URL eingeben:', 'https://...');
        if (src) chain.setImage({ src }).run();
        break;
      }
    }

    updateToolbarState(toolbar);
  });

  // Update active states on selection change
  if (editor) {
    editor.on('selectionUpdate', () => updateToolbarState(toolbar));
    editor.on('transaction', () => updateToolbarState(toolbar));
  }

  return toolbar;
}

function updateToolbarState(toolbar) {
  if (!editor) return;
  toolbar.querySelectorAll('.format-btn').forEach((btn) => {
    const action = btn.dataset.action;
    let isActive = false;
    switch (action) {
      case 'bold': isActive = editor.isActive('bold'); break;
      case 'italic': isActive = editor.isActive('italic'); break;
      case 'strike': isActive = editor.isActive('strike'); break;
      case 'code': isActive = editor.isActive('code'); break;
      case 'h1': isActive = editor.isActive('heading', { level: 1 }); break;
      case 'h2': isActive = editor.isActive('heading', { level: 2 }); break;
      case 'h3': isActive = editor.isActive('heading', { level: 3 }); break;
      case 'bulletList': isActive = editor.isActive('bulletList'); break;
      case 'orderedList': isActive = editor.isActive('orderedList'); break;
      case 'taskList': isActive = editor.isActive('taskList'); break;
      case 'blockquote': isActive = editor.isActive('blockquote'); break;
      case 'codeBlock': isActive = editor.isActive('codeBlock'); break;
    }
    btn.classList.toggle('is-active', isActive);
  });
}
