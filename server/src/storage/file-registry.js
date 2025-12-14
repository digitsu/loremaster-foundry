/**
 * File Registry
 *
 * Tracks uploaded files and their Claude file_ids.
 * Prevents duplicate uploads by comparing content hashes.
 *
 * TODO: Implement in Step 4 - Claude Files API Integration
 */

import { createHash } from 'crypto';

export class FileRegistry {
  /**
   * Create a new FileRegistry instance.
   *
   * @param {Database} db - SQLite database instance.
   */
  constructor(db) {
    this.db = db;
    console.log('[FileRegistry] Initialized');
  }

  /**
   * Register a file in the registry.
   *
   * @param {string} worldId - World identifier.
   * @param {string} fileType - Type of file (rules, compendium, world_state, pdf).
   * @param {string} contentHash - Hash of file content.
   * @param {string} claudeFileId - Claude Files API file_id.
   * @param {string} filename - Original filename.
   * @returns {Object} Registry entry.
   */
  register(worldId, fileType, contentHash, claudeFileId, filename) {
    const result = this.db.prepare(`
      INSERT OR REPLACE INTO file_registry
        (world_id, file_type, content_hash, claude_file_id, filename)
      VALUES (?, ?, ?, ?, ?)
    `).run(worldId, fileType, contentHash, claudeFileId, filename);

    return {
      id: result.lastInsertRowid,
      worldId,
      fileType,
      contentHash,
      claudeFileId,
      filename
    };
  }

  /**
   * Get file by content hash.
   *
   * @param {string} worldId - World identifier.
   * @param {string} fileType - Type of file.
   * @param {string} contentHash - Hash of file content.
   * @returns {Object|null} Registry entry or null.
   */
  getByHash(worldId, fileType, contentHash) {
    return this.db.prepare(`
      SELECT * FROM file_registry
      WHERE world_id = ? AND file_type = ? AND content_hash = ?
    `).get(worldId, fileType, contentHash);
  }

  /**
   * Get all files for a world.
   *
   * @param {string} worldId - World identifier.
   * @returns {Array} Array of registry entries.
   */
  getFilesForWorld(worldId) {
    return this.db.prepare(`
      SELECT * FROM file_registry
      WHERE world_id = ?
      ORDER BY created_at DESC
    `).all(worldId);
  }

  /**
   * Get Claude file_ids for a world.
   *
   * @param {string} worldId - World identifier.
   * @returns {Array<string>} Array of Claude file_ids.
   */
  getFileIds(worldId) {
    const files = this.getFilesForWorld(worldId);
    return files.map(f => f.claude_file_id);
  }

  /**
   * Delete a file from the registry.
   *
   * @param {string} worldId - World identifier.
   * @param {string} claudeFileId - Claude file_id to delete.
   * @returns {boolean} Success status.
   */
  delete(worldId, claudeFileId) {
    const result = this.db.prepare(`
      DELETE FROM file_registry
      WHERE world_id = ? AND claude_file_id = ?
    `).run(worldId, claudeFileId);

    return result.changes > 0;
  }

  /**
   * Calculate content hash for deduplication.
   *
   * @param {string|Buffer} content - Content to hash.
   * @returns {string} SHA-256 hash.
   */
  static hashContent(content) {
    return createHash('sha256').update(content).digest('hex');
  }
}
