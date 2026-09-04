import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findTests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join(dir, f))
    .sort();
}

// Discover all unit test files matching src/utils/*.test.js, src/editor/*.test.js,
// src/components/*.test.js, and tests/utils.test.js
const testFiles = [
  ...findTests('src/utils'),
  ...findTests('src/editor'),
  ...findTests('src/components'),
  'tests/utils.test.js'
].filter(f => fs.existsSync(f));

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
