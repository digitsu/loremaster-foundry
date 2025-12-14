/**
 * Loremaster Conversation Manager
 *
 * Application window for managing conversation history and sessions.
 * Allows users to view, switch between, rename, and delete conversations
 * with the Loremaster AI GM.
 */

const MODULE_ID = 'loremaster';

/**
 * Register Handlebars helpers for the Conversation Manager template.
 * Called once during module initialization.
 */
export function registerConversationManagerHelpers() {
  // Format timestamp to relative time
  Handlebars.registerHelper('formatRelativeTime', (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return game.i18n.localize('LOREMASTER.ConversationManager.JustNow');
    if (diffMins < 60) return game.i18n.format('LOREMASTER.ConversationManager.MinutesAgo', { count: diffMins });
    if (diffHours < 24) return game.i18n.format('LOREMASTER.ConversationManager.HoursAgo', { count: diffHours });
    if (diffDays < 7) return game.i18n.format('LOREMASTER.ConversationManager.DaysAgo', { count: diffDays });
    return date.toLocaleDateString();
  });

  // Format token count with abbreviation
  Handlebars.registerHelper('formatTokens', (tokens) => {
    if (typeof tokens !== 'number' || isNaN(tokens)) return '0';
    if (tokens < 1000) return tokens.toString();
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  });

  // Check if conversation is active
  Handlebars.registerHelper('isActiveConversation', (convId, activeId) => {
    return convId === activeId;
  });

  // Truncate text with ellipsis
  Handlebars.registerHelper('truncate', (text, length) => {
    if (!text) return '';
    const maxLength = parseInt(length, 10) || 50;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  });
}

/**
 * ConversationManager Application class for managing conversation history.
 * Extends Foundry's Application class to provide a dedicated window.
 */
export class ConversationManager extends Application {
  /**
   * Create a new ConversationManager instance.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   * @param {object} options - Application options.
   */
  constructor(socketClient, options = {}) {
    super(options);
    this.socketClient = socketClient;
    this.conversations = [];
    this.activeConversationId = null;
    this.selectedConversation = null;
    this.hasMore = false;
    this.currentOffset = 0;
    this.pageSize = 20;
  }

  /**
   * Default application options.
   *
   * @returns {object} The default options.
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'loremaster-conversation-manager',
      title: game.i18n.localize('LOREMASTER.ConversationManager.Title'),
      template: 'modules/loremaster/templates/conversation-manager.hbs',
      classes: ['loremaster', 'conversation-manager'],
      width: 550,
      height: 450,
      resizable: true,
      tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'conversations' }]
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
      conversations: this.conversations,
      activeConversationId: this.activeConversationId,
      selectedConversation: this.selectedConversation,
      hasMore: this.hasMore,
      totalCount: this.conversations.length,
      isGM: game.user.isGM
    };
  }

  /**
   * Activate event listeners for the application.
   *
   * @param {jQuery} html - The rendered HTML.
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Conversation list item clicks
    html.find('.conversation-item').on('click', this._onConversationClick.bind(this));

    // Switch conversation button
    html.find('.switch-btn').on('click', this._onSwitchConversation.bind(this));

    // Rename conversation
    html.find('.rename-btn').on('click', this._onRenameConversation.bind(this));

    // Clear conversation
    html.find('.clear-btn').on('click', this._onClearConversation.bind(this));

    // Delete conversation
    html.find('.delete-btn').on('click', this._onDeleteConversation.bind(this));

    // New conversation button
    html.find('.new-conversation-btn').on('click', this._onNewConversation.bind(this));

    // Load more button
    html.find('.load-more-btn').on('click', this._onLoadMore.bind(this));

    // Refresh button
    html.find('.refresh-btn').on('click', this._onRefresh.bind(this));

    // Double-click to switch
    html.find('.conversation-item').on('dblclick', this._onSwitchConversation.bind(this));
  }

  /**
   * Handle window render - load initial data.
   *
   * @param {boolean} force - Force render.
   * @param {object} options - Render options.
   */
  async _render(force = false, options = {}) {
    await super._render(force, options);

    // Load conversations on first render
    if (!this._loaded) {
      this._loaded = true;
      await this._loadConversations();
    }
  }

