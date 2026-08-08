const fs = require('fs');
const path = require('path');

const root = __dirname;
const source = path.join(root, 'src');
const target = path.join(root, 'build', 'firefox');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'manifest.chrome.json' || entry.name === 'manifest.firefox.json') continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    fs.cpSync(from, to, { recursive: true });
}

fs.copyFileSync(
    path.join(source, 'manifest.firefox.json'),
    path.join(target, 'manifest.json')
);

console.log('Prepared Firefox extension in build/firefox');
