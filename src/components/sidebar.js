// Sidebar component — hierarchical page tree with real-time updates
import { subscribeToPages, createPage, getDeletedPages, restorePage, permanentlyDeletePage, updatePageHierarchy } from '../firebase/firestore.js';
import { canEdit, onAuthChange } from '../firebase/auth.js';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let allPages = [];
let unsubscribe = null;
let onNavigateCallback = null;
let activePageId = null;
let searchFilter = '';
let trashExpanded = false;
let trashContainer = null;
let lastTreeFingerprint = null;
let draggedPageId = null;
const expandedFolders = new Set();

/**
 * Helper to get all parent IDs of a page
 */
function getParentPath(pageId) {
  const path = [];
  let current = allPages.find(p => p.id === pageId);
  while (current && current.parentId) {
    path.push(current.parentId);
    current = allPages.find(p => p.id === current.parentId);
  }
  return path;
}

/**
 * Get a fingerprint of the tree structure and titles
 */
function getTreeFingerprint(pages) {
  const visibleProps = pages.map(p => ({
    id: p.id,
    title: p.title,
    parentId: p.parentId,
    order: p.order
  })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(visibleProps);
}

/**
 * Initialize sidebar and start listening to page changes
 */
export function initSidebar(treeContainer, onNavigate) {
  onNavigateCallback = onNavigate;

  onAuthChange((user) => {
    if (unsubscribe) unsubscribe();
    if (user) {
      // Listen to real-time page updates
      unsubscribe = subscribeToPages((pages) => {
        allPages = pages;
        
        let shouldRender = false;

        // Refresh active page state (ensures path is expanded when data loads)
        if (activePageId) {
          const oldExpandedCount = expandedFolders.size;
          
          // 1. Auto-expand parents
          const parents = getParentPath(activePageId);
          parents.forEach(id => expandedFolders.add(id));

          // 2. Auto-expand active page itself if it has children
          const hasChildren = allPages.some(p => p.parentId === activePageId);
          if (hasChildren) {
            const page = allPages.find(p => p.id === activePageId);
            if (page) {
              const siblings = allPages.filter(p => p.parentId === page.parentId && p.id !== activePageId);
              siblings.forEach(s => expandedFolders.delete(s.id));
              expandedFolders.add(activePageId);
            }
          }
          
          if (expandedFolders.size !== oldExpandedCount) {
            shouldRender = true;
          }
        }

        // Only re-render tree if structure or titles changed (ignore updatedAt/content changes)
        const fingerprint = getTreeFingerprint(pages);
        if (fingerprint !== lastTreeFingerprint) {
          lastTreeFingerprint = fingerprint;
          shouldRender = true;
        }

        if (shouldRender) {
          renderTree(treeContainer);
        }

        // Refresh trash if it's open
        if (trashExpanded && trashContainer) {
          renderTrash(trashContainer);
        }
      });
    }
  });

  // Search filtering
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchFilter = e.target.value.toLowerCase();
      renderTree(treeContainer);
    });
  }

  // Create trash section
  const sidebar = treeContainer.parentElement;
  if (sidebar) {
    trashContainer = document.createElement('div');
    trashContainer.className = 'trash-section';
    // Insert before sidebar-footer (if it exists)
    const footer = sidebar.querySelector('.sidebar-footer');
    if (footer) {
      sidebar.insertBefore(trashContainer, footer);
    } else {
      sidebar.appendChild(trashContainer);
    }
    renderTrashHeader(trashContainer);
  }
}

/**
 * Set the active page (highlight in tree)
 */
