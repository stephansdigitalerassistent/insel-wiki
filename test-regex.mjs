import { extractTasksFromContent } from './src/utils/tasks.js';

const samples = [
  '- [ ] Task 1',
  '- [x] Task 2',
  '* [ ] Task 3',
  '  - [ ] Indented Task',
  '- [ ]Task with no space',
  '- [ ]   Task with many spaces',
  '[ ] Task without dash', // Should NOT match currently
];

samples.forEach(sample => {
  const result = extractTasksFromContent(sample);
  console.log(`Sample: "${sample}"`);
  console.log(`Result: ${JSON.stringify(result)}`);
  console.log('---');
});
