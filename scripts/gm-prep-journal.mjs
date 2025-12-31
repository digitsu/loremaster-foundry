/**
 * GM Prep Journal Sync
 *
 * Watches for edits to GM Prep Script journals and syncs them back to the server.
 * Uses debouncing to avoid excessive API calls during active editing.
 */

const MODULE_ID = 'loremaster';
const SYNC_DEBOUNCE_MS = 30000; // 30 seconds

/**
 * Manages syncing of GM Prep Script journal edits back to the server.
 * Implements debounced auto-sync to avoid excessive API calls.
 */
export class GMPrepJournalSync {
  /**
   * Create a new GMPrepJournalSync instance.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   */
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.pendingSyncs = new Map(); // journalId -> { timeoutId, scriptId, content }
    this.syncIndicators = new Map(); // journalId -> HTMLElement
  }

  /**
   * Initialize the journal sync hooks.
   * Should be called during module ready.
   */
  initialize() {
    // Only GMs need journal sync
    if (!game.user.isGM) return;

    // Listen for journal page updates
    Hooks.on('updateJournalEntryPage', this._onJournalPageUpdate.bind(this));

    // Listen for journal close to trigger immediate sync
    Hooks.on('closeJournalSheet', this._onJournalClose.bind(this));

    console.log(`${MODULE_ID} | GM Prep Journal Sync initialized`);
  }

  /**
   * Handle journal entry page updates.
   * Checks if the page belongs to a GM Prep Script journal and schedules sync.
   *
   * @param {JournalEntryPage} page - The updated page.
   * @param {Object} changes - The changes made.
   * @param {Object} options - Update options.
   * @param {string} userId - The user who made the change.
   * @private
   */
  async _onJournalPageUpdate(page, changes, options, userId) {
    // Only process our own changes
    if (userId !== game.user.id) return;

    // Check if this is a GM Prep Script journal
    const journal = page.parent;
    if (!journal) return;

    const isGMPrepScript = journal.getFlag(MODULE_ID, 'isGMPrepScript');
    if (!isGMPrepScript) return;

    // Check if content actually changed
    if (!changes.text?.content) return;

    const scriptId = journal.getFlag(MODULE_ID, 'scriptId');
    if (!scriptId) {
      console.warn(`${MODULE_ID} | GM Prep Script journal missing scriptId flag`);
      return;
    }

    // Get the updated content (convert HTML back to markdown)
    const htmlContent = changes.text.content;
    const markdownContent = this._htmlToMarkdown(htmlContent);

    // Schedule debounced sync
    this._scheduleSyncToServer(journal.id, scriptId, markdownContent);
  }

  /**
   * Handle journal close - sync immediately if there are pending changes.
   *
   * @param {JournalSheet} sheet - The journal sheet being closed.
   * @param {jQuery} html - The sheet HTML.
   * @private
   */
  async _onJournalClose(sheet, html) {
    const journal = sheet.document;
    const pending = this.pendingSyncs.get(journal.id);

    if (pending) {
      // Clear the debounce timer and sync immediately
      clearTimeout(pending.timeoutId);
      this.pendingSyncs.delete(journal.id);

      await this._performSync(journal.id, pending.scriptId, pending.content);
    }
  }

  /**
   * Schedule a debounced sync to the server.
   * Clears any existing pending sync for this journal and sets a new timer.
   *
   * @param {string} journalId - The journal ID.
   * @param {number} scriptId - The GM Prep script ID.
   * @param {string} content - The markdown content to sync.
   * @private
   */
  _scheduleSyncToServer(journalId, scriptId, content) {
    // Clear existing pending sync
    const existing = this.pendingSyncs.get(journalId);
    if (existing) {
      clearTimeout(existing.timeoutId);
    }

    // Show syncing indicator
    this._showSyncIndicator(journalId, 'pending');

    // Set up new debounced sync
    const timeoutId = setTimeout(async () => {
      this.pendingSyncs.delete(journalId);
      await this._performSync(journalId, scriptId, content);
    }, SYNC_DEBOUNCE_MS);

    this.pendingSyncs.set(journalId, {
      timeoutId,
      scriptId,
      content
    });

    console.log(`${MODULE_ID} | Scheduled sync for script ${scriptId} in ${SYNC_DEBOUNCE_MS}ms`);
  }

  /**
   * Perform the actual sync to the server.
   *
   * @param {string} journalId - The journal ID.
   * @param {number} scriptId - The GM Prep script ID.
   * @param {string} content - The markdown content to sync.
   * @private
   */
  async _performSync(journalId, scriptId, content) {
    this._showSyncIndicator(journalId, 'syncing');

    try {
      const result = await this.socketClient.syncGMPrepScript(scriptId, content);

      if (result.success) {
        console.log(`${MODULE_ID} | Synced script ${scriptId} to server`);

        // Update journal flag with new file ID if changed
        const journal = game.journal.get(journalId);
        if (journal && result.claudeFileId) {
          await journal.setFlag(MODULE_ID, 'claudeFileId', result.claudeFileId);
        }

        this._showSyncIndicator(journalId, 'synced');

        // Hide the synced indicator after 3 seconds
        setTimeout(() => {
          this._hideSyncIndicator(journalId);
        }, 3000);

      } else {
        throw new Error(result.message || 'Sync failed');
      }

    } catch (error) {
      console.error(`${MODULE_ID} | Failed to sync script ${scriptId}:`, error);
      this._showSyncIndicator(journalId, 'error');

      // Show error notification
      ui.notifications.error(game.i18n.format('LOREMASTER.GMPrep.SyncError', {
        error: error.message
      }));
    }
  }

  /**
   * Show a sync status indicator on the journal sheet.
   *
   * @param {string} journalId - The journal ID.
   * @param {string} status - The sync status: 'pending', 'syncing', 'synced', 'error'.
   * @private
   */
  _showSyncIndicator(journalId, status) {
    // Find the journal sheet window
    const journal = game.journal.get(journalId);
    if (!journal?.sheet?.rendered) return;

    const header = $(journal.sheet.element).find('.window-header');
    if (!header.length) return;

    // Remove existing indicator
    header.find('.gm-prep-sync-indicator').remove();

    // Create indicator element
    const indicator = $(`<span class="gm-prep-sync-indicator sync-${status}"></span>`);

    switch (status) {
      case 'pending':
        indicator.html('<i class="fas fa-clock"></i> <span>Pending sync...</span>');
        indicator.attr('title', 'Changes will sync in 30 seconds');
        break;
      case 'syncing':
        indicator.html('<i class="fas fa-sync fa-spin"></i> <span>Syncing...</span>');
        indicator.attr('title', 'Syncing to server');
        break;
      case 'synced':
        indicator.html('<i class="fas fa-check"></i> <span>Synced</span>');
        indicator.attr('title', 'Synced to server');
        break;
      case 'error':
        indicator.html('<i class="fas fa-exclamation-triangle"></i> <span>Sync failed</span>');
        indicator.attr('title', 'Failed to sync - check console for details');
        break;
    }

    // Insert before the close button
    header.find('.close').before(indicator);

    // Store reference
    this.syncIndicators.set(journalId, indicator[0]);
  }

  /**
   * Hide the sync indicator for a journal.
   *
   * @param {string} journalId - The journal ID.
   * @private
   */
  _hideSyncIndicator(journalId) {
    const indicator = this.syncIndicators.get(journalId);
    if (indicator) {
      $(indicator).fadeOut(300, function() {
        $(this).remove();
      });
      this.syncIndicators.delete(journalId);
    }
  }

  /**
   * Convert HTML content from Foundry journal back to markdown.
   * Reverses the markdown-to-HTML conversion done when creating the journal.
   *
   * @param {string} html - The HTML content.
   * @returns {string} Markdown content.
   * @private
   */
  _htmlToMarkdown(html) {
    if (!html || typeof html !== 'string') return '';

    let text = html;

    // Remove wrapper divs
    text = text.replace(/<div class="gm-prep-script">/gi, '');
    text = text.replace(/<\/div>/gi, '');

    // Convert headers back to markdown
    text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
    text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
    text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
    text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n');

    // Convert horizontal rules
    text = text.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Convert bold and italic
    text = text.replace(/<strong><em>(.*?)<\/em><\/strong>/gi, '***$1***');
    text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');

    // Convert code
    text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');

    // Convert list items
    text = text.replace(/<li class="unchecked">(.*?)<\/li>/gi, '- [ ] $1\n');
    text = text.replace(/<li class="checked">(.*?)<\/li>/gi, '- [x] $1\n');
    text = text.replace(/<li>(.*?)<\/li>/gi, '- $1\n');

    // Remove list wrappers
    text = text.replace(/<ul[^>]*>/gi, '');
    text = text.replace(/<\/ul>/gi, '\n');

    // Convert table rows back (handle thead/tbody structure)
    // Add separator after thead
    text = text.replace(/<\/thead>/gi, (match) => {
      // Count the columns from the previous header row
      return '</thead>|SEPARATOR|';
    });
    // First convert header cells
    text = text.replace(/<th>(.*?)<\/th>/gi, '<td>$1</td>');
    // Remove thead/tbody wrappers
    text = text.replace(/<\/?thead>/gi, '');
    text = text.replace(/<\/?tbody>/gi, '');
    // Convert table rows
    text = text.replace(/<tr>(.*?)<\/tr>/gi, (match, content) => {
      const cells = content.match(/<td>(.*?)<\/td>/gi) || [];
      const cellValues = cells.map(cell => cell.replace(/<\/?td>/gi, '').trim());
      return '| ' + cellValues.join(' | ') + ' |\n';
    });
    // Convert separator placeholders to proper markdown separators
    text = text.replace(/\|SEPARATOR\|/g, (match, offset, str) => {
      // Find the previous row to count columns
      const prevMatch = str.substring(0, offset).match(/\| [^|]+ \|[^\n]*\n$/);
      if (prevMatch) {
        const cols = (prevMatch[0].match(/\|/g) || []).length - 1;
        return '|' + ' --- |'.repeat(cols) + '\n';
      }
      return '| --- | --- | --- |\n'; // Fallback
    });
    text = text.replace(/<table[^>]*>/gi, '');
    text = text.replace(/<\/table>/gi, '');

    // Convert paragraphs and line breaks
    text = text.replace(/<\/p><p>/gi, '\n\n');
    text = text.replace(/<p>/gi, '');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Decode HTML entities
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');

    // Clean up excessive whitespace
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();

    return text;
  }
}
