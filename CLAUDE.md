# Loremaster Module - Development Notes

## Environment

- **Foundry VTT Version**: 13
- **Module Compatibility**: Minimum V13, Verified V13

## Code Locations

- **Foundry Module (Client)**: `/Users/jerrychan/foundrydata/Data/modules/loremaster/`
- **Proxy Server**: `~/work/loremaster-proxy/` (separate repository)

## Git Commit Guidelines

- Claude-related files and directories (`.claude/`, `CLAUDE.md`, etc.) may be committed to the repository
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
- `content-manager.mjs` - PDF upload, adventure management, Cast tab UI
- `conversation-manager.mjs` - Conversation history management UI with export
- `cast-selection-dialog.mjs` - Character assignment dialog for adventure activation
- `gm-prep-journal.mjs` - Debounced sync of GM Prep journal edits to server
- `usage-monitor.mjs` - API usage tracking and cost estimation UI
- `welcome-journal.mjs` - First-run documentation journal

### Server-Side (Proxy Server)

- `socket-handler.js` - WebSocket event handlers
- `conversation-store.js` - SQLite database for conversations and canon
- `claude-client.js` - Claude API integration
- `pdf-processor.js` - PDF text extraction

## Features

### Core Features
- **Chat Integration**: `@lm` prefix for public messages, `@lm!` for private GM chat
- **Message Batching**: Collects multiple player actions before sending to AI
- **Canon System**: Published responses become official campaign history
- **PDF Support**: Upload adventure PDFs for AI context
- **Tool Use**: Claude can roll dice, query actors, etc.

### GM Prep System
- **GM Prep Script Generation**: AI generates comprehensive adventure scripts from uploaded PDFs
- **Character Extraction**: Parses GM Prep scripts to extract NPCs and playable characters
- **Journal Sync**: GM Prep journals auto-sync back to server with 30-second debounce
- **Sync Indicators**: Visual feedback in journal header showing sync status (pending, syncing, synced, error)

### Cast Management
- **Cast Selection Dialog**: Shown when activating an adventure with a GM Prep script
- **Character Assignments**: Assign players to playable characters via dropdown
- **Loremaster Control**: Mark NPCs for AI roleplay with checkboxes
- **Cast Tab**: Persistent character management in Content Manager
- **Role Detection**: Characters categorized as PC, major NPC, minor NPC, antagonist

### Conversation Management
- **Conversation History**: View, switch, rename, and delete conversations
- **Compaction & Archive**: Summarize long conversations and archive them
- **Continue from Summary**: Start new conversations with inherited context
- **Export to Journal**: Export conversation history to Foundry journal with player/AI styling

### API Usage Monitoring
- **Usage Monitor**: Track API token usage (input, output, cache reads/writes)
- **Session Stats**: View current session usage
- **All-Time Stats**: Track cumulative usage across all sessions
- **Cost Estimation**: Approximate API cost calculation

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

## Current Status

- **Version**: 0.1.6 (released), main branch includes P2 polish (PR #2 merged)
- **P2 Polish Complete**: i18n (92 keys across 4 groups), connection status bar component
- **Status Bar**: `scripts/status-bar.mjs` — persistent pill showing connection state, tier, quota. 6 states with auto-collapse.
- **i18n Coverage**: SharedContent, PatreonLogin, Connection, SettingsPanel groups in `lang/en.json`

## Recent Changes

- PR #2 merged: P2 Polish (i18n + status bar) — 940 lines across 11 files
- PR #1 merged: Shared Content Library UI (v0.1.5)
- v0.1.6: Auto-reconnect with auth recovery for hosted mode
- Custom settings UI with inline account panel and section headers
