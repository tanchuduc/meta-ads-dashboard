const fs = require('fs');
const code = fs.readFileSync('apps-script/AdPipeline.gs', 'utf8');

// Check syntax with Function constructor
try {
  new Function(code);
  console.log('AdPipeline.gs compiles cleanly as JS function body!');
} catch (e) {
  console.error('AdPipeline.gs syntax error:', e);
}

// Check function names exported/defined in AdPipeline.gs
const funcs = [...code.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g)].map(m => m[1]);
console.log('Total functions in AdPipeline.gs:', funcs.length);
console.log('Has importAdData:', funcs.includes('importAdData'));
console.log('Has importAdCreatives:', funcs.includes('importAdCreatives'));