  /**
   * Load conversations from the server.
   *
   * @param {boolean} append - Whether to append to existing list.
   * @private
   */
  async _loadConversations(append = false) {
    try {
      const offset = append ? this.currentOffset : 0;
      const result = await this.socketClient.listConversations(this.pageSize, offset);

      if (append) {
        this.conversations = [...this.conversations, ...result.conversations];
      } else {
        this.conversations = result.conversations || [];
      }

      this.hasMore = result.hasMore || false;
      this.currentOffset = this.conversations.length;

      // Get active conversation ID from the first conversation if we don't have one
      if (!this.activeConversationId && this.conversations.length > 0) {
        this.activeConversationId = this.conversations[0].id;
      }

      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load conversations:`, error);
      ui.notifications.error(game.i18n.localize('LOREMASTER.ConversationManager.LoadError'));
    }
  }

  /**
   * Handle conversation item click - select it.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onConversationClick(event) {
    event.preventDefault();
    const conversationId = event.currentTarget.dataset.conversationId;

    // Update selected state
    this.element.find('.conversation-item').removeClass('selected');
    event.currentTarget.classList.add('selected');

    // Load conversation details
    try {
      const result = await this.socketClient.getConversation(conversationId, 5);
      this.selectedConversation = result;
      this._updateDetailsPanel();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to load conversation:`, error);
    }
  }

  /**
   * Update the details panel with selected conversation info.
   *
   * @private
   */
  _updateDetailsPanel() {
    const html = this.element;
    const panel = html.find('.conversation-details');

    if (!this.selectedConversation) {
      panel.addClass('hidden');
      return;
    }

    panel.removeClass('hidden');
    const conv = this.selectedConversation;

    panel.find('.detail-title').text(conv.title || game.i18n.localize('LOREMASTER.ConversationManager.Untitled'));
    panel.find('.detail-created').text(new Date(conv.created_at).toLocaleString());
    panel.find('.detail-updated').text(new Date(conv.updated_at).toLocaleString());
    panel.find('.detail-messages').text(conv.messageCount || 0);
    panel.find('.detail-tokens').text(conv.total_tokens || 0);

    // Show/hide action buttons based on whether it's the active conversation
    const isActive = conv.id === this.activeConversationId;
    panel.find('.switch-btn').toggleClass('hidden', isActive);
    panel.find('.active-badge').toggleClass('hidden', !isActive);

    // Recent messages preview
    const messagesPreview = panel.find('.messages-preview');
    messagesPreview.empty();

    if (conv.messages && conv.messages.length > 0) {
      conv.messages.slice(0, 3).forEach(msg => {
        const roleClass = msg.role === 'assistant' ? 'ai-message' : 'user-message';
        const roleLabel = msg.role === 'assistant' ?
          game.i18n.localize('LOREMASTER.ConversationManager.AI') :
          game.i18n.localize('LOREMASTER.ConversationManager.User');
        const content = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');

        messagesPreview.append(`
          <div class="message-preview ${roleClass}">
            <span class="message-role">${roleLabel}:</span>
            <span class="message-content">${content}</span>
          </div>
        `);
      });
    } else {
      messagesPreview.append(`
        <div class="empty-messages">
          ${game.i18n.localize('LOREMASTER.ConversationManager.NoMessages')}
        </div>
      `);
    }
  }

  /**
   * Handle switch conversation button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onSwitchConversation(event) {
    event.preventDefault();
    event.stopPropagation();

    let conversationId;
    if (event.type === 'dblclick') {
      conversationId = event.currentTarget.dataset.conversationId;
    } else {
      conversationId = this.selectedConversation?.id;
    }

    if (!conversationId || conversationId === this.activeConversationId) return;

    try {
      await this.socketClient.switchConversation(conversationId);
      this.activeConversationId = conversationId;
      ui.notifications.info(game.i18n.localize('LOREMASTER.ConversationManager.SwitchSuccess'));
      this.render(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to switch conversation:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ConversationManager.SwitchError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle rename conversation button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRenameConversation(event) {
    event.preventDefault();

    if (!this.selectedConversation) return;

    const currentTitle = this.selectedConversation.title ||
      game.i18n.localize('LOREMASTER.ConversationManager.Untitled');

    // Show dialog for new title
    new Dialog({
      title: game.i18n.localize('LOREMASTER.ConversationManager.RenameTitle'),
      content: `
        <form>
          <div class="form-group">
            <label>${game.i18n.localize('LOREMASTER.ConversationManager.NewTitle')}</label>
            <input type="text" name="title" value="${currentTitle}" autofocus>
          </div>
        </form>
      `,
      buttons: {
        rename: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize('LOREMASTER.ConversationManager.Rename'),
          callback: async (html) => {
            const newTitle = html.find('input[name="title"]').val().trim();
            if (newTitle && newTitle !== currentTitle) {
              try {
                await this.socketClient.renameConversation(this.selectedConversation.id, newTitle);
                ui.notifications.info(game.i18n.localize('LOREMASTER.ConversationManager.RenameSuccess'));
                await this._loadConversations();
              } catch (error) {
                console.error(`${MODULE_ID} | Failed to rename conversation:`, error);
                ui.notifications.error(game.i18n.format('LOREMASTER.ConversationManager.RenameError', {
                  error: error.message
                }));
              }
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('Cancel')
        }
      },
      default: 'rename'
    }).render(true);
  }

  /**
   * Handle clear conversation button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onClearConversation(event) {
    event.preventDefault();

    if (!this.selectedConversation) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.ConversationManager.ClearTitle'),
      content: game.i18n.format('LOREMASTER.ConversationManager.ClearConfirm', {
        name: this.selectedConversation.title || game.i18n.localize('LOREMASTER.ConversationManager.Untitled')
      }),
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.clearConversation(this.selectedConversation.id);
      ui.notifications.info(game.i18n.localize('LOREMASTER.ConversationManager.ClearSuccess'));
      await this._loadConversations();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to clear conversation:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ConversationManager.ClearError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle delete conversation button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onDeleteConversation(event) {
    event.preventDefault();

    if (!this.selectedConversation) return;

    // Can't delete the active conversation
    if (this.selectedConversation.id === this.activeConversationId) {
      ui.notifications.warn(game.i18n.localize('LOREMASTER.ConversationManager.CannotDeleteActive'));
      return;
    }

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.ConversationManager.DeleteTitle'),
      content: game.i18n.format('LOREMASTER.ConversationManager.DeleteConfirm', {
        name: this.selectedConversation.title || game.i18n.localize('LOREMASTER.ConversationManager.Untitled')
      }),
      yes: () => true,
      no: () => false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.deleteConversation(this.selectedConversation.id);
      ui.notifications.info(game.i18n.localize('LOREMASTER.ConversationManager.DeleteSuccess'));
      this.selectedConversation = null;
      await this._loadConversations();
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to delete conversation:`, error);
      ui.notifications.error(game.i18n.format('LOREMASTER.ConversationManager.DeleteError', {
        error: error.message
      }));
    }
  }

  /**
   * Handle new conversation button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onNewConversation(event) {
    event.preventDefault();

    // Show dialog for title
    new Dialog({
      title: game.i18n.localize('LOREMASTER.ConversationManager.NewConversationTitle'),
      content: `
        <form>
          <div class="form-group">
            <label>${game.i18n.localize('LOREMASTER.ConversationManager.ConversationTitle')}</label>
            <input type="text" name="title" placeholder="${game.i18n.localize('LOREMASTER.ConversationManager.TitlePlaceholder')}" autofocus>
          </div>
        </form>
      `,
      buttons: {
        create: {
          icon: '<i class="fas fa-plus"></i>',
          label: game.i18n.localize('LOREMASTER.ConversationManager.Create'),
          callback: async (html) => {
            const title = html.find('input[name="title"]').val().trim() || null;
            try {
              const result = await this.socketClient.newConversation(title);
              this.activeConversationId = result.conversationId;
              ui.notifications.info(game.i18n.localize('LOREMASTER.ConversationManager.CreateSuccess'));
              await this._loadConversations();
            } catch (error) {
              console.error(`${MODULE_ID} | Failed to create conversation:`, error);
              ui.notifications.error(game.i18n.format('LOREMASTER.ConversationManager.CreateError', {
                error: error.message
              }));
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('Cancel')
        }
      },
      default: 'create'
    }).render(true);
  }

  /**
   * Handle load more button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onLoadMore(event) {
    event.preventDefault();
    await this._loadConversations(true);
  }

  /**
   * Handle refresh button click.
   *
   * @param {Event} event - The click event.
   * @private
   */
  async _onRefresh(event) {
    event.preventDefault();
    this.currentOffset = 0;
    this.selectedConversation = null;
    await this._loadConversations();
  }

  /**
   * Set the active conversation ID.
   *
   * @param {string} conversationId - The active conversation ID.
   */
  setActiveConversation(conversationId) {
    this.activeConversationId = conversationId;
    if (this.rendered) {
      this.render(false);
    }
  }
}
