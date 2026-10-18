'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.scripts.start, 'node server.js', 'Render yarn start should invoke server.js');
assert.match(html, /href="style\.css"/, 'HTML must reference style.css');
assert.match(html, /src="app\.js"/, 'HTML must reference app.js');
assert.ok(css.length > 1000, 'CSS should not be empty');
new vm.Script(js, { filename: 'app.js' });
for (const file of ['index.html', 'style.css', 'app.js', 'server.js']) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} must exist`);
}
console.log('PASS: package.json start script');
console.log('PASS: HTML CSS/JS references');
console.log('PASS: JavaScript syntax');
console.log('PASS: required server files');
