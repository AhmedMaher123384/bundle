const fs = require('fs');
const code = fs.readFileSync('/Users/ahmedmaher/Documents/trae_projects/bundle_app/snippet_latest.js', 'utf8');

// Find try statements and check if they have catch or finally
let pos = 0;
let tryCount = 0;
while ((pos = code.indexOf('try', pos)) !== -1) {
  tryCount++;
  // Look ahead for catch or finally
  const afterTry = code.substring(pos + 3, pos + 100);
  const hasCatch = afterTry.includes('catch');
  const hasFinally = afterTry.includes('finally');
  
  if (!hasCatch && !hasFinally) {
    console.log(`❌ Try #${tryCount} at position ${pos} has no catch or finally!`);
    const context = code.substring(Math.max(0, pos - 20), pos + 200);
    console.log('Context:', JSON.stringify(context));
    break;
  }
  pos += 3;
}

console.log(`Checked ${tryCount} try statements`);