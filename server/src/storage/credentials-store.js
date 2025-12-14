/**
 * Credentials Store
 *
 * Securely stores and retrieves encrypted API keys for each world.
 * Uses AES-256-GCM encryption for API key protection.
 */

import { encrypt, decrypt } from '../middleware/encryption.js';
import { config } from '../config/default.js';

export class CredentialsStore {
  /**
   * Create a new CredentialsStore instance.
   *
   * @param {Database} db - The SQLite database instance.
   */
  constructor(db) {
    this.db = db;
    this.hasEncryption = !!config.security.encryptionKey;

    if (this.hasEncryption) {
      console.log('[CredentialsStore] Initialized with encryption enabled');
    } else {
      console.warn('[CredentialsStore] WARNING: Encryption key not set, API keys stored in plaintext');
    }
  }

  /**
   * Store an API key for a world.
   *
   * @param {string} worldId - The world identifier.
   * @param {string} apiKey - The API key to store.
   * @returns {boolean} Success status.
   */
  storeApiKey(worldId, apiKey) {
    try {
      let encrypted, iv, authTag;

      if (this.hasEncryption) {
        // Encrypt the API key
        const result = encrypt(apiKey);
        encrypted = result.encrypted;
        iv = result.iv;
        authTag = result.authTag;
      } else {
        // Store in plaintext (development only)
        encrypted = Buffer.from(apiKey).toString('base64');
        iv = 'plaintext';
        authTag = 'none';
      }

      // Upsert into database
      this.db.prepare(`
        INSERT INTO world_credentials (world_id, api_key_encrypted, api_key_iv, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(world_id) DO UPDATE SET
          api_key_encrypted = excluded.api_key_encrypted,
          api_key_iv = excluded.api_key_iv,
          updated_at = CURRENT_TIMESTAMP
      `).run(worldId, `${encrypted}:${authTag}`, iv);

      console.log(`[CredentialsStore] API key stored for world: ${worldId}`);
      return true;

    } catch (error) {
      console.error('[CredentialsStore] Failed to store API key:', error.message);
      return false;
    }
  }

  /**
   * Retrieve an API key for a world.
   *
   * @param {string} worldId - The world identifier.
   * @returns {string|null} The API key or null if not found.
   */
  getApiKey(worldId) {
    try {
      const row = this.db.prepare(`
        SELECT api_key_encrypted, api_key_iv
        FROM world_credentials
        WHERE world_id = ?
      `).get(worldId);

      if (!row) {
        return null;
      }

      const [encrypted, authTag] = row.api_key_encrypted.split(':');
      const iv = row.api_key_iv;

      if (iv === 'plaintext') {
        // Decode plaintext (development only)
        return Buffer.from(encrypted, 'base64').toString('utf8');
      }

      // Decrypt the API key
      return decrypt(encrypted, iv, authTag);

    } catch (error) {
      console.error('[CredentialsStore] Failed to retrieve API key:', error.message);
      return null;
    }
  }

  /**
   * Delete an API key for a world.
   *
   * @param {string} worldId - The world identifier.
   * @returns {boolean} Success status.
   */
  deleteApiKey(worldId) {
    try {
      const result = this.db.prepare(`
        DELETE FROM world_credentials
        WHERE world_id = ?
      `).run(worldId);

      if (result.changes > 0) {
        console.log(`[CredentialsStore] API key deleted for world: ${worldId}`);
        return true;
      }
      return false;

    } catch (error) {
      console.error('[CredentialsStore] Failed to delete API key:', error.message);
      return false;
    }
  }

  /**
   * Check if a world has a stored API key.
   *
   * @param {string} worldId - The world identifier.
   * @returns {boolean} True if key exists.
   */
  hasApiKey(worldId) {
    const row = this.db.prepare(`
      SELECT 1 FROM world_credentials WHERE world_id = ?
    `).get(worldId);

    return !!row;
  }

  /**
   * List all worlds with stored API keys.
   *
   * @returns {Array<string>} Array of world IDs.
   */
  listWorlds() {
    const rows = this.db.prepare(`
      SELECT world_id FROM world_credentials
    `).all();

    return rows.map(r => r.world_id);
  }
}
