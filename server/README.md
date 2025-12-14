# Loremaster Server

Proxy server for the Loremaster module. Handles Claude API communication, conversation persistence, and game data management.

## Requirements

- Node.js 18+
- npm or yarn

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment config:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and set your `ENCRYPTION_KEY`:
   ```bash
   # Generate a key:
   openssl rand -hex 32
   ```

4. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `HOST` | localhost | Server host |
| `ENCRYPTION_KEY` | - | 32-byte hex key for API key encryption (required for production) |
| `ALLOWED_ORIGINS` | http://localhost:30000 | Comma-separated allowed CORS origins |
| `DB_PATH` | ./data/loremaster.db | SQLite database path |
| `UPLOADS_PATH` | ./data/uploads | PDF uploads directory |

## API Endpoints

### HTTP

- `GET /health` - Health check

### WebSocket Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | Client → Server | Authenticate with API key and world ID |
| `chat` | Client → Server | Send chat message to AI |
| `sync` | Client → Server | Sync game data |
| `history` | Client → Server | Get conversation history |
| `new-conversation` | Client → Server | Create new conversation |
| `tool-execute` | Server → Client | Request tool execution in Foundry |
| `tool-result` | Client → Server | Return tool execution result |

## Architecture

```
loremaster-server/
├── src/
│   ├── index.js              # Entry point
│   ├── config/
│   │   └── default.js        # Configuration
│   ├── api/
│   │   └── claude-client.js  # Claude API wrapper
│   ├── storage/
│   │   └── conversation-store.js  # SQLite persistence
│   └── websocket/
│       └── socket-handler.js # WebSocket handler
└── data/
    └── loremaster.db         # SQLite database (auto-created)
```

## License

MIT
