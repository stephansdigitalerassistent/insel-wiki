import { extractTasksFromContent } from './src/utils/tasks.js';

const content = `
# Title
- [ ] Task 1
- [x] Task 2
  - [ ] Subtask 1
* [ ] Task 3 (using asterisk)
 - [ ] Task 4 (with leading space)
[ ] Task 5 (no dash)
`;

const tasks = extractTasksFromContent(content);
console.log('Extracted tasks:', JSON.stringify(tasks, null, 2));

if (tasks.length === 3) {
    console.log('SUCCESS: Extracted 3 tasks (ignoring asterisk and no-dash)');
} else {
    console.log('FAILURE: Extracted ' + tasks.length + ' tasks instead of 3 (or more if we want to support asterisk)');
}
