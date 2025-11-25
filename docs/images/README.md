# 📸 Documentation Images

This folder contains all visual content for YT re:Watch documentation.

## 📁 Folder Structure

```
images/
├── installation/          # Installation process screenshots
│   ├── chrome-webstore.png
│   ├── firefox-addons.png
│   ├── extension-installed.png
│   └── toolbar-icon.png
├── interface/             # Extension interface screenshots  
│   ├── popup-overview.png
│   ├── videos-tab.png
│   ├── shorts-tab.png
│   ├── playlists-tab.png
│   ├── analytics-tab.png
│   └── settings-tab.png
├── features/              # Feature demonstrations
│   ├── youtube-overlay.png
│   ├── progress-bar.png
│   ├── search-function.png
│   ├── theme-switching.png
│   └── sync-indicator.png   # Legacy asset from Firefox Sync era (4.0.0+ no longer uses sync)
├── troubleshooting/       # Problem-solving visuals
│   ├── common-issues.png
│   ├── sync-setup.png       # Legacy Firefox Sync configuration (kept for historical reference)
│   └── browser-differences.png
└── videos/               # Video content (if any)
    ├── quick-start.mp4
    └── feature-overview.mp4
```

## 📋 Image Requirements

### Technical Specifications
- **Format**: PNG for screenshots, JPG for photos, SVG for icons
- **Resolution**: Minimum 1920x1080 for screenshots
- **Retina**: 2x versions for high-DPI displays
- **Compression**: Optimize for web (keep under 500KB each)

### Content Guidelines
- **Annotations**: Use red arrows/circles to highlight important areas
- **Consistency**: Same browser, theme, and UI state across screenshots
- **Context**: Show enough surrounding context to orient users
- **Quality**: Clear, well-lit, professional appearance

## 🎯 Priority Screenshots Needed

### High Priority (Week 1)
- [ ] `installation/chrome-webstore.png` - Chrome Web Store page
- [ ] `installation/firefox-addons.png` - Firefox Add-ons page
- [ ] `interface/popup-overview.png` - All 5 tabs visible
- [ ] `features/youtube-overlay.png` - "viewed" label on video

### Medium Priority (Week 2)
- [ ] `interface/videos-tab.png` - Videos tab with sample data
- [ ] `interface/analytics-tab.png` - Charts and statistics
- [ ] `features/progress-bar.png` - Video thumbnail with progress
- [ ] `interface/settings-tab.png` - Customization options

### Low Priority (Week 3)
- [ ] `troubleshooting/sync-setup.png` - Firefox Sync configuration
- [ ] `features/theme-switching.png` - Dark/light mode comparison
- [ ] `interface/shorts-tab.png` - YouTube Shorts display
- [ ] `interface/playlists-tab.png` - Playlist management

## 🎨 Style Guidelines

### Visual Style
- **Clean backgrounds**: Avoid clutter in screenshots
- **Consistent UI state**: Same browser zoom, window size
- **Highlight important elements**: Use arrows, circles, or borders
- **Professional appearance**: Well-organized, clean interface

### Annotation Style
- **Color**: Use red (#FF0000) for highlights
- **Arrows**: Simple, bold arrows pointing to key elements
- **Text**: Clear, readable font (minimum 14px)
- **Spacing**: Don't overcrowd annotations

## 📱 Multi-Platform Considerations

### Browser Differences
- Chrome vs Firefox extension interfaces
- Different operating systems (Windows, Mac, Linux)
- Various screen sizes and resolutions

### Accessibility
- High contrast versions for accessibility
- Alt text descriptions for all images
- Clear visual hierarchy and labeling

## 🔧 Tools Recommended

### Screenshot Tools
- **Built-in**: macOS Screenshot (Cmd+Shift+4), Windows Snipping Tool
- **Third-party**: Lightshot, Greenshot, CleanShot X
- **Browser extensions**: Full Page Screen Capture

### Image Editing
- **Simple edits**: Paint, Preview, Photos
- **Advanced**: GIMP (free), Photoshop, Canva
- **Annotations**: Skitch, Annotate, CloudApp

### Optimization
- **Compression**: TinyPNG, ImageOptim, Squoosh
- **Format conversion**: CloudConvert, Online-Convert
- **Batch processing**: ImageMagick, Automator

## 📝 Naming Conventions

### File Naming
- Use lowercase with hyphens: `chrome-webstore.png`
- Be descriptive: `analytics-tab-with-charts.png`
- Include version if needed: `popup-overview-v2.6.4.png`
- Use consistent prefixes: `ui-`, `feature-`, `install-`

### Alt Text Guidelines
```markdown
![Extension popup showing all five tabs](./images/interface/popup-overview.png)
![Chrome Web Store install button highlighted](./images/installation/chrome-webstore.png)
```

## 🚀 Getting Started

### For Contributors
1. **Check priority list** above for most needed images
2. **Follow technical specifications** for quality
3. **Use consistent style** across all screenshots
4. **Submit via PR** with descriptive commit messages

### For Maintainers
1. **Review image quality** before merging
2. **Check file sizes** (optimize if needed)
3. **Verify alt text** is descriptive
4. **Update priority list** as images are added

## 📊 Usage in Documentation

### Markdown Syntax
```markdown
![Alt text](./images/folder/filename.png)
```

### HTML for Advanced Layout
```html
<img src="./images/folder/filename.png" alt="Alt text" width="600" style="border: 1px solid #ccc;">
```

### Responsive Images
```markdown
![Alt text](./images/folder/filename.png)
*Figure 1: Extension popup interface showing all available tabs*
```

---

*Ready to contribute visual content? Pick an image from the priority list and start creating!* 
