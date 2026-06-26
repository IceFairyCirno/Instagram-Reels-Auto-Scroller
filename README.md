# Instagram Reels Auto-Scroller

A Chrome extension for those who have completely surrendered their attention span to the reels. When your thumb is too physically exhausted from hours of continuous swiping to even lift itself, this tool takes over—seamlessly automating your descent into the doom-scrolling abyss without a single interruption to your brainrot routine. Because why look away from the screen when you can let an automation script feed short-form slop directly into your eyes indefinitely?

## Features

- **Auto-Scroll**: Automatically advances to the next Reel when the current one ends
- **Auto-like**: Automatically likes the reel created by the creators you followed
- **Pause/Resume**: Toggle auto-scroll at any time with the popup or press `P` key
- **Customizable Delay**: Adjust the wait time before scrolling (0.5s - 5s)
- **Visual Indicator**: See the current status directly on Instagram pages
- **Keyboard Shortcut**: Press `P` to pause/resume while browsing

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right corner)
3. Click "Load unpacked"
4. Select the folder containing these files
5. The extension icon will appear in your Chrome toolbar

## Usage

1. Navigate to Instagram (www.instagram.com)
2. Click the extension icon to open the popup
3. Toggle "Enable Extension" to start auto-scrolling
4. Use the "Pause Scroll" button to temporarily stop auto-scroll
5. Press `P` key while on Instagram to quickly toggle pause

## Files

- `manifest.json` - Extension configuration
- `popup.html` / `popup.css` / `popup.js` - Extension popup interface
- `content-script.js` - Main logic for detecting and scrolling reels
- `content-style.css` - Styles for in-page indicators
- `background.js` - Service worker for state management
- `icons/` - Extension icons

## How It Works

1. The content script monitors for video elements on Instagram pages
2. When a video ends, it waits for the configured delay
3. It then simulates pressing the Down arrow key to navigate to the next reel
4. The extension state persists across sessions using Chrome storage

## Requirements

- Google Chrome (version 88 or higher)
- Developer mode enabled for installation

## Privacy

This extension only runs on Instagram pages and does not collect or transmit any personal data.
