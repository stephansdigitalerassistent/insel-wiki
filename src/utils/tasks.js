/**
 * Extrahiert alle Todos aus einem gegebenen Markdown-Text.
 * Erkennt Formate wie '- [ ] Aufgabe' oder '- [x] Erledigt'.
 *
 * @example
 * import { extractTasksFromContent } from './utils/tasks.js';
 * const tasks = extractTasksFromContent('- [ ] Aufgabe\n- [x] Erledigt');
 * console.log(tasks);
 * // => [
 * //   { done: false, text: 'Aufgabe', raw: '- [ ] Aufgabe', index: 0, indent: 0 },
 * //   { done: true, text: 'Erledigt', raw: '- [x] Erledigt', index: 1, indent: 0 }
 * // ]
 */
export function extractTasksFromContent(content) {
  if (!content || typeof content !== 'string') return [];

  const tasks = [];
  // Robust regex: 
  // - Supports both '-' and '*' (optional for compatibility)
  // - Handles indentation using [ \t] to avoid capturing newlines
  // - Captures indentation, checked status, and text
  const taskRegex = /^([ \t]*)(?:[-*]\s+)?\[( |x|X)\]\s*(.*)$/gm;

  let match;
  let index = 0;
  while ((match = taskRegex.exec(content)) !== null) {
    tasks.push({
      done: match[2].toLowerCase() === 'x',
      text: match[3].trim(),
      raw: match[0],
      index: index++,
      indent: match[1].length
    });
  }

  return tasks;
}