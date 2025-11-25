# 🔨 Build Instructions

## 🛠️ Development Setup

This guide explains how to set up your development environment and build YT re:Watch extension for both Chrome and Firefox.

### Prerequisites
- **Node.js 14+** - [Download here](https://nodejs.org/)
- **NPM or Yarn** - Package manager (comes with Node.js)
- **Chrome/Firefox** - For testing the extension
- **Git** - For cloning the repository

### Local Development

#### 1. Clone the Repository
```bash
git clone https://github.com/EdinUser/YouTubeLocalHistory.git
cd YouTubeLocalHistory
```

#### 2. Install Dependencies
```bash
npm install
```

This will install all required dependencies including:
- **Jest** - For unit and integration testing
- **Playwright** - For end-to-end testing
- **ESLint** - For code linting
- **Babel** - For JavaScript transpilation

#### 3. Build the Extension
```bash
# Build both Chrome and Firefox versions
./build.sh

# Or build specific browser
./build.sh chrome
./build.sh firefox
```

#### 4. Load in Browser
After building, the extensions will be available in the `dist/` folder:
- **Chrome**: `dist/youtube-local-history-chrome-v{version}.zip`
- **Firefox**: `dist/youtube-local-history-firefox-v{version}.zip`

**To load in browser:**
- **Chrome**: Go to `chrome://extensions/`, enable "Developer mode", click "Load unpacked" and select the `build/chrome` folder
- **Firefox**: Go to `about:debugging`, click "This Firefox", then "Load Temporary Add-on" and select the `build/firefox` folder

### Testing

#### Run All Tests
```bash
npm test
```

#### Run Specific Test Suites
```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Memory tests only
npm run test:memory

# End-to-end tests (requires Playwright browsers)
npm run test:e2e

# Watch mode for development
npm run test:watch
```

#### Test Coverage
```bash
npm run test:coverage
```

This generates a coverage report in the `coverage/` folder.

### Building for Production

#### Build Both Browsers
```bash
./build.sh
```

This will:
1. Clean previous builds
2. Merge locale files
3. Build Chrome extension (with signing if certificates are available)
4. Build Firefox extension
5. Create distribution packages in `dist/`

#### Build Specific Browser
```bash
# Chrome only
./build.sh chrome

# Firefox only
./build.sh firefox
```

#### Output Files
After building, you'll find:
- **Chrome**: `dist/youtube-local-history-chrome-v{version}.zip` and `.crx` (if signed)
- **Firefox**: `dist/youtube-local-history-firefox-v{version}.zip`

### Project Structure

```
src/
├── _locales/          # Multi-language support files
│   ├── en/           # English translations
│   ├── de/           # German translations
│   └── ...           # Other languages
├── manifest.chrome.json   # Chrome extension manifest
├── manifest.firefox.json  # Firefox extension manifest
├── background.js         # Service worker/background script
├── content.js           # Content script for YouTube pages
├── popup.html/js        # Extension popup interface
├── storage.js           # Local storage management
└── indexeddb-storage.js # IndexedDB wrapper for unlimited storage
```

### Development Tips

#### Hot Reloading
- The build script doesn't include hot reloading
- After making changes, run `./build.sh` and reload the extension in your browser
- Use the "Reload" button in `chrome://extensions/` or `about:debugging`

#### Debugging
- Enable "Debug Mode" in the extension settings for detailed logging
- Check browser console for errors
- Use `chrome://extensions/` or `about:debugging` for extension management

#### Common Issues
- **Build fails**: Ensure Node.js 14+ and all dependencies are installed
- **Extension not loading**: Check manifest permissions and browser compatibility
- **Tests failing**: Ensure Playwright browsers are installed (`npx playwright install`)

---
*For more technical details, see [Technical Documentation](./technical.md)*
