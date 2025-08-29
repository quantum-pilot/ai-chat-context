# 💬 AI Chat Context Window

Browser extension that displays real-time token usage for Claude.ai and ChatGPT conversations.

## Features

- Automatic model detection
- Real-time token counting using [tiktoken](https://github.com/openai/tiktoken)
- Visual indicators: Green (0-70%), Yellow (70-90%), Red (90-100%)
- Supports individual plans from Claude (Free/Pro/Max) and ChatGPT (Free/Plus/Pro)

## Installation

### Chrome
1. Download latest release or build from source
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" → select `dist/` folder

### Firefox
1. Download latest release or build from source
2. Open `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on"
4. Select any file in `dist/` folder

## Build from Source

```bash
npm install
npm run build
```

Extension files will be in `dist/`.
