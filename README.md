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

### Shared Content Library
- **Browse Shared Adventures** - Explore community-published adventures and rulebooks for your game system
- **One-Click Activation** - Activate shared content to give the AI instant access — no uploading required
- **Tier-Gated Access** - Activation slots scale with your subscription (Basic: 2, Pro: 5, Premium: unlimited)
- **Submit Content** - Share your processed PDFs with other Loremaster users for review and publication
- **RAG Integration** - Activated shared content is seamlessly included in the AI's semantic search context

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

## What's New in v0.6.0

Headline features since v0.5.x — **all of these work in self-hosted**, most automatically:

- **Voice Output v2** — emotional audio tags (whispered, excited, etc.) via ElevenLabs v3
- **Voice Input** — push-to-talk speech-to-text (default hotkey: backtick `` ` ``)
- **Character Stat Sync** — Loremaster reads your characters and proposes changes; GM reviews and approves in a dedicated panel
- **PDF auto-compression** — large adventure PDFs (up to 64 MB) upload cleanly without manual prep
- **OCR fallback for scanned PDFs** — text extracted even from image-only PDFs (proxy needs the OCR-enabled image)
- **Phoenix protocol auto-detect** — no more guessing `ws://` vs `wss://` in your proxy URL
- **Local shared library** *(new in v0.6.0)* — publish a PDF once, activate it in any world you GM. Same UI hosted users have; scoped to your own proxy.
- **Friendlier pre-flight errors** — clearer message if your Claude key isn't set

Full hosted-vs-self-hosted breakdown lives in `docs/SELF_HOSTED_PARITY.md`.

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

1. **Download and run** the proxy server from [Gumroad](https://burninator.gumroad.com/l/glzbu) (setup instructions included). Full env-var reference is in the proxy's `docs/DEPLOY.md`. **Critical**: set `DEPLOYMENT_MODE=self_hosted` — without it the proxy boots in hosted mode and rejects you.
2. **Enable the module** in your Foundry world
3. **Open Module Settings** (Settings > Module Settings > Loremaster)
4. **Set Server Mode** to "Self-Hosted"
5. **Enter your Proxy URL** (e.g., `http://localhost:3001`). The Phoenix protocol is now auto-detected from the URL — no more guessing `ws://` vs `wss://`.
6. **Enter your Claude API Key** from [Anthropic](https://console.anthropic.com/)
7. **Enter your License Key** (provided with Gumroad purchase)
8. **Enable Loremaster** and save settings

**Optional proxy env vars for full feature parity:**

| Env var | Unlocks |
|---|---|
| `VOYAGE_API_KEY` | RAG / semantic PDF search (without it, falls back to text-only) |
| `OPERATOR_ELEVENLABS_API_KEY` *(or per-world setting)* | Voice output (TTS) for all players |
| `ENCRYPTION_KEY` | **Required** — hex-encoded 32 bytes; generate with `openssl rand -hex 32` |

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

- **Discord**: [discord.gg/W2NQ6ekYMd](https://discord.gg/W2NQ6ekYMd)
- **Website**: [loremastervtt.com](https://loremastervtt.com)
- **Issues**: [GitHub Issues](https://github.com/digitsu/loremaster-foundry/issues)
- **Email**: support@loremastervtt.com

## Voice (v0.4 → v0.6)

Loremaster supports a one-way voice mode where Claude's published canon is
read aloud via ElevenLabs, plus push-to-talk speech-to-text in supported
browsers. **v0.5** added emotional **audio tags** (whispered, excited,
etc.) rendered through ElevenLabs' v3 model — Claude can now write
`[whispers] you sure about this?` and it lands in your players' ears as
audio, while the displayed chat content shows the clean text.

### Settings

- **Hear AI voice** (per-user, default off): plays canon audio on publish.
- **ElevenLabs API key** (self-hosted only): your ElevenLabs key. Hosted
  users get the operator-managed key automatically.
- **Voice ID** (per-world): ElevenLabs voice ID. Default `Einstein`
  (`n4gY9MeIbTbAMJ5rlJ51`).
- **Use emote tags** (per-world, default on): when on, ElevenLabs renders
  `[whispers]`, `[excited]`, etc. via the v3 model. Tags are stripped from
  the displayed chat content.
- **Push-to-talk key** (per-user): hotkey to dictate into chat. Default
  backtick (`` ` ``) — chosen to avoid Foundry V13 keybind collisions.
- **Push-to-talk mode** (per-user): "hold" or "toggle". Default hold.

### Browser support

| Browser | TTS playback | STT (push-to-talk) |
|---|---|---|
| Chrome / Edge / Brave | ✅ | ✅ |
| Firefox | ✅ | ❌ (button greyed out) |
| Safari | ✅ | ❌ (button greyed out) |

## License

Copyright (c) 2025 Jerry Chan. All Rights Reserved. See [LICENSE.md](LICENSE.md) for details.
