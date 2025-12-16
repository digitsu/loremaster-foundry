/**
 * House Rules Store
 *
 * Manages CRUD operations for GM house rules and session rulings.
 * Handles persistent house rules and session-only rulings that expire
 * when the session ends.
 */

/**
 * HouseRulesStore class provides database operations for house rules.
 */
export class HouseRulesStore {
  /**
   * Create a new HouseRulesStore instance.
   *
   * @param {Database} db - The better-sqlite3 database instance.
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new house rule/ruling.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {Object} options - Ruling options.
   * @param {string} options.ruleContext - Short description of the rule situation.
   * @param {string} options.foundryInterpretation - What Foundry/system says.
   * @param {string} options.pdfInterpretation - What the PDF says.
   * @param {string} options.gmRuling - The GM's decision.
   * @param {string} options.rulingType - 'session' or 'persistent'.
   * @param {number} options.sourcePdfId - FK to pdf_documents if from PDF.
   * @param {string} options.createdBy - User ID who made ruling.
   * @param {string} options.createdByName - User name who made ruling.
   * @returns {Object} The created ruling record.
   */
  createRuling(worldId, options) {
    const {
      ruleContext,
      foundryInterpretation = null,
      pdfInterpretation = null,
      gmRuling,
      rulingType = 'session',
      sourcePdfId = null,
      createdBy,
      createdByName = null
    } = options;

    if (!ruleContext || !gmRuling) {
      throw new Error('Rule context and GM ruling are required');
    }

    if (!['session', 'persistent'].includes(rulingType)) {
      throw new Error('Ruling type must be "session" or "persistent"');
    }

    // Set expiration for session rulings (24 hours from now)
    const expiresAt = rulingType === 'session'
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null;

    const result = this.db.prepare(`
      INSERT INTO house_rules
        (world_id, rule_context, foundry_interpretation, pdf_interpretation,
         gm_ruling, ruling_type, source_pdf_id, created_by, created_by_name, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      worldId,
      ruleContext,
      foundryInterpretation,
      pdfInterpretation,
      gmRuling,
      rulingType,
      sourcePdfId,
      createdBy,
      createdByName,
      expiresAt
    );

    console.log(`[HouseRulesStore] Created ${rulingType} ruling ${result.lastInsertRowid} for world ${worldId}`);

    return {
      id: result.lastInsertRowid,
      worldId,
      ruleContext,
      foundryInterpretation,
      pdfInterpretation,
      gmRuling,
      rulingType,
      sourcePdfId,
      createdBy,
      createdByName,
      expiresAt
    };
  }

  /**
   * Get a ruling by ID.
   *
   * @param {number} rulingId - The ruling ID.
   * @returns {Object|null} The ruling record or null.
   */
  getRuling(rulingId) {
    return this.db.prepare(`
      SELECT * FROM house_rules WHERE id = ?
    `).get(rulingId);
  }

  /**
   * Get all rulings for a world.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {boolean} persistentOnly - If true, only return persistent rules.
   * @returns {Array} Array of ruling records.
   */
  getRulingsForWorld(worldId, persistentOnly = false) {
    let query = `
      SELECT * FROM house_rules
      WHERE world_id = ?
    `;

    if (persistentOnly) {
      query += ` AND ruling_type = 'persistent'`;
    } else {
      // Exclude expired session rulings
      query += ` AND (ruling_type = 'persistent' OR expires_at IS NULL OR expires_at > datetime('now'))`;
    }

    query += ` ORDER BY created_at DESC`;

    return this.db.prepare(query).all(worldId);
  }

  /**
   * Get rulings formatted for Claude context.
   * Respects token budget and prioritizes persistent rules.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {number} maxTokens - Maximum tokens to include (approx 4 chars per token).
   * @returns {Array} Array of ruling records within token budget.
   */
  getRulingsForContext(worldId, maxTokens = 5000) {
    // Get all active rulings, persistent first
    const rulings = this.db.prepare(`
      SELECT * FROM house_rules
      WHERE world_id = ?
        AND (ruling_type = 'persistent' OR expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY
        CASE ruling_type WHEN 'persistent' THEN 0 ELSE 1 END,
        created_at DESC
    `).all(worldId);

    // Estimate tokens and select rulings within budget
    const maxChars = maxTokens * 4;
    const selected = [];
    let totalChars = 0;

    for (const ruling of rulings) {
      const rulingChars = this._estimateRulingChars(ruling);

      if (totalChars + rulingChars <= maxChars) {
        selected.push(ruling);
        totalChars += rulingChars;
      } else if (ruling.ruling_type === 'persistent') {
        // Always include persistent rules even if over budget
        selected.push(ruling);
        totalChars += rulingChars;
      }
    }

    return selected;
  }

  /**
   * Estimate character count for a ruling (for token estimation).
   *
   * @param {Object} ruling - The ruling object.
   * @returns {number} Estimated character count.
   * @private
   */
  _estimateRulingChars(ruling) {
    let chars = 0;
    chars += (ruling.rule_context || '').length;
    chars += (ruling.foundry_interpretation || '').length;
    chars += (ruling.pdf_interpretation || '').length;
    chars += (ruling.gm_ruling || '').length;
    chars += 100; // Overhead for formatting
    return chars;
  }

  /**
   * Update an existing ruling.
   *
   * @param {number} rulingId - The ruling ID.
   * @param {Object} updates - Fields to update.
   * @returns {boolean} Success status.
   */
  updateRuling(rulingId, updates) {
    const allowedFields = [
      'rule_context', 'foundry_interpretation', 'pdf_interpretation',
      'gm_ruling', 'ruling_type'
    ];

    const setClause = [];
    const params = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(dbKey)) {
        setClause.push(`${dbKey} = ?`);
        params.push(value);
      }
    }

    if (setClause.length === 0) {
      return false;
    }

    // If changing to persistent, clear expiration
    if (updates.rulingType === 'persistent' || updates.ruling_type === 'persistent') {
      setClause.push('expires_at = NULL');
    }

    params.push(rulingId);

    const result = this.db.prepare(`
      UPDATE house_rules
      SET ${setClause.join(', ')}
      WHERE id = ?
    `).run(...params);

    if (result.changes > 0) {
      console.log(`[HouseRulesStore] Updated ruling ${rulingId}`);
    }

    return result.changes > 0;
  }

  /**
   * Delete a ruling.
   *
   * @param {number} rulingId - The ruling ID.
   * @returns {boolean} Success status.
   */
  deleteRuling(rulingId) {
    const result = this.db.prepare(`
      DELETE FROM house_rules WHERE id = ?
    `).run(rulingId);

    if (result.changes > 0) {
      console.log(`[HouseRulesStore] Deleted ruling ${rulingId}`);
    }

    return result.changes > 0;
  }

  /**
   * Expire all session rulings for a world.
   * Called when a session ends or world disconnects.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {number} Number of expired rulings.
   */
  expireSessionRulings(worldId) {
    const result = this.db.prepare(`
      UPDATE house_rules
      SET expires_at = datetime('now')
      WHERE world_id = ?
        AND ruling_type = 'session'
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).run(worldId);

    if (result.changes > 0) {
      console.log(`[HouseRulesStore] Expired ${result.changes} session rulings for world ${worldId}`);
    }

    return result.changes;
  }

  /**
   * Clean up old expired rulings from the database.
   *
   * @param {number} daysOld - Delete rulings expired more than this many days ago.
   * @returns {number} Number of deleted rulings.
   */
  cleanupExpiredRulings(daysOld = 7) {
    const result = this.db.prepare(`
      DELETE FROM house_rules
      WHERE ruling_type = 'session'
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now', '-' || ? || ' days')
    `).run(daysOld);

    if (result.changes > 0) {
      console.log(`[HouseRulesStore] Cleaned up ${result.changes} old expired rulings`);
    }

    return result.changes;
  }

  /**
   * Export house rules as a markdown document.
   * For use with the Foundry Journal interface.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {boolean} persistentOnly - If true, only export persistent rules.
   * @returns {string} Markdown-formatted house rules document.
   */
  exportAsMarkdown(worldId, persistentOnly = true) {
    const rulings = this.getRulingsForWorld(worldId, persistentOnly);

    if (rulings.length === 0) {
      return '# House Rules\n\nNo house rules have been established yet.\n\nWhen Loremaster detects a rules discrepancy between your PDF rules and the Foundry system, and you make a ruling, it will be recorded here.';
    }

    const lines = ['# House Rules', ''];
    lines.push('These are the official house rules for this campaign, established through GM rulings during play.', '');

    let currentType = null;

    for (const ruling of rulings) {
      if (ruling.ruling_type !== currentType) {
        currentType = ruling.ruling_type;
        const typeLabel = currentType === 'persistent' ? 'Persistent House Rules' : 'Session Rulings';
        lines.push(`## ${typeLabel}`, '');
      }

      lines.push(`### ${ruling.rule_context}`);
      lines.push('');

      if (ruling.pdf_interpretation) {
        lines.push(`**PDF Rules:** ${ruling.pdf_interpretation}`);
        lines.push('');
      }

      if (ruling.foundry_interpretation) {
        lines.push(`**Foundry System:** ${ruling.foundry_interpretation}`);
        lines.push('');
      }

      lines.push(`**GM Ruling:** ${ruling.gm_ruling}`);
      lines.push('');

      const date = new Date(ruling.created_at).toLocaleDateString();
      lines.push(`*Established ${date}${ruling.created_by_name ? ` by ${ruling.created_by_name}` : ''}*`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Import house rules from a markdown document.
   * Basic parser for the format used by exportAsMarkdown.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @param {string} markdown - The markdown content to import.
   * @param {string} createdBy - User ID importing the rules.
   * @param {string} createdByName - User name importing the rules.
   * @returns {Object} Import result with counts.
   */
  importFromMarkdown(worldId, markdown, createdBy, createdByName) {
    // This is a simplified parser - could be expanded for more robust parsing
    const sections = markdown.split('###').slice(1); // Skip header
    let imported = 0;
    let errors = 0;

    for (const section of sections) {
      try {
        const lines = section.trim().split('\n');
        const ruleContext = lines[0].trim();

        if (!ruleContext) continue;

        let pdfInterpretation = null;
        let foundryInterpretation = null;
        let gmRuling = null;

        for (const line of lines) {
          if (line.startsWith('**PDF Rules:**')) {
            pdfInterpretation = line.replace('**PDF Rules:**', '').trim();
          } else if (line.startsWith('**Foundry System:**')) {
            foundryInterpretation = line.replace('**Foundry System:**', '').trim();
          } else if (line.startsWith('**GM Ruling:**')) {
            gmRuling = line.replace('**GM Ruling:**', '').trim();
          }
        }

        if (gmRuling) {
          this.createRuling(worldId, {
            ruleContext,
            foundryInterpretation,
            pdfInterpretation,
            gmRuling,
            rulingType: 'persistent',
            createdBy,
            createdByName
          });
          imported++;
        }
      } catch (error) {
        console.warn(`[HouseRulesStore] Error parsing section:`, error.message);
        errors++;
      }
    }

    console.log(`[HouseRulesStore] Imported ${imported} rulings from markdown (${errors} errors)`);

    return { imported, errors };
  }

  /**
   * Get statistics for a world's house rules.
   *
   * @param {string} worldId - The Foundry world identifier.
   * @returns {Object} Statistics object.
   */
  getStats(worldId) {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN ruling_type = 'persistent' THEN 1 ELSE 0 END) as persistent,
        SUM(CASE WHEN ruling_type = 'session'
          AND (expires_at IS NULL OR expires_at > datetime('now'))
          THEN 1 ELSE 0 END) as session_active,
        SUM(CASE WHEN ruling_type = 'session'
          AND expires_at IS NOT NULL AND expires_at <= datetime('now')
          THEN 1 ELSE 0 END) as session_expired
      FROM house_rules
      WHERE world_id = ?
    `).get(worldId);

    return {
      total: stats.total || 0,
      persistent: stats.persistent || 0,
      sessionActive: stats.session_active || 0,
      sessionExpired: stats.session_expired || 0
    };
  }
}
