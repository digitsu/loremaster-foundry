/**
 * PDF Processor
 *
 * Handles PDF upload, text extraction, and upload to Claude Files API.
 * Allows GMs to use adventure PDFs as context instead of Foundry modules.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import pdfParse from 'pdf-parse';
import { config } from '../config/default.js';

/**
 * PDFProcessor class handles PDF text extraction and processing.
 */
export class PDFProcessor {
  /**
   * Create a new PDFProcessor instance.
   *
   * @param {PDFRegistry} pdfRegistry - The PDF registry for database operations.
   * @param {FilesManager} filesManager - The files manager for Claude API uploads.
   */
  constructor(pdfRegistry, filesManager) {
    this.pdfRegistry = pdfRegistry;
    this.filesManager = filesManager;
    this.uploadsPath = config.storage.uploadsPath;
    this.ensureUploadsDirectory();
    console.log('[PDFProcessor] Initialized');
  }

  /**
   * Ensure uploads directory exists.
   */
  ensureUploadsDirectory() {
    if (!existsSync(this.uploadsPath)) {
      mkdirSync(this.uploadsPath, { recursive: true });
    }
  }

  /**
   * Get world-specific upload directory.
   *
   * @param {string} worldId - The world ID.
   * @returns {string} Path to world's upload directory.
   * @private
   */
  _getWorldUploadsPath(worldId) {
    const worldPath = join(this.uploadsPath, worldId);
    if (!existsSync(worldPath)) {
      mkdirSync(worldPath, { recursive: true });
    }
    return worldPath;
  }

  /**
   * Process an uploaded PDF file.
   *
   * @param {string} apiKey - The user's Claude API key.
   * @param {string} worldId - The world ID.
   * @param {Buffer} pdfBuffer - The PDF file buffer.
   * @param {string} filename - Original filename.
   * @param {string} category - Category: 'adventure', 'supplement', 'reference'.
   * @param {string} displayName - User-provided display name.
   * @param {Function} onProgress - Progress callback: (stage, progress, message) => void.
   * @returns {Promise<Object>} Processing result with PDF record.
   */
  async processPDF(apiKey, worldId, pdfBuffer, filename, category, displayName, onProgress = () => {}) {
    let pdfRecord = null;

    try {
      // Stage 1: Create database record
      onProgress('uploading', 10, 'Creating PDF record...');
      pdfRecord = this.pdfRegistry.createPDF(
        worldId,
        filename,
        pdfBuffer.length,
        category,
        displayName,
        pdfBuffer
      );

      // Update status to processing
      this.pdfRegistry.updateStatus(pdfRecord.id, 'processing');
      onProgress('uploading', 25, 'PDF record created');

      // Stage 2: Extract text from PDF
      onProgress('extracting', 30, 'Extracting text from PDF...');
      const extractedData = await this._extractText(pdfBuffer);
      onProgress('extracting', 50, `Extracted ${extractedData.text.length} characters`);

      // Stage 3: Compress text
      const compressedText = this.compressText(extractedData.text);
      const finalText = this._formatForClaude(
        compressedText,
        displayName || filename,
        category,
        extractedData.info
      );

      // Stage 4: Upload to Claude Files API
      onProgress('uploading-to-claude', 60, 'Uploading to Claude context...');
      const claudeFilename = `${worldId}-${category}-${this._sanitizeFilename(filename)}.txt`;

      const uploadResult = await this.filesManager.uploadFile(
        apiKey,
        claudeFilename,
        finalText,
        'text/plain'
      );

      onProgress('uploading-to-claude', 90, 'Uploaded to Claude');

      // Stage 5: Update database with success
      this.pdfRegistry.updateStatus(pdfRecord.id, 'completed', {
        extractedTextLength: finalText.length,
        claudeFileId: uploadResult.id
      });

      // Also register in file_registry for unified file ID retrieval
      await this._registerInFileRegistry(worldId, uploadResult.id, claudeFilename, finalText);

      onProgress('complete', 100, 'Processing complete!');

      console.log(`[PDFProcessor] Processed PDF ${filename}: ${finalText.length} chars, file_id: ${uploadResult.id}`);

      return {
        id: pdfRecord.id,
        filename,
        displayName: displayName || filename,
        category,
        claudeFileId: uploadResult.id,
        extractedTextLength: finalText.length,
        pageCount: extractedData.pageCount,
        status: 'completed'
      };

    } catch (error) {
      console.error(`[PDFProcessor] Error processing PDF ${filename}:`, error);

      // Update database with error
      if (pdfRecord) {
        this.pdfRegistry.updateStatus(pdfRecord.id, 'failed', {
          errorMessage: error.message
        });
      }

      throw error;
    }
  }

  /**
   * Extract text from a PDF buffer.
   *
   * @param {Buffer} pdfBuffer - The PDF file buffer.
   * @returns {Promise<Object>} Extracted data with text, pageCount, info.
   * @private
   */
  async _extractText(pdfBuffer) {
    try {
      const data = await pdfParse(pdfBuffer);

      return {
        text: data.text,
        pageCount: data.numpages,
        info: data.info || {}
      };
    } catch (error) {
      throw new Error(`PDF text extraction failed: ${error.message}`);
    }
  }

