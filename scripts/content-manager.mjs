/**
 * Loremaster Content Manager
 *
 * Application window for managing PDF adventure uploads and content files.
 * Allows GMs to upload, categorize, and manage PDF documents that provide
 * context for Loremaster AI interactions.
 */

const MODULE_ID = 'loremaster';

/**
 * Register Handlebars helpers for the Content Manager template.
 * Called once during module initialization.
 */
export function registerContentManagerHelpers() {
  // Equality comparison helper
  Handlebars.registerHelper('eq', (a, b) => a === b);

  // Not equal comparison helper
  Handlebars.registerHelper('ne', (a, b) => a !== b);

  // Format file size (bytes to human readable)
  Handlebars.registerHelper('formatSize', (bytes) => {
    if (typeof bytes !== 'number' || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  });

  // Get status CSS class
  Handlebars.registerHelper('statusClass', (status) => {
    return `status-${status || 'pending'}`;
  });

  // Get localized status label
  Handlebars.registerHelper('statusLabel', (status) => {
    const key = `LOREMASTER.ContentManager.Status.${(status || 'pending').charAt(0).toUpperCase() + (status || 'pending').slice(1)}`;
    return game.i18n.localize(key);
  });

  // Get localized category label
  Handlebars.registerHelper('categoryLabel', (category) => {
    // Convert snake_case to PascalCase for localization key
    const cat = category || 'reference';
    const pascalCase = cat.split('_').map(part =>
      part.charAt(0).toUpperCase() + part.slice(1)
    ).join('');
    const key = `LOREMASTER.ContentManager.Category.${pascalCase}`;
    return game.i18n.localize(key);
  });
}

/**
 * ContentManager Application class for managing PDF uploads and content.
 * Extends Foundry's Application class to provide a dedicated window.
 */
export class ContentManager extends Application {
  /**
   * Create a new ContentManager instance.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   * @param {object} options - Application options.
   */
  constructor(socketClient, options = {}) {
    super(options);
    this.socketClient = socketClient;
    this.pdfs = [];
    this.stats = null;
    this.isUploading = false;
    this.uploadProgress = { stage: '', progress: 0, message: '' };
    // Active Adventure data
    this.activeAdventure = null;
    this.availableAdventures = { pdfAdventures: [], moduleAdventures: [] };
    this.transitionState = null;
    this.linkedGMPrepScript = null;
  }

  /**
   * Default application options.
   *
   * @returns {object} The default options.
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'loremaster-content-manager',
      title: game.i18n.localize('LOREMASTER.ContentManager.Title'),
      template: 'modules/loremaster/templates/content-manager.hbs',
      classes: ['loremaster', 'content-manager'],
      width: 600,
      height: 500,
      resizable: true,
      tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'pdfs' }],
      scrollY: ['.tab']
    });
  }

  /**
   * Get data for template rendering.
   *
   * @param {object} options - Render options.
   * @returns {object} Template data.
   */
  async getData(options = {}) {
    const data = await super.getData(options);

    return {
      ...data,
      pdfs: this.pdfs,
      stats: this.stats,
      isUploading: this.isUploading,
      uploadProgress: this.uploadProgress,
      categories: [
        { value: 'core_rules', label: game.i18n.localize('LOREMASTER.ContentManager.Category.CoreRules') },
        { value: 'rules_supplement', label: game.i18n.localize('LOREMASTER.ContentManager.Category.RulesSupplement') },
        { value: 'adventure', label: game.i18n.localize('LOREMASTER.ContentManager.Category.Adventure') },
        { value: 'adventure_supplement', label: game.i18n.localize('LOREMASTER.ContentManager.Category.AdventureSupplement') },
        { value: 'reference', label: game.i18n.localize('LOREMASTER.ContentManager.Category.Reference') }
      ],
      isGM: game.user.isGM,
      maxFileSize: this._formatFileSize(50 * 1024 * 1024),
      // Active Adventure data
      activeAdventure: this.activeAdventure,
      availableAdventures: this.availableAdventures,
      transitionState: this.transitionState,
      linkedGMPrepScript: this.linkedGMPrepScript
    };
  }

  /**
   * Activate event listeners for the application.
   *
   * @param {jQuery} html - The rendered HTML.
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Upload zone events
    const dropZone = html.find('.upload-zone')[0];
    if (dropZone) {
      dropZone.addEventListener('dragover', this._onDragOver.bind(this));
      dropZone.addEventListener('dragleave', this._onDragLeave.bind(this));
      dropZone.addEventListener('drop', this._onDrop.bind(this));
    }

    // File input
    html.find('.file-input').on('change', this._onFileSelect.bind(this));
    html.find('.browse-btn').on('click', () => html.find('.file-input').trigger('click'));

    // Upload button
    html.find('.upload-btn').on('click', this._onUpload.bind(this));

    // Delete buttons
    html.find('.delete-pdf-btn').on('click', this._onDeletePDF.bind(this));

    // GM Prep buttons
    html.find('.gm-prep-btn').on('click', this._onGMPrep.bind(this));

    // Refresh button
    html.find('.refresh-btn').on('click', this._onRefresh.bind(this));

    // ===== Active Adventure Tab =====
    // Adventure selector
    html.find('.adventure-select').on('change', this._onAdventureSelect.bind(this));

    // Clear active adventure
    html.find('.clear-adventure-btn').on('click', this._onClearAdventure.bind(this));

    // Complete transition
    html.find('.complete-transition-btn').on('click', this._onCompleteTransition.bind(this));

    // View GM Prep script
    html.find('.view-gm-prep-btn').on('click', this._onViewGMPrepScript.bind(this));

    // Foundry module selector
    html.find('.foundry-module-select').on('change', this._onFoundryModuleSelect.bind(this));

    // Register module
    html.find('.register-module-btn').on('click', this._onRegisterModule.bind(this));

    // Unregister module
    html.find('.unregister-module-btn').on('click', this._onUnregisterModule.bind(this));

    // Populate Foundry modules dropdown on adventure tab
    this._populateFoundryModules(html);
  }

  /**
   * Handle window render - load initial data.
   *
   * @param {boolean} force - Force render.
   * @param {object} options - Render options.
   */
  async _render(force = false, options = {}) {
    await super._render(force, options);

    // Load data on first render
    if (!this._loaded) {
      this._loaded = true;
      await this._loadPDFs();
      // Load adventure data for GMs
      if (game.user.isGM) {
        await this._loadAdventureData();
      }
    }
  }

  /**
   * Load PDFs from the server.
   * Also loads GM Prep status for adventure PDFs.
   *
   * @private
   */
  async _loadPDFs() {
    try {
      this.pdfs = await this.socketClient.listPDFs();
      this.stats = await this.socketClient.getPDFStats();

      // Load GM Prep status for adventure PDFs (GM only)
      if (game.user.isGM) {
        for (const pdf of this.pdfs) {
          if (pdf.category === 'adventure') {
            try {
              const status = await this.socketClient.getGMPrepStatus(pdf.id);
              pdf.hasGMPrepScript = status.hasScript;
              pdf.gmPrepStatus = status.status;
              pdf.gmPrepScriptId = status.scriptId;
            } catch (error) {
              console.warn(`${MODULE_ID} | Failed to get GM Prep status for PDF ${pdf.id}:`, error);
              pdf.hasGMPrepScript = false;
            }
          }
        }
      }

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load PDFs:`, error);
      ui.notifications.error(game.i18n.localize('LOREMASTER.ContentManager.LoadError'));
    }
  }

  /**
   * Handle dragover event on drop zone.
   *
   * @param {DragEvent} event - The drag event.
   * @private
   */
  _onDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('drag-over');
  }

  /**
   * Handle dragleave event on drop zone.
   *
   * @param {DragEvent} event - The drag event.
   * @private
   */
  _onDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');
  }

  /**
   * Handle file drop event.
   *
   * @param {DragEvent} event - The drop event.
   * @private
   */
  _onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');

    const files = event.dataTransfer?.files;
    if (files?.length > 0) {
      this._handleFileSelection(files[0]);
    }
  }

  /**
   * Handle file input selection.
   *
   * @param {Event} event - The change event.
   * @private
   */
  _onFileSelect(event) {
    const files = event.target.files;
    if (files?.length > 0) {
      this._handleFileSelection(files[0]);
    }
  }

  /**
   * Handle file selection and validation.
   *
   * @param {File} file - The selected file.
   * @private
   */
  _handleFileSelection(file) {
    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      ui.notifications.warn(game.i18n.localize('LOREMASTER.ContentManager.InvalidFileType'));
      return;
    }

    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      ui.notifications.warn(game.i18n.format('LOREMASTER.ContentManager.FileTooLarge', {
        max: this._formatFileSize(maxSize)
      }));
      return;
    }

    // Update UI with selected file
    this._selectedFile = file;
    const html = this.element;
    html.find('.selected-file-name').text(file.name);
    html.find('.selected-file-size').text(this._formatFileSize(file.size));
    html.find('.selected-file-info').removeClass('hidden');
    html.find('.upload-btn').prop('disabled', false);
  }

  /**
   * Handle upload button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onUpload(event) {
    event.preventDefault();

    if (!this._selectedFile || this.isUploading) return;

    const html = this.element;
    const category = html.find('.category-select').val();
    const displayName = html.find('.display-name-input').val().trim() || this._selectedFile.name;

    try {
      this.isUploading = true;
      this._updateUploadUI(true);

      // Convert file to base64
      const fileData = await this._fileToBase64(this._selectedFile);

      // Upload with progress callback
      const result = await this.socketClient.uploadPDF(
        this._selectedFile.name,
        category,
        displayName,
        fileData,
        (stage, progress, message) => {
          this.uploadProgress = { stage, progress, message };
          this._updateProgressUI(stage, progress, message);
        }
      );

      ui.notifications.info(game.i18n.format('LOREMASTER.ContentManager.UploadSuccess', {
        name: result.pdf?.displayName || result.displayName || displayName
      }));

      // Reset form and reload
      this._resetUploadForm();
      await this._loadPDFs();

    } catch (error) {
      console.error(`${MODULE_ID} | Upload failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ContentManager.UploadError', {
        error: error.message
      }));
    } finally {
      this.isUploading = false;
      this._updateUploadUI(false);
    }
  }

  /**
   * Handle PDF delete button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onDeletePDF(event) {
    event.preventDefault();

    const pdfId = parseInt(event.currentTarget.dataset.pdfId, 10);
    const pdfName = event.currentTarget.dataset.pdfName;

    // Confirm deletion
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.ContentManager.DeleteTitle'),
      content: game.i18n.format('LOREMASTER.ContentManager.DeleteConfirm', { name: pdfName }),
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.deletePDF(pdfId);
      ui.notifications.info(game.i18n.format('LOREMASTER.ContentManager.DeleteSuccess', { name: pdfName }));
      await this._loadPDFs();
    } catch (error) {
      console.error(`${MODULE_ID} | Delete failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ContentManager.DeleteError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle refresh button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRefresh(event) {
    event.preventDefault();
    await this._loadPDFs();
  }

  /**
   * Convert a File to base64 string.
   *
   * @param {File} file - The file to convert.
   * @returns {Promise<string>} Base64-encoded file data.
   * @private
   */
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Remove data URL prefix
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Format file size for display.
   *
   * @param {number} bytes - Size in bytes.
   * @returns {string} Formatted size string.
   * @private
   */
  _formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Update upload UI state.
   *
   * @param {boolean} uploading - Whether upload is in progress.
   * @private
   */
  _updateUploadUI(uploading) {
    const html = this.element;
    html.find('.upload-btn').prop('disabled', uploading);
    html.find('.upload-progress').toggleClass('hidden', !uploading);
    html.find('.file-input').prop('disabled', uploading);
    html.find('.browse-btn').prop('disabled', uploading);
  }

  /**
   * Update progress bar UI.
   *
   * @param {string} stage - Current stage name.
   * @param {number} progress - Progress percentage (0-100).
   * @param {string} message - Progress message.
   * @private
   */
  _updateProgressUI(stage, progress, message) {
    const html = this.element;
    html.find('.progress-bar-fill').css('width', `${progress}%`);
    html.find('.progress-message').text(message);
    html.find('.progress-percent').text(`${progress}%`);
  }

  /**
   * Reset the upload form to initial state.
   *
   * @private
   */
  _resetUploadForm() {
    this._selectedFile = null;
    const html = this.element;
    html.find('.file-input').val('');
    html.find('.display-name-input').val('');
    html.find('.category-select').val('adventure');
    html.find('.selected-file-info').addClass('hidden');
    html.find('.upload-btn').prop('disabled', true);
    html.find('.upload-progress').addClass('hidden');
  }

  /**
   * Get the status label for a PDF.
   *
   * @param {string} status - The processing status.
   * @returns {string} Localized status label.
   */
  static getStatusLabel(status) {
    const key = `LOREMASTER.ContentManager.Status.${status.charAt(0).toUpperCase() + status.slice(1)}`;
    return game.i18n.localize(key);
  }

  /**
   * Get the status class for styling.
   *
   * @param {string} status - The processing status.
   * @returns {string} CSS class name.
   */
  static getStatusClass(status) {
    return `status-${status}`;
  }

  /**
   * Get the category label for a PDF.
   *
   * @param {string} category - The category value.
   * @returns {string} Localized category label.
   */
  static getCategoryLabel(category) {
    const key = `LOREMASTER.ContentManager.Category.${category.charAt(0).toUpperCase() + category.slice(1)}`;
    return game.i18n.localize(key);
  }

  // ===== GM Prep Methods =====

  /**
   * Handle GM Prep button click.
   * Opens a confirmation dialog and generates the adventure script.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onGMPrep(event) {
    event.preventDefault();

    const pdfId = parseInt(event.currentTarget.dataset.pdfId, 10);
    const pdfName = event.currentTarget.dataset.pdfName;
    const hasExisting = event.currentTarget.dataset.hasScript === 'true';

    // Show confirmation dialog with explanation
    const confirmed = await this._showGMPrepDialog(pdfName, hasExisting);
    if (!confirmed) return;

    try {
      // Show notification that generation is starting
      ui.notifications.info(game.i18n.localize('LOREMASTER.GMPrep.Generating'));

      // Generate script with progress callback
      const result = await this.socketClient.generateGMPrep(
        pdfId,
        pdfName,
        hasExisting, // overwrite if existing
        (stage, progress, message) => {
          // Could update a progress UI here if desired
          console.log(`${MODULE_ID} | GM Prep progress: ${stage} - ${progress}% - ${message}`);
        }
      );

      // Create/update journal entry with the script
      await this._createGMPrepJournal(result.adventureName, result.scriptContent, result.scriptId);

      ui.notifications.info(game.i18n.format('LOREMASTER.GMPrep.Success', { name: pdfName }));

      // Reload PDFs to update the GM Script status tag
      await this._loadPDFs();

    } catch (error) {
      console.error(`${MODULE_ID} | GM Prep generation failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.GMPrep.Error', { error: error.message }));
    }
  }

  /**
   * Show the GM Prep confirmation dialog.
   * Explains what GM Prep does and confirms the action.
   *
   * @param {string} adventureName - The name of the adventure.
   * @param {boolean} hasExisting - Whether a script already exists.
   * @returns {Promise<boolean>} True if confirmed.
   * @private
   */
  async _showGMPrepDialog(adventureName, hasExisting) {
    const warningHtml = hasExisting
      ? `<p class="gm-prep-warning"><i class="fas fa-exclamation-triangle"></i> ${game.i18n.localize('LOREMASTER.GMPrep.OverwriteWarning')}</p>`
      : '';

    return Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.GMPrep.DialogTitle'),
      content: `
        <div class="gm-prep-dialog">
          <p>${game.i18n.localize('LOREMASTER.GMPrep.DialogExplanation')}</p>
          <ul>
            <li>${game.i18n.localize('LOREMASTER.GMPrep.DialogBullet1')}</li>
            <li>${game.i18n.localize('LOREMASTER.GMPrep.DialogBullet2')}</li>
            <li>${game.i18n.localize('LOREMASTER.GMPrep.DialogBullet3')}</li>
            <li>${game.i18n.localize('LOREMASTER.GMPrep.DialogBullet4')}</li>
          </ul>
          ${warningHtml}
          <p><strong>${game.i18n.localize('LOREMASTER.GMPrep.DialogConfirm')}</strong></p>
        </div>
      `,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
  }

  /**
   * Create or update a Foundry journal entry with the GM Prep script.
   * The journal is GM-only and contains the full adventure script.
   *
   * @param {string} adventureName - The name of the adventure.
   * @param {string} scriptContent - The markdown script content.
   * @param {number} scriptId - The server-side script ID.
   * @returns {Promise<JournalEntry>} The created/updated journal entry.
   * @private
   */
  async _createGMPrepJournal(adventureName, scriptContent, scriptId) {
    const journalName = `Loremaster: ${adventureName} - GM Script`;

    // Check for existing journal
    let journal = game.journal.find(j => j.name === journalName);

    // Convert markdown to HTML for Foundry journal
    const htmlContent = this._markdownToHtml(scriptContent);

    if (journal) {
      // Update existing journal
      const page = journal.pages.contents[0];
      if (page) {
        await page.update({
          'text.content': htmlContent
        });
      }
    } else {
      // Create new journal (GM only visibility)
      journal = await JournalEntry.create({
        name: journalName,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        flags: {
          loremaster: {
            isGMPrepScript: true,
            scriptId: scriptId,
            adventureName: adventureName
          }
        },
        pages: [{
          name: 'GM Prep Script',
          type: 'text',
          text: {
            format: 1, // HTML format
            content: htmlContent
          }
        }]
      });
    }

    // Store journal UUID on server
    try {
      await this.socketClient.updateGMPrepJournal(scriptId, journal.uuid);
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to update journal UUID on server:`, error);
    }

    // Open the journal for the GM
    journal.sheet.render(true);

    return journal;
  }

  /**
   * Convert markdown to HTML for Foundry journal display.
   * Handles headers, lists, bold, italic, and basic formatting.
   *
   * @param {string} markdown - The markdown content.
   * @returns {string} HTML content.
   * @private
   */
  _markdownToHtml(markdown) {
    let html = markdown
      // Escape HTML special chars first
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headers (must be before other replacements)
      .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // Horizontal rules
      .replace(/^---$/gim, '<hr>')
      // Bold and italic
      .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      // Code blocks (simple handling)
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      // Checkboxes
      .replace(/^\- \[ \] (.*$)/gim, '<li class="unchecked">$1</li>')
      .replace(/^\- \[x\] (.*$)/gim, '<li class="checked">$1</li>')
      // Unordered list items
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      // Ordered list items
      .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap consecutive li elements in ul tags
    html = html.replace(/(<li[^>]*>.*?<\/li>)(\s*<br>)?(\s*<li)/g, '$1$3');
    html = html.replace(/(<li[^>]*>.*?<\/li>)+/g, (match) => {
      if (match.includes('class="checked"') || match.includes('class="unchecked"')) {
        return `<ul class="gm-prep-checklist">${match}</ul>`;
      }
      return `<ul>${match}</ul>`;
    });

    // Handle tables (basic support)
    html = html.replace(/\|(.+)\|/g, (match, content) => {
      const cells = content.split('|').map(cell => cell.trim());
      if (cells.every(cell => cell.match(/^-+$/))) {
        return ''; // Skip separator rows
      }
      const cellHtml = cells.map(cell => `<td>${cell}</td>`).join('');
      return `<tr>${cellHtml}</tr>`;
    });
    html = html.replace(/(<tr>.*?<\/tr>)+/g, (match) => {
      return `<table class="gm-prep-table">${match}</table>`;
    });

    return `<div class="gm-prep-script">${html}</div>`;
  }

  // ===== Active Adventure Methods =====

  /**
   * Load active adventure data from the server.
   * Fetches current adventure, available adventures, and transition state.
   *
   * @private
   */
  async _loadAdventureData() {
    try {
      // Load in parallel for efficiency
      const [activeResult, adventuresResult, transitionResult] = await Promise.all([
        this.socketClient.getActiveAdventure(),
        this.socketClient.listAvailableAdventures(),
        this.socketClient.getTransitionState()
      ]);

      // Extract data from response wrappers
      this.activeAdventure = activeResult?.activeAdventure || null;
      this.availableAdventures = adventuresResult || { pdfAdventures: [], moduleAdventures: [] };
      this.transitionState = transitionResult?.transitionState || null;

      // If there's an active adventure with a GM Prep script, load its details
      if (this.activeAdventure?.gm_prep_script_id) {
        this.linkedGMPrepScript = { id: this.activeAdventure.gm_prep_script_id };
      } else {
        this.linkedGMPrepScript = null;
      }

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load adventure data:`, error);
    }
  }

  /**
   * Handle adventure selection change.
   * Shows transition dialog if changing from an existing adventure.
   *
   * @param {Event} event - The change event.
   * @private
   */
  async _onAdventureSelect(event) {
    const value = event.target.value;
    if (!value) return;

    // Parse selection value (format: "pdf:123" or "module:module-id")
    const [type, id] = value.split(':');
    const adventureType = type;
    const adventureId = type === 'pdf' ? parseInt(id, 10) : id;

    // Find the adventure name
    let adventureName = '';
    let gmPrepScriptId = null;
    if (adventureType === 'pdf') {
      const pdf = this.availableAdventures.pdfAdventures.find(p => p.id === adventureId);
      adventureName = pdf?.display_name || 'Unknown Adventure';
      gmPrepScriptId = pdf?.gmPrepScriptId || null;
    } else {
      const module = this.availableAdventures.moduleAdventures.find(m => m.module_id === adventureId);
      adventureName = module?.module_name || adventureId;
    }

    // If there's an existing active adventure, show transition dialog
    if (this.activeAdventure) {
      const transitionChoice = await this._showTransitionDialog(
        this.activeAdventure.adventure_name,
        adventureName
      );

      if (transitionChoice === 'cancel') {
        // Reset the selector to current value
        this.render(false);
        return;
      }

      // Set the adventure with transition options
      try {
        await this.socketClient.setActiveAdventure(adventureType, adventureId, {
          adventureName,
          gmPrepScriptId,
          transitionType: transitionChoice,
          transitionPrompt: transitionChoice === 'narrative' ?
            await this._getTransitionPrompt(this.activeAdventure.adventure_name, adventureName) : null
        });

        ui.notifications.info(game.i18n.format('LOREMASTER.ActiveAdventure.SwitchSuccess', {
          name: adventureName
        }));

        await this._loadAdventureData();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to set adventure:`, error);
        ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.SwitchError', {
          error: error.message
        }));
      }
    } else {
      // No existing adventure, just set it
      try {
        await this.socketClient.setActiveAdventure(adventureType, adventureId, {
          adventureName,
          gmPrepScriptId
        });

        ui.notifications.info(game.i18n.format('LOREMASTER.ActiveAdventure.SetSuccess', {
          name: adventureName
        }));

        await this._loadAdventureData();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to set adventure:`, error);
        ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.SetError', {
          error: error.message
        }));
      }
    }
  }

  /**
   * Show the adventure transition dialog.
   * Lets GM choose between immediate switch or narrative bridge.
   *
   * @param {string} fromName - Current adventure name.
   * @param {string} toName - New adventure name.
   * @returns {Promise<string>} 'immediate', 'narrative', or 'cancel'.
   * @private
   */
  async _showTransitionDialog(fromName, toName) {
    return new Promise((resolve) => {
      new Dialog({
        title: game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionTitle'),
        content: `
          <div class="adventure-transition-dialog">
            <p>${game.i18n.format('LOREMASTER.ActiveAdventure.TransitionMessage', {
              from: fromName,
              to: toName
            })}</p>
            <p class="hint">${game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionHint')}</p>
          </div>
        `,
        buttons: {
          immediate: {
            icon: '<i class="fas fa-forward"></i>',
            label: game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionImmediate'),
            callback: () => resolve('immediate')
          },
          narrative: {
            icon: '<i class="fas fa-book-open"></i>',
            label: game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionNarrative'),
            callback: () => resolve('narrative')
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('Cancel'),
            callback: () => resolve('cancel')
          }
        },
        default: 'immediate',
        close: () => resolve('cancel')
      }).render(true);
    });
  }

  /**
   * Get transition prompt from GM for narrative bridge.
   *
   * @param {string} fromName - Current adventure name.
   * @param {string} toName - New adventure name.
   * @returns {Promise<string|null>} The transition prompt or null if cancelled.
   * @private
   */
  async _getTransitionPrompt(fromName, toName) {
    return new Promise((resolve) => {
      new Dialog({
        title: game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionPromptTitle'),
        content: `
          <div class="transition-prompt-dialog">
            <p>${game.i18n.format('LOREMASTER.ActiveAdventure.TransitionPromptMessage', {
              from: fromName,
              to: toName
            })}</p>
            <div class="form-group">
              <label>${game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionPromptLabel')}</label>
              <textarea class="transition-prompt-input" rows="4"
                placeholder="${game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionPromptPlaceholder')}"></textarea>
            </div>
          </div>
        `,
        buttons: {
          submit: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize('Submit'),
            callback: (html) => {
              const prompt = html.find('.transition-prompt-input').val().trim();
              resolve(prompt || null);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'submit'
      }).render(true);
    });
  }

  /**
   * Handle clearing the active adventure.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onClearAdventure(event) {
    event.preventDefault();

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.ActiveAdventure.ClearTitle'),
      content: game.i18n.format('LOREMASTER.ActiveAdventure.ClearConfirm', {
        name: this.activeAdventure?.adventure_name || ''
      }),
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.clearActiveAdventure();
      ui.notifications.info(game.i18n.localize('LOREMASTER.ActiveAdventure.ClearSuccess'));
      await this._loadAdventureData();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to clear adventure:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.ClearError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle completing a narrative transition.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onCompleteTransition(event) {
    event.preventDefault();

    try {
      await this.socketClient.completeTransition();
      ui.notifications.info(game.i18n.localize('LOREMASTER.ActiveAdventure.TransitionCompleted'));
      await this._loadAdventureData();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to complete transition:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.TransitionError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle viewing the linked GM Prep script.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onViewGMPrepScript(event) {
    event.preventDefault();

    // Find the Loremaster GM Script journal
    const adventureName = this.activeAdventure?.adventure_name;
    if (!adventureName) return;

    const journalName = `Loremaster: ${adventureName} - GM Script`;
    const journal = game.journal.find(j => j.name === journalName);

    if (journal) {
      journal.sheet.render(true);
    } else {
      ui.notifications.warn(game.i18n.localize('LOREMASTER.ActiveAdventure.ScriptNotFound'));
    }
  }

  /**
   * Handle Foundry module selection change.
   * Enables/disables the register button based on selection.
   *
   * @param {Event} event - The change event.
   * @private
   */
  _onFoundryModuleSelect(event) {
    const value = event.target.value;
    const html = this.element;
    html.find('.register-module-btn').prop('disabled', !value);
  }

  /**
   * Handle registering a Foundry module as an adventure source.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRegisterModule(event) {
    event.preventDefault();

    const html = this.element;
    const moduleSelect = html.find('.foundry-module-select');
    const moduleId = moduleSelect.val();

    if (!moduleId) return;

    // Get module info from Foundry
    const module = game.modules.get(moduleId);
    if (!module) {
      ui.notifications.error(game.i18n.localize('LOREMASTER.ActiveAdventure.ModuleNotFound'));
      return;
    }

    const moduleName = module.title || moduleId;

    try {
      await this.socketClient.registerAdventureModule(moduleId, moduleName, module.description || '');
      ui.notifications.info(game.i18n.format('LOREMASTER.ActiveAdventure.RegisterSuccess', {
        name: moduleName
      }));

      // Reset selector and reload
      moduleSelect.val('');
      html.find('.register-module-btn').prop('disabled', true);
      await this._loadAdventureData();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to register module:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.RegisterError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle unregistering a Foundry module from adventure sources.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onUnregisterModule(event) {
    event.preventDefault();

    const moduleId = event.currentTarget.dataset.moduleId;
    const module = this.availableAdventures.moduleAdventures.find(m => m.module_id === moduleId);
    const moduleName = module?.module_name || moduleId;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.ActiveAdventure.UnregisterTitle'),
      content: game.i18n.format('LOREMASTER.ActiveAdventure.UnregisterConfirm', {
        name: moduleName
      }),
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.unregisterAdventureModule(moduleId);
      ui.notifications.info(game.i18n.format('LOREMASTER.ActiveAdventure.UnregisterSuccess', {
        name: moduleName
      }));
      await this._loadAdventureData();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to unregister module:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.UnregisterError', {
        error: error.message
      }));
    }
  }

  /**
   * Populate the Foundry modules dropdown with installed adventure-type modules.
   * Excludes already-registered modules from the list.
   *
   * @param {jQuery} html - The rendered HTML.
   * @private
   */
  _populateFoundryModules(html) {
    const select = html.find('.foundry-module-select');
    if (!select.length) return;

    // Get list of already registered module IDs
    const registeredIds = new Set(
      this.availableAdventures.moduleAdventures.map(m => m.module_id)
    );

    // Find eligible modules (active, not registered, likely adventure content)
    const eligibleModules = [];
    for (const [id, module] of game.modules.entries()) {
      if (!module.active) continue;
      if (registeredIds.has(id)) continue;
      if (id === 'loremaster') continue; // Don't list ourselves

      // Check if it looks like an adventure/content module
      // (has compendiums, or has "adventure" in title/description)
      const hasCompendiums = module.packs?.size > 0;
      const looksLikeAdventure =
        module.title?.toLowerCase().includes('adventure') ||
        module.description?.toLowerCase().includes('adventure') ||
        module.title?.toLowerCase().includes('module') ||
        module.title?.toLowerCase().includes('content');

      if (hasCompendiums || looksLikeAdventure) {
        eligibleModules.push({
          id,
          title: module.title || id
        });
      }
    }

    // Sort alphabetically
    eligibleModules.sort((a, b) => a.title.localeCompare(b.title));

    // Build options HTML
    select.empty();
    select.append(`<option value="">${game.i18n.localize('LOREMASTER.ActiveAdventure.SelectModule')}</option>`);

    for (const module of eligibleModules) {
      select.append(`<option value="${module.id}">${module.title}</option>`);
    }
  }
}
