# Loremaster Integration - TODO

## Overview

AI-powered Loremaster module for Foundry VTT, allowing players to interact with Claude AI through the chat system. Currently supports Year Zero Engine systems with extensible adapter architecture.

---

## Completed Features

### 1. Module Architecture ✅
- [x] Standalone Foundry VTT v13 module
- [x] Module manifest with proper dependencies
- [x] Proxy server architecture (Node.js backend)
- [x] WebSocket communication layer
- [x] System-agnostic design with adapter pattern

### 2. Game System Interface ✅
- [x] Chat message hooks and handlers
- [x] Actor, item, scene, combat API integration
- [x] Read-only and read-write access patterns
- [x] Tool handler system for AI-triggered actions

### 3. Game State Management ✅
- [x] Active scene and token extraction
- [x] Actor stats and inventory serialization
- [x] Combat tracker state
- [x] Recent chat history
- [x] Context formatting for Claude

### 4. Chat Message Pipeline ✅
- [x] `@lm` prefix for public messages
- [x] `@lm!` prefix for private GM chat
- [x] Multi-player message batching
- [x] GM rulings via `!gm:` prefix
- [x] Veto and regenerate controls

### 5. AI API Integration ✅
- [x] Claude API communication layer
- [x] System prompts with game context
- [x] Tool use (function calling)
- [x] API key storage (server-side)
- [x] Conversation history management

### 6. Content Management ✅
- [x] PDF upload and processing
- [x] Category system (Core Rules, Supplements, Adventures, Reference)
- [x] Claude Files API integration
- [x] Content Manager UI

### 7. Canon System ✅
- [x] Publish AI responses to permanent history
- [x] Private GM chat with iterate/discard workflow
- [x] Canon context injection for AI continuity

### 8. Rules Discrepancy Detection ✅
- [x] Detection prompts for PDF vs Foundry conflicts
- [x] GM ruling workflow (session vs persistent)
- [x] House Rules Journal integration
- [x] Automatic GM presence detection

### 9. AI-Triggered Game Actions ✅
- [x] Year Zero Engine tools (skill checks, attacks, push rolls)
- [x] Cross-system tools (damage, resource modification)
- [x] Tool adapter documentation
- [x] Critical injury table rolling

---

## In Progress

### 10. Game System Adapters
- [x] Year Zero Engine (Coriolis, Forbidden Lands, Alien RPG, etc.)
- [ ] D&D 5e adapter
- [ ] Pathfinder 2e adapter
- [ ] Dynamic tool registration protocol

---

## Publishing & Distribution

### 11. Foundry Package Listing
- [ ] Ensure `module.json` has all required fields (manifest URL, download URL)
- [ ] Create GitHub Release with tagged version and zip file
- [ ] Submit to Foundry Package Database: https://foundryvtt.com/packages/submit
- [ ] Wait for approval and verify listing in Foundry module browser

---

## Future Considerations

### NPC Dialogue System
- [ ] NPC personality persistence
- [ ] Voice/tone configuration per NPC
- [ ] Dialogue history per character

### Session Management
- [ ] Session start/end markers
- [ ] Automatic session summaries
- [ ] Cross-session memory management

### Advanced Tool Features
- [ ] Condition/status effect management
- [ ] Initiative manipulation
- [ ] Token movement
- [ ] Map/scene annotations

### UI Enhancements
- [ ] Dedicated Loremaster chat panel
- [ ] AI response formatting options
- [ ] Tool call visualization
- [ ] Token usage tracking display
- [ ] Grey out License Key and Claude API Key fields when hosted option is selected in module settings

---

## Documentation

| Document | Description |
|----------|-------------|
| `docs/TOOL_ADAPTER_SYSTEM.md` | How to add support for new game systems |
| `docs/RULES_DISCREPANCY_SPEC.md` | Rules discrepancy detection testing spec |
| `CLAUDE.md` | Development notes and environment info |

---

## Architecture Summary

```
┌─────────────────────────────────────┐
│          Foundry VTT v13            │
│  ┌─────────────────────────────┐    │
│  │    Loremaster Module        │    │
│  │  - Chat Handler             │    │
│  │  - Tool Handlers            │    │
│  │  - UI Components            │    │
│  └──────────────┬──────────────┘    │
└─────────────────┼───────────────────┘
                  │ WebSocket
┌─────────────────┼───────────────────┐
│  ┌──────────────┴──────────────┐    │
│  │      Proxy Server           │    │
│  │  - Socket Handler           │    │
│  │  - Claude Client            │    │
│  │  - Storage (SQLite)         │    │
│  │  - PDF Processor            │    │
│  └──────────────┬──────────────┘    │
└─────────────────┼───────────────────┘
                  │ HTTPS
┌─────────────────┼───────────────────┐
│  ┌──────────────┴──────────────┐    │
│  │       Claude API            │    │
│  │  - Messages API             │    │
│  │  - Tool Use                 │    │
│  │  - Files API                │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```
