const fs = require('fs');
const files = ['Config.gs', 'Code.gs', 'DataPipeline.gs', 'AdSetPipeline.gs', 'AdPipeline.gs'];
const declared = new Set(['Logger', 'SpreadsheetApp', 'DriveApp', 'PropertiesService', 'UrlFetchApp', 'Utilities', 'Session', 'HtmlService', 'MailApp', 'JSON', 'Math', 'Date', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Infinity', 'setTimeout', 'console', 'TypeError', 'Error', 'RangeError']);

files.forEach(f => {
  const code = fs.readFileSync('apps-script/' + f, 'utf8');
  // strip comments and strings
  const cleaned = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
  
  // declared
  for (const m of cleaned.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g)) declared.add(m[1]);
  for (const m of cleaned.matchAll(/(?:var|const|let)\s+([a-zA-Z0-9_]+)/g)) declared.add(m[1]);
});

const missingCalls = [];
files.forEach(f => {
  const code = fs.readFileSync('apps-script/' + f, 'utf8');
  const cleaned = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
  
  // Match standalone function calls not preceded by a dot
  const regex = /(?<![\.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  for (const m of cleaned.matchAll(regex)) {
    const fn = m[1];
    if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'delete', 'void'].includes(fn)) continue;
    if (!declared.has(fn)) {
      missingCalls.push({ file: f, fn: fn });
    }
  }
});

console.log('Standalone undeclared calls count:', missingCalls.length);
console.log(missingCalls);
