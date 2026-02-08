/**
 * Loremaster Shared Content Admin
 *
 * Admin dialog for managing shared content submissions and published items.
 * Allows admins to review pending submissions, approve/reject content,
 * remove published content, and directly publish PDFs to the shared library.
 */

const MODULE_ID = 'loremaster';

/**
 * SharedContentAdmin Application class for admin management of shared content.
 * Extends Foundry's Application class to provide a dedicated admin window.
 */
export class SharedContentAdmin extends Application {
  /**
   * Create a new SharedContentAdmin instance.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   * @param {object} options - Application options.
   */
  constructor(socketClient, options = {}) {
    super(options);
    this.socketClient = socketClient;
    this.pendingItems = [];
    this.publishedItems = [];
    this.userPdfs = [];
  }

  /**
   * Default application options.
   *
   * @returns {object} The default options.
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'loremaster-shared-content-admin',
      title: 'Shared Content Administration',
      template: 'modules/loremaster/templates/shared-content-admin.hbs',
      classes: ['loremaster', 'shared-content-admin'],
      width: 700,
      height: 500,
      resizable: true,
      tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'pending' }],
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
      pendingItems: this.pendingItems,
      publishedItems: this.publishedItems,
      userPdfs: this.userPdfs,
      hasPending: this.pendingItems.length > 0,
      hasPublished: this.publishedItems.length > 0,
      hasPdfs: this.userPdfs.length > 0
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

    // Pending tab actions
    html.find('.approve-btn').on('click', this._onApprove.bind(this));
    html.find('.reject-btn').on('click', this._onReject.bind(this));

    // Published tab actions
    html.find('.remove-btn').on('click', this._onRemove.bind(this));
    html.find('.direct-publish-btn').on('click', this._onDirectPublish.bind(this));
  }

  /**
   * Load admin data from the server.
   * Fetches pending submissions, published content, and user's PDFs.
   *
   * @private
   */
  async _loadData() {
    try {
      // Load pending submissions
      const pendingResult = await this.socketClient.adminListPendingShared();
      this.pendingItems = pendingResult.pending || [];

      // Load published shared content
      const sharedResult = await this.socketClient.listSharedContent();
      this.publishedItems = (sharedResult.content || []).filter(item => item.status === 'published');

      // Load user's PDFs for direct publish
      const pdfsResult = await this.socketClient.listPDFs();
      this.userPdfs = pdfsResult || [];

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load admin data:`, error);
      ui.notifications.error('Failed to load admin data. See console for details.');
    }
  }

  /**
   * Called after the application is first rendered.
   * Loads data from the server.
   *
   * @param {jQuery} html - The rendered HTML.
   * @protected
   */
  async _render(...args) {
    await super._render(...args);
    await this._loadData();
  }

  /**
   * Handle approve button click.
   * Approves a pending submission and moves it to published state.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onApprove(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const sharedContentId = parseInt(button.dataset.sharedContentId);

    try {
      await this.socketClient.adminApproveShared(sharedContentId);
      ui.notifications.info('Content approved and published successfully.');

      // Remove from pending list
      this.pendingItems = this.pendingItems.filter(item => item.id !== sharedContentId);

      // Reload data to update published list
      await this._loadData();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to approve content:`, error);
      ui.notifications.error('Failed to approve content. See console for details.');
    }
  }

  /**
   * Handle reject button click.
   * Rejects a pending submission and removes it from the queue.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onReject(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const sharedContentId = parseInt(button.dataset.sharedContentId);

    try {
      await this.socketClient.adminRejectShared(sharedContentId);
      ui.notifications.info('Content rejected and removed from queue.');

      // Remove from pending list
      this.pendingItems = this.pendingItems.filter(item => item.id !== sharedContentId);
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to reject content:`, error);
      ui.notifications.error('Failed to reject content. See console for details.');
    }
  }

  /**
   * Handle remove button click.
   * Removes published content from the shared library.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRemove(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const sharedContentId = parseInt(button.dataset.sharedContentId);
    const title = button.dataset.title || 'this content';

    // Confirmation dialog
    const confirmed = await Dialog.confirm({
      title: 'Remove Shared Content',
      content: `<p>Are you sure you want to remove <strong>${title}</strong> from the shared library?</p>
                <p>This will deactivate it for all users who have activated it.</p>`,
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.adminRemoveShared(sharedContentId);
      ui.notifications.info('Content removed from shared library.');

      // Remove from published list
      this.publishedItems = this.publishedItems.filter(item => item.id !== sharedContentId);
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to remove content:`, error);
      ui.notifications.error('Failed to remove content. See console for details.');
    }
  }

  /**
   * Handle direct publish button click.
   * Opens a dialog to select a PDF and publish it directly to the shared library.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onDirectPublish(event) {
    event.preventDefault();

    // Reload PDFs to ensure we have the latest list
    try {
      const pdfsResult = await this.socketClient.listPDFs();
      this.userPdfs = pdfsResult || [];
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load PDFs:`, error);
      ui.notifications.error('Failed to load PDFs. See console for details.');
      return;
    }

    if (this.userPdfs.length === 0) {
      ui.notifications.warn('No PDFs available to publish.');
      return;
    }

    // Create PDF selection options
    const pdfOptions = this.userPdfs
      .filter(pdf => pdf.processing_status === 'completed')
      .map(pdf => `<option value="${pdf.id}">${pdf.display_name || pdf.filename}</option>`)
      .join('');

    if (!pdfOptions) {
      ui.notifications.warn('No completed PDFs available to publish.');
      return;
    }

    // Build dialog content
    const content = `
      <form class="direct-publish-form">
        <div class="form-group">
          <label for="pdf-select">Select PDF:</label>
          <select id="pdf-select" name="pdfId">
            ${pdfOptions}
          </select>
        </div>
        <div class="form-group">
          <label for="publisher">Publisher (optional):</label>
          <input type="text" id="publisher" name="publisher" placeholder="Enter publisher name">
        </div>
        <div class="form-group">
          <label for="description">Description (optional):</label>
          <textarea id="description" name="description" rows="4" placeholder="Enter description"></textarea>
        </div>
        <style>
          .direct-publish-form .form-group {
            margin-bottom: 12px;
          }
          .direct-publish-form label {
            display: block;
            margin-bottom: 4px;
            font-weight: bold;
          }
          .direct-publish-form input,
          .direct-publish-form select,
          .direct-publish-form textarea {
            width: 100%;
            padding: 6px;
            border: 1px solid #ccc;
            border-radius: 3px;
          }
        </style>
      </form>
    `;

    // Show dialog
    new Dialog({
      title: 'Direct Publish PDF',
      content: content,
      buttons: {
        publish: {
          icon: '<i class="fas fa-upload"></i>',
          label: 'Publish',
          callback: async (html) => {
            const formData = new FormData(html.find('.direct-publish-form')[0]);
            const pdfId = formData.get('pdfId');
            const publisher = formData.get('publisher') || '';
            const description = formData.get('description') || '';

            try {
              await this.socketClient.adminPublishPdf(pdfId, {
                publisher: publisher,
                description: description
              });
              ui.notifications.info('PDF published to shared library successfully.');

              // Reload data to update published list
              await this._loadData();
            } catch (error) {
              console.error(`${MODULE_ID} | Failed to publish PDF:`, error);
              if (error.message && error.message.includes('already exists')) {
                ui.notifications.warn('This PDF has already been published to the shared library.');
              } else {
                ui.notifications.error('Failed to publish PDF. See console for details.');
              }
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      default: 'publish'
    }).render(true);
  }
}
