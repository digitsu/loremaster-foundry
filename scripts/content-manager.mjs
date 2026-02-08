/**
 * Loremaster Content Manager
 *
 * Application window for managing PDF adventure uploads and content files.
 * Allows GMs to upload, categorize, and manage PDF documents that provide
 * context for Loremaster AI interactions.
 */

import { showCastSelectionIfNeeded } from './cast-selection-dialog.mjs';
import { progressBar } from './progress-bar.mjs';
import { isHostedMode } from './config.mjs';
import { SharedContentAdmin } from './shared-content-admin.mjs';

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
    this.sharedAdventures = [];
    this.transitionState = null;
    this.linkedGMPrepScript = null;
    // History tab data
    this.activeConversation = null;
    this.compactedConversations = [];
    this.isCompacting = false;
    // Cast management data
    this.castScriptId = null;
    this.castCharacters = [];
    this.castDirty = false;
    // Foundry module import data
    this.foundryModules = [];
    this.foundryModulesAvailable = false;
    this.isImportingModule = false;
    this.moduleImportProgress = { progress: 0, message: '' };
    // Backup tab data
    this.backupPreview = null;
    this.isBackingUp = false;
    this.backupProgress = { stage: '', progress: 0, message: '' };
    this.pendingImport = null;
    this.isImportingBackup = false;
    this.importProgress = { stage: '', progress: 0, message: '' };
    // Saved backups (hosted mode only)
    this.savedBackups = [];
    // Shared content data
    this.sharedContent = [];
    this.sharedTier = null;
    this.activatedSharedContent = [];
    // Admin detection (cached after first check)
    this._isAdmin = null;
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
      sharedAdventures: this.sharedAdventures || [],
      transitionState: this.transitionState,
      linkedGMPrepScript: this.linkedGMPrepScript,
      // History tab data
      activeConversation: this.activeConversation,
      compactedConversations: this.compactedConversations,
      isCompacting: this.isCompacting,
      // Cast management data - only show playable characters in the UI
      castScriptId: this.castScriptId,
      castCharacters: this.castCharacters.filter(c => c.isPlayable),
      hasNonPlayableOnly: this.castCharacters.length > 0 && this.castCharacters.filter(c => c.isPlayable).length === 0,
      gamePlayers: this._getGamePlayers(),
      // License status from proxy server
      license: this.socketClient.getLicenseStatus(),
      // Foundry module import data
      foundryModules: this.foundryModules,
      foundryModulesAvailable: this.foundryModulesAvailable,
      isImportingModule: this.isImportingModule,
      moduleImportProgress: this.moduleImportProgress,
      // Backup tab data
      backupPreview: this.backupPreview,
      isBackingUp: this.isBackingUp,
      backupProgress: this.backupProgress,
      pendingImport: this.pendingImport,
      isImportingBackup: this.isImportingBackup,
      importProgress: this.importProgress,
      worldName: game.world?.title || 'World',
      currentDate: new Date().toISOString().split('T')[0],
      // Hosted mode detection and saved backups
      isHostedMode: isHostedMode(),
      savedBackups: this.savedBackups,
      // Shared content data
      sharedContent: this.sharedContent,
      sharedTier: this.sharedTier,
      activatedSharedContent: this.activatedSharedContent,
      hasActivatedSharedContent: this.activatedSharedContent.length > 0,
      // Admin status
      isAdmin: this._isAdmin === true
    };
  }

  /**
   * Activate event listeners for the application.
   *
   * @param {jQuery} html - The rendered HTML.
   */
  activateListeners(html) {
    super.activateListeners(html);
    html = $(html); // Convert to jQuery for Foundry v12 compatibility

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

    // Share buttons
    html.find('.share-pdf-btn').on('click', this._onSharePDF.bind(this));

    // GM Prep buttons
    html.find('.gm-prep-btn').on('click', this._onGMPrep.bind(this));

    // Refresh button
    html.find('.refresh-btn').on('click', this._onRefresh.bind(this));

    // Generate Embeddings button
    html.find('.generate-embeddings-btn').on('click', this._onGenerateEmbeddings.bind(this));

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

    // ===== History Tab =====
    // Compact & Archive button
    html.find('.compact-conversation-btn').on('click', this._onCompactConversation.bind(this));

    // View Summary button
    html.find('.view-summary-btn').on('click', this._onViewSummary.bind(this));

    // Continue Adventure button
    html.find('.continue-adventure-btn').on('click', this._onContinueAdventure.bind(this));

    // Refresh history
    html.find('.refresh-history-btn').on('click', this._onRefreshHistory.bind(this));

    // ===== Cast Tab =====
    // Extract characters from script
    html.find('.extract-characters-btn').on('click', this._onExtractCharacters.bind(this));

    // Save cast assignments
    html.find('.save-cast-btn').on('click', this._onSaveCast.bind(this));

    // Player assignment changes
    html.find('.assign-player-select').on('change', this._onPlayerAssignmentChange.bind(this));

    // GM/AI control checkboxes
    html.find('.gm-control-checkbox').on('change', this._onControlCheckboxChange.bind(this));
    html.find('.ai-control-checkbox').on('change', this._onControlCheckboxChange.bind(this));

    // ===== Foundry Module Import Tab =====
    // Import module button
    html.find('.import-module-btn').on('click', this._onImportModule.bind(this));

    // Delete imported module button
    html.find('.delete-module-btn').on('click', this._onDeleteModule.bind(this));

    // Refresh modules list
    html.find('.refresh-modules-btn').on('click', this._onRefreshModules.bind(this));

    // ===== Backup Tab =====
    // Create backup button
    html.find('.create-backup-btn').on('click', this._onCreateBackup.bind(this));

    // Backup file drop zone
    const backupDropZone = html.find('#backup-drop-zone')[0];
    if (backupDropZone) {
      backupDropZone.addEventListener('dragover', this._onBackupDragOver.bind(this));
      backupDropZone.addEventListener('dragleave', this._onBackupDragLeave.bind(this));
      backupDropZone.addEventListener('drop', this._onBackupDrop.bind(this));
    }

    // Backup file input
    html.find('.backup-file-input').on('change', this._onBackupFileSelect.bind(this));
    html.find('#backup-drop-zone').on('click', () => html.find('.backup-file-input').trigger('click'));

    // Import backup buttons
    html.find('.confirm-import-btn').on('click', this._onConfirmImport.bind(this));
    html.find('.cancel-import-btn').on('click', this._onCancelImport.bind(this));

    // Saved backups (hosted mode) - restore and delete buttons
    html.find('.restore-backup-btn').on('click', this._onRestoreSavedBackup.bind(this));
    html.find('.delete-backup-btn').on('click', this._onDeleteSavedBackup.bind(this));

    // ===== Shared Content =====
    // Browse shared library button
    html.find('.browse-shared-btn').on('click', this._onBrowseSharedLibrary.bind(this));

    // Deactivate shared content button
    html.find('.deactivate-shared-btn').on('click', this._onDeactivateSharedContent.bind(this));

    // Admin button
    html.find('.admin-shared-btn').on('click', this._onAdminShared.bind(this));
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
      // Load shared content data
      await this._loadSharedContentData();
      // Check admin status
      await this._checkAdminStatus();
      // Load adventure data, cast, history, Foundry modules, and backup data for GMs
      if (game.user.isGM) {
        await this._loadAdventureData();
        await this._loadCastData();
        await this._loadHistoryData();
        await this._loadFoundryModules();
        await this._loadBackupData();
        // Check RAG availability and gate the embeddings button
        await this._checkRagAvailability();
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
   * Load shared content data from the server.
   * Fetches available shared content for the current game system and tier status.
   *
   * @private
   */
  async _loadSharedContentData() {
    try {
      const [contentResult, tierResult] = await Promise.all([
        this.socketClient.listSharedContent(),
        this.socketClient.getSharedTierStatus()
      ]);
      this.sharedContent = contentResult.content || [];
      // Prefer dedicated tier endpoint; fall back to tier info from list response
      this.sharedTier = tierResult.tier || contentResult.tier || { current: 0, max: 0 };

      // Filter activated shared content
      this.activatedSharedContent = this.sharedContent.filter(item => item.isActivated);

      this.render(false);
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to load shared content:`, error);
      // Non-critical error - don't show notification, just log
      this.sharedContent = [];
      this.sharedTier = { current: 0, max: 0 };
      this.activatedSharedContent = [];
    }
  }

  /**
   * Check if the current user has admin privileges for shared content.
   * Admin status is determined by attempting to call adminListPendingShared().
   * Result is cached in this._isAdmin.
   *
   * @private
   */
  async _checkAdminStatus() {
    // Skip if already checked
    if (this._isAdmin !== null) return;

    try {
      // Attempt to list pending shared content (admin-only operation)
      await this.socketClient.adminListPendingShared();
      // If successful, user is an admin
      this._isAdmin = true;
      this.render(false);
    } catch (error) {
      // If fails, user is not an admin
      this._isAdmin = false;
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
    const html = $(this.element);
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

    const html = $(this.element);
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

    // Keep pdfId as string - Elixir uses UUIDs, Node.js uses integers
    const pdfId = event.currentTarget.dataset.pdfId;
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
   * Handle PDF share button click.
   * Opens a dialog to submit the PDF to the shared library for admin review.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onSharePDF(event) {
    event.preventDefault();

    const pdfId = event.currentTarget.dataset.pdfId;
    const pdfName = event.currentTarget.dataset.pdfName;
    const shareButton = event.currentTarget;

    // Escape user-provided strings to prevent XSS
    const escapedName = foundry.utils.escapeHtml(pdfName);

    // Create submission dialog
    new Dialog({
      title: 'Share to Library',
      content: `
        <form class="share-dialog-form">
          <div class="form-group">
            <label for="share-title">Title</label>
            <input type="text" id="share-title" name="title" value="${escapedName}" readonly style="background: #f5f5f5;">
          </div>
          <div class="form-group">
            <label for="share-publisher">Publisher (optional)</label>
            <input type="text" id="share-publisher" name="publisher" placeholder="Your name or organization">
          </div>
          <div class="form-group">
            <label for="share-description">Description (optional)</label>
            <textarea id="share-description" name="description" rows="4" placeholder="Briefly describe this content..."></textarea>
          </div>
        </form>
        <style>
          .share-dialog-form .form-group {
            margin-bottom: 12px;
          }
          .share-dialog-form label {
            display: block;
            margin-bottom: 4px;
            font-weight: bold;
          }
          .share-dialog-form input[type="text"],
          .share-dialog-form textarea {
            width: 100%;
            padding: 6px;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-sizing: border-box;
          }
          .share-dialog-form textarea {
            resize: vertical;
            font-family: inherit;
          }
        </style>
      `,
      buttons: {
        submit: {
          icon: '<i class="fas fa-share-alt"></i>',
          label: 'Submit for Review',
          callback: async (html) => {
            const publisher = html.find('#share-publisher').val().trim() || null;
            const description = html.find('#share-description').val().trim() || null;

            try {
              await this.socketClient.submitToSharedLibrary('pdf', pdfId, publisher, description);
              ui.notifications.info('Submitted for review');

              // Disable the share button and show pending status
              shareButton.disabled = true;
              shareButton.title = 'Pending Review';
              shareButton.style.opacity = '0.5';

            } catch (error) {
              console.error(`${MODULE_ID} | Share submission failed:`, error);

              // Check for specific error messages
              if (error.message && error.message.includes('already exists')) {
                ui.notifications.warn('Content already exists in the shared library');
              } else {
                ui.notifications.error(`Failed to submit: ${error.message}`);
              }
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'submit'
    }).render(true);
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
   * Check RAG availability and update the embeddings button accordingly.
   * Disables/hides the button if RAG is not available for the current user's tier
   * or deployment mode.
   *
   * @private
   */
  async _checkRagAvailability() {
    try {
      const ragStatus = await this.socketClient.getRagStatus();
      this._ragAvailable = ragStatus.ragAvailable;

      const html = $(this.element);
      const btn = html.find('.generate-embeddings-btn');

      if (!ragStatus.ragAvailable) {
        btn.prop('disabled', true);
        btn.css('opacity', '0.5');

        // Set tooltip based on reason
        if (ragStatus.deploymentMode !== 'hosted') {
          btn.attr('title', game.i18n.localize('LOREMASTER.ContentManager.RAGNotAvailableSelfHosted') || 'RAG not available in self-hosted mode');
        } else {
          const requiredTier = ragStatus.ragRequiredTier || 'Pro';
          btn.attr('title', game.i18n.format('LOREMASTER.ContentManager.RAGRequiresTier', { tier: requiredTier }) || `RAG requires ${requiredTier} tier`);
        }

        console.log(`${MODULE_ID} | RAG not available: deploymentMode=${ragStatus.deploymentMode}, userTier=${ragStatus.userTier}`);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to check RAG status:`, error);
      // On error, leave button enabled (fail open for UX)
    }
  }

  /**
   * Handle Generate Embeddings button click.
   * Rechunks PDFs and generates embeddings for all content.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onGenerateEmbeddings(event) {
    event.preventDefault();

    // Check if RAG is available before proceeding
    if (this._ragAvailable === false) {
      ui.notifications.warn(game.i18n.localize('LOREMASTER.ContentManager.RAGNotAvailable') || 'RAG is not available for your current tier');
      return;
    }

    // Disable button during operation
    const html = $(this.element);
    const btn = html.find('.generate-embeddings-btn');
    btn.prop('disabled', true);
    btn.find('i').removeClass('fa-brain').addClass('fa-spinner fa-spin');

    try {
      // Show progress bar
      progressBar.show('embeddings', 'Generating embeddings...', 'fa-brain');

      const result = await this.socketClient.generateEmbeddings((stage, progress, message) => {
        progressBar.update('embeddings', progress, message);
      });

      // Build success message
      if (result.totalProcessed > 0) {
        progressBar.complete('embeddings', `Generated ${result.totalProcessed} embeddings`);
        ui.notifications.info(game.i18n.format('LOREMASTER.ContentManager.EmbeddingsSuccess', {
          count: result.totalProcessed
        }));
      } else {
        progressBar.complete('embeddings', 'All content already embedded');
        ui.notifications.info(game.i18n.localize('LOREMASTER.ContentManager.EmbeddingsNothingToDo'));
      }

      // Show warning if some PDFs need re-upload
      if (result.needsReupload?.length > 0) {
        ui.notifications.warn(game.i18n.format('LOREMASTER.ContentManager.EmbeddingsNeedsReupload', {
          count: result.needsReupload.length
        }));
      }

      // Refresh PDF list
      await this._loadPDFs();

    } catch (error) {
      console.error(`${MODULE_ID} | Generate embeddings failed:`, error);
      progressBar.error('embeddings', 'Embedding generation failed');
      ui.notifications.error(game.i18n.format('LOREMASTER.ContentManager.EmbeddingsError', {
        error: error.message
      }));
    } finally {
      // Re-enable button
      btn.prop('disabled', false);
      btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-brain');
    }
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
    const html = $(this.element);
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
    const html = $(this.element);
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
    const html = $(this.element);
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

    // Keep pdfId as string - Elixir uses UUIDs, Node.js uses integers
    const pdfId = event.currentTarget.dataset.pdfId;
    const pdfName = event.currentTarget.dataset.pdfName;
    const hasExisting = event.currentTarget.dataset.hasScript === 'true';

    // Show confirmation dialog with explanation
    const confirmed = await this._showGMPrepDialog(pdfName, hasExisting);
    if (!confirmed) return;

    try {
      // Show progress bar
      progressBar.show('gm-prep', `Generating GM Prep: ${pdfName}`, 'fa-scroll');

      // Generate script with progress callback
      const result = await this.socketClient.generateGMPrep(
        pdfId,
        pdfName,
        hasExisting, // overwrite if existing
        (stage, progress, message) => {
          progressBar.update('gm-prep', progress, message);
        }
      );

      // Create/update journal entry with the script
      await this._createGMPrepJournal(result.adventureName, result.scriptContent, result.scriptId);

      // Complete the progress bar
      progressBar.complete('gm-prep', 'GM Prep script created!');

      ui.notifications.info(game.i18n.format('LOREMASTER.GMPrep.Success', { name: pdfName }));

      // Reload PDFs to update the GM Script status tag
      await this._loadPDFs();

    } catch (error) {
      console.error(`${MODULE_ID} | GM Prep generation failed:`, error);
      progressBar.error('gm-prep', 'GM Prep generation failed');
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
    // First, escape HTML special chars in the raw markdown (before any conversion)
    let html = markdown
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Handle tables - must be done before line break conversion
    html = this._convertMarkdownTables(html);

    html = html
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
      // Line breaks (but not inside tables)
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

    return `<div class="gm-prep-script">${html}</div>`;
  }

  /**
   * Convert markdown tables to HTML tables.
   * Must be called before line breaks are converted.
   *
   * @param {string} markdown - The markdown content.
   * @returns {string} Content with tables converted to HTML.
   * @private
   */
  _convertMarkdownTables(markdown) {
    const lines = markdown.split('\n');
    const result = [];
    let inTable = false;
    let tableRows = [];
    let headerRow = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if this line is a table row (starts and ends with |)
      if (line.startsWith('|') && line.endsWith('|')) {
        // Extract cells
        const cells = line.slice(1, -1).split('|').map(cell => cell.trim());

        // Check if this is a separator row (all cells are dashes)
        const isSeparator = cells.every(cell => /^[-:]+$/.test(cell));

        if (isSeparator) {
          // This is the separator row, mark that header is complete
          if (!inTable && tableRows.length > 0) {
            headerRow = tableRows.pop();
            inTable = true;
          }
          continue; // Skip separator row
        }

        if (!inTable) {
          // This might be a header row
          tableRows.push(cells);
        } else {
          // This is a data row
          tableRows.push(cells);
        }
      } else {
        // Not a table row - flush any pending table
        if (tableRows.length > 0 || headerRow) {
          result.push(this._buildHtmlTable(headerRow, tableRows));
          tableRows = [];
          headerRow = null;
          inTable = false;
        }
        result.push(line);
      }
    }

    // Flush any remaining table
    if (tableRows.length > 0 || headerRow) {
      result.push(this._buildHtmlTable(headerRow, tableRows));
    }

    return result.join('\n');
  }

  /**
   * Build an HTML table from parsed rows.
   *
   * @param {Array|null} headerRow - The header row cells.
   * @param {Array} dataRows - Array of data row cell arrays.
   * @returns {string} HTML table string.
   * @private
   */
  _buildHtmlTable(headerRow, dataRows) {
    let html = '<table class="gm-prep-table">';

    // Add header if present
    if (headerRow && headerRow.length > 0) {
      html += '<thead><tr>';
      for (const cell of headerRow) {
        html += `<th>${cell}</th>`;
      }
      html += '</tr></thead>';
    }

    // Add body rows
    if (dataRows.length > 0) {
      html += '<tbody>';
      for (const row of dataRows) {
        html += '<tr>';
        for (const cell of row) {
          html += `<td>${cell}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody>';
    }

    html += '</table>';
    return html;
  }

  // ===== Active Adventure Methods =====

  /**
   * Load active adventure data from the server.
   * Fetches current adventure, available adventures, transition state, and shared adventures.
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

      // Filter shared adventures from activated shared content
      // Only include adventure and adventure_supplement categories
      this.sharedAdventures = this.activatedSharedContent.filter(item =>
        item.category === 'adventure' || item.category === 'adventure_supplement'
      );

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

    // Parse selection value (format: "pdf:uuid", "module:module-id", or "shared:id")
    const [type, id] = value.split(':');
    const adventureType = type;
    // Keep ID as string - Elixir uses UUIDs, Node.js uses integers
    // Both work as strings since string comparison works for both
    const adventureId = id;

    // Find the adventure name and GM script info
    let adventureName = '';
    let gmPrepScriptId = null;
    let pdfId = null;
    if (adventureType === 'pdf') {
      const pdf = this.availableAdventures.pdfAdventures.find(p => p.id === adventureId);
      adventureName = pdf?.display_name || 'Unknown Adventure';
      gmPrepScriptId = pdf?.gmPrepScriptId || null;
      pdfId = pdf?.id;

      // If no GM script exists for this PDF adventure, prompt to generate one
      if (!gmPrepScriptId && pdfId) {
        const generateScript = await this._promptGenerateGMScript(adventureName);
        if (generateScript === 'generate') {
          // Generate the script first
          try {
            progressBar.show('gm-prep', `Generating GM Prep: ${adventureName}`, 'fa-scroll');

            const result = await this.socketClient.generateGMPrep(
              pdfId,
              adventureName,
              false, // not overwriting
              (stage, progress, message) => {
                progressBar.update('gm-prep', progress, message);
              }
            );

            // Create journal entry
            await this._createGMPrepJournal(result.adventureName, result.scriptContent, result.scriptId);

            progressBar.complete('gm-prep', 'GM Prep script created!');

            // Update the script ID
            gmPrepScriptId = result.scriptId;

            // Reload PDFs to update list
            await this._loadPDFs();
          } catch (error) {
            console.error(`${MODULE_ID} | GM Prep generation failed:`, error);
            progressBar.error('gm-prep', 'GM Prep generation failed');
            ui.notifications.error(game.i18n.format('LOREMASTER.GMPrep.Error', { error: error.message }));
            this.render(false);
            return;
          }
        } else if (generateScript === 'cancel') {
          // User cancelled, reset selector
          this.render(false);
          return;
        }
        // If 'skip', continue without a script
      } else if (gmPrepScriptId && pdfId) {
        // Script exists - ask if user wants to regenerate it
        const regenerateChoice = await this._promptRegenerateGMScript(adventureName);
        if (regenerateChoice === 'regenerate') {
          // Regenerate the script with overwrite
          try {
            progressBar.show('gm-prep', `Regenerating GM Prep: ${adventureName}`, 'fa-scroll');

            const result = await this.socketClient.generateGMPrep(
              pdfId,
              adventureName,
              true, // overwrite existing
              (stage, progress, message) => {
                progressBar.update('gm-prep', progress, message);
              }
            );

            // Update journal entry
            await this._createGMPrepJournal(result.adventureName, result.scriptContent, result.scriptId);

            progressBar.complete('gm-prep', 'GM Prep script regenerated!');

            // Update the script ID
            gmPrepScriptId = result.scriptId;

            // Reload PDFs to update list
            await this._loadPDFs();
          } catch (error) {
            console.error(`${MODULE_ID} | GM Prep regeneration failed:`, error);
            progressBar.error('gm-prep', 'GM Prep regeneration failed');
            ui.notifications.error(game.i18n.format('LOREMASTER.GMPrep.Error', { error: error.message }));
            this.render(false);
            return;
          }
        } else if (regenerateChoice === 'cancel') {
          // User cancelled, reset selector
          this.render(false);
          return;
        }
        // If 'keep', continue with existing script
      }
    } else if (adventureType === 'shared') {
      // Shared adventures don't have GM Prep scripts
      const sharedAdventure = this.sharedAdventures.find(s => String(s.id) === adventureId);
      adventureName = sharedAdventure?.title || 'Unknown Shared Adventure';
      gmPrepScriptId = null; // Shared adventures don't have GM Prep scripts
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
        // Show cast selection dialog if we have a GM Prep script
        if (gmPrepScriptId) {
          const proceed = await showCastSelectionIfNeeded(
            this.socketClient,
            gmPrepScriptId,
            adventureName
          );

          if (!proceed) {
            // User cancelled cast selection
            this.render(false);
            return;
          }
        }

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
        await this._loadCastData();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to set adventure:`, error);
        ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.SwitchError', {
          error: error.message
        }));
      }
    } else {
      // No existing adventure, just set it
      try {
        // Show cast selection dialog if we have a GM Prep script
        if (gmPrepScriptId) {
          const proceed = await showCastSelectionIfNeeded(
            this.socketClient,
            gmPrepScriptId,
            adventureName
          );

          if (!proceed) {
            // User cancelled cast selection
            this.render(false);
            return;
          }
        }

        await this.socketClient.setActiveAdventure(adventureType, adventureId, {
          adventureName,
          gmPrepScriptId
        });

        ui.notifications.info(game.i18n.format('LOREMASTER.ActiveAdventure.SetSuccess', {
          name: adventureName
        }));

        await this._loadAdventureData();
        await this._loadCastData();
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to set adventure:`, error);
        ui.notifications.error(game.i18n.format('LOREMASTER.ActiveAdventure.SetError', {
          error: error.message
        }));
      }
    }
  }

  /**
   * Prompt user to generate a GM script for an adventure without one.
   *
   * @param {string} adventureName - The adventure name.
   * @returns {Promise<string>} 'generate', 'skip', or 'cancel'.
   * @private
   */
  async _promptGenerateGMScript(adventureName) {
    return new Promise((resolve) => {
      new Dialog({
        title: game.i18n.localize('LOREMASTER.ActiveAdventure.NoScriptTitle'),
        content: `
          <div class="no-script-dialog">
            <p>${game.i18n.format('LOREMASTER.ActiveAdventure.NoScriptMessage', { name: adventureName })}</p>
            <p class="hint">${game.i18n.localize('LOREMASTER.ActiveAdventure.NoScriptHint')}</p>
          </div>
        `,
        buttons: {
          generate: {
            icon: '<i class="fas fa-scroll"></i>',
            label: game.i18n.localize('LOREMASTER.ActiveAdventure.GenerateScript'),
            callback: () => resolve('generate')
          },
          skip: {
            icon: '<i class="fas fa-forward"></i>',
            label: game.i18n.localize('LOREMASTER.ActiveAdventure.SkipScript'),
            callback: () => resolve('skip')
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('LOREMASTER.Private.Cancel'),
            callback: () => resolve('cancel')
          }
        },
        default: 'generate',
        close: () => resolve('cancel')
      }).render(true);
    });
  }

  /**
   * Show prompt when a GM Prep script already exists.
   * Lets GM choose to keep existing, regenerate, or cancel.
   *
   * @param {string} adventureName - The adventure name.
   * @returns {Promise<string>} 'keep', 'regenerate', or 'cancel'.
   * @private
   */
  async _promptRegenerateGMScript(adventureName) {
    return new Promise((resolve) => {
      new Dialog({
        title: game.i18n.localize('LOREMASTER.ActiveAdventure.ScriptExistsTitle') || 'GM Prep Script Exists',
        content: `
          <div class="script-exists-dialog">
            <p>${game.i18n.format('LOREMASTER.ActiveAdventure.ScriptExistsMessage', { name: adventureName }) || `A GM Prep script already exists for "${adventureName}".`}</p>
            <p class="hint">${game.i18n.localize('LOREMASTER.ActiveAdventure.ScriptExistsHint') || 'You can keep the existing script or regenerate it from the PDF.'}</p>
          </div>
        `,
        buttons: {
          keep: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize('LOREMASTER.ActiveAdventure.KeepScript') || 'Keep Existing',
            callback: () => resolve('keep')
          },
          regenerate: {
            icon: '<i class="fas fa-sync"></i>',
            label: game.i18n.localize('LOREMASTER.ActiveAdventure.RegenerateScript') || 'Regenerate',
            callback: () => resolve('regenerate')
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('LOREMASTER.Private.Cancel'),
            callback: () => resolve('cancel')
          }
        },
        default: 'keep',
        close: () => resolve('cancel')
      }).render(true);
    });
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
    const html = $(this.element);
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

    const html = $(this.element);
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

  // ===== History Tab Methods =====

  /**
   * Load conversation history data from the server.
   * Fetches active conversation and compacted conversations.
   *
   * @private
   */
  async _loadHistoryData() {
    try {
      // Get all conversations to separate active from compacted
      const result = await this.socketClient.listConversations();
      const conversations = result.conversations || [];

      // Find the active conversation (status !== 'compacted')
      this.activeConversation = conversations.find(c => c.status !== 'compacted') || null;

      // Get compacted conversations
      this.compactedConversations = conversations.filter(c => c.status === 'compacted');

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load history data:`, error);
    }
  }

  /**
   * Handle Compact & Archive button click.
   * Shows confirmation dialog and triggers conversation compaction.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onCompactConversation(event) {
    event.preventDefault();

    if (!this.activeConversation || this.isCompacting) return;

    const conversationId = this.activeConversation.id;
    const conversationTitle = this.activeConversation.title || game.i18n.localize('LOREMASTER.ConversationManager.Untitled');

    // Confirm compaction
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.History.CompactBtn'),
      content: `<p>${game.i18n.localize('LOREMASTER.History.CompactConfirm')}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    try {
      this.isCompacting = true;
      this.render(false);

      // Show progress notification
      ui.notifications.info(game.i18n.localize('LOREMASTER.History.Compacting'));

      // Perform compaction
      const result = await this.socketClient.compactConversation(conversationId);

      ui.notifications.info(game.i18n.localize('LOREMASTER.History.CompactSuccess'));

      // Reload history data
      await this._loadHistoryData();

    } catch (error) {
      console.error(`${MODULE_ID} | Compaction failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.History.CompactError', {
        error: error.message
      }));
    } finally {
      this.isCompacting = false;
      this.render(false);
    }
  }

  /**
   * Handle View Summary button click.
   * Shows a dialog with the conversation summary.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onViewSummary(event) {
    event.preventDefault();

    const conversationId = event.currentTarget.dataset.conversationId;
    const conversationTitle = event.currentTarget.dataset.conversationTitle || game.i18n.localize('LOREMASTER.ConversationManager.Untitled');

    try {
      const result = await this.socketClient.getConversationSummary(conversationId);

      if (!result.summary) {
        ui.notifications.warn('No summary available');
        return;
      }

      // Show summary in a dialog
      new Dialog({
        title: game.i18n.localize('LOREMASTER.History.SummaryDialogTitle'),
        content: `
          <div class="conversation-summary-dialog">
            <h3>${conversationTitle}</h3>
            <div class="summary-meta">
              <span class="archived-date">
                <i class="fas fa-archive"></i>
                ${game.i18n.localize('LOREMASTER.History.ArchivedOn')}: ${this._formatDate(result.compactedAt)}
              </span>
              ${result.summaryTokens ? `<span class="token-count">${result.summaryTokens} tokens</span>` : ''}
            </div>
            <div class="summary-content">
              ${this._markdownToHtml(result.summary)}
            </div>
          </div>
        `,
        buttons: {
          continue: {
            icon: '<i class="fas fa-play"></i>',
            label: game.i18n.localize('LOREMASTER.History.ContinueAdventure'),
            callback: () => this._continueFromConversation(conversationId, conversationTitle)
          },
          close: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('Close')
          }
        },
        default: 'close'
      }, {
        width: 600,
        height: 500,
        classes: ['loremaster', 'summary-dialog']
      }).render(true);

    } catch (error) {
      console.error(`${MODULE_ID} | Failed to get summary:`, error);
      ui.notifications.error(`Failed to load summary: ${error.message}`);
    }
  }

  /**
   * Handle Continue Adventure button click.
   * Creates a new conversation from a compacted one.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onContinueAdventure(event) {
    event.preventDefault();

    const conversationId = event.currentTarget.dataset.conversationId;
    const conversationTitle = event.currentTarget.dataset.conversationTitle;

    await this._continueFromConversation(conversationId, conversationTitle);
  }

  /**
   * Continue adventure from a compacted conversation.
   * Creates a new conversation with inherited summary context.
   *
   * @param {string} conversationId - The compacted conversation ID.
   * @param {string} previousTitle - The previous conversation title.
   * @private
   */
  async _continueFromConversation(conversationId, previousTitle) {
    try {
      ui.notifications.info(game.i18n.localize('LOREMASTER.History.NewFromSummary'));

      // Generate a new title based on the old one
      const newTitle = `${previousTitle || 'Adventure'} (Continued)`;

      const result = await this.socketClient.createConversationFromSummary(conversationId, newTitle);

      ui.notifications.info(game.i18n.localize('LOREMASTER.History.ContinueSuccess'));

      // Reload history data
      await this._loadHistoryData();

    } catch (error) {
      console.error(`${MODULE_ID} | Failed to continue adventure:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.History.ContinueError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle refresh history button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRefreshHistory(event) {
    event.preventDefault();
    await this._loadHistoryData();
  }

  /**
   * Format a date string for display.
   *
   * @param {string} dateStr - ISO date string.
   * @returns {string} Formatted date.
   * @private
   */
  _formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // ===== Cast Management Methods =====

  /**
   * Get list of game players for assignment dropdown.
   *
   * @returns {Array} Array of player objects with id, name, isGM.
   * @private
   */
  _getGamePlayers() {
    return game.users.contents.map(user => ({
      id: user.id,
      name: user.name,
      isGM: user.isGM
    }));
  }

  /**
   * Load cast data from the server.
   * Uses the active adventure's GM Prep script ID if available.
   *
   * @private
   */
  async _loadCastData() {
    try {
      // Get script ID from active adventure
      if (this.activeAdventure?.gm_prep_script_id) {
        this.castScriptId = this.activeAdventure.gm_prep_script_id;

        // Fetch characters for this script
        const result = await this.socketClient.getCharacters(this.castScriptId);
        this.castCharacters = result.characters || [];
        this.castDirty = false;

        console.log(`${MODULE_ID} | Loaded ${this.castCharacters.length} characters for script ${this.castScriptId}`);
      } else {
        this.castScriptId = null;
        this.castCharacters = [];
      }

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load cast data:`, error);
    }
  }

  /**
   * Handle extract characters from script button click.
   * Parses the GM Prep script and extracts character information.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onExtractCharacters(event) {
    event.preventDefault();

    if (!this.castScriptId) {
      ui.notifications.warn(game.i18n.localize('LOREMASTER.Cast.NoActiveAdventure'));
      return;
    }

    try {
      ui.notifications.info(game.i18n.localize('LOREMASTER.Cast.Extracting'));

      const result = await this.socketClient.extractCharactersFromScript(this.castScriptId);

      if (result.success) {
        ui.notifications.info(game.i18n.format('LOREMASTER.Cast.ExtractSuccess', {
          count: result.characters?.length || 0
        }));

        // Reload cast data
        await this._loadCastData();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Character extraction failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Cast.ExtractError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle save cast assignments button click.
   * Saves all character assignments to the server.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onSaveCast(event) {
    event.preventDefault();

    if (!this.castScriptId || this.castCharacters.length === 0) {
      return;
    }

    try {
      // Prepare characters with world ID
      const charactersToSave = this.castCharacters.map(char => ({
        ...char,
        worldId: game.world.id
      }));

      const result = await this.socketClient.bulkUpdateCharacters(this.castScriptId, charactersToSave);

      if (result.success) {
        this.castDirty = false;
        ui.notifications.info(game.i18n.localize('LOREMASTER.Cast.SaveSuccess'));
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to save cast:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Cast.SaveError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle player assignment dropdown change.
   *
   * @param {Event} event - The change event.
   * @private
   */
  _onPlayerAssignmentChange(event) {
    const characterName = event.target.dataset.character;
    const userId = event.target.value;

    // Find the user name
    const user = userId ? game.users.get(userId) : null;
    const userName = user?.name || null;

    // Update local character data
    const character = this.castCharacters.find(c => c.characterName === characterName);
    if (character) {
      character.assignedToUserId = userId || null;
      character.assignedToUserName = userName;
      this.castDirty = true;
    }
  }

  /**
   * Handle GM/AI control checkbox change.
   *
   * @param {Event} event - The change event.
   * @private
   */
  _onControlCheckboxChange(event) {
    const characterName = event.target.dataset.character;
    const isGMControl = event.target.classList.contains('gm-control-checkbox');
    const isAIControl = event.target.classList.contains('ai-control-checkbox');
    const checked = event.target.checked;

    // Update local character data
    const character = this.castCharacters.find(c => c.characterName === characterName);
    if (character) {
      if (isGMControl) {
        character.isGMControlled = checked;
        // If GM controls, uncheck AI control
        if (checked) {
          character.isLoremasterControlled = false;
          // Update the UI - use filter() to handle special characters in names
          const html = $(this.element);
          html.find('.ai-control-checkbox').filter(function() {
            return this.dataset.character === characterName;
          }).prop('checked', false);
        }
      }
      if (isAIControl) {
        character.isLoremasterControlled = checked;
        // If AI controls, uncheck GM control
        if (checked) {
          character.isGMControlled = false;
          // Update the UI - use filter() to handle special characters in names
          const html = $(this.element);
          html.find('.gm-control-checkbox').filter(function() {
            return this.dataset.character === characterName;
          }).prop('checked', false);
        }
      }
      this.castDirty = true;
    }
  }

  // ===== Foundry Module Import Methods =====

  /**
   * Load available Foundry modules from the server.
   * Fetches modules discovered by the server and their import status.
   *
   * @private
   */
  async _loadFoundryModules() {
    try {
      console.log(`${MODULE_ID} | Loading Foundry modules...`);
      const result = await this.socketClient.discoverFoundryModules();
      console.log(`${MODULE_ID} | discoverFoundryModules result:`, result);

      if (result.available) {
        this.foundryModulesAvailable = true;
        this.foundryModules = result.modules || [];
        console.log(`${MODULE_ID} | Found ${this.foundryModules.length} modules available for import`);
      } else {
        this.foundryModulesAvailable = false;
        this.foundryModules = [];
        console.log(`${MODULE_ID} | No modules available (result.available is false)`);
      }

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load Foundry modules:`, error);
      this.foundryModulesAvailable = false;
      this.foundryModules = [];
      // Still render to show error state
      this.render(false);
    }
  }

  /**
   * Handle import module button click.
   * Imports a Foundry module's content for RAG retrieval.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onImportModule(event) {
    event.preventDefault();

    const moduleId = event.currentTarget.dataset.moduleId;
    const moduleName = event.currentTarget.dataset.moduleName;

    if (!moduleId || this.isImportingModule) return;

    try {
      this.isImportingModule = true;
      this._updateModuleImportUI(true);

      // Show progress bar
      progressBar.show('module-import', `Importing ${moduleName}...`, 'fa-cube');

      // Import module with progress callback
      const result = await this.socketClient.importFoundryModule(
        moduleId,
        (stage, progress, message) => {
          this.moduleImportProgress = { progress, message };
          progressBar.update('module-import', progress, message);
        }
      );

      // Complete progress bar
      progressBar.complete('module-import', `Imported ${result.chunkCount} chunks`);

      ui.notifications.info(game.i18n.format('LOREMASTER.ModuleImport.Success', {
        name: moduleName,
        chunks: result.chunkCount
      }));

      // Reload modules list
      await this._loadFoundryModules();

    } catch (error) {
      console.error(`${MODULE_ID} | Module import failed:`, error);
      progressBar.error('module-import', 'Import failed');
      ui.notifications.error(game.i18n.format('LOREMASTER.ModuleImport.Error', {
        error: error.message
      }));
    } finally {
      this.isImportingModule = false;
      this._updateModuleImportUI(false);
    }
  }

  /**
   * Handle delete module button click.
   * Removes imported content for a module.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onDeleteModule(event) {
    event.preventDefault();

    const moduleId = event.currentTarget.dataset.moduleId;
    const moduleName = event.currentTarget.dataset.moduleName;

    // Confirm deletion
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.ModuleImport.DeleteTitle'),
      content: game.i18n.format('LOREMASTER.ModuleImport.DeleteConfirm', { name: moduleName }),
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.deleteModuleContent(moduleId);
      ui.notifications.info(game.i18n.format('LOREMASTER.ModuleImport.DeleteSuccess', { name: moduleName }));
      await this._loadFoundryModules();
    } catch (error) {
      console.error(`${MODULE_ID} | Delete module content failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ModuleImport.DeleteError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle refresh modules button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRefreshModules(event) {
    event.preventDefault();
    await this._loadFoundryModules();
  }

  /**
   * Update module import UI state.
   *
   * @param {boolean} importing - Whether import is in progress.
   * @private
   */
  _updateModuleImportUI(importing) {
    const html = $(this.element);
    html.find('.import-module-btn').prop('disabled', importing);
    html.find('.module-import-progress').toggleClass('hidden', !importing);
  }

  // ========================================
  // Backup Tab Methods
  // ========================================

  /**
   * Load backup preview data from the server.
   * Fetches counts of exportable data for the current world.
   *
   * @private
   */
  async _loadBackupData() {
    if (!game.user.isGM) return;

    try {
      this.backupPreview = await this.socketClient.getBackupPreview();

      // In hosted mode, also load saved backups list
      if (isHostedMode()) {
        try {
          const result = await this.socketClient.listBackups();
          this.savedBackups = result.backups || [];
        } catch (err) {
          console.error(`${MODULE_ID} | Failed to load saved backups:`, err);
          this.savedBackups = [];
        }
      }

      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load backup preview:`, error);
      this.backupPreview = null;
    }
  }

  /**
   * Handle create backup button click.
   * Creates a world state backup and downloads it as a JSON file.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onCreateBackup(event) {
    event.preventDefault();

    if (this.isBackingUp) return;

    const nameInput = this.element.find('.backup-name-input');
    const backupName = nameInput.val() || `${game.world?.title || 'World'} Backup`;

    this.isBackingUp = true;
    this.backupProgress = { stage: 'starting', progress: 0, message: 'Gathering world data...' };
    this.render();

    try {
      const result = await this.socketClient.createBackup(backupName, {}, (stage, progress, message) => {
        this.backupProgress = { stage, progress, message };
        this._updateBackupProgressUI();
      });

      // In hosted mode, backup is saved to server - just refresh the list
      // In self-hosted mode, download the backup file (result.backup contains data)
      if (isHostedMode()) {
        // Refresh the saved backups list
        const listResult = await this.socketClient.listBackups();
        this.savedBackups = listResult.backups || [];
      } else if (result.backup && result.backup.data) {
        // Self-hosted: download the backup file
        this._downloadBackup(result.backup, backupName);
      }

      ui.notifications.info(game.i18n.localize('LOREMASTER.Backup.CreateSuccess'));
    } catch (error) {
      console.error(`${MODULE_ID} | Backup creation failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Backup.CreateError', {
        error: error.message
      }));
    } finally {
      this.isBackingUp = false;
      this.backupProgress = { stage: '', progress: 0, message: '' };
      this.render();
    }
  }

  /**
   * Download backup data as a JSON file.
   *
   * @param {object} backup - The backup data object.
   * @param {string} name - The backup name for the filename.
   * @private
   */
  _downloadBackup(backup, name) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Sanitize filename: replace non-alphanumeric chars with underscores
    a.download = `${name.replace(/[^a-z0-9]/gi, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Handle backup drop zone dragover event.
   *
   * @param {DragEvent} event - The dragover event.
   * @private
   */
  _onBackupDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('dragover');
  }

  /**
   * Handle backup drop zone dragleave event.
   *
   * @param {DragEvent} event - The dragleave event.
   * @private
   */
  _onBackupDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');
  }

  /**
   * Handle backup file drop event.
   *
   * @param {DragEvent} event - The drop event.
   * @private
   */
  async _onBackupDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');

    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await this._processBackupFile(file);
    }
  }

  /**
   * Handle backup file input selection.
   *
   * @param {Event} event - The change event.
   * @private
   */
  async _onBackupFileSelect(event) {
    const file = event.target.files?.[0];
    if (file) {
      await this._processBackupFile(file);
    }
    // Reset the input so the same file can be selected again
    event.target.value = '';
  }

  /**
   * Process a selected backup file for import.
   * Parses and validates the JSON, then shows import preview.
   *
   * @param {File} file - The backup file to process.
   * @private
   */
  async _processBackupFile(file) {
    if (!file.name.endsWith('.json')) {
      ui.notifications.error(game.i18n.localize('LOREMASTER.Backup.InvalidFileType'));
      return;
    }

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      // Validate the backup
      const validation = await this.socketClient.validateBackup(backup);
      if (!validation.valid) {
        ui.notifications.error(game.i18n.format('LOREMASTER.Backup.ValidationError', {
          errors: validation.errors.join(', ')
        }));
        return;
      }

      // Store pending import and show preview
      this.pendingImport = backup;
      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to read backup file:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Backup.ReadError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle confirm import button click.
   * Imports the pending backup into the current world.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onConfirmImport(event) {
    event.preventDefault();

    if (!this.pendingImport || this.isImportingBackup) return;

    const overwrite = this.element.find('input[name="overwrite"]').is(':checked');
    const merge = this.element.find('input[name="merge"]').is(':checked');

    this.isImportingBackup = true;
    this.importProgress = { stage: 'starting', progress: 0, message: 'Starting import...' };
    this.render();

    try {
      const result = await this.socketClient.importBackup(
        this.pendingImport,
        { overwrite, merge },
        (stage, progress, message) => {
          this.importProgress = { stage, progress, message };
          this._updateImportProgressUI();
        }
      );

      ui.notifications.info(game.i18n.format('LOREMASTER.Backup.ImportSuccess', {
        count: result.imported?.total || 0
      }));

      // Clear pending import and refresh all data
      this.pendingImport = null;
      await this._loadBackupData();
      await this._loadAdventureData();
      await this._loadCastData();
      await this._loadHistoryData();
    } catch (error) {
      console.error(`${MODULE_ID} | Backup import failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Backup.ImportError', {
        error: error.message
      }));
    } finally {
      this.isImportingBackup = false;
      this.importProgress = { stage: '', progress: 0, message: '' };
      this.render();
    }
  }

  /**
   * Handle cancel import button click.
   * Clears the pending import preview.
   *
   * @param {Event} event - The click event.
   * @private
   */
  _onCancelImport(event) {
    event.preventDefault();
    this.pendingImport = null;
    this.render();
  }

  /**
   * Update the backup progress UI without full re-render.
   *
   * @private
   */
  _updateBackupProgressUI() {
    const html = $(this.element);
    const progressBar = html.find('.backup-progress-bar');
    const progressText = html.find('.backup-progress-text');

    progressBar.css('width', `${this.backupProgress.progress}%`);
    progressText.text(this.backupProgress.message);
  }

  /**
   * Update the import progress UI without full re-render.
   *
   * @private
   */
  _updateImportProgressUI() {
    const html = $(this.element);
    const progressBar = html.find('.import-progress-bar');
    const progressText = html.find('.import-progress-text');

    progressBar.css('width', `${this.importProgress.progress}%`);
    progressText.text(this.importProgress.message);
  }

  // ========================================
  // Saved Backups Methods (Hosted Mode)
  // ========================================

  /**
   * Handle restore saved backup button click.
   * Restores world data from a server-stored backup.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRestoreSavedBackup(event) {
    event.preventDefault();

    const button = $(event.currentTarget);
    const backupId = button.data('backup-id');
    const backupName = button.data('backup-name');

    if (!backupId) return;

    // Confirm restore
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.Backup.RestoreBackup'),
      content: `<p>${game.i18n.localize('LOREMASTER.Backup.ConfirmRestore')}</p><p><strong>${backupName}</strong></p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      button.prop('disabled', true);
      const result = await this.socketClient.restoreFromBackup(backupId, {
        mergeStrategy: 'skip_existing'
      });

      ui.notifications.info(game.i18n.localize('LOREMASTER.Backup.RestoreSuccess'));

      // Refresh all data
      await this._loadBackupData();
      await this._loadAdventureData();
      await this._loadCastData();
      await this._loadHistoryData();
    } catch (error) {
      console.error(`${MODULE_ID} | Restore failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Backup.RestoreError', {
        error: error.message
      }));
    } finally {
      button.prop('disabled', false);
    }
  }

  /**
   * Handle delete saved backup button click.
   * Deletes a backup from the server.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onDeleteSavedBackup(event) {
    event.preventDefault();

    const button = $(event.currentTarget);
    const backupId = button.data('backup-id');
    const backupName = button.data('backup-name');

    if (!backupId) return;

    // Confirm delete
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.Backup.DeleteBackup'),
      content: `<p>${game.i18n.localize('LOREMASTER.Backup.ConfirmDelete')}</p><p><strong>${backupName}</strong></p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      button.prop('disabled', true);
      await this.socketClient.deleteBackup(backupId);

      ui.notifications.info(game.i18n.localize('LOREMASTER.Backup.DeleteSuccess'));

      // Refresh saved backups list
      const result = await this.socketClient.listBackups();
      this.savedBackups = result.backups || [];
      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Delete failed:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.Backup.DeleteError', {
        error: error.message
      }));
      button.prop('disabled', false);
    }
  }

  // ===== Shared Content Handlers =====

  /**
   * Handle browse shared library button click.
   * Opens a Foundry Dialog displaying all available shared content as cards.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onBrowseSharedLibrary(event) {
    event.preventDefault();

    // Build the dialog content
    const categories = [
      'core_rules',
      'rules_supplement',
      'adventure',
      'adventure_supplement',
      'reference'
    ];

    const categoryLabels = {
      core_rules: game.i18n.localize('LOREMASTER.ContentManager.Category.CoreRules'),
      rules_supplement: game.i18n.localize('LOREMASTER.ContentManager.Category.RulesSupplement'),
      adventure: game.i18n.localize('LOREMASTER.ContentManager.Category.Adventure'),
      adventure_supplement: game.i18n.localize('LOREMASTER.ContentManager.Category.AdventureSupplement'),
      reference: game.i18n.localize('LOREMASTER.ContentManager.Category.Reference')
    };

    const typeIcons = {
      pdf: 'fa-file-pdf',
      module: 'fa-cube'
    };

    // Build category filter buttons
    let filterButtons = '<div class="shared-category-filters">';
    filterButtons += '<button class="shared-category-filter active" data-category="all">All</button>';
    for (const cat of categories) {
      filterButtons += `<button class="shared-category-filter" data-category="${cat}">${categoryLabels[cat]}</button>`;
    }
    filterButtons += '</div>';

    // Tier status display (with null safety)
    const tierCurrent = this.sharedTier?.current ?? 0;
    const tierMax = this.sharedTier?.max ?? 0;
    const tierStatus = `<div class="shared-tier-status">
      <i class="fas fa-layer-group"></i>
      <span>${tierCurrent} / ${tierMax === -1 ? '∞' : tierMax} shared resources activated</span>
    </div>`;

    // Build card grid
    let cardGrid = '<div class="shared-library-grid">';

    if (this.sharedContent.length === 0) {
      cardGrid += '<div class="empty-state"><i class="fas fa-box-open"></i><p>No shared content available for this game system.</p></div>';
    } else {
      for (const item of this.sharedContent) {
        const isActivated = item.isActivated;
        const canActivate = !isActivated && (this.sharedTier.max === -1 || this.sharedTier.current < this.sharedTier.max);
        const rawDesc = item.description || 'No description provided.';
        const truncatedDesc = rawDesc.length > 120 ? rawDesc.substring(0, 120) + '...' : rawDesc;

        // Escape all user-provided strings to prevent XSS
        const esc = foundry.utils.escapeHtml;
        const safeTitle = esc(item.title);
        const safePublisher = esc(item.publisher || 'Unknown');
        const safeDesc = esc(truncatedDesc);
        const safeCategory = esc(item.category);
        const safeId = esc(String(item.id));

        cardGrid += `
          <div class="shared-content-card" data-category="${safeCategory}" data-shared-id="${safeId}">
            <div class="card-header">
              <i class="fas ${typeIcons[item.contentType] || 'fa-file'}"></i>
              <span class="category-badge">${categoryLabels[item.category] || safeCategory}</span>
            </div>
            <div class="card-body">
              <h4 class="card-title">${safeTitle}</h4>
              <p class="card-publisher">by ${safePublisher}</p>
              <p class="card-description">${safeDesc}</p>
            </div>
            <div class="card-footer">
              ${isActivated
                ? '<button class="deactivate-card-btn" data-shared-id="' + safeId + '"><i class="fas fa-times-circle"></i> Deactivate</button>'
                : canActivate
                  ? '<button class="activate-card-btn" data-shared-id="' + safeId + '"><i class="fas fa-plus-circle"></i> Activate</button>'
                  : '<button class="activate-card-btn" disabled title="Tier limit reached"><i class="fas fa-lock"></i> Tier Limit Reached</button>'
              }
            </div>
          </div>
        `;
      }
    }
    cardGrid += '</div>';

    const dialogContent = tierStatus + filterButtons + cardGrid;

    // Create the dialog
    const dialog = new Dialog({
      title: `Shared Library — ${game.system.title}`,
      content: dialogContent,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close'
        }
      },
      default: 'close',
      render: (html) => {
        // Category filter handlers
        html.find('.shared-category-filter').on('click', (e) => {
          const filterBtn = $(e.currentTarget);
          const category = filterBtn.data('category');

          // Update active filter button
          html.find('.shared-category-filter').removeClass('active');
          filterBtn.addClass('active');

          // Filter cards
          if (category === 'all') {
            html.find('.shared-content-card').show();
          } else {
            html.find('.shared-content-card').hide();
            html.find(`.shared-content-card[data-category="${category}"]`).show();
          }
        });

        // Activate button handlers
        html.find('.activate-card-btn').on('click', async (e) => {
          const btn = $(e.currentTarget);
          const sharedId = btn.data('shared-id');
          if (!sharedId) return;

          try {
            btn.prop('disabled', true);
            await this.socketClient.activateSharedContent(sharedId);
            ui.notifications.info('Shared content activated successfully.');

            // Refresh data and close dialog
            await this._loadSharedContentData();
            dialog.close();
          } catch (error) {
            console.error(`${MODULE_ID} | Failed to activate shared content:`, error);
            ui.notifications.error(`Failed to activate: ${error.message}`);
            btn.prop('disabled', false);
          }
        });

        // Deactivate button handlers
        html.find('.deactivate-card-btn').on('click', async (e) => {
          const btn = $(e.currentTarget);
          const sharedId = btn.data('shared-id');
          if (!sharedId) return;

          try {
            btn.prop('disabled', true);
            await this.socketClient.deactivateSharedContent(sharedId);
            ui.notifications.info('Shared content deactivated.');

            // Refresh data and close dialog
            await this._loadSharedContentData();
            dialog.close();
          } catch (error) {
            console.error(`${MODULE_ID} | Failed to deactivate shared content:`, error);
            ui.notifications.error(`Failed to deactivate: ${error.message}`);
            btn.prop('disabled', false);
          }
        });
      },
      close: () => {}
    }, {
      width: 800,
      height: 600,
      classes: ['loremaster', 'shared-library-dialog']
    });

    dialog.render(true);
  }

  /**
   * Handle deactivate shared content button click.
   * Deactivates a shared content item from the user's world.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onDeactivateSharedContent(event) {
    event.preventDefault();

    const button = $(event.currentTarget);
    const sharedId = button.data('shared-id');
    const sharedTitle = button.data('shared-title');

    if (!sharedId) return;

    // Confirm deactivation
    const confirmed = await Dialog.confirm({
      title: 'Deactivate Shared Content',
      content: `<p>Deactivate <strong>${sharedTitle}</strong>?</p><p>This will remove it from your active documents.</p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      button.prop('disabled', true);
      await this.socketClient.deactivateSharedContent(sharedId);
      ui.notifications.info('Shared content deactivated.');

      // Refresh shared content data
      await this._loadSharedContentData();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to deactivate shared content:`, error);
      ui.notifications.error(`Failed to deactivate: ${error.message}`);
      button.prop('disabled', false);
    }
  }

  /**
   * Handle admin shared content button click.
   * Opens the SharedContentAdmin dialog for managing shared content.
   *
   * @param {Event} event - The click event.
   * @private
   */
  _onAdminShared(event) {
    event.preventDefault();

    // Create and render SharedContentAdmin dialog
    const adminDialog = new SharedContentAdmin(this.socketClient);
    adminDialog.render(true);
  }
}
