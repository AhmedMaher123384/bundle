const fs = require('fs');
const code = fs.readFileSync('/Users/ahmedmaher/Documents/trae_projects/bundle_app/snippet_latest.js', 'utf8');

// Look at the problematic try statement
const pos = 384;
const context = code.substring(pos - 50, pos + 300);
console.log('Problematic try statement:');
console.log(JSON.stringify(context));

// Look for the catch block that should be there
const afterTry = code.substring(pos, pos + 500);
const catchPos = afterTry.indexOf('catch');
console.log('\nCatch position:', catchPos);
if (catchPos === -1) {
  console.log('No catch found in next 500 chars!');
} else {
  const catchContext = afterTry.substring(Math.max(0, catchPos - 20), catchPos + 50);
  console.log('Catch context:', JSON.stringify(catchContext));
}