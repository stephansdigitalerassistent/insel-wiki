import { extractTasksFromContent } from './tasks.js';
import { slugify } from './string.js';

/**
 * @module utils/series-helper
 * @description
 * Utility functions for detecting meeting series, predicting follower page titles,
 * rolling over open action items and extracting meeting scaffolds.
 *
 * Everything here works on the Markdown projection of a page, so it stays free of
 * editor and DOM dependencies and can be unit-tested with plain node.
 */

/**
 * Predicts the next title in a meeting or sequential page series.
 * Supports:
 * - Number suffixes with hyphen, underscore, space, or hash (e.g. "micha-11" -> "micha-12", "Micha #11" -> "Micha #12")
 * - Bracketed numbering (e.g. "Meeting (11)" -> "Meeting (12)", "Sprint [4]" -> "Sprint [5]")
 * - Version/Prefix numbering (e.g. "micha-v11" -> "micha-v12", "Sprint 4" -> "Sprint 5")
 * - ISO dates (e.g. "Jour Fixe 2026-08-26" -> "Jour Fixe 2026-09-02" (+7 days))
 * - Swiss/German dates (e.g. "Standup 26.08.2026" -> "Standup 02.09.2026" (+7 days))
 * - Un-numbered fallback (e.g. "micha" -> "micha-2", "Micha 1:1" -> "Micha 1:1 #2")
 *
 * @param {string} currentTitle - The current page title.
 * @returns {string} The predicted next page title.
 */
export function predictNextMeetingTitle(currentTitle) {
  if (!currentTitle || typeof currentTitle !== 'string') {
    return 'Meeting #2';
  }

  const trimmed = currentTitle.trim();

  // 1. Check for ISO date pattern: YYYY-MM-DD
  const isoDateRegex = /(.*?)(\b\d{4}-\d{2}-\d{2}\b)(.*)/;
  const isoMatch = trimmed.match(isoDateRegex);
  if (isoMatch) {
    const [, prefix, dateStr, suffix] = isoMatch;
    const nextDate = addDaysToDateString(dateStr, 7, 'iso');
    if (nextDate) {
      return `${prefix}${nextDate}${suffix}`.trim();
    }
  }

  // 2. Check for Swiss/German date pattern: DD.MM.YYYY
  const deDateRegex = /(.*?)(\b\d{2}\.\d{2}\.\d{4}\b)(.*)/;
  const deMatch = trimmed.match(deDateRegex);
  if (deMatch) {
    const [, prefix, dateStr, suffix] = deMatch;
    const nextDate = addDaysToDateString(dateStr, 7, 'de');
    if (nextDate) {
      return `${prefix}${nextDate}${suffix}`.trim();
    }
  }

  // 3. Check for bracketed numbers: e.g. "Title (11)", "Title [4]"
  const bracketRegex = /^(.*?)(\(|\[)(\d+)(\)|\])$/;
  const bracketMatch = trimmed.match(bracketRegex);
  if (bracketMatch) {
    const [, prefix, openBracket, numStr, closeBracket] = bracketMatch;
    const nextNum = parseInt(numStr, 10) + 1;
    return `${prefix}${openBracket}${nextNum}${closeBracket}`.trim();
  }

  // 4. Check for standard sequential number suffix:
  // e.g. "micha-11", "micha_11", "micha 11", "Micha #11", "Sprint 4", "micha-v11"
  const suffixNumberRegex = /^(.*?)((?:[-_\s]+v?|[-_\s]*#))(\d+)$/i;
  const suffixMatch = trimmed.match(suffixNumberRegex);
  if (suffixMatch) {
    const [, prefix, delimiter, numStr] = suffixMatch;
    const nextNum = parseInt(numStr, 10) + 1;
    return `${prefix}${delimiter}${nextNum}`.trim();
  }

  // Check for 1:1 or 1-1 without a trailing counter
  if (/(?:^|\s|[-_])1[:\-]1$/i.test(trimmed)) {
    return `${trimmed} #2`;
  }

  // 5. Standalone number at the end of word: e.g. "micha11" -> "micha12"
  const trailingNumRegex = /^(.*?[a-zA-Z])(\d+)$/;
  const trailingMatch = trimmed.match(trailingNumRegex);
  if (trailingMatch) {
    const [, prefix, numStr] = trailingMatch;
    const nextNum = parseInt(numStr, 10) + 1;
    return `${prefix}${nextNum}`.trim();
  }

  // 6. Fallback: If title contains sync/meeting/jour fixe/standup, append " #2", otherwise append "-2"
  if (/sync|meeting|jour fixe|standup/i.test(trimmed)) {
    return `${trimmed} #2`;
  }

  return `${trimmed}-2`;
}

/**
 * Helper to add days to a date string and format back.
 *
 * @param {string} dateStr - Date string.
 * @param {number} days - Number of days to add.
 * @param {'iso'|'de'} format - Format type ('iso' or 'de').
 * @returns {string|null} The incremented date string.
 */
function addDaysToDateString(dateStr, days = 7, format = 'iso') {
  try {
    let d;
    if (format === 'iso') {
      d = new Date(`${dateStr}T12:00:00Z`);
    } else {
      const [day, month, year] = dateStr.split('.').map(Number);
      d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    }

    if (isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + days);

    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');

    if (format === 'iso') {
      return `${yyyy}-${mm}-${dd}`;
    } else {
      return `${dd}.${mm}.${yyyy}`;
    }
  } catch (e) {
    return null;
  }
}

/**
 * Extracts uncompleted tasks from markdown or HTML content.
 *
 * @param {string} content - Predecessor markdown content.
 * @param {string} [predecessorTitle] - Optional title for attribution.
 * @returns {Array<{ text: string, formatted: string }>} Open tasks list.
 */
export function extractOpenTasks(content, predecessorTitle = '') {
  if (!content || typeof content !== 'string') return [];

  const allTasks = extractTasksFromContent(content);
  const openTasks = allTasks.filter(t => !t.done && t.text.trim().length > 0);

  const attribution = predecessorTitle ? ` (aus ${predecessorTitle})` : '';

  // A task that was already rolled over once keeps naming the meeting it came
  // from, instead of collecting one "(aus …)" suffix per meeting it survives.
  return openTasks.map(t => ({
    text: t.text,
    formatted: `- [ ] ${t.text}${/\(aus [^)]+\)$/.test(t.text) ? '' : attribution}`
  }));
}

/**
 * Extracts the structural headings and table scaffolds from the previous meeting,
 * leaving out ephemeral discussion body text.
 *
 * @param {string} content - Markdown content from predecessor.
 * @returns {string} The cleaned structural scaffold markdown.
 */
export function extractScaffold(content) {
  if (!content || typeof content !== 'string') {
    return defaultMeetingScaffold();
  }

  const lines = content.split('\n');
  const resultLines = [];
  let inTable = false;
  let tableHeaderWritten = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Toggle code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Skip existing navigation links / date header bars
    if (
      trimmed.includes('⏮') ||
      trimmed.includes('⏭') ||
      trimmed.includes('Vorheriges Meeting') ||
      trimmed.includes('Nächstes Meeting') ||
      trimmed.startsWith('---')
    ) {
      continue;
    }

    // Preserve Headings (H1 - H4)
    if (/^#{1,4}\s+/.test(trimmed)) {
      // Don't duplicate open tasks section if we already generate it separately
      if (/offene pendenzen|rollover/i.test(trimmed)) {
        continue;
      }
      resultLines.push('');
      resultLines.push(trimmed);
      resultLines.push('');
      continue;
    }

    // Preserve Table headers & structure
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHeaderWritten = false;
        resultLines.push('');
        resultLines.push(trimmed);
      } else if (!tableHeaderWritten && trimmed.includes('---')) {
        resultLines.push(trimmed);
        tableHeaderWritten = true;
        // Add one empty row for quick typing
        const colCount = trimmed.split('|').length - 2;
        if (colCount > 0) {
          resultLines.push('| ' + Array(colCount).fill(' ').join(' | ') + ' |');
        }
      }
      continue;
    } else {
      inTable = false;
    }
  }

  const scaffold = resultLines.join('\n').trim();
  return scaffold.length > 0 ? scaffold : defaultMeetingScaffold();
}

