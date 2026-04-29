
const taskRegex = /^(\s*)(?:[-*]\s+)?\[( |x|X)\]\s*(.*)$/gm;
const content = "\n[ ] Task 1\n[ ] Task 2";
let match;
while ((match = taskRegex.exec(content)) !== null) {
  console.log({
    indent: match[1].length,
    text: match[3],
    raw: JSON.stringify(match[0])
  });
}
