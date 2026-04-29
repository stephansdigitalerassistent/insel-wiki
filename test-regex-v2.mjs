
const samples = [
  '- [ ] Task 1',
  '- [x] Task 2',
  '* [ ] Task 3',
  '  - [ ] Indented Task',
  '- [ ]Task with no space',
  '- [ ]   Task with many spaces',
  '[ ] Task without dash',
  '  [ ] Indented without dash'
];

// Proposed regex:
// ^(\s*)           - Leading whitespace
// (?:[-*]\s+)?     - Optional marker (- or *) followed by at least one space
// \[( |x|X)\]      - [ ] or [x]
// \s*              - Optional space after brackets
// (.*)$            - The task text
const taskRegex = /^(\s*)(?:[-*]\s+)?\[( |x|X)\]\s*(.*)$/gm;

samples.forEach(sample => {
  taskRegex.lastIndex = 0;
  const match = taskRegex.exec(sample);
  console.log(`Sample: "${sample}"`);
  if (match) {
    console.log(`Result: ${JSON.stringify({
      done: match[2].toLowerCase() === 'x',
      text: match[3].trim(),
      raw: match[0],
      indent: match[1].length
    })}`);
  } else {
    console.log(`Result: NO MATCH`);
  }
  console.log('---');
});
