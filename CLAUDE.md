# Loremaster Module - Development Notes

## Environment

- **Foundry VTT Version**: 13
- **Module Compatibility**: Minimum V13, Verified V13

## Code Locations

- **Foundry Module (Client)**: `/Users/jerrychan/foundrydata/Data/modules/loremaster/`
- **Proxy Server**: `~/work/loremaster-proxy/` (separate repository)

## Git Commit Guidelines

- Do NOT include any "Co-authored by", "Generated with Claude Code", or "Co-Authored-By" lines in commit messages
- Keep commit messages clean and focused on the changes only

## Architecture

Loremaster is an AI-powered Game Master assistant module that consists of:

1. **Foundry Module** (`/scripts/`) - Client-side code running in the browser
2. **Proxy Server** (`/server/`) - Node.js backend for Claude API communication

## Key Components

### Client-Side (Foundry Module)

- `loremaster.mjs` - Main entry point, hooks, initialization
- `chat-handler.mjs` - Chat message processing, private GM chat, publish/iterate/discard
- `socket-client.mjs` - WebSocket communication with proxy server
- `message-batcher.mjs` - Multi-player message batching
- `content-manager.mjs` - PDF upload and management UI
- `conversation-manager.mjs` - Conversation history management UI
- `welcome-journal.mjs` - First-run documentation journal

### Server-Side (Proxy Server)

- `socket-handler.js` - WebSocket event handlers
- `conversation-store.js` - SQLite database for conversations and canon
- `claude-client.js` - Claude API integration
- `pdf-processor.js` - PDF text extraction

## Features

- **Chat Integration**: `@lm` prefix for public messages, `@lm!` for private GM chat
- **Message Batching**: Collects multiple player actions before sending to AI
- **Canon System**: Published responses become official campaign history
- **PDF Support**: Upload adventure PDFs for AI context
- **Tool Use**: Claude can roll dice, query actors, etc.

## Foundry V12+ API Changes

### Chat Messages

**IMPORTANT**: ChatMessage API changed significantly in Foundry V12+.

**DO NOT USE** (deprecated/broken):
```javascript
// Old pattern - causes errors in V12+
speaker: { alias: 'Loremaster' }
style: CONST.CHAT_MESSAGE_STYLES.OTHER
type: CONST.CHAT_MESSAGE_TYPES.IC
```

**USE INSTEAD**:
```javascript
// Correct V12+ pattern
speaker: ChatMessage.getSpeaker({ alias: 'Loremaster' })
// or with actor
speaker: ChatMessage.getSpeaker({ actor: someActor })

// Omit 'style' and 'type' properties entirely - they cause notification errors
```

Key points:
- Always use `ChatMessage.getSpeaker()` for speaker data
- Remove `style` property completely (causes `element.addEventListener is not a function` error)
- Remove `type` property completely (deprecated in favor of `style`, which itself causes issues)
- `CONST.CHAT_MESSAGE_TYPES` is deprecated, use `CONST.CHAT_MESSAGE_STYLES` (but better to omit entirely)

### Scene Controls

- Scene controls use `getSceneControlButtons` hook
- Control groups: tokens, measure, tiles, drawings, walls, lighting, sounds, notes
- Tools require: name, title, icon, button, visible, onClick properties
