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
  // Globaler Regex für GFM Task Listen, jetzt auch mit Einrückung
  const taskRegex = /^(\s*)- \[( |x|X)\] (.*)$/gm;

  let match;
  let index = 0;
  while ((match = taskRegex.exec(content)) !== null) {
    tasks.push({
      done: match[2].toLowerCase() === 'x',
      text: match[3].trim(),
      raw: match[0],
      index: index++
    });
  }

  // Simple cache management
  if (taskCache.size > 500) taskCache.clear();
  taskCache.set(cacheKey, tasks);

  return tasks;
}