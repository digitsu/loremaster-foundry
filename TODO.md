# AI GM Integration - TODO

## Overview
Plan and implement AI-powered Game Master augmentation for Coriolis, allowing players to interact with an AI GM through the Foundry VTT chat system.

---

## High-Level Topics

### 1. Module Architecture
- [ ] Design as a standalone custom Foundry module (separate from yzecoriolis system)
- [ ] Define module manifest structure and dependencies
- [ ] Determine compatibility layer with yzecoriolis system
- [ ] Plan for system-agnostic design (potential reuse with other game systems)

### 2. Game System Interface
- [ ] Research Foundry API hooks for chat messages, actors, items, scenes
- [ ] Define interface points between AI GM module and yzecoriolis system
- [ ] Determine read-only vs read-write access patterns
- [ ] Plan event listeners for game state changes (combat, rolls, etc.)

### 3. Game State Management
- [ ] Identify what game state the AI needs access to:
  - Active scene and tokens
  - Actor stats and inventory
  - Combat tracker state
  - Journal entries and lore
  - Recent chat/roll history
- [ ] Design state serialization format for AI context
- [ ] Plan state snapshot vs streaming updates
- [ ] Consider context window limits and state summarization

### 4. Chat Message Pipeline
- [ ] Capture player messages from Foundry chat
- [ ] Filter/identify messages intended for AI GM (prefix? channel? whisper?)
- [ ] Queue and serialize messages from multiple players
- [ ] Handle real-time message ordering and batching
- [ ] Design response rendering back to Foundry chat

### 5. AI API Integration
- [ ] Design API communication layer (Claude API)
- [ ] Structure system prompts with game context
- [ ] Handle streaming responses
- [ ] Manage API rate limits and errors
- [ ] Secure API key storage (server-side vs client-side considerations)

### 6. Future Considerations
- [ ] AI-triggered dice rolls and game actions
- [ ] NPC dialogue and personality persistence
- [ ] Session memory and continuity
- [ ] GM override and AI suggestion modes

---

## Next Session
Start with topic #1 (Module Architecture) - create the basic module skeleton and establish the foundation for the AI GM system.
