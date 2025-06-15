# YouTube Local History

Store your YouTube video history locally, without sending it to Google. This project provides multiple ways to track your YouTube history:

1. Browser Extensions (Firefox & Chrome)
2. TamperMonkey/GreaseMonkey Script

## Features

- Store video history locally using IndexedDB
- View your complete watch history
- Export/Import history data
- Video progress indicators on thumbnails
- Customizable settings:
  - Auto-clean period (1-180 days)
  - Pagination count (1-20 items)
  - Overlay label text and color
- Works with PocketTube and other YouTube extensions

## Installation Options

### Browser Extensions

#### Firefox
1. Visit [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/local-youtube-video-history/)
2. Click "Add to Firefox"

#### Chrome
1. Download the latest release from the [Releases](https://github.com/EdinUser/YouTubeLocalHistory/releases) page
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `chrome_extension` folder

### TamperMonkey Script

1. Install [TamperMonkey](https://www.tampermonkey.net/) for your browser
2. Visit [the script page](https://github.com/EdinUser/YouTubeLocalHistory/raw/main/youtube-local-history.user.js)
3. Click "Install"

## Usage

1. First, turn off YouTube History:
   - Go to your Google profile
   - Select "Data & Privacy"
   - Scroll down to "YouTube History"
   - Click "Pause"

2. Install your preferred version (Browser Extension or TamperMonkey script)

3. Browse YouTube as usual - your history will be stored locally

4. Access your history:
   - Browser Extensions: Click the extension icon in your toolbar
   - TamperMonkey: Click the TamperMonkey icon and select "YouTube Local History"

## Settings

### Browser Extensions
- Click the extension icon
- Go to the "Settings" tab
- Customize:
  - Auto-clean period (days)
  - Items per page
  - Overlay label text
  - Overlay color

## Development

### Building Extensions

1. Clone the repository:
```bash
git clone https://github.com/EdinUser/YouTubeLocalHistory.git
cd YouTubeLocalHistory
```

2. Build the extensions:
```bash
./package.sh
```

The built extensions will be in the `dist` directory.

## Support

- Report issues on [GitHub Issues](https://github.com/EdinUser/YouTubeLocalHistory/issues)
- Star the repository if you find it useful!

## License

MIT License - see [LICENSE](LICENSE) file for details 