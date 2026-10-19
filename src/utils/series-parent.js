import * as Y from 'yjs';

/**
 * @module utils/series-parent
 * @description
 * Adds the link to a newly created meeting to its parent page, next to the
 * predecessor's link, when the parent already keeps a list of the meetings.
 *
 * The parent page is either a Yjs document (once it has been opened in the
 * editor) or, while it has never been opened, only its markdown seed — so both
 * representations are handled here. Both functions are pure, so they can be
 * unit-tested with plain node.
 */

const LIST_ITEMS = new Set(['listItem', 'taskItem']);

/** Whether an href points to the given page (`#/id` or `#/id/slug`). */
function linksTo(href, pageId) {
  return typeof href === 'string' && (href === `#/${pageId}` || href.startsWith(`#/${pageId}/`));
}

/**
 * Returns the predecessor's link-mark attributes if this list item's own
 * paragraph links to it (nested lists are ignored), otherwise null.
 */
function findLinkInItem(item, pageId) {
  for (const child of item.toArray()) {
    if (!(child instanceof Y.XmlElement) || child.nodeName !== 'paragraph') continue;
    for (const text of child.toArray()) {
      if (!(text instanceof Y.XmlText)) continue;
      const op = text.toDelta().find(d => linksTo(d.attributes?.link?.href, pageId));
      if (op) return op.attributes.link;
    }
  }
  return null;
}

/** Depth-first search for the list item that links to the page. */
function findItem(node, pageId) {
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (LIST_ITEMS.has(child.nodeName)) {
      const link = findLinkInItem(child, pageId);
      if (link) return { list: node, item: child, link };
    }
    const found = findItem(child, pageId);
    if (found) return found;
  }
  return null;
}

/**
 * Where the new entry goes: after the predecessor, unless the predecessor
 * heads a longer list — then the list runs newest first.
 */
function insertIndex(index, length) {
  return index === 0 && length > 1 ? 0 : index + 1;
}

/**
 * Inserts a list item linking to the new page next to the item that links to
 * the predecessor. Does nothing when no list on the page links to it.
 *
 * @param {Y.XmlFragment} fragment - The parent page's document ('default' fragment).
 * @param {Object} opts
 * @param {string} opts.predecessorId - Page the new meeting follows.
 * @param {string} opts.href - Link to the new page (`#/id/slug`).
 * @param {string} opts.title - Title of the new page.
 * @returns {boolean} Whether an entry was added.
 */
export function insertSeriesLinkInFragment(fragment, { predecessorId, href, title }) {
  const found = findItem(fragment, predecessorId);
  if (!found) return false;

  const { list, item, link } = found;
  const text = new Y.XmlText();
  // Copy the predecessor link's attributes (target, rel, …) so both entries look alike.
  text.insert(0, title, { link: { ...link, href } });
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [text]);
  const newItem = new Y.XmlElement(item.nodeName);
  if (item.nodeName === 'taskItem') newItem.setAttribute('checked', false);
  newItem.insert(0, [paragraph]);

  const siblings = list.toArray();
  list.insert(insertIndex(siblings.indexOf(item), siblings.length), [newItem]);
  return true;
}

const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;

/**
 * Markdown counterpart of {@link insertSeriesLinkInFragment}, for a parent page
 * that has never been opened and so only has its markdown seed.
 *
 * @param {string} markdown - The parent page's markdown.
 * @param {Object} opts - Same as {@link insertSeriesLinkInFragment}.
 * @returns {string|null} The new markdown, or null when no list links to the predecessor.
 */
export function insertSeriesLinkInMarkdown(markdown, { predecessorId, href, title }) {
  if (!markdown || typeof markdown !== 'string') return null;

  const lines = markdown.split('\n');
  const linkPattern = new RegExp(`\\]\\(#/${predecessorId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^)]*)?\\)`);
  const index = lines.findIndex(line => LIST_LINE.test(line) && linkPattern.test(line));
  if (index === -1) return null;

  const [, indent, marker, task] = lines[index].match(LIST_LINE);
  const label = title.replace(/[\[\]]/g, '\\$&');
  const entry = `${indent}${marker} ${task ? '[ ] ' : ''}[${label}](${href})`;

  // Items of the same list: same indent, contiguous.
  const sameList = line => {
    const m = line?.match(LIST_LINE);
    return Boolean(m) && m[1] === indent;
  };
  // The predecessor's item ends after its own nested, deeper-indented lines.
  let end = index + 1;
  while (end < lines.length && lines[end].trim() && lines[end].match(/^\s*/)[0].length > indent.length) end++;
  const isFirst = !sameList(lines[index - 1]);
  const hasNext = sameList(lines[end]);
  lines.splice(isFirst && hasNext ? index : end, 0, entry);
  return lines.join('\n');
}
