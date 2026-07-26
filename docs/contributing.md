# 🤝 Contributing to YT re:Watch

We welcome contributions from the community! Whether you're fixing bugs, adding features, improving documentation, or translating the extension, your help makes YT re:Watch better for everyone.

## 🚀 Getting Started

### 1. Fork and Clone
```bash
# Fork the repository on GitHub
git clone https://github.com/YOUR_USERNAME/YouTubeLocalHistory.git
cd YouTubeLocalHistory
```

### 2. Set Up Development Environment
Follow the [Build Instructions](./build.md) to set up your development environment.

### 3. Create a Feature Branch
```bash
git checkout -b feature/amazing-feature
# or
git checkout -b fix/important-bug
```

## 📝 Contribution Types

### 🐛 Bug Fixes
- **Test thoroughly** - Ensure your fix works across different scenarios
- **Add tests** - Include unit tests for your bug fix
- **Update documentation** - If the fix changes user-facing behavior

### ✨ New Features
- **Follow existing patterns** - Match the current codebase style and architecture
- **Add comprehensive tests** - Unit, integration, and e2e tests as appropriate
- **Update documentation** - Add user-facing documentation for new features
- **Consider browser compatibility** - Test on both Chrome and Firefox

### 🌐 Translations
- Edit the appropriate JSON files in `src/_locales/{language}/`
- **Test your translations** - Load the extension and verify text appears correctly
- **Follow existing key naming** - Use consistent patterns for message keys

### 📚 Documentation
- **Keep it user-friendly** - Write for end users, not just developers
- **Include examples** - Show before/after where helpful
- **Test links** - Ensure all internal links work correctly

## 💻 Development Workflow

### Code Style Guidelines
- **JavaScript ES6+** - Use modern JavaScript features
- **Consistent naming** - Follow existing variable and function naming patterns
- **Comments where useful** - Add short comments for complex behavior, especially storage migrations, YouTube parser logic, and feed ranking rules
- **2-space indentation** - Match the existing codebase style
- **Meaningful variable names** - Use descriptive names that explain purpose

### Pull Request Process

1. **Create feature branch** from `main`
2. **Make your changes** following the guidelines above
3. **Write tests** for new functionality
4. **Run checks** to ensure nothing is broken
5. **Update documentation** if needed
6. **Submit pull request** with clear description

Recommended checks before opening a PR:

```bash
npm run lint
npm test -- --runInBand
npm run prepare:firefox
npx web-ext lint --source-dir=build/firefox
```

For local Firefox testing, load `build/firefox/manifest.json` from `about:debugging` after running `npm run prepare:firefox`.

### Code Review Guidelines

When reviewing contributions, focus on:

- **Functionality** - Does it work as intended?
- **Performance** - Any performance regressions?
- **Security** - Are there any security vulnerabilities?
- **Browser compatibility** - Works on both Chrome and Firefox?
- **Test coverage** - Are there appropriate tests?
- **Documentation** - Is it properly documented?

## 🔧 Technical Guidelines

### Browser Extension APIs
- Use **Manifest V3** patterns for Chrome
- Ensure **WebExtensions compatibility** for Firefox
- Follow **security best practices** for extension development

### Storage Management
- Use **chrome.storage** or **browser.storage** APIs appropriately
- Handle **storage quotas** gracefully
- Implement **data migration** for schema changes

### Error Handling
- **Graceful degradation** - Extension should work even if features fail
- **User-friendly errors** - Show helpful messages to users
- **Comprehensive logging** - Enable debug mode for troubleshooting

### Testing Requirements
- **Unit tests** for individual functions
- **Integration tests** for feature interactions
- **E2E tests** for complete user workflows when a change affects browser behavior end-to-end
- **Cross-browser testing** on Chrome and Firefox

## 🌍 Localization

### Adding New Languages
1. Create new folder in `src/_locales/{language_code}/`
2. Copy structure from existing language (e.g., `en/`)
3. Translate all JSON files
4. Keep message keys in sync across all locale JSON files
5. Update browser manifests only if the new language needs manifest metadata

### Translation Guidelines
- **Keep keys consistent** - Use the same message keys as English
- **Cultural adaptation** - Adapt content for cultural context when needed
- **Length considerations** - Some UI elements have space constraints

## 📞 Getting Help

### Community Support
- **GitHub Issues** - [Report bugs or request features](https://github.com/EdinUser/YouTubeLocalHistory/issues)
- **Telegram Community** - [Chat with other contributors](https://t.me/+eFftKWGVvSpiZjZk)
- **Documentation** - Check existing docs for guidance

### Before Asking Questions
1. **Search existing issues** - Someone may have already reported your problem
2. **Check documentation** - The answer might already be documented
3. **Try troubleshooting steps** - Basic debugging often solves issues

## 🎉 Recognition

Contributors are recognized in:
- **CHANGELOG.md** - For significant contributions
- **GitHub repository** - All contributors listed
- **Community shoutouts** - In our Telegram community

---

Thank you for contributing to YT re:Watch! Your help makes YouTube better for everyone. 🚀
