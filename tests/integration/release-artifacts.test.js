const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const LOCALES = ['en', 'bg', 'de', 'es', 'fr'];
const EXPECTED_PERMISSIONS = ['storage', 'unlimitedStorage', 'scripting', 'contextMenus'];
const EXPECTED_HOST_PERMISSIONS = ['*://*.youtube.com/*'];
const REMOVED_LEGACY_MODULES = [
  'feed-core.js',
  'feed-data-pipeline.js',
  'feed-youtube-search-core.js',
  'feed-youtube-search-render.js',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n').slice(0, 4000));
  }
  return result.stdout;
}

function filesUnder(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute, relative) : [relative];
  });
}

function archiveEntries(archivePath) {
  return run('unzip', ['-Z1', archivePath])
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, ''))
    .filter((entry) => entry && !entry.endsWith('/'))
    .sort();
}

function manifestReferences(manifest) {
  return [
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap((item) => [...(item.js || []), ...(item.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((item) => item.resources || []),
  ].filter(Boolean);
}

function htmlReferences(html) {
  return [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1].split(/[?#]/)[0])
    .filter((reference) => (
      reference &&
      !reference.startsWith('/') &&
      !/^(?:https?:|data:|mailto:|javascript:)/i.test(reference)
    ));
}

function assertPackageContract(buildDir, archivePath, expectedVersion) {
  const buildFiles = filesUnder(buildDir).sort();
  const entries = archiveEntries(archivePath);
  expect(entries).toEqual(buildFiles);

  const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'));
  expect(manifest.version).toBe(expectedVersion);
  expect(manifest.permissions).toEqual(EXPECTED_PERMISSIONS);
  expect(manifest.host_permissions).toEqual(EXPECTED_HOST_PERMISSIONS);
  REMOVED_LEGACY_MODULES.forEach((moduleName) => expect(entries).not.toContain(moduleName));
  const references = new Set(manifestReferences(manifest));

  entries.filter((entry) => entry.endsWith('.html')).forEach((entry) => {
    const html = fs.readFileSync(path.join(buildDir, entry), 'utf8');
    htmlReferences(html).forEach((reference) => references.add(reference));
  });
  const missingReferences = [...references]
    .filter((reference) => !entries.includes(reference))
    .sort();

  const englishCatalog = JSON.parse(
    fs.readFileSync(path.join(buildDir, '_locales', 'en', 'messages.json'), 'utf8')
  );
  expect(Object.keys(englishCatalog)).toHaveLength(380);
  LOCALES.forEach((locale) => {
    const localePath = `_locales/${locale}/messages.json`;
    expect(entries).toContain(localePath);
    const catalog = JSON.parse(fs.readFileSync(path.join(buildDir, localePath), 'utf8'));
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(englishCatalog).sort());
  });

  const embeddedManifest = JSON.parse(run('unzip', ['-p', archivePath, 'manifest.json']));
  expect(embeddedManifest.version).toBe(expectedVersion);
  expect(embeddedManifest.permissions).toEqual(EXPECTED_PERMISSIONS);
  expect(embeddedManifest.host_permissions).toEqual(EXPECTED_HOST_PERMISSIONS);
  return missingReferences;
}

function createIsolatedCheckout() {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'ytlh-release-artifacts-'));
  ['build.sh', 'merge_locales.js', 'package.json', 'package-lock.json'].forEach((name) => {
    fs.copyFileSync(path.join(ROOT, name), path.join(checkout, name));
  });
  fs.mkdirSync(path.join(checkout, 'scripts'));
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'build-chrome-unpacked.sh'),
    path.join(checkout, 'scripts', 'build-chrome-unpacked.sh')
  );
  fs.cpSync(path.join(ROOT, 'src'), path.join(checkout, 'src'), { recursive: true });

  const fakeBin = path.join(checkout, 'fake-bin');
  fs.mkdirSync(fakeBin);
  const fakeChrome = path.join(fakeBin, 'google-chrome-stable');
  fs.writeFileSync(fakeChrome, `#!/bin/sh
extension_dir=""
for argument in "$@"; do
  case "$argument" in
    --pack-extension=*) extension_dir="\${argument#*=}" ;;
  esac
done
test -n "$extension_dir"
: > "\${extension_dir}.crx"
`);
  fs.chmodSync(fakeChrome, 0o755);
  return { checkout, fakeBin };
}

function build(checkout, fakeBin) {
  run('bash', ['build.sh'], {
    cwd: checkout,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });
}

