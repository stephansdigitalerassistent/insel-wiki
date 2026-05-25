/**
 * @typedef {Object} Task
 * @property {boolean} done - Indicates whether the task is checked/completed (parsed from '[x]' or '[X]').
 * @property {string} text - The trimmed text content of the task.
 * @property {string} raw - The raw line matched from the content.
 * @property {number} index - The zero-based sequential index of the task.
 * @property {number} indent - The indentation length (number of leading spaces or tabs).
 */

/**
 * Extracts all task items (todos) from the given markdown text.
 * It parses markdown-style task list items starting with either '-' or '*' bullets,
 * followed by a checkbox ('[ ]' for unchecked, '[x]' or '[X]' for checked).
 *
 * @param {string} content - The markdown-style text content to analyze.
 * @returns {Task[]} An array of the extracted task objects.
 *
 * @example
 * import { extractTasksFromContent } from './utils/tasks.js';
 *
 * const content = '- [ ] Task to do\n- [x] Task completed';
 * const tasks = extractTasksFromContent(content);
 * console.log(tasks);
 * // Output:
 * // [
 * //   { done: false, text: 'Task to do', raw: '- [ ] Task to do', index: 0, indent: 0 },
 * //   { done: true, text: 'Task completed', raw: '- [x] Task completed', index: 1, indent: 0 }
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