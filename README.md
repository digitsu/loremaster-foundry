# Loremaster

An AI-powered Game Master assistant for Foundry VTT. Loremaster uses Claude AI to provide dynamic narration, NPC interactions, rules assistance, and more during your tabletop RPG sessions.

## Features

### Core Capabilities
- **Chat Integration** - Use `@lm` prefix to interact with the AI in Foundry chat
- **Private GM Chat** - Use `@lm!` for GM-only responses
- **Multi-Player Batching** - Collects player actions and responds cohesively
- **Canon System** - Published responses become official campaign history
- **Tool Integration** - AI can roll dice, query actors, lookup items, and more

### Content Management
- **PDF Adventures** - Upload adventure PDFs for AI context
- **World Data Sync** - Share actors, items, and journals with Loremaster
- **Active Adventures** - Set the current adventure for focused AI assistance

### GM Prep System
- **Script Generation** - AI generates comprehensive adventure preparation scripts
- **Character Extraction** - Automatically parses NPCs and playable characters
- **Journal Sync** - Edits to GM Prep journals auto-sync back to the server
- **Cast Management** - Assign players to characters, mark NPCs for AI roleplay

### Session Management
- **Conversation History** - View, switch, and manage conversation sessions
- **Compaction & Archive** - Summarize long conversations for continuity
- **Export to Journal** - Save conversation logs as Foundry journals
- **Usage Monitoring** - Track API token usage and costs

## Requirements

- Foundry VTT v13 or later
- Loremaster Proxy Server (see [loremaster-proxy](https://github.com/your-repo/loremaster-proxy))
- Claude API key from Anthropic

## Installation

### Method 1: Manual Installation
1. Download the latest release
2. Extract to `Data/modules/loremaster` in your Foundry user data folder
3. Restart Foundry VTT
4. Enable the module in your world

### Method 2: Manifest URL
1. In Foundry, go to Add-on Modules
2. Click "Install Module"
3. Paste the manifest URL in the bottom field
4. Click Install

## Configuration

### 1. Set Up the Proxy Server
The Loremaster proxy server handles communication with Claude AI. See the [proxy server documentation](https://github.com/your-repo/loremaster-proxy) for setup instructions.

### 2. Configure Module Settings
In Foundry, go to **Settings > Module Settings > Loremaster**:

| Setting | Description |
|---------|-------------|
| **Enable Loremaster** | Turn the module on/off |
| **Proxy URL** | URL of your proxy server (e.g., `http://localhost:3001`) |
| **Claude API Key** | Your Anthropic API key |
| **Chat Trigger Prefix** | Prefix to activate Loremaster (default: `@lm`) |
| **Response Visibility** | Who sees AI responses |
| **Batching Mode** | Timer or Manual message batching |

## Usage

### Basic Chat
```
@lm Describe the tavern we just entered
@lm What does the blacksmith look like?
@lm I search the room for hidden compartments
```

### GM-Only Messages
```
@lm! What's the secret behind the merchant's behavior?
```

### GM Rulings
```
@lm [GM RULING: The guard is actually a spy] Describe the guard's reaction
```

### Manual Batch Control
```
@lm !send    # Send collected messages now
@lm !clear   # Clear pending messages
```

## Scene Controls

Access Loremaster features from the Notes scene controls:

| Icon | Feature |
|------|---------|
| Brain | Content Manager - PDFs, Adventures, Cast |
| Comments | Conversation Manager |
| Gavel | House Rules Journal |
| Chart | API Usage Monitor |
| Book | Loremaster Guide |

## Support

For issues and feature requests, please contact the developer.

## License

Copyright (c) 2025 Jerry Chan. All Rights Reserved. See [LICENSE.md](LICENSE.md) for details.
