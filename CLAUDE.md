# AI Chat Context Window Extension

## Overview
Browser extension that displays real-time token usage for Claude.ai and ChatGPT conversations with visual indicators.

## Build & Test

### Build
```bash
npm install
npm run build
```

### Test with MCP Playwright
1. Load extension at chrome://extensions (Developer mode ON → Load unpacked → select `dist/`)
2. Navigate to Claude.ai or ChatGPT.com
3. Verify token counter appears (top-right corner)
4. Type messages and verify counter updates
5. Switch chats and verify counter resets

### Manual Reload After Changes
1. Run `npm run build`
2. Click "Reload" button in chrome://extensions
3. Refresh the Claude/ChatGPT page

## Key Features
- **Real-time token counting** using js-tiktoken (cl100k_base encoding)
- **Visual indicators**: Green (0-70%), Yellow (70-90%), Red (90-100%), Flashing Red (overflow)
- **Auto-detects plan**: Free/Plus/Pro based on UI elements
- **Model detection**: Automatically identifies current model
- **Smart caching**: Avoids re-tokenizing unchanged messages
- **Memory efficient**: Clears old cache entries automatically

## Technical Details
- TypeScript + Manifest V3
- Content scripts for claude.ai and chatgpt.com
- MutationObserver for real-time DOM tracking
