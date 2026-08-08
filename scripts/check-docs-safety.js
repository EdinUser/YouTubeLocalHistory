#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_EXTENSIONS = new Set(['.md', '.markdown', '.yml', '.yaml', '.html', '.json']);
const TOP_LEVEL_FILES = ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'mkdocs.yml'];
const INTERNAL_GUIDES = [
  'helpers/features/user-documentation-and-screenshot-system.md',
  'helpers/important/documentation-and-screenshot-guide.md',
  'scripts/docs-screenshot-catalog.json',
];

const RULES = [
  {
    name: 'personal POSIX filesystem path',
    pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+(?:\/|\b)/,
  },
  {
    name: 'personal Windows filesystem path',
    pattern: /\b[A-Za-z]:\\Users\\[^\s\\]+/,
  },
  {
    name: 'machine-local file URL',
    pattern: /\bfile:\/\//i,
  },
  {
    name: 'home-directory shortcut',
    pattern: /(?:\$\{?HOME\}?|~)\//,
  },
  {
    name: 'workstation or deployment filesystem path',
    pattern: /\/(?:srv|var\/www|opt|mnt|Volumes)\/[A-Za-z0-9._/-]+/,
  },
  {
    name: 'local-only host',
    pattern: /(?:\blocalhost\b|\b127\.0\.0\.1\b|\[::1\]|\b[a-z0-9-]+\.(?:internal|lan)\b)/i,
  },
  {
    name: 'private network address',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
  },
  {
    name: 'remote-shell command',
    pattern: /^\s*(?:\$\s*)?(?:ssh|scp|sftp|rsync)\b/i,
  },
  {
    name: 'SSH-style remote URL',
    pattern: /(?:\bssh:\/\/|\bgit@[A-Za-z0-9.-]+:)/i,
  },
  {
    name: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: 'common access-token format',
    pattern: /\b(?:ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/,
  },
];

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(absolute);
    return PUBLIC_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function existingFile(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? [absolute] : [];
}

const files = [
  ...listFiles(path.join(ROOT, 'docs')),
  ...TOP_LEVEL_FILES.flatMap(existingFile),
  ...INTERNAL_GUIDES.flatMap(existingFile),
];

const findings = [];
for (const file of [...new Set(files)].sort()) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: path.relative(ROOT, file),
          line: index + 1,
          rule: rule.name,
        });
      }
    }
  });
}

if (findings.length) {
  console.error('Documentation safety check failed:');
  findings.forEach((finding) => {
    console.error(`- ${finding.file}:${finding.line}: ${finding.rule}`);
  });
  process.exitCode = 1;
} else {
  console.log(`Documentation safety check passed (${files.length} files scanned).`);
}
