const fs = require('fs');
const path = require('path');

const srcLocalesDir = path.join(__dirname, 'src/_locales');
const buildTargets = [
  path.join(__dirname, 'build/chrome/_locales'),
  path.join(__dirname, 'build/firefox/_locales'),
];

function mergeLocaleFiles(locale, localePath) {
  const files = fs.readdirSync(localePath)
    .filter(f => f.endsWith('.json'))
    .sort();

  let merged = {};
  for (const file of files) {
    const filePath = path.join(localePath, file);
    if (file === 'messages.json') continue; // We'll overwrite this
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    merged = { ...merged, ...data };
  }
  // Also include the base messages.json (lowest priority)
  const basePath = path.join(localePath, 'messages.json');
  if (fs.existsSync(basePath)) {
    const baseData = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    merged = { ...baseData, ...merged };
  }
  // Write merged result to each build target
  for (const targetRoot of buildTargets) {
    // Ensure _locales and language subfolder exist
    if (!fs.existsSync(targetRoot)) {
      fs.mkdirSync(targetRoot, { recursive: true });
    }
    const targetLocaleDir = path.join(targetRoot, locale);
    if (!fs.existsSync(targetLocaleDir)) {
      fs.mkdirSync(targetLocaleDir, { recursive: true });
    }
    const targetMessages = path.join(targetLocaleDir, 'messages.json');
    fs.writeFileSync(targetMessages, JSON.stringify(merged, null, 2));
    console.log(`Merged locale files for ${locale} -> ${targetMessages}`);
  }
}

// Ensure _locales and language folders are created, and only merged messages.json is written
fs.readdirSync(srcLocalesDir).forEach(locale => {
  const localePath = path.join(srcLocalesDir, locale);
  if (fs.statSync(localePath).isDirectory()) {
    mergeLocaleFiles(locale, localePath);
  }
}); 