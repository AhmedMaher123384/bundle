const fs = require('fs');
const code = fs.readFileSync('/Users/ahmedmaher/Documents/trae_projects/bundle_app/snippet_latest.js', 'utf8');

// Find the problematic try statement manually
const pos = 384;
console.log('Starting at position', pos);

// Count braces to find the matching closing brace
let braceCount = 0;
let i = pos + 3; // skip 'try'
let inString = false;
let stringChar = '';

while (i < code.length) {
  const char = code[i];
  
  // Handle string escaping
  if (inString && char === '\\') {
    i += 2; // skip escaped character
    continue;
  }
  
  // Handle string boundaries
  if (!inString && (char === '"' || char === "'" || char === '`')) {
    inString = true;
    stringChar = char;
  } else if (inString && char === stringChar) {
    inString = false;
    stringChar = '';
  }
  
  // Count braces only when not in string
  if (!inString) {
    if (char === '{') braceCount++;
    else if (char === '}') braceCount--;
    
    if (braceCount === -1) {
      // Found the closing brace
      const tryBlock = code.substring(pos, i + 1);
      console.log('Found try block:', JSON.stringify(tryBlock));
      
      // Check what comes after
      const after = code.substring(i + 1, i + 100).trim();
      console.log('What comes after:', JSON.stringify(after));
      
      if (!after.startsWith('catch') && !after.startsWith('finally')) {
        console.log('❌ PROBLEM: No catch or finally!');
      } else {
        console.log('✅ Has catch/finally');
      }
      break;
    }
  }
  
  i++;
}