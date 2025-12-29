const fs = require('fs');
const code = fs.readFileSync('/tmp/snippet_latest.js', 'utf8');
console.log('File length:', code.length);
console.log('Last 50 characters:', JSON.stringify(code.slice(-50)));
try {
  new Function(code);
  console.log('✅ Syntax is valid!');
} catch (e) {
  console.error('❌ Syntax error:', e.message);
  console.error('Error location:', e.stack);
}