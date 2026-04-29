
import { extractTasksFromContent } from './src/utils/tasks.js';

const content = `
[ ] Task 1 (No marker)
- [ ] Task 2 (Hyphen)
* [ ] Task 3 (Asterisk)
  - [x] Task 4 (Indented)
[x] Task 5 (No marker, checked)
`;

const tasks = extractTasksFromContent(content);
console.log('Tasks found:', tasks.length);
tasks.forEach((t, i) => {
  console.log(\`\${i}: [\${t.done ? 'x' : ' '}] "\${t.text}" (indent: \${t.indent})\`);
});

if (tasks.length === 5) {
  console.log('✅ Regex works for all cases');
} else {
  console.log('❌ Regex failed to find some tasks');
}
