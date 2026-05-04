// Sidebar component — hierarchical page tree with real-time updates
import { subscribeToPages, createPage, getDeletedPages, restorePage, permanentlyDeletePage, updatePageHierarchy, deletePage, getPage } from '../firebase/firestore.js';
import { canEdit, onAuthChange } from '../firebase/auth.js';

// --- Hover prefetch ---
// Warm the localStorage page cache on hover so the click feels instant.
// Firestore's client cache also benefits, making the eventual getPage in
// loadPage cheap. TTL'd to avoid hammering reads on tree-scrubbing.
const _prefetchedAt = new Map();
const _prefetchInFlight = new Set();
const PREFETCH_TTL_MS = 60_000;
const PREFETCH_HOVER_DELAY_MS = 150;
let _hoverPrefetchTimer = null;

async function prefetchPage(pageId) {
  if (!pageId) return;
  if (_prefetchInFlight.has(pageId)) return;
  const last = _prefetchedAt.get(pageId);
  if (last && (Date.now() - last) < PREFETCH_TTL_MS) return;
  _prefetchInFlight.add(pageId);
  try {
    const fresh = await getPage(pageId);
    if (fresh) {
      try { localStorage.setItem(`cache_page_${pageId}`, JSON.stringify(fresh)); } catch {}
      _prefetchedAt.set(pageId, Date.now());
    }
  } catch (e) {
    // Swallow — prefetch is best-effort
  } finally {
    _prefetchInFlight.delete(pageId);
  }
}

// --- Per-page sort preferences (stored locally per browser/user) ---
const SORT_MODES = ['manual', 'name', 'created', 'changed'];
const SORT_LABELS = {
  manual: 'Manuell',
  name: 'Name',
  created: 'Erstellt',
  changed: 'Geändert',
};
const SORT_KEY = (parentId) => `insel-wiki-sort-${parentId || 'root'}`;

function getSortMode(parentId) {
  try {
    const v = localStorage.getItem(SORT_KEY(parentId));
    return SORT_MODES.includes(v) ? v : 'manual';
  } catch {
    return 'manual';
  }
}

function setSortMode(parentId, mode) {
  if (!SORT_MODES.includes(mode)) return;
  try { localStorage.setItem(SORT_KEY(parentId), mode); } catch {}
}

function tsMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds != null) return ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6;
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

function applySort(pages, mode) {
  const arr = [...pages];
  switch (mode) {
    case 'name':
      return arr.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'de', { sensitivity: 'base' }));
    case 'created':
      return arr.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    case 'changed':
      return arr.sort((a, b) => tsMs(b.updatedAt) - tsMs(a.updatedAt));
    case 'manual':
    default:
      return arr.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
}

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
let activeMenu = null;
const expandedFolders = new Set();

// --- Options popover menu (singleton) ---

function dismissOnClick(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
}

function dismissOnKey(e) {
  if (e.key === 'Escape') closeMenu();
}

function closeMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  document.removeEventListener('mousedown', dismissOnClick, true);
  document.removeEventListener('keydown', dismissOnKey);
}

