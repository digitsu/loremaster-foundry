/**
 * House Rules Journal
 *
 * Provides a Foundry Journal interface for viewing and editing house rules.
 * Syncs with the server's house_rules database table.
 */

const MODULE_ID = 'loremaster';
const JOURNAL_NAME = 'Loremaster House Rules';

/**
 * HouseRulesJournal class manages the Foundry Journal for house rules.
 */
export class HouseRulesJournal {
  /**
   * Create a new HouseRulesJournal instance.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   */
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.journal = null;
    this._syncInProgress = false;
  }

  /**
   * Get or create the House Rules journal entry.
   *
   * @returns {Promise<JournalEntry>} The journal entry.
   */
  async getOrCreateJournal() {
    // Check for existing journal
    let journal = game.journal.getName(JOURNAL_NAME);

    if (!journal) {
      // Create new journal
      journal = await JournalEntry.create({
        name: JOURNAL_NAME,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        flags: {
          [MODULE_ID]: {
            isHouseRulesJournal: true,
            lastSync: null
          }
        }
      });

      // Create initial page
      await journal.createEmbeddedDocuments('JournalEntryPage', [{
        name: 'House Rules',
        type: 'text',
        text: {
          content: this._getDefaultContent(),
          format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
        }
      }]);

      console.log(`${MODULE_ID} | Created House Rules journal`);
    }

    this.journal = journal;
    return journal;
  }

  /**
   * Get default content for a new house rules journal.
   *
   * @returns {string} Default HTML content.
   * @private
   */
  _getDefaultContent() {
    return `
      <h1>House Rules</h1>
      <p>No house rules have been established yet.</p>
      <p>When Loremaster detects a rules discrepancy between your PDF rules and the Foundry system, and you make a ruling, it will be recorded here.</p>
      <hr>
      <p><em>This document syncs automatically with Loremaster. You can edit it manually, and changes will be saved to the server.</em></p>
    `;
  }

  /**
   * Open the House Rules journal and sync content from server.
   *
   * @returns {Promise<void>}
   */
  async open() {
    try {
      const journal = await this.getOrCreateJournal();

      // Sync content from server before opening
      await this.syncFromServer();

      // Open the journal
      journal.sheet.render(true);

    } catch (error) {
      console.error(`${MODULE_ID} | Failed to open House Rules journal:`, error);
      ui.notifications.error('Failed to open House Rules journal');
    }
  }

  /**
   * Sync house rules content from the server.
   *
   * @returns {Promise<void>}
   */
  async syncFromServer() {
    if (this._syncInProgress) return;

    try {
      this._syncInProgress = true;

      const journal = await this.getOrCreateJournal();

      // Get markdown from server
      const result = await this.socketClient.getHouseRulesDocument();

      if (result && result.markdown) {
        // Convert markdown to HTML
        const html = this._markdownToHtml(result.markdown);

        // Update journal page
        const page = journal.pages.contents[0];
        if (page) {
          await page.update({
            'text.content': html
          });
        }

        // Update sync timestamp
        await journal.setFlag(MODULE_ID, 'lastSync', Date.now());

        console.log(`${MODULE_ID} | Synced house rules from server`);
      }

    } catch (error) {
      console.error(`${MODULE_ID} | Failed to sync house rules:`, error);
    } finally {
      this._syncInProgress = false;
    }
  }

  /**
   * Save house rules content to the server.
   *
   * @param {string} content - The HTML content from the journal.
   * @returns {Promise<boolean>} Success status.
   */
  async saveToServer(content) {
    try {
      // Convert HTML back to markdown
      const markdown = this._htmlToMarkdown(content);

      // Save to server
      await this.socketClient.updateHouseRulesDocument(markdown);

      console.log(`${MODULE_ID} | Saved house rules to server`);
      return true;

    } catch (error) {
      console.error(`${MODULE_ID} | Failed to save house rules:`, error);
      ui.notifications.error('Failed to save house rules');
      return false;
    }
  }

  /**
   * Convert markdown to HTML for journal display.
   *
   * @param {string} markdown - The markdown content.
   * @returns {string} HTML content.
   * @private
   */
  _markdownToHtml(markdown) {
    // Simple markdown to HTML conversion
    let html = markdown
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap in paragraphs
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><hr><\/p>/g, '<hr>');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');

    return html;
  }

  /**
   * Convert HTML back to markdown for server storage.
   *
   * @param {string} html - The HTML content.
   * @returns {string} Markdown content.
   * @private
   */
  _htmlToMarkdown(html) {
    // Simple HTML to markdown conversion
    let markdown = html
      // Remove wrapper tags
      .replace(/<\/?p>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      // Headers
      .replace(/<h1>(.+?)<\/h1>/g, '# $1\n')
      .replace(/<h2>(.+?)<\/h2>/g, '## $1\n')
      .replace(/<h3>(.+?)<\/h3>/g, '### $1\n')
      // Bold
      .replace(/<strong>(.+?)<\/strong>/g, '**$1**')
      .replace(/<b>(.+?)<\/b>/g, '**$1**')
      // Italic
      .replace(/<em>(.+?)<\/em>/g, '*$1*')
      .replace(/<i>(.+?)<\/i>/g, '*$1*')
      // Horizontal rules
      .replace(/<hr\s*\/?>/g, '\n---\n')
      // Strip remaining HTML tags
      .replace(/<[^>]+>/g, '')
      // Clean up whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return markdown;
  }

  /**
   * Set up hooks to sync journal changes back to server.
   */
  setupHooks() {
    // Watch for journal updates
    Hooks.on('updateJournalEntryPage', async (page, changes, options, userId) => {
      if (userId !== game.user.id) return;
      if (!page.parent) return;

      // Check if this is our house rules journal
      const isHouseRulesJournal = page.parent.getFlag(MODULE_ID, 'isHouseRulesJournal');
      if (!isHouseRulesJournal) return;

      // Check if content changed
      if (changes.text?.content) {
        console.log(`${MODULE_ID} | House Rules journal updated, saving to server`);
        await this.saveToServer(changes.text.content);
      }
    });
  }
}

/**
 * Create and register the house rules journal functionality.
 *
 * @param {SocketClient} socketClient - The socket client instance.
 * @returns {HouseRulesJournal} The journal manager instance.
 */
export function createHouseRulesJournal(socketClient) {
  const journal = new HouseRulesJournal(socketClient);
  journal.setupHooks();
  return journal;
}