export function setActivePage(pageId) {
  activePageId = pageId;
  
  if (pageId) {
    // 1. Auto-expand parents of the active page
    const parents = getParentPath(pageId);
    parents.forEach(id => expandedFolders.add(id));

    // 2. Intelligent space-saving: when selecting a page that is a folder, 
    // expand it and collapse its siblings.
    const page = allPages.find(p => p.id === pageId);
    const hasChildren = allPages.some(p => p.parentId === pageId);
    
    if (hasChildren && page) {
      // Collapse siblings
      const siblings = allPages.filter(p => p.parentId === page.parentId && p.id !== pageId);
      siblings.forEach(s => expandedFolders.delete(s.id));
      
      expandedFolders.add(pageId);
    }
  }

  const treeContainer = document.getElementById('page-tree');
  if (treeContainer) renderTree(treeContainer);
}

/**
 * Get all pages (for breadcrumb building etc.)
 */
export function getAllPages() {
  return allPages;
}

/**
 * Build a breadcrumb trail for a page
 */
export function getBreadcrumb(pageId) {
  const trail = [];
  let current = allPages.find((p) => p.id === pageId);
  while (current) {
    trail.unshift(current);
    current = current.parentId
      ? allPages.find((p) => p.id === current.parentId)
      : null;
  }
  return trail;
}

/**
 * Render the hierarchical tree
 */
function renderTree(container) {
  const filteredPages = searchFilter
    ? allPages.filter((p) => {
        const inTitle = p.title && p.title.toLowerCase().includes(searchFilter);
        const inContent = p.content && p.content.toLowerCase().includes(searchFilter);
        return inTitle || inContent;
      })
    : allPages;

  // Build tree from flat list
  const rootPages = searchFilter
    ? filteredPages
    : filteredPages.filter((p) => !p.parentId);

  // Pin special pages to the top
  if (!searchFilter) {
    const pinnedIds = ['mtxtAoHvUQINUWJiIsK0', 'I1V7J26YHEYaL6o6NzNn', '02LIwOpQSGFzYfRfgOwf'];
    rootPages.sort((a, b) => {
      const aPinned = pinnedIds.indexOf(a.id);
      const bPinned = pinnedIds.indexOf(b.id);
      if (aPinned !== -1 && bPinned !== -1) return aPinned - bPinned;
      if (aPinned !== -1) return -1;
      if (bPinned !== -1) return 1;
      return (a.order || 0) - (b.order || 0); // fallback to normal order
    });
  }

  // Build the new tree off-DOM, then swap in one atomic mutation. Avoids the
  // visible empty-state flash that caused sidebar flicker on every render.
  const frag = document.createDocumentFragment();
  if (rootPages.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;';
    empty.textContent = searchFilter ? 'Keine Ergebnisse' : 'Noch keine Seiten';
    frag.appendChild(empty);
  } else {
    rootPages.forEach((page) => {
      frag.appendChild(createTreeItem(page, filteredPages));
    });
  }
  container.replaceChildren(frag);
}

/**
 * Create a tree item element (recursive)
 */