/**
 * Default clean meeting scaffold if predecessor has no headings.
 */
function defaultMeetingScaffold() {
  return [
    '### 📋 Traktanden / Agenda',
    '1. Review offener Pendenzen',
    '2. ',
    '',
    '### 📝 Notizen & Diskussion',
    '',
    '### ✅ Neue Beschlüsse & Action Items',
    '- [ ] '
  ].join('\n');
}

/**
 * Generates the full initial markdown content for the new follower meeting.
 *
 * @param {Object} opts
 * @param {string} opts.predecessorId - Firestore ID of the previous meeting.
 * @param {string} opts.predecessorTitle - Title of the previous meeting.
 * @param {string} [opts.predecessorContent=''] - Markdown content of the previous meeting.
 * @param {boolean} [opts.carryoverTasks=true] - Whether to copy open tasks.
 * @param {boolean} [opts.carryoverScaffold=true] - Whether to retain predecessor headings.
 * @returns {string} The compiled markdown content for the new sub-page.
 */
export function generateFollowupMeetingMarkdown({
  predecessorId,
  predecessorTitle,
  predecessorContent = '',
  carryoverTasks = true,
  carryoverScaffold = true
}) {
  const parts = [];

  const prevSlug = slugify(predecessorTitle || '');

  // 1. Navigation line: an icon and the link, nothing else.
  if (predecessorId) {
    const linkText = (predecessorTitle || '⏮').replace(/[\[\]]/g, '\\$&');
    parts.push(`⏮ [${linkText}](#/${predecessorId}/${prevSlug})`);
    parts.push('');
  }

  // 2. Rollover of Open Action Items
  if (carryoverTasks && predecessorContent) {
    const openTasks = extractOpenTasks(predecessorContent, predecessorTitle);
    if (openTasks.length > 0) {
      parts.push('### ⏳ Offene Pendenzen aus vorherigem Meeting');
      openTasks.forEach(task => {
        parts.push(task.formatted);
      });
      parts.push('');
    }
  }

  // 3. Meeting Scaffold / Sections
  if (carryoverScaffold && predecessorContent) {
    parts.push(extractScaffold(predecessorContent));
  } else {
    parts.push(defaultMeetingScaffold());
  }

  return parts.join('\n').trim() + '\n';
}
