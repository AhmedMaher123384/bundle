// Script to convert formatted JS to array format for bundle.logic.js
const fs = require('fs');
const path = require('path');

// Read the formatted file
const formattedPath = '/Users/ahmedmaher/Documents/trae_projects/bundle_app/backend/src/storefront/snippet/features/bundle/bundle.logic.formatted.js';
const formattedContent = fs.readFileSync(formattedPath, 'utf8');

// Remove the module.exports part and keep only the functions
const functionsMatch = formattedContent.match(/function [\s\S]*?(?=\/\/ Export the module)/);
if (!functionsMatch) {
  console.error('Could not find functions section');
  process.exit(1);
}

let functionsCode = functionsMatch[0];

// Minify the code (basic minification)
functionsCode = functionsCode
  .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
  .replace(/\/\/.*$/gm, '') // Remove line comments
  .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
  .replace(/;\s*}/g, ';}') // Remove spaces before closing braces
  .replace(/{\s*/g, '{') // Remove spaces after opening braces
  .replace(/\s*;\s*/g, ';') // Normalize semicolons
  .trim();

// Split into chunks that can be safely escaped for the array format
const chunks = [];
const maxChunkSize = 500; // Safe size for string literals

for (let i = 0; i < functionsCode.length; i += maxChunkSize) {
  chunks.push(functionsCode.slice(i, i + maxChunkSize));
}

// Create the array format
const arrayContent = `module.exports = [
${chunks.map(chunk => `  ${JSON.stringify(chunk)}`).join(',\n')}
];`;

// Write the output
const outputPath = '/Users/ahmedmaher/Documents/trae_projects/bundle_app/backend/src/storefront/snippet/features/bundle/bundle.logic.js';
fs.writeFileSync(outputPath, arrayContent);

console.log('Successfully converted formatted code to array format');
console.log(`Output written to: ${outputPath}`);
console.log(`Total chunks: ${chunks.length}`);
