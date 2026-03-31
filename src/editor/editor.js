// Tiptap WYSIWYG Editor with Yjs collaboration
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import tippy from 'tippy.js';
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
import { Comment } from './Comment.js';
import { Mention } from '@tiptap/extension-mention';
import suggestion from './suggestions.js';
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
let turndownInstance = null;

function getTurndown() {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }
  return turndownInstance;
}

/**
 * Initialize the editor for a given page
 */
export function createEditor(element, pageId, user, onSave, initialContent) {
  // Clean up previous editor
  destroyEditor();

  currentPageId = pageId;
  saveCallback = onSave;

  // Create Yjs document
  ydoc = new Y.Doc();

  // Create Custom Firestore Provider for robust serverless sync
  provider = new FirestoreYjsProvider(pageId, ydoc, user);
  provider.setLoadCallback((hasYjsState) => {
    if (initialContent) {
      setTimeout(() => {
        if (editor && editor.isEmpty) {
          console.log(`[Insel-Wiki] Applying fallback content for ${pageId}`);
          setContent(initialContent);
        }
      }, 500);
    }
  });

  const linkMenuEl = document.getElementById('link-bubble-menu');
  const formatMenuEl = document.getElementById('format-bubble-menu');
  
  // Prevent focus loss when clicking/touching inside the bubble menus
  const preventBlur = (e) => e.preventDefault();

  if (linkMenuEl) {
      linkMenuEl.style.display = 'flex';
      linkMenuEl.addEventListener('mousedown', preventBlur);
      linkMenuEl.addEventListener('touchstart', preventBlur, { passive: false });
  }
  if (formatMenuEl) {
      formatMenuEl.style.display = 'flex';
      formatMenuEl.addEventListener('mousedown', preventBlur);
      formatMenuEl.addEventListener('touchstart', preventBlur, { passive: false });
  }

  const extensions = [
    StarterKit.configure({
      history: false,
      undoRedo: false,
      codeBlock: false,
      link: false,
    }),
    CodeBlock,
    Comment,
    Mention.configure({
      HTMLAttributes: {
        class: 'mention',
      },
      suggestion,
    }),
    Placeholder.configure({
      placeholder: 'Beginne hier zu schreiben…',
    }),
    Image.configure({
      inline: true,
    }),
    Link.configure({
      autolink: true,
      openOnClick: false,
      HTMLAttributes: {
        class: 'editable-link',
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
    onCreate: ({ editor }) => {
       window.editor = editor;
    },
    onDestroy: () => {
       window.editor = null;
    },
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
      handleClick: (view, pos, event) => {
        const { schema } = view.state;
        const marks = view.state.doc.resolve(pos).marks();
        const linkMark = marks.find(mark => mark.type === schema.marks.link);
        const attrs = linkMark?.attrs;

        if (attrs?.href) {
          const linkNode = event.target.closest('a');
          
          if (linkNode) {
            const rect = linkNode.getBoundingClientRect();
            
            // Click near the right edge of the link → navigate directly
            if (event.clientX > (rect.right - 30)) {
               if (attrs.href.startsWith('#')) {
                window.location.hash = attrs.href;
              } else {
                window.open(attrs.href, '_blank');
              }
              return true;
            }
          }
          if (event.ctrlKey || event.metaKey) {
            if (attrs.href.startsWith('#')) {
              window.location.hash = attrs.href;
            } else {
              window.open(attrs.href, '_blank');
            }
            return true;
          }
        }
        return false;
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.key === ' ') {
            const { selection } = view.state;
            const { schema } = view.state;
            if (selection.empty && view.state.doc.rangeHasMark(selection.from - 1, selection.from, schema.marks.link)) {
              editor.chain().unsetLink().insertContent(' ').run();
              return true;
            }
          }
          return false;
        },
        dblclick: (view, event) => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (pos === undefined) return false;
          const { schema } = view.state;
          const marks = view.state.doc.resolve(pos).marks();
          const linkMark = marks.find(mark => mark.type === schema.marks.link);
          if (linkMark?.attrs?.href) {
            const href = linkMark.attrs.href;
            if (href.startsWith('#')) {
              window.location.hash = href;
            } else {
              window.open(href, '_blank');
            }
            return true;
          }
          return false;
        }
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
          return true;
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
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (saveCallback && currentPageId) {
          const html = ed.getHTML();
          let markdown = getTurndown().turndown(html);
          if (markdown.length > 100000) {
            markdown = markdown.substring(0, 100000);
            console.warn('[Insel-Wiki] Saved content exceeded 100,000 characters and was truncated.');
          }
          saveCallback(currentPageId, markdown);
        }
      }, 1500);
    }
  });

  function getSelectionBoundingRect() {
    const { view, state } = editor;
    const { selection } = state;
    const domSelection = window.getSelection();
    if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
      return domSelection.getRangeAt(0).getBoundingClientRect();
    }
    const coords = view.coordsAtPos(selection.from);
    return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
  }

  let formatTippy = null;
  let linkTippy = null;

  if (formatMenuEl) {
    formatTippy = tippy(element, {
      content: formatMenuEl,
      interactive: true,
      trigger: 'manual',
      placement: 'top',
      appendTo: document.body,
      zIndex: 1000,
      getReferenceClientRect: getSelectionBoundingRect
    });
    
    formatMenuEl.onclick = async (e) => {
      const btn = e.target.closest('.format-bubble-action');
      if (!btn) return;
      const action = btn.dataset.action;
      const chain = editor.chain().focus();
      switch (action) {
        case 'bold': chain.toggleBold().run(); break;
        case 'italic': chain.toggleItalic().run(); break;
        case 'h1': chain.toggleHeading({ level: 1 }).run(); break;
        case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
        case 'bulletList': chain.toggleBulletList().run(); break;
        case 'link': {
          const url = await promptModal('URL eingeben:', 'https://...');
          if (url) chain.setLink({ href: url }).run();
          break;
        }
      }
    };
  }

  if (linkMenuEl) {
    linkTippy = tippy(element, {
      content: linkMenuEl,
      interactive: true,
      trigger: 'manual',
      placement: 'top',
      appendTo: document.body,
      zIndex: 1000,
      getReferenceClientRect: getSelectionBoundingRect,
      onShow(instance) {
        const attrs = editor.getAttributes('link');
        const urlEl = instance.popper.querySelector('#bubble-link-url');
        if (urlEl && attrs.href) {
          urlEl.href = attrs.href;
          urlEl.textContent = attrs.href;
          urlEl.target = '_blank';
          urlEl.rel = 'noopener noreferrer';
        }
      }
    });

    // Remove old global event listener and attach directly to the tippy content element
    linkMenuEl.onclick = async (e) => {
      const editBtn = e.target.closest('#bubble-link-edit');
      const unlinkBtn = e.target.closest('#bubble-link-unlink');
      const urlLink = e.target.closest('#bubble-link-url');

      if (editBtn) {
        e.preventDefault(); e.stopPropagation();
        const { href } = editor.getAttributes('link');
        const newUrl = await promptModal('Link bearbeiten:', href);
        if (newUrl !== null) {
          editor.chain().focus().extendMarkRange('link').setLink({ href: newUrl }).run();
          if (linkTippy) linkTippy.hide();
        }
        return;
      } 
      
      if (unlinkBtn) {
        e.preventDefault(); e.stopPropagation();
        editor.chain().focus().unsetLink().run();
        if (linkTippy) linkTippy.hide();
        return;
      } 
      
      if (urlLink) {
        const href = urlLink.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          window.location.hash = href;
          if (linkTippy) linkTippy.hide();
        }
        return;
      }
    };
  }

  function updateBubbleMenus() {
    if (!editor || editor.isDestroyed) return;
    const { state, view } = editor;
    const { selection } = state;
    const isFocused = view.hasFocus();
    const isLink = editor.isActive('link');

    if (formatTippy) {
      if (isFocused && !selection.empty && !isLink) {
        formatTippy.setProps({ getReferenceClientRect: getSelectionBoundingRect });
        formatTippy.show();
      } else {
        formatTippy.hide();
      }
    }

    if (linkTippy) {
      if (isFocused && isLink) {
        linkTippy.setProps({ getReferenceClientRect: getSelectionBoundingRect });
        linkTippy.show();
      } else {
        linkTippy.hide();
      }
    }
  }

  editor.on('selectionUpdate', updateBubbleMenus);
  editor.on('transaction', updateBubbleMenus);
  editor.on('focus', updateBubbleMenus);
  editor.on('blur', () => {
    setTimeout(() => {
      if (!element.contains(document.activeElement) &&
          (!formatMenuEl || !formatMenuEl.contains(document.activeElement)) &&
          (!linkMenuEl || !linkMenuEl.contains(document.activeElement))) {
        if (formatTippy) formatTippy.hide();
        if (linkTippy) linkTippy.hide();
      }
    }, 150); // Increased timeout
  });

  provider.init();
  return editor;
}

export function setContent(markdown) {
  if (!editor) return;
  const isHtml = /<[a-z][\s\S]*>/i.test(markdown || '');
  const html = isHtml ? markdown : marked.parse(markdown || '');
  editor.commands.setContent(html, true);
}

export function getMarkdown() {
  if (!editor) return '';
  const html = editor.getHTML();
  return getTurndown().turndown(html);
}

export function getHTML() {
  if (!editor) return '';
  return editor.getHTML();
}

export function setEditable(editable) {
  if (editor) {
    editor.setEditable(editable);
  }
}

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

export function getProvider() {
  return provider;
}

export function getEditor() {
  return editor;
}

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
    <button class="format-btn" data-action="comment" title="Kommentar hinzufügen">💬</button>
  `;
  container.insertBefore(toolbar, container.firstChild);
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
      case 'comment': {
        const commentId = `comment-${Date.now()}`;
        chain.setComment(commentId).run();
        const event = new CustomEvent('add-comment', { detail: { commentId } });
        window.dispatchEvent(event);
        break;
      }
    }
    updateToolbarState(toolbar);
  });
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
