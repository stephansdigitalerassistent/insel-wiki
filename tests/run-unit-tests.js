import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';

// Discover all unit test files matching src/utils/*.test.js and tests/utils.test.js
const testFiles = [
  ...globSync('src/utils/*.test.js'),
  'tests/utils.test.js'
];

console.log(`Found ${testFiles.length} unit test file(s) to execute.\n`);

let hasFailed = false;

for (const file of testFiles) {
  console.log(`▶️ Running: node ${file}`);
  const result = spawnSync('node', [file], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`❌ File failed: ${file} (exit code ${result.status})`);
    hasFailed = true;
  } else {
    console.log(`✅ File passed: ${file}\n`);
  }
}

if (hasFailed) {
  console.error('❌ Some unit tests failed.');
  process.exit(1);
} else {
  console.log('🎉 All unit tests executed successfully.');
}
