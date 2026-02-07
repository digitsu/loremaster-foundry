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
- **Hosted Mode**: Patreon subscription (no additional setup)
- **Self-Hosted Mode**: Loremaster Proxy Server + Claude API key

## Choose Your Setup

### Option 1: Hosted Mode (Recommended)
Let us handle the server infrastructure. Just subscribe and play.

**[Subscribe on Patreon](https://patreon.com/loremastervtt)** - Monthly subscription

| Tier | Monthly Tokens | Best For |
|------|---------------|----------|
| **Basic** | 500,000 | Casual games, 1-2 sessions/month |
| **Pro** | 2,000,000 | Regular campaigns, weekly sessions |
| **Premium** | 5,000,000 | Professional GMs, multiple weekly sessions |

### Option 2: Self-Hosted (One-Time Purchase)
Run your own Loremaster server with full control.

**[Purchase & Download on Gumroad](https://burninator.gumroad.com/l/glzbu)** - $25 one-time

- You host the server on your own machine or VPS
- You pay Anthropic directly for Claude API usage
- Full control over your data and infrastructure

## Installation

### The Forge Users
1. Go to your Forge game configuration
2. Click "Install Module" and search for "Loremaster"
3. Install and enable the module in your world

### Self-Hosted Foundry
**Method 1: Manual Installation**
1. Download the latest release
2. Extract to `Data/modules/loremaster` in your Foundry user data folder
3. Restart Foundry VTT
4. Enable the module in your world

**Method 2: Manifest URL**
1. In Foundry, go to Add-on Modules
2. Click "Install Module"
3. Paste the manifest URL in the bottom field
4. Click Install

## Configuration

### Hosted Mode Setup (Patreon)

1. **Subscribe** to [Loremaster on Patreon](https://patreon.com/loremastervtt)
2. **Enable the module** in your Foundry world
3. **Open Module Settings** (Settings > Module Settings > Loremaster)
4. **Set Server Mode** to "Hosted (Patreon)"
5. **Enable Loremaster** and save settings
   - *Note*: Proxy URL, Claude API Key, and License Key are auto-configured and disabled in hosted mode. These fields are only used for self-hosted setups.
6. **Connect with Patreon**: A popup will appear asking you to authenticate
7. **Authorize**: Log in to Patreon and grant Loremaster access
8. **Done!** The module will automatically connect using your subscription

Your session stays connected until you log out. Quota resets monthly on your billing date.

### Self-Hosted Setup

1. **Download and run** the proxy server from [Gumroad](https://burninator.gumroad.com/l/glzbu) (setup instructions included)
2. **Enable the module** in your Foundry world
3. **Open Module Settings** (Settings > Module Settings > Loremaster)
4. **Set Server Mode** to "Self-Hosted"
5. **Enter your Proxy URL** (e.g., `http://localhost:3001`)
6. **Enter your Claude API Key** from [Anthropic](https://console.anthropic.com/)
7. **Enter your License Key** (provided with Gumroad purchase)
8. **Enable Loremaster** and save settings

### Module Settings Reference

| Setting | Description |
|---------|-------------|
| **Enable Loremaster** | Turn the module on/off |
| **Server Mode** | Hosted (Patreon) or Self-Hosted |
| **Proxy URL** | Server URL — auto-configured and locked in hosted mode; user-configurable in self-hosted mode |
| **Claude API Key** | Your Anthropic API key — self-hosted only (disabled in hosted mode) |
| **License Key** | Your Gumroad license — self-hosted only (disabled in hosted mode) |
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

Loremaster has its own top-level control group in the left toolbar, identified by a **wizard hat** icon (🧙 `fa-hat-wizard`). Click it to reveal the Loremaster tools:

| Icon | Feature |
|------|---------|
| 🧠 Brain | Content Manager - PDFs, Adventures, Cast |
| 💬 Comments | Conversation Manager |
| ⚖️ Gavel | House Rules Journal |
| 📊 Chart | API Usage Monitor |
| 📖 Book | Loremaster Guide |
| 👤 User *(hosted mode only)* | Loremaster Account |

## Support

- **Discord**: [discord.gg/loremaster](https://discord.gg/loremaster)
- **Website**: [loremastervtt.com](https://loremastervtt.com)
- **Issues**: [GitHub Issues](https://github.com/digitsu/loremaster-foundry/issues)
- **Email**: support@loremastervtt.com

## License

Copyright (c) 2025 Jerry Chan. All Rights Reserved. See [LICENSE.md](LICENSE.md) for details.
