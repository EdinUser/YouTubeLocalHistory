# 🔧 Troubleshooting Guide

This guide helps you solve common issues with YT re:Watch extension. If you're experiencing problems, follow these steps in order.

## 🚨 Quick Fixes (Try First)

Most issues can be resolved with these simple steps:

### 1. Refresh YouTube Page
```bash
# Press Ctrl+F5 (or Cmd+Shift+R on Mac) to hard refresh
```
This fixes 90% of all issues by clearing cached content and reloading the extension.

### 2. Restart Extension
1. Click the extension icon in your browser toolbar
2. Close the popup completely
3. Click the extension icon again to reopen

### 3. Check Browser Compatibility
- **Chrome**: Works on `youtube.com` (not `youtube.tv` or mobile)
- **Firefox**: Works on `youtube.com` (not mobile or TV)
- Ensure you're on the main YouTube website, not embedded players

## 🐛 Common Issues & Solutions

### Installation Problems

#### Extension Icon Not Visible
**Symptoms**: Extension icon missing from browser toolbar

**Solutions**:
1. **Check if installed**: Go to `chrome://extensions/` (Chrome) or `about:addons` (Firefox)
2. **Enable extension**: Click the toggle to enable YT re:Watch
3. **Pin to toolbar**: Click the puzzle piece icon and pin YT re:Watch
4. **Restart browser**: Complete browser restart often fixes visibility issues

#### Extension Not Loading on YouTube
**Symptoms**: No overlays or progress bars on YouTube pages

**Solutions**:
1. **Refresh YouTube page** (try multiple times)
2. **Check permissions**: Extension needs access to `youtube.com`
3. **Clear browser cache**: Old cached content can interfere
4. **Disable other extensions**: Conflicts with other YouTube extensions

### Video Tracking Issues

#### Videos Not Being Tracked
**Symptoms**: Watched videos don't appear in history

**Solutions**:
1. **Watch for 10+ seconds**: Extension tracks after minimum watch time
2. **Refresh page**: Reload YouTube after watching
3. **Check if on YouTube.com**: Extension only works on main site
4. **Disable ad blockers**: Some ad blockers interfere with video detection
5. **Enable in settings**: Ensure "Track videos" is enabled in extension settings

#### Progress Bars Not Showing
**Symptoms**: No visual indicators on video thumbnails

**Solutions**:
1. **Refresh YouTube page** after watching videos
2. **Check overlay settings**: Ensure overlays are enabled in settings
3. **Wait for sync**: Progress bars appear after video is saved to history
4. **Clear browser data**: Old cached thumbnails can cause display issues

### History Display Problems

#### History Tab Empty or Missing Videos
**Symptoms**: Extension popup shows no history or missing videos

**Solutions**:
1. **Refresh extension popup**: Close and reopen the extension
2. **Check storage quota**: Extension has 5GB+ storage limit
3. **Browser data clearing**: If you cleared browser data, history is lost
4. **Incognito mode**: Extension doesn't work in private browsing
5. **Different browser profile**: Each profile has separate history

#### Videos Disappearing from History
**Symptoms**: Previously tracked videos no longer appear

**Solutions**:
1. **Check deletion**: Videos may have been manually deleted
2. **Storage corruption**: Rare, but can happen with browser crashes
3. **Sync issues (Firefox)**: Check sync settings if using multiple devices
4. **Browser update**: Updates can sometimes affect extension storage

### Sync Problems (Firefox Only)

#### Sync Not Working
**Symptoms**: History not syncing between Firefox devices

**Solutions**:
1. **Enable Firefox Sync**: Go to Firefox Settings > Sync > Enable
2. **Enable extension sync**: In YT re:Watch settings, toggle "Enable Sync"
3. **Check internet connection**: Sync requires stable internet
4. **Wait for sync**: Automatic sync runs every 10 minutes
5. **Manual sync**: Use "Sync Now" button in extension settings

#### Sync Errors
**Symptoms**: Red indicator in extension popup, sync failures

**Solutions**:
1. **Check network**: Ensure stable internet connection
2. **Restart browser**: Complete restart often fixes sync issues
3. **Re-enable sync**: Turn off and on sync in extension settings
4. **Check Firefox Sync**: Ensure Firefox account sync is working

### Performance Issues

#### Extension Slow or Unresponsive
**Symptoms**: Extension popup slow to open, videos slow to track

**Solutions**:
1. **Clear extension data**: Go to extension settings > Advanced > Reset Data
2. **Browser restart**: Complete restart frees up memory
3. **Check storage usage**: Large history can slow down the extension
4. **Disable unused features**: Turn off features you don't need

#### High Memory Usage
**Symptoms**: Browser using excessive memory

**Solutions**:
1. **Browser restart**: Frees up accumulated memory
2. **Check video count**: Large history increases memory usage
3. **Storage cleanup**: Remove old videos you no longer need
4. **Browser extensions**: Other extensions may also use memory

## 🔍 Debug Mode

Enable debug mode for detailed logging to help troubleshoot complex issues:

### Enable Debug Mode
1. Open YT re:Watch extension popup
2. Go to **Settings** tab
3. Enable **"Debug Mode"**
4. Check browser console for detailed logs

### Debug Information to Include in Bug Reports
When reporting issues, include:
- **Browser and version** (Chrome 120.0, Firefox 119.0)
- **Extension version** (visible in extension popup)
- **Operating system** (Windows 11, macOS 14.0, Ubuntu 22.04)
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Console errors** (if in debug mode)
- **Screenshots** (if visual issues)

## 📞 Getting Help

### Community Support
- **GitHub Issues**: [Report bugs or request help](https://github.com/EdinUser/YouTubeLocalHistory/issues)
- **Telegram Community**: [Chat with other users](https://t.me/+eFftKWGVvSpiZjZk)

### Before Asking for Help
1. **Try the troubleshooting steps above**
2. **Search existing GitHub issues** - someone may have reported the same problem
3. **Check the FAQ** - [Frequently Asked Questions](./faq.md)
4. **Read the detailed guide** - [Complete User Guide](./detailed_guide.md)

### Emergency Fixes
If nothing works:
1. **Reset extension data**: Go to Settings > Advanced > Reset Data (loses all history)
2. **Reinstall extension**: Remove and reinstall YT re:Watch
3. **Check for updates**: Ensure you have the latest version

---

*Most issues are resolved by **refreshing the YouTube page** and **restarting the browser**. Try these steps first before diving into complex troubleshooting.*
