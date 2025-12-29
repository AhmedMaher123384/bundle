const fs = require('fs');
const code = fs.readFileSync('/Users/ahmedmaher/Documents/trae_projects/bundle_app/snippet_latest.js', 'utf8');

// Look more carefully at the try statements
const tryRegex = /try\s*\{([^}]*)\}/g;
let match;
let count = 0;

while ((match = tryRegex.exec(code)) !== null) {
  count++;
  const fullMatch = match[0];
  const afterMatch = code.substring(match.index + fullMatch.length, match.index + fullMatch.length + 100);
  
  console.log(`Try #${count} at position ${match.index}:`);
  console.log('Full match:', JSON.stringify(fullMatch));
  console.log('After match:', JSON.stringify(afterMatch));
  
  // Check if next thing is catch or finally
  const nextPart = afterMatch.trim();
  if (!nextPart.startsWith('catch') && !nextPart.startsWith('finally')) {
    console.log('❌ PROBLEM: No catch or finally after this try!');
    break;
  }
  console.log('✅ Has catch/finally');
  console.log('---');
}