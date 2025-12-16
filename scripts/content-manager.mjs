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
      tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'pdfs' }]
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
      maxFileSize: this._formatFileSize(50 * 1024 * 1024)
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

    // Refresh button
    html.find('.refresh-btn').on('click', this._onRefresh.bind(this));
  }

  /**
   * Handle window render - load initial data.
   *
   * @param {boolean} force - Force render.
   * @param {object} options - Render options.
   */
  async _render(force = false, options = {}) {
    await super._render(force, options);

    // Load PDFs on first render
    if (!this._loaded) {
      this._loaded = true;
      await this._loadPDFs();
    }
  }

  /**
   * Load PDFs from the server.
   *
   * @private
   */
  async _loadPDFs() {
    try {
      this.pdfs = await this.socketClient.listPDFs();
      this.stats = await this.socketClient.getPDFStats();
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
        name: result.displayName
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
}
