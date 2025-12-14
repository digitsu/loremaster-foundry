# Loremaster Module - Development Notes

## Environment

- **Foundry VTT Version**: 13
- **Module Compatibility**: Minimum V13, Verified V13

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

## Foundry V13 Considerations

- Scene controls use `getSceneControlButtons` hook
- Control groups: tokens, measure, tiles, drawings, walls, lighting, sounds, notes
- Tools require: name, title, icon, button, visible, onClick properties
