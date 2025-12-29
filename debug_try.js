const fs = require('fs');
const code = fs.readFileSync('/Users/ahmedmaher/Documents/trae_projects/bundle_app/snippet_latest.js', 'utf8');

// Find all try statements
const tryMatches = code.match(/try\s*\{/g);
console.log('Found', tryMatches ? tryMatches.length : 0, 'try statements');

// Find positions of all try statements
let pos = 0;
let tryCount = 0;
while ((pos = code.indexOf('try', pos)) !== -1) {
  tryCount++;
  const context = code.substring(Math.max(0, pos - 20), pos + 50);
  console.log(`Try #${tryCount} at position ${pos}:`, JSON.stringify(context));
  pos += 3;
}