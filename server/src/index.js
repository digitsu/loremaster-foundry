/**
 * Loremaster Proxy Server
 *
 * Main entry point for the proxy server that handles:
 * - WebSocket connections from Foundry VTT clients
 * - Claude API communication
 * - Conversation persistence
 * - Game data management
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/default.js';
import { SocketHandler } from './websocket/socket-handler.js';
import { ConversationStore } from './storage/conversation-store.js';
import { CredentialsStore } from './storage/credentials-store.js';
import { HouseRulesStore } from './storage/house-rules-store.js';
import { GMPrepStore } from './storage/gm-prep-store.js';
import { ClaudeClient } from './api/claude-client.js';
import { FilesManager } from './api/files-manager.js';
import { PDFRegistry } from './storage/pdf-registry.js';
import { PDFProcessor } from './services/pdf-processor.js';
import { ToolExecutor } from './tools/tool-executor.js';

// Initialize Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Initialize storage
const conversationStore = new ConversationStore(config.storage.dbPath);

// Initialize credentials store (uses same database connection)
const credentialsStore = new CredentialsStore(conversationStore.db);

// Warn if encryption key is not set
if (!config.security.encryptionKey) {
  console.warn('[Loremaster] WARNING: ENCRYPTION_KEY not set. API keys will not be encrypted securely.');
  console.warn('[Loremaster] Set ENCRYPTION_KEY environment variable for production use.');
}

// Initialize Claude client
const claudeClient = new ClaudeClient();

// Initialize files manager (uses same database connection)
const filesManager = new FilesManager(conversationStore.db);

// Initialize PDF components
const pdfRegistry = new PDFRegistry(conversationStore.db);
const pdfProcessor = new PDFProcessor(pdfRegistry, filesManager);

// Initialize house rules store (uses same database connection)
const houseRulesStore = new HouseRulesStore(conversationStore.db);

// Initialize GM Prep store (uses same database connection)
const gmPrepStore = new GMPrepStore(conversationStore.db);

// Initialize socket handler with all services
const socketHandler = new SocketHandler(
  wss,
  claudeClient,
  conversationStore,
  credentialsStore,
  filesManager,
  pdfProcessor,
  houseRulesStore,
  gmPrepStore
);

// Initialize tool executor (requires socketHandler for client communication)
const toolExecutor = new ToolExecutor(socketHandler);
socketHandler.setToolExecutor(toolExecutor);

// Start server
server.listen(config.server.port, config.server.host, () => {
  console.log(`[Loremaster] Server running at http://${config.server.host}:${config.server.port}`);
  console.log(`[Loremaster] WebSocket server ready for connections`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Loremaster] Shutting down...');
  conversationStore.close();
  wss.close();
  server.close(() => {
    console.log('[Loremaster] Server closed');
    process.exit(0);
  });
});

export { app, server, wss };
