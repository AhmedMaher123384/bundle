const fs = require('fs');
const code = fs.readFileSync('/Users/ahmedmaher/Documents/trae_projects/bundle_app/snippet_latest.js', 'utf8');

// Look at the exact structure around position 384
const pos = 384;
const context = code.substring(pos - 100, pos + 500);
console.log('Context around position 384:');
console.log(JSON.stringify(context));

// Let's also check if there's a syntax error by parsing just this section
try {
  new Function(context);
  console.log('✅ This section parses correctly');
} catch (e) {
  console.log('❌ Syntax error in this section:', e.message);
}