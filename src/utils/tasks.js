/**
 * Extrahiert alle Todos aus einem gegebenen Markdown-Text.
 * Erkennt Formate wie '- [ ] Aufgabe' oder '- [x] Erledigt'.
 */
export function extractTasksFromContent(content) {
  if (!content) return [];
  
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
  
  return tasks;
}