/**
 * GM Prep Store
 *
 * Manages GM Prep script records in the database.
 * Handles CRUD operations for adventure scripts generated from PDFs.
 */

/**
 * GMPrepStore class provides database operations for GM Prep scripts.
 */
export class GMPrepStore {
  /**
   * Create a new GMPrepStore instance.
   *
   * @param {Database} db - The better-sqlite3 database instance.
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new GM Prep script record.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {number} pdfId - The PDF document ID.
   * @param {string} adventureName - Display name of the adventure.
   * @returns {Object} The created script record.
   */
  createScript(worldId, pdfId, adventureName) {
    // Check for existing script for this PDF
    const existing = this.getScriptByPdfId(worldId, pdfId);

    if (existing) {
      // Update existing record to pending status for regeneration
      this.db.prepare(`
        UPDATE gm_prep_scripts
        SET generation_status = 'pending',
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(existing.id);

      console.log(`[GMPrepStore] Reset existing script ${existing.id} for regeneration`);
      return { ...existing, generation_status: 'pending', error_message: null };
    }

    const result = this.db.prepare(`
      INSERT INTO gm_prep_scripts
        (world_id, pdf_id, adventure_name, generation_status)
      VALUES (?, ?, ?, 'pending')
    `).run(worldId, pdfId, adventureName);

    console.log(`[GMPrepStore] Created script record ${result.lastInsertRowid} for PDF ${pdfId}`);

    return {
      id: result.lastInsertRowid,
      world_id: worldId,
      pdf_id: pdfId,
      adventure_name: adventureName,
      generation_status: 'pending'
    };
  }

  /**
   * Get a GM Prep script by ID.
   *
   * @param {number} scriptId - The script ID.
   * @returns {Object|null} The script record or null.
   */
  getScript(scriptId) {
    return this.db.prepare(`
      SELECT * FROM gm_prep_scripts WHERE id = ?
    `).get(scriptId);
  }

  /**
   * Get a GM Prep script by PDF ID for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {number} pdfId - The PDF document ID.
   * @returns {Object|null} The script record or null.
   */
  getScriptByPdfId(worldId, pdfId) {
    return this.db.prepare(`
      SELECT * FROM gm_prep_scripts
      WHERE world_id = ? AND pdf_id = ?
    `).get(worldId, pdfId);
  }

  /**
   * Get all GM Prep scripts for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array} Array of script records.
   */
  getScriptsForWorld(worldId) {
    return this.db.prepare(`
      SELECT gps.*, pd.display_name as pdf_display_name, pd.filename as pdf_filename
      FROM gm_prep_scripts gps
      LEFT JOIN pdf_documents pd ON gps.pdf_id = pd.id
      WHERE gps.world_id = ?
      ORDER BY gps.updated_at DESC
    `).all(worldId);
  }

  /**
   * Get all completed GM Prep scripts for a world.
   * Used to include script context in AI responses.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Array} Array of completed script records.
   */
  getCompletedScriptsForWorld(worldId) {
    return this.db.prepare(`
      SELECT gps.*, pd.display_name as pdf_display_name, pd.category as pdf_category
      FROM gm_prep_scripts gps
      LEFT JOIN pdf_documents pd ON gps.pdf_id = pd.id
      WHERE gps.world_id = ? AND gps.generation_status = 'completed'
      ORDER BY gps.updated_at DESC
    `).all(worldId);
  }

  /**
   * Update a GM Prep script.
   *
   * @param {number} scriptId - The script ID.
   * @param {Object} options - Update options.
   * @param {string} options.scriptContent - The generated script content.
   * @param {string} options.journalUuid - The Foundry journal UUID.
   * @param {string} options.status - New generation status.
   * @param {string} options.errorMessage - Error message if failed.
   * @returns {boolean} True if update succeeded.
   */
  updateScript(scriptId, options = {}) {
    const updates = ['updated_at = CURRENT_TIMESTAMP'];
    const params = [];

    if (options.scriptContent !== undefined) {
      updates.push('script_content = ?');
      params.push(options.scriptContent);
    }

    if (options.journalUuid !== undefined) {
      updates.push('journal_uuid = ?');
      params.push(options.journalUuid);
    }

    if (options.status !== undefined) {
      updates.push('generation_status = ?');
      params.push(options.status);
    }

    if (options.errorMessage !== undefined) {
      updates.push('error_message = ?');
      params.push(options.errorMessage);
    }

    params.push(scriptId);

    const result = this.db.prepare(`
      UPDATE gm_prep_scripts
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    if (result.changes > 0) {
      console.log(`[GMPrepStore] Updated script ${scriptId}`);
    }

    return result.changes > 0;
  }

  /**
   * Delete a GM Prep script.
   *
   * @param {number} scriptId - The script ID.
   * @returns {Object|null} The deleted record or null.
   */
  deleteScript(scriptId) {
    const script = this.getScript(scriptId);
    if (!script) return null;

    this.db.prepare(`
      DELETE FROM gm_prep_scripts WHERE id = ?
    `).run(scriptId);

    console.log(`[GMPrepStore] Deleted script ${scriptId}`);
    return script;
  }

  /**
   * Delete GM Prep script by PDF ID.
   * Called when a PDF is deleted.
   *
   * @param {number} pdfId - The PDF document ID.
   * @returns {Object|null} The deleted record or null.
   */
  deleteScriptByPdfId(pdfId) {
    const script = this.db.prepare(`
      SELECT * FROM gm_prep_scripts WHERE pdf_id = ?
    `).get(pdfId);

    if (!script) return null;

    this.db.prepare(`
      DELETE FROM gm_prep_scripts WHERE pdf_id = ?
    `).run(pdfId);

    console.log(`[GMPrepStore] Deleted script for PDF ${pdfId}`);
    return script;
  }

  /**
   * Check if a PDF has a completed GM Prep script.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {number} pdfId - The PDF document ID.
   * @returns {boolean} True if a completed script exists.
   */
  hasCompletedScript(worldId, pdfId) {
    const script = this.getScriptByPdfId(worldId, pdfId);
    return script && script.generation_status === 'completed';
  }

  /**
   * Get script status information for a PDF.
   * Used by the UI to show script availability.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {number} pdfId - The PDF document ID.
   * @returns {Object} Status object with hasScript and status properties.
   */
  getScriptStatus(worldId, pdfId) {
    const script = this.getScriptByPdfId(worldId, pdfId);

    if (!script) {
      return { hasScript: false, status: null, scriptId: null };
    }

    return {
      hasScript: true,
      status: script.generation_status,
      scriptId: script.id,
      journalUuid: script.journal_uuid,
      adventureName: script.adventure_name
    };
  }
}