test('release build is clean, repeatable, complete, localized, and version-aligned for both browsers', () => {
  const { checkout, fakeBin } = createIsolatedCheckout();
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(checkout, 'package-lock.json'), 'utf8'));
    const chromeSourceManifest = JSON.parse(fs.readFileSync(path.join(checkout, 'src', 'manifest.chrome.json'), 'utf8'));
    const firefoxSourceManifest = JSON.parse(fs.readFileSync(path.join(checkout, 'src', 'manifest.firefox.json'), 'utf8'));
    const version = packageJson.version;

    expect(packageLock.version).toBe(version);
    expect(packageLock.packages[''].version).toBe(version);
    expect(chromeSourceManifest.version).toBe(version);
    expect(firefoxSourceManifest.version).toBe(version);

    build(checkout, fakeBin);
    const chromeArchive = path.join(checkout, 'dist', `youtube-local-history-chrome-v${version}.zip`);
    const firefoxArchive = path.join(checkout, 'dist', `youtube-local-history-firefox-v${version}.zip`);
    const firstMissing = {
      chrome: assertPackageContract(path.join(checkout, 'build', 'chrome'), chromeArchive, version),
      firefox: assertPackageContract(path.join(checkout, 'build', 'firefox'), firefoxArchive, version),
    };

    const sentinel = path.join(checkout, 'stale-release-sentinel.txt');
    fs.writeFileSync(sentinel, 'must not survive a repeated build');
    fs.copyFileSync(sentinel, path.join(checkout, 'build', 'chrome', path.basename(sentinel)));
    fs.copyFileSync(sentinel, path.join(checkout, 'build', 'firefox', path.basename(sentinel)));
    run('zip', ['-j', chromeArchive, sentinel]);
    run('zip', ['-j', firefoxArchive, sentinel]);

    build(checkout, fakeBin);
    expect(filesUnder(path.join(checkout, 'build', 'chrome'))).not.toContain(path.basename(sentinel));
    expect(filesUnder(path.join(checkout, 'build', 'firefox'))).not.toContain(path.basename(sentinel));
    expect(archiveEntries(chromeArchive)).not.toContain(path.basename(sentinel));
    expect(archiveEntries(firefoxArchive)).not.toContain(path.basename(sentinel));
    const repeatedMissing = {
      chrome: assertPackageContract(path.join(checkout, 'build', 'chrome'), chromeArchive, version),
      firefox: assertPackageContract(path.join(checkout, 'build', 'firefox'), firefoxArchive, version),
    };
    expect({ firstBuild: firstMissing, repeatedBuild: repeatedMissing }).toEqual({
      firstBuild: { chrome: [], firefox: [] },
      repeatedBuild: { chrome: [], firefox: [] },
    });
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
}, 120000);

test('release artifact gate detects a referenced feed module omitted from both browser packages', () => {
  const { checkout, fakeBin } = createIsolatedCheckout();
  try {
    const buildScriptPath = path.join(checkout, 'build.sh');
    const referencedModule = 'feed-local-search.js';
    const copiedLine = `       "$PROJECT_ROOT/src/${referencedModule}" \\\n`;
    const buildScript = fs.readFileSync(buildScriptPath, 'utf8');
    expect(buildScript).toContain(copiedLine);
    fs.writeFileSync(buildScriptPath, buildScript.replace(copiedLine, ''));

    build(checkout, fakeBin);
    const version = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8')).version;
    const missing = {
      chrome: assertPackageContract(
        path.join(checkout, 'build', 'chrome'),
        path.join(checkout, 'dist', `youtube-local-history-chrome-v${version}.zip`),
        version
      ),
      firefox: assertPackageContract(
        path.join(checkout, 'build', 'firefox'),
        path.join(checkout, 'dist', `youtube-local-history-firefox-v${version}.zip`),
        version
      ),
    };

    expect(missing).toEqual({
      chrome: [referencedModule],
      firefox: [referencedModule],
    });
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
}, 120000);

test('Chrome E2E rebuild prunes deleted source modules without replacing its loaded directory', () => {
  const { checkout } = createIsolatedCheckout();
  try {
    const buildDir = path.join(checkout, 'build', 'e2e', 'chrome');
    fs.mkdirSync(buildDir, { recursive: true });
    REMOVED_LEGACY_MODULES.forEach((moduleName) => {
      fs.writeFileSync(path.join(buildDir, moduleName), 'stale module');
    });
    const retainedMarker = path.join(buildDir, 'loaded-profile-marker');
    fs.writeFileSync(retainedMarker, 'keep the loaded directory');

    run('bash', ['scripts/build-chrome-unpacked.sh'], { cwd: checkout });

    REMOVED_LEGACY_MODULES.forEach((moduleName) => {
      expect(fs.existsSync(path.join(buildDir, moduleName))).toBe(false);
    });
    expect(fs.readFileSync(retainedMarker, 'utf8')).toBe('keep the loaded directory');
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
}, 30000);