function createTreeItem(page, allFilteredPages) {
  const children = searchFilter
    ? []
    : allFilteredPages.filter((p) => p.parentId === page.id);
  const hasChildren = children.length > 0;

  const item = document.createElement('div');
  item.className = 'tree-node';

  const row = document.createElement('div');
  row.className = `tree-item${page.id === activePageId ? ' active' : ''}`;
  row.dataset.pageId = page.id;

  // Expand button
  if (hasChildren) {
    const isExpanded = expandedFolders.has(page.id);
    const expandBtn = document.createElement('button');
    expandBtn.className = `expand-btn ${isExpanded ? 'expanded' : ''}`;
    expandBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18l6-6-6-6"/></svg>`;
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isNowExpanded = !expandBtn.classList.contains('expanded');
      
      if (isNowExpanded) {
        // Intelligent space-saving: Collapse siblings when expanding this one
        const siblings = allFilteredPages.filter(p => p.parentId === page.parentId && p.id !== page.id);
        siblings.forEach(s => expandedFolders.delete(s.id));
        
        expandedFolders.add(page.id);
      } else {
        expandedFolders.delete(page.id);
      }
      
      renderTree(document.getElementById('page-tree'));
    });
    row.appendChild(expandBtn);
  } else {
    const spacer = document.createElement('span');
    spacer.style.width = '18px';
    spacer.style.display = 'inline-block';
    spacer.style.flexShrink = '0';
    row.appendChild(spacer);
  }

  // Page icon
  const icon = document.createElement('span');
  icon.className = 'page-icon';
  icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  row.appendChild(icon);

  // Page name
  const name = document.createElement('span');
  name.className = 'page-name';
  name.textContent = page.title || 'Ohne Titel';
  row.appendChild(name);

  // Search result snippet
  if (searchFilter && page.content && page.content.toLowerCase().includes(searchFilter)) {
    const snippet = document.createElement('div');
    snippet.className = 'search-snippet';
    
    // Find index of first occurrence
    const contentLower = page.content.toLowerCase();
    const index = contentLower.indexOf(searchFilter);
    const start = Math.max(0, index - 20);
    const end = Math.min(page.content.length, index + searchFilter.length + 40);
    
    let text = page.content.substring(start, end).replace(/\n/g, ' ');
    if (start > 0) text = '…' + text;
    if (end < page.content.length) text = text + '…';
    
    // Escape HTML first, then highlight the search term safely
    const escaped = escapeHtml(text);
    const escapedFilter = escapeHtml(searchFilter);
    const regex = new RegExp(`(${escapeRegex(escapedFilter)})`, 'gi');
    snippet.innerHTML = escaped.replace(regex, '<mark>$1</mark>');
    
    item.appendChild(row);
    item.appendChild(snippet);
  } else {
    item.appendChild(row);
  }

  row.addEventListener('click', () => {
    // If clicking the active page, toggle its expansion
    if (page.id === activePageId && hasChildren) {
      if (expandedFolders.has(page.id)) {
        expandedFolders.delete(page.id);
      } else {
        // Expand and collapse siblings
        const siblings = allFilteredPages.filter(p => p.parentId === page.parentId && p.id !== page.id);
        siblings.forEach(s => expandedFolders.delete(s.id));
        expandedFolders.add(page.id);
      }
      renderTree(document.getElementById('page-tree'));
      return;
    }

    if (onNavigateCallback) onNavigateCallback(page.id);
  });
  if (canEdit() && !searchFilter) {
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
      draggedPageId = page.id;
      e.dataTransfer.effectAllowed = 'move';
      // Slight delay to allow UI to clone the element before hiding it
      setTimeout(() => row.classList.add('is-dragging'), 0);
    });

    row.addEventListener('dragend', () => {
      draggedPageId = null;
      row.classList.remove('is-dragging');
      document.querySelectorAll('.tree-item').forEach(el => {
        el.classList.remove('drop-above', 'drop-below', 'drop-inside');
      });
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault(); // Necessary to allow dropping
      if (!draggedPageId || draggedPageId === page.id) return;

      // Prevent dropping a parent into its own child hierarchy
      let currentParent = page.parentId;
      while (currentParent) {
        if (currentParent === draggedPageId) return; // invalid drop target
        const parentPage = allFilteredPages.find(p => p.id === currentParent);
        currentParent = parentPage ? parentPage.parentId : null;
      }

      e.dataTransfer.dropEffect = 'move';
      
      const rect = row.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      
      row.classList.remove('drop-above', 'drop-below', 'drop-inside');
      
      if (relativeY < rect.height * 0.25) {
        row.dataset.dropAction = 'above';
        row.classList.add('drop-above');
      } else if (relativeY > rect.height * 0.75) {
        row.dataset.dropAction = 'below';
        row.classList.add('drop-below');
      } else {
        row.dataset.dropAction = 'inside';
        row.classList.add('drop-inside');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-above', 'drop-below', 'drop-inside');
      row.dataset.dropAction = '';
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drop-above', 'drop-below', 'drop-inside');
      
      const dropAction = row.dataset.dropAction;
      if (!draggedPageId || draggedPageId === page.id || !dropAction) return;

      let newParentId = null;
      let newOrder = 0;

      if (dropAction === 'inside') {
        newParentId = page.id;
        // Place at the end of the new parent's children
        const targetChildren = allFilteredPages.filter(p => p.parentId === page.id);
        newOrder = targetChildren.length;
        
        // Auto-expand folder on drop
        expandedFolders.add(page.id);
      } else {
        newParentId = page.parentId;
        // Determine the order amongst siblings
        const siblings = allFilteredPages
          .filter(p => p.parentId === page.parentId)
          .sort((a, b) => a.order - b.order);
        
        const targetIndex = siblings.findIndex(p => p.id === page.id);
        newOrder = dropAction === 'above' ? targetIndex : targetIndex + 1;
      }

      try {
        await updatePageHierarchy(draggedPageId, newParentId, newOrder);
      } catch (err) {
        console.error('Drag and drop error:', err);
      }
    });
  }

  item.appendChild(row);

  // Render children
  if (hasChildren) {
    const isExpanded = expandedFolders.has(page.id);
    const childContainer = document.createElement('div');
    childContainer.className = `tree-children ${isExpanded ? '' : 'collapsed'}`;
    children.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((child) => {
      childContainer.appendChild(createTreeItem(child, allFilteredPages));
    });
    item.appendChild(childContainer);
  }

  return item;
}

