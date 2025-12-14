/**
 * Files Manager
 *
 * Handles Claude Files API operations for persistent context files.
 * Manages uploading, caching, and referencing game data files.
 * Integrates with FileRegistry for deduplication and tracking.
 */

import { config } from '../config/default.js';
import { FileRegistry } from '../storage/file-registry.js';

/**
 * FilesManager class handles Claude Files API operations.
 */
export class FilesManager {
  /**
   * Create a new FilesManager instance.
   *
   * @param {Database} db - SQLite database instance for file registry.
   */
  constructor(db) {
    this.filesEndpoint = config.claude.filesEndpoint;
    this.apiVersion = config.claude.apiVersion;
    this.filesBeta = config.claude.filesApiBeta;
    this.registry = new FileRegistry(db);

    console.log('[FilesManager] Initialized');
  }

  /**
   * Upload a file to Claude Files API.
   *
   * @param {string} apiKey - User's Claude API key.
   * @param {string} filename - Name for the file.
   * @param {string|Buffer} content - File content.
   * @param {string} mimeType - MIME type (default: text/plain).
   * @returns {Promise<Object>} Upload result with file_id.
   */
  async uploadFile(apiKey, filename, content, mimeType = 'text/plain') {
    if (!apiKey) {
      throw new Error('API key required for file upload');
    }

    const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

    // Create multipart form data
    const boundary = `----FormBoundary${Date.now()}`;
    const formData = this._buildMultipartForm(boundary, filename, contentBuffer, mimeType);

    try {
      console.log(`[FilesManager] Uploading file: ${filename} (${contentBuffer.length} bytes)`);

      const response = await fetch(this.filesEndpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': this.apiVersion,
          'anthropic-beta': this.filesBeta,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        console.error(`[FilesManager] Upload failed: ${errorMessage}`);
        throw new Error(`Files API error: ${errorMessage}`);
      }

      const data = await response.json();
      console.log(`[FilesManager] Upload successful: ${data.id}`);

      return {
        fileId: data.id,
        filename: data.filename,
        size: data.size_bytes,
        mimeType: data.mime_type,
        createdAt: data.created_at
      };

    } catch (error) {
      console.error('[FilesManager] Upload failed:', error.message);
      throw error;
    }
  }

  /**
   * Upload and register a file, checking for duplicates.
   *
   * @param {string} apiKey - User's Claude API key.
   * @param {string} worldId - World identifier.
   * @param {string} fileType - Type of file (rules, compendium, world_state, pdf).
   * @param {string} filename - Name for the file.
   * @param {string|Buffer} content - File content.
   * @param {string} mimeType - MIME type.
   * @returns {Promise<Object>} Result with file_id and whether it was cached.
   */
  async uploadAndRegister(apiKey, worldId, fileType, filename, content, mimeType = 'text/plain') {
    // Calculate content hash for deduplication
    const contentHash = FileRegistry.hashContent(content);

    // Check if we already have this exact content
    const existing = this.registry.getByHash(worldId, fileType, contentHash);
    if (existing) {
      console.log(`[FilesManager] Using cached file: ${existing.claude_file_id}`);
      return {
        fileId: existing.claude_file_id,
        filename: existing.filename,
        cached: true
      };
    }

    // Upload to Claude
    const uploadResult = await this.uploadFile(apiKey, filename, content, mimeType);

    // Register in database
    this.registry.register(worldId, fileType, contentHash, uploadResult.fileId, filename);

    return {
      fileId: uploadResult.fileId,
      filename: filename,
      cached: false,
      size: uploadResult.size
    };
  }

  /**
   * Get all Claude file_ids for a world.
   *
   * @param {string} worldId - World identifier.
   * @returns {Array<string>} Array of Claude file_ids.
   */
  getFileIdsForWorld(worldId) {
    return this.registry.getFileIds(worldId);
  }

  /**
   * Get file registry entries for a world.
   *
   * @param {string} worldId - World identifier.
   * @returns {Array<Object>} Array of registry entries.
   */
  getFilesForWorld(worldId) {
    return this.registry.getFilesForWorld(worldId);
  }

  /**
   * Delete a file from Claude Files API and registry.
   *
   * @param {string} apiKey - User's Claude API key.
   * @param {string} worldId - World identifier.
   * @param {string} fileId - Claude file_id to delete.
   * @returns {Promise<boolean>} Success status.
   */
  async deleteFile(apiKey, worldId, fileId) {
    if (!apiKey) {
      throw new Error('API key required for file deletion');
    }

    try {
      console.log(`[FilesManager] Deleting file: ${fileId}`);

      const response = await fetch(`${this.filesEndpoint}/${fileId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': this.apiVersion,
          'anthropic-beta': this.filesBeta
        }
      });

      if (!response.ok && response.status !== 404) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        throw new Error(`Delete failed: ${errorMessage}`);
      }

      // Remove from registry
      this.registry.delete(worldId, fileId);

      console.log(`[FilesManager] File deleted: ${fileId}`);
      return true;

    } catch (error) {
      console.error('[FilesManager] Delete failed:', error.message);
      throw error;
    }
  }

  /**
   * Delete all files for a world.
   *
   * @param {string} apiKey - User's Claude API key.
   * @param {string} worldId - World identifier.
   * @returns {Promise<number>} Number of files deleted.
   */
  async deleteAllForWorld(apiKey, worldId) {
    const files = this.getFilesForWorld(worldId);
    let deleted = 0;

    for (const file of files) {
      try {
        await this.deleteFile(apiKey, worldId, file.claude_file_id);
        deleted++;
      } catch (error) {
        console.error(`[FilesManager] Failed to delete ${file.claude_file_id}:`, error.message);
      }
    }

    return deleted;
  }

  /**
   * Get file information from Claude API.
   *
   * @param {string} apiKey - User's Claude API key.
   * @param {string} fileId - Claude file_id.
   * @returns {Promise<Object>} File information.
   */
  async getFileInfo(apiKey, fileId) {
    if (!apiKey) {
      throw new Error('API key required');
    }

    try {
      const response = await fetch(`${this.filesEndpoint}/${fileId}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': this.apiVersion,
          'anthropic-beta': this.filesBeta
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      console.error('[FilesManager] Get file info failed:', error.message);
      throw error;
    }
  }

  /**
   * Build multipart form data for file upload.
   *
   * @param {string} boundary - Form boundary string.
   * @param {string} filename - Filename.
   * @param {Buffer} content - File content.
   * @param {string} mimeType - MIME type.
   * @returns {Buffer} Multipart form data.
   * @private
   */
  _buildMultipartForm(boundary, filename, content, mimeType) {
    const CRLF = '\r\n';
    const parts = [];

    // File part
    parts.push(`--${boundary}${CRLF}`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`);
    parts.push(`Content-Type: ${mimeType}${CRLF}`);
    parts.push(CRLF);

    // Convert parts to buffer
    const header = Buffer.from(parts.join(''));
    const footer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

    return Buffer.concat([header, content, footer]);
  }
}
