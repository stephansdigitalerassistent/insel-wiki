const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '../node_modules/lodash/template.js');

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  if (!content.includes('_arrayEach')) {
    const patch = "var arrayEach = require('./_arrayEach'), assignWith = require('./assignWith');\n";
    fs.writeFileSync(targetFile, patch + content, 'utf8');
    console.log('Successfully patched lodash/template.js with missing imports.');
  } else {
    console.log('lodash/template.js is already patched.');
  }
} else {
  console.warn('Warning: lodash/template.js not found to patch.');
}