/**
 * Destroy sidebar listener
 */
export function destroySidebar() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// --- Trash Section ---

function renderTrashHeader(container) {
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'trash-header';
  header.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
    </svg>
    <span>Papierkorb</span>
    <svg class="trash-chevron${trashExpanded ? ' expanded' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  `;
  header.addEventListener('click', () => {
    trashExpanded = !trashExpanded;
    renderTrashHeader(container);
    if (trashExpanded) {
      renderTrash(container);
    }
  });
  container.appendChild(header);

  if (trashExpanded) {
    const list = document.createElement('div');
    list.className = 'trash-list';
    list.innerHTML = '<div class="trash-loading">Laden…</div>';
    container.appendChild(list);
  }
}

async function renderTrash(container) {
  let list = container.querySelector('.trash-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'trash-list';
    container.appendChild(list);
  }

  try {
    const deletedPages = await getDeletedPages();

    if (deletedPages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'trash-empty';
      empty.textContent = 'Papierkorb ist leer';
      list.replaceChildren(empty);
      return;
    }

    // Only show top-level deleted pages (whose parent is not also deleted)
    const deletedIds = new Set(deletedPages.map(p => p.id));
    const topLevel = deletedPages.filter(p => !p.parentId || !deletedIds.has(p.parentId));

    const frag = document.createDocumentFragment();
    topLevel.forEach((page) => {
      const item = document.createElement('div');
      item.className = 'trash-item';

      const name = document.createElement('span');
      name.className = 'trash-item-name';
      name.textContent = page.title || 'Ohne Titel';
      item.appendChild(name);

      if (canEdit()) {
        const actions = document.createElement('div');
        actions.className = 'trash-item-actions';

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn-icon btn-small';
        restoreBtn.title = 'Wiederherstellen';
        restoreBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>`;
        restoreBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await restorePage(page.id);
            renderTrash(container);
          } catch (err) {
            console.error('Restore error:', err);
          }
        });
        actions.appendChild(restoreBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-icon btn-small btn-danger';
        deleteBtn.title = 'Endgültig löschen';
        deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Endgültig löschen? Dies kann nicht rückgängig gemacht werden.')) return;
          try {
            await permanentlyDeletePage(page.id);
            renderTrash(container);
          } catch (err) {
            console.error('Permanent delete error:', err);
          }
        });
        actions.appendChild(deleteBtn);

        item.appendChild(actions);
      }

      frag.appendChild(item);
    });
    list.replaceChildren(frag);
  } catch (err) {
    console.error('Error loading trash:', err);
    const errMsg = document.createElement('div');
    errMsg.className = 'trash-empty';
    errMsg.textContent = 'Fehler beim Laden';
    list.replaceChildren(errMsg);
  }
}