  /**
   * Format extracted text for Claude context.
   *
   * @param {string} text - The extracted/compressed text.
   * @param {string} displayName - The document display name.
   * @param {string} category - The document category.
   * @param {Object} pdfInfo - PDF metadata.
   * @returns {string} Formatted text for Claude.
   * @private
   */
  _formatForClaude(text, displayName, category, pdfInfo) {
    const categoryLabel = {
      adventure: 'Adventure Module',
      supplement: 'Rules Supplement',
      reference: 'Reference Material'
    }[category] || 'Document';

    let formatted = `=== ${categoryLabel.toUpperCase()}: ${displayName} ===\n\n`;

    if (pdfInfo.Title) {
      formatted += `Title: ${pdfInfo.Title}\n`;
    }
    if (pdfInfo.Author) {
      formatted += `Author: ${pdfInfo.Author}\n`;
    }
    if (pdfInfo.Title || pdfInfo.Author) {
      formatted += '\n';
    }

    formatted += text;
    formatted += `\n\n=== END ${displayName} ===`;

    return formatted;
  }

  /**
   * Register uploaded file in the unified file_registry.
   *
   * @param {string} worldId - The world ID.
   * @param {string} claudeFileId - The Claude file_id.
   * @param {string} filename - The filename.
   * @param {string} content - The content (for hash).
   * @private
   */
  async _registerInFileRegistry(worldId, claudeFileId, filename, content) {
    // The filesManager handles this during uploadAndRegister,
    // but we may need to register separately for PDFs
    // This ensures PDF file_ids appear in getFileIdsForWorld()
    try {
      // Check if filesManager has a direct registration method
      // For now, the pdf_documents table tracks this separately
      // and we'll need to combine file sources when building context
    } catch (error) {
      console.warn('[PDFProcessor] Could not register in file_registry:', error.message);
    }
  }

  /**
   * Delete a PDF document and its Claude file.
   *
   * @param {string} apiKey - The user's Claude API key.
   * @param {string} worldId - The world ID.
   * @param {number} pdfId - The PDF document ID.
   * @returns {Promise<boolean>} Success status.
   */
  async deletePDF(apiKey, worldId, pdfId) {
    const pdf = this.pdfRegistry.getPDF(pdfId);

    if (!pdf) {
      throw new Error(`PDF not found: ${pdfId}`);
    }

    if (pdf.world_id !== worldId) {
      throw new Error(`PDF ${pdfId} does not belong to world ${worldId}`);
    }

    // Delete from Claude Files API if uploaded
    if (pdf.claude_file_id) {
      try {
        await this.filesManager.deleteFile(apiKey, worldId, pdf.claude_file_id);
      } catch (error) {
        console.warn(`[PDFProcessor] Could not delete Claude file ${pdf.claude_file_id}:`, error.message);
      }
    }

    // Delete from database
    this.pdfRegistry.deletePDF(pdfId);

    console.log(`[PDFProcessor] Deleted PDF ${pdfId}`);
    return true;
  }

  /**
   * Get all PDFs for a world.
   *
   * @param {string} worldId - The world ID.
   * @returns {Array} List of PDF documents.
   */
  getPDFsForWorld(worldId) {
    return this.pdfRegistry.getPDFsForWorld(worldId);
  }

  /**
   * Get Claude file IDs for all completed PDFs in a world.
   *
   * @param {string} worldId - The world ID.
   * @returns {Array<string>} Array of Claude file_ids.
   */
  getFileIdsForWorld(worldId) {
    return this.pdfRegistry.getFileIdsForWorld(worldId);
  }

  /**
   * Get PDF statistics for a world.
   *
   * @param {string} worldId - The world ID.
   * @returns {Object} Statistics object.
   */
  getStats(worldId) {
    return this.pdfRegistry.getStats(worldId);
  }

  /**
   * Compress text for token efficiency.
   *
   * @param {string} text - Extracted PDF text.
   * @returns {string} Compressed text.
   */
  compressText(text) {
    let compressed = text;

    // Remove excessive whitespace (multiple spaces/newlines to single)
    compressed = compressed.replace(/[ \t]+/g, ' ');
    compressed = compressed.replace(/\n\s*\n\s*\n/g, '\n\n');

    // Remove common page header/footer patterns
    compressed = compressed.replace(/Page \d+ of \d+/gi, '');
    compressed = compressed.replace(/^\d+\s*$/gm, ''); // Standalone page numbers

    // Remove excessive dashes/underscores (often used as separators)
    compressed = compressed.replace(/[-_]{10,}/g, '---');

    // Trim lines
    compressed = compressed.split('\n').map(line => line.trim()).join('\n');

    // Final trim
    compressed = compressed.trim();

    return compressed;
  }

  /**
   * Sanitize filename for use in Claude file naming.
   *
   * @param {string} filename - The original filename.
   * @returns {string} Sanitized filename.
   * @private
   */
  _sanitizeFilename(filename) {
    return filename
      .replace(/\.pdf$/i, '')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .substring(0, 50);
  }
}
