/**
 * PDF Registry
 *
 * Manages PDF document records in the database.
 * Handles CRUD operations for uploaded PDF adventures.
 */

import crypto from 'crypto';
import { getCategoryPriority } from '../services/pdf-processor.js';

/**
 * PDFRegistry class provides database operations for PDF documents.
 */
export class PDFRegistry {
  /**
   * Create a new PDFRegistry instance.
   *
   * @param {Database} db - The better-sqlite3 database instance.
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new PDF document record.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {string} filename - Original filename.
   * @param {number} originalSize - File size in bytes.
   * @param {string} category - Category: 'adventure', 'supplement', 'reference'.
   * @param {string} displayName - Optional user-provided display name.
   * @param {Buffer} contentBuffer - PDF content for hash calculation.
   * @returns {Object} The created PDF record.
   */
  createPDF(worldId, filename, originalSize, category, displayName, contentBuffer) {
    const contentHash = this._calculateHash(contentBuffer);
    const priority = getCategoryPriority(category);

    // Check for duplicate
    const existing = this.db.prepare(`
      SELECT id FROM pdf_documents
      WHERE world_id = ? AND content_hash = ?
    `).get(worldId, contentHash);

    if (existing) {
      throw new Error(`Duplicate PDF: This file has already been uploaded (ID: ${existing.id})`);
    }

    const result = this.db.prepare(`
      INSERT INTO pdf_documents
        (world_id, filename, original_size, category, priority, display_name, content_hash, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(worldId, filename, originalSize, category, priority, displayName || filename, contentHash);

    console.log(`[PDFRegistry] Created PDF record ${result.lastInsertRowid} for ${filename} (priority: ${priority})`);

    return {
      id: result.lastInsertRowid,
      worldId,
      filename,
      originalSize,
      category,
      priority,
      displayName: displayName || filename,
      contentHash,
      processingStatus: 'pending'
    };
  }

  /**
   * Get a PDF document by ID.
   *
   * @param {number} pdfId - The PDF document ID.
   * @returns {Object|null} The PDF record or null.
   */
  getPDF(pdfId) {
    return this.db.prepare(`
      SELECT * FROM pdf_documents WHERE id = ?
    `).get(pdfId);
  }

  /**
   * Get all PDF documents for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array} Array of PDF records.
   */
  getPDFsForWorld(worldId) {
    return this.db.prepare(`
      SELECT * FROM pdf_documents
      WHERE world_id = ?
      ORDER BY uploaded_at DESC
    `).all(worldId);
  }

  /**
   * Get PDFs by category for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {string} category - The category to filter by.
   * @returns {Array} Array of PDF records.
   */
  getPDFsByCategory(worldId, category) {
    return this.db.prepare(`
      SELECT * FROM pdf_documents
      WHERE world_id = ? AND category = ?
      ORDER BY uploaded_at DESC
    `).all(worldId, category);
  }

  /**
   * Get all completed PDFs for a world (for context building).
   * Ordered by priority (highest first) then upload date.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array} Array of completed PDF records with claude_file_id.
   */
  getCompletedPDFsForWorld(worldId) {
    return this.db.prepare(`
      SELECT * FROM pdf_documents
      WHERE world_id = ? AND processing_status = 'completed' AND claude_file_id IS NOT NULL
      ORDER BY priority DESC, uploaded_at DESC
    `).all(worldId);
  }

  /**
   * Update PDF processing status.
   *
   * @param {number} pdfId - The PDF document ID.
   * @param {string} status - New status: 'pending', 'processing', 'completed', 'failed'.
   * @param {Object} options - Optional updates.
   * @param {string} options.errorMessage - Error message if failed.
   * @param {number} options.extractedTextLength - Length of extracted text.
   * @param {string} options.claudeFileId - Claude Files API file_id.
   */
  updateStatus(pdfId, status, options = {}) {
    const updates = ['processing_status = ?'];
    const params = [status];

    if (status === 'completed') {
      updates.push('processed_at = CURRENT_TIMESTAMP');
    }

    if (options.errorMessage !== undefined) {
      updates.push('error_message = ?');
      params.push(options.errorMessage);
    }

    if (options.extractedTextLength !== undefined) {
      updates.push('extracted_text_length = ?');
      params.push(options.extractedTextLength);
    }

    if (options.claudeFileId !== undefined) {
      updates.push('claude_file_id = ?');
      params.push(options.claudeFileId);
    }

    params.push(pdfId);

    this.db.prepare(`
      UPDATE pdf_documents
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    console.log(`[PDFRegistry] Updated PDF ${pdfId} status to ${status}`);
  }

  /**
   * Delete a PDF document.
   *
   * @param {number} pdfId - The PDF document ID.
   * @returns {Object|null} The deleted record (for cleanup) or null.
   */
  deletePDF(pdfId) {
    const pdf = this.getPDF(pdfId);
    if (!pdf) return null;

    this.db.prepare(`
      DELETE FROM pdf_documents WHERE id = ?
    `).run(pdfId);

    console.log(`[PDFRegistry] Deleted PDF ${pdfId}`);
    return pdf;
  }

  /**
   * Delete all PDFs for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array} Array of deleted records (for cleanup).
   */
  deleteAllPDFsForWorld(worldId) {
    const pdfs = this.getPDFsForWorld(worldId);

    this.db.prepare(`
      DELETE FROM pdf_documents WHERE world_id = ?
    `).run(worldId);

    console.log(`[PDFRegistry] Deleted ${pdfs.length} PDFs for world ${worldId}`);
    return pdfs;
  }

  /**
   * Get PDF file IDs for Claude context (only completed uploads).
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array<string>} Array of Claude file_ids.
   */
  getFileIdsForWorld(worldId) {
    const pdfs = this.getCompletedPDFsForWorld(worldId);
    return pdfs
      .filter(pdf => pdf.claude_file_id)
      .map(pdf => pdf.claude_file_id);
  }

  /**
   * Calculate SHA-256 hash of content for deduplication.
   *
   * @param {Buffer} content - The content to hash.
   * @returns {string} Hex-encoded hash.
   * @private
   */
  _calculateHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get statistics for a world's PDFs.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Object} Statistics object.
   */
  getStats(worldId) {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN processing_status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN processing_status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN processing_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(original_size) as totalSize,
        SUM(extracted_text_length) as totalTextLength
      FROM pdf_documents
      WHERE world_id = ?
    `).get(worldId);

    return {
      total: stats.total || 0,
      completed: stats.completed || 0,
      failed: stats.failed || 0,
      processing: stats.processing || 0,
      pending: stats.pending || 0,
      totalSize: stats.totalSize || 0,
      totalTextLength: stats.totalTextLength || 0
    };
  }
}
