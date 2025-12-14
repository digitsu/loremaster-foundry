/**
 * Loremaster Server Configuration
 *
 * Configuration settings for the proxy server.
 * Override with environment variables for production.
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || 'localhost'
  },

  claude: {
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    filesEndpoint: 'https://api.anthropic.com/v1/files',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '2048', 10),
    apiVersion: '2023-06-01',
    filesApiBeta: 'files-api-2025-04-14'
  },

  storage: {
    dbPath: process.env.DB_PATH || join(__dirname, '../../data/loremaster.db'),
    uploadsPath: process.env.UPLOADS_PATH || join(__dirname, '../../data/uploads')
  },

  security: {
    encryptionKey: process.env.ENCRYPTION_KEY || null,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:30000').split(',')
  },

  limits: {
    maxMessageLength: 4000,
    maxHistoryTokens: 50000,
    chatRateLimit: 10,      // per minute
    syncRateLimit: 5        // per 5 minutes
  }
};

// Validate required configuration
if (!config.security.encryptionKey) {
  console.warn('[Loremaster] WARNING: ENCRYPTION_KEY not set. API keys will not be encrypted securely.');
  console.warn('[Loremaster] Set ENCRYPTION_KEY environment variable for production use.');
}
