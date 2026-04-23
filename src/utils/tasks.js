const taskCache = new Map();

/**
 * Extrahiert alle Todos aus einem gegebenen Markdown-Text.
 * Erkennt Formate wie '- [ ] Aufgabe' oder '- [x] Erledigt'.
 */
export function extractTasksFromContent(content) {
  if (!content) return [];

  // Quick cache check (using content hash or string length + start)
  const cacheKey = content.length + content.substring(0, 50);
  if (taskCache.has(cacheKey)) return taskCache.get(cacheKey);

  const tasks = [];
  // Globaler Regex für GFM Task Listen
  const taskRegex = /^- \[( |x|X)\] (.*)$/gm;

  let match;
  while ((match = taskRegex.exec(content)) !== null) {
    tasks.push({
      done: match[1].toLowerCase() === 'x',
      text: match[2].trim(),
      raw: match[0]
    });
  }

  // Simple cache management
  if (taskCache.size > 500) taskCache.clear();
  taskCache.set(cacheKey, tasks);

  return tasks;
}