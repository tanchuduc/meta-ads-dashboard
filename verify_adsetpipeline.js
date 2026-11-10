const fs = require('fs');
const code = fs.readFileSync('apps-script/AdSetPipeline.gs', 'utf8');

try {
  new Function(code);
  console.log('AdSetPipeline.gs compiles cleanly as JS function body!');
} catch (e) {
  console.error('AdSetPipeline.gs syntax error:', e);
}

const funcs = [...code.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g)].map(m => m[1]);
console.log('Total functions in AdSetPipeline.gs:', funcs.length);
console.log('Has importAdSetData:', funcs.includes('importAdSetData'));