function openOptionsMenu(anchorEl, { parentId, page }) {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'sidebar-options-menu';

  // --- Standard actions (only for a specific page, not root) ---
  if (page && canEdit()) {
    const newChild = document.createElement('button');
    newChild.className = 'sidebar-options-item';
    newChild.textContent = 'Neue Unterseite';
    newChild.addEventListener('click', async () => {
      closeMenu();
      const title = prompt('Titel der neuen Unterseite:');
      if (!title || !title.trim()) return;
      try {
        const id = await createPage(title.trim(), page.id);
        expandedFolders.add(page.id);
        if (onNavigateCallback) onNavigateCallback(id);
      } catch (err) {
        console.error('Create child error:', err);
      }
    });
    menu.appendChild(newChild);

    const del = document.createElement('button');
    del.className = 'sidebar-options-item sidebar-options-danger';
    del.textContent = 'Löschen';
    del.addEventListener('click', async () => {
      closeMenu();
      if (!confirm(`„${page.title || 'Ohne Titel'}" in den Papierkorb verschieben?`)) return;
      try {
        await deletePage(page.id);
      } catch (err) {
        console.error('Delete error:', err);
      }
    });
    menu.appendChild(del);

    const sep = document.createElement('div');
    sep.className = 'sidebar-options-sep';
    menu.appendChild(sep);
  }

  // --- Sort section ---
  const heading = document.createElement('div');
  heading.className = 'sidebar-options-heading';
  heading.textContent = parentId ? 'Unterseiten sortieren' : 'Hauptseiten sortieren';
  menu.appendChild(heading);

  const current = getSortMode(parentId);
  for (const mode of SORT_MODES) {
    const item = document.createElement('button');
    item.className = `sidebar-options-item sidebar-options-radio${mode === current ? ' selected' : ''}`;
    item.innerHTML = `<span class="sidebar-options-check">${mode === current ? '✓' : ''}</span><span>${SORT_LABELS[mode]}</span>`;
    item.addEventListener('click', () => {
      setSortMode(parentId, mode);
      closeMenu();
      const treeContainer = document.getElementById('page-tree');
      if (treeContainer) renderTree(treeContainer);
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);

  // Position relative to the anchor button.
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  // Clamp horizontally on screen.
  requestAnimationFrame(() => {
    const m = menu.getBoundingClientRect();
    if (m.right > window.innerWidth - 8) {
      menu.style.left = `${Math.max(8, window.innerWidth - m.width - 8)}px`;
    }
  });

  activeMenu = menu;
  // Defer listener attachment so the click that opened the menu doesn't
  // immediately dismiss it.
  setTimeout(() => {
    document.addEventListener('mousedown', dismissOnClick, true);
    document.addEventListener('keydown', dismissOnKey);
  }, 0);
}

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

  // Root-level options menu (sort + future global actions)
  const sortRootBtn = document.getElementById('sort-root-btn');
  if (sortRootBtn) {
    sortRootBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openOptionsMenu(sortRootBtn, { parentId: null, page: null });
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
  let rootPages = searchFilter
    ? filteredPages
    : filteredPages.filter((p) => !p.parentId);

  // Pin special pages to the top, then apply user-selected sort to the rest.
  if (!searchFilter) {
    const pinnedIds = ['mtxtAoHvUQINUWJiIsK0', 'I1V7J26YHEYaL6o6NzNn', '02LIwOpQSGFzYfRfgOwf'];
    const pinned = pinnedIds
      .map((id) => rootPages.find((p) => p.id === id))
      .filter(Boolean);
    const rest = applySort(
      rootPages.filter((p) => !pinnedIds.includes(p.id)),
      getSortMode(null)
    );
    rootPages = [...pinned, ...rest];
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

  // Per-page options menu (⋮)
  const moreBtn = document.createElement('button');
  moreBtn.className = 'more-btn';
  moreBtn.title = 'Optionen';
  moreBtn.setAttribute('aria-label', 'Optionen');
  moreBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openOptionsMenu(moreBtn, { parentId: page.id, page });
  });
  row.appendChild(moreBtn);

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

  row.addEventListener('mouseenter', () => {
    clearTimeout(_hoverPrefetchTimer);
    _hoverPrefetchTimer = setTimeout(() => prefetchPage(page.id), PREFETCH_HOVER_DELAY_MS);
  });
  row.addEventListener('mouseleave', () => {
    clearTimeout(_hoverPrefetchTimer);
  });
  // Also prefetch on touchstart so taps on mobile benefit before the click resolves.
  row.addEventListener('touchstart', () => prefetchPage(page.id), { passive: true });

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
    applySort(children, getSortMode(page.id)).forEach((child) => {
      childContainer.appendChild(createTreeItem(child, allFilteredPages));
    });
    item.appendChild(childContainer);
  }

  return item;
}



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
