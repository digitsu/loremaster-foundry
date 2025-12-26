/**
 * Loremaster Usage Monitor
 *
 * Application window for monitoring Claude API token usage.
 * Displays horizontal progress bars showing current usage vs configured limits,
 * with support for both all-time tracking and session-based "trip meter" mode.
 */

const MODULE_ID = 'loremaster';

/**
 * Register Handlebars helpers for the Usage Monitor template.
 * Called once during module initialization.
 */
export function registerUsageMonitorHelpers() {
  // Format large numbers with commas
  Handlebars.registerHelper('formatNumber', (num) => {
    if (typeof num !== 'number' || isNaN(num)) return '0';
    return num.toLocaleString();
  });

  // Calculate percentage and format with one decimal
  Handlebars.registerHelper('formatPercent', (used, limit) => {
    if (!limit || limit <= 0) return '—';
    const percent = (used / limit) * 100;
    return `${percent.toFixed(1)}%`;
  });

  // Calculate bar width percentage (capped at 100)
  Handlebars.registerHelper('barWidth', (used, limit) => {
    if (!limit || limit <= 0) return 0;
    const percent = Math.min((used / limit) * 100, 100);
    return percent.toFixed(1);
  });

  // Get warning level CSS class based on percentage
  Handlebars.registerHelper('usageLevel', (used, limit) => {
    if (!limit || limit <= 0) return 'normal';
    const percent = (used / limit) * 100;
    if (percent >= 90) return 'critical';
    if (percent >= 75) return 'warning';
    return 'normal';
  });

  // Get localized label for request type
  Handlebars.registerHelper('requestTypeLabel', (type) => {
    const key = `LOREMASTER.UsageMonitor.RequestTypes.${type}`;
    const localized = game.i18n.localize(key);
    // If not found, fall back to the raw type
    return localized !== key ? localized : type;
  });

  // Format datetime for display
  Handlebars.registerHelper('formatDateTime', (isoString) => {
    if (!isoString) return game.i18n.localize('LOREMASTER.UsageMonitor.NoActiveSession');
    const date = new Date(isoString);
    return date.toLocaleString();
  });

  // Check if limit is configured
  Handlebars.registerHelper('hasLimit', (limit) => {
    return typeof limit === 'number' && limit > 0;
  });

  // Multiply two numbers (for cache savings calculation)
  Handlebars.registerHelper('mult', (a, b) => {
    if (typeof a !== 'number' || typeof b !== 'number') return 0;
    return Math.round(a * b);
  });

  // Calculate cache hit rate as a percentage
  Handlebars.registerHelper('cacheHitRate', (cacheRead, cacheCreation, inputTokens) => {
    const totalCacheable = (cacheRead || 0) + (cacheCreation || 0) + (inputTokens || 0);
    if (totalCacheable === 0) return '0%';
    const hitRate = ((cacheRead || 0) / totalCacheable) * 100;
    return `${hitRate.toFixed(1)}%`;
  });
}

/**
 * UsageMonitor Application class for displaying API usage statistics.
 * Extends Foundry's Application class to provide a dedicated window.
 *
 * TODO: Migrate to ApplicationV2 before Foundry V16
 * The V1 Application framework is deprecated since V13 and will be removed in V16.
 * See: foundry.applications.api.ApplicationV2
 */
export class UsageMonitor extends Application {
  /**
   * Create a new UsageMonitor instance.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   * @param {object} options - Application options.
   */
  constructor(socketClient, options = {}) {
    super(options);
    this.socketClient = socketClient;
    this.stats = null;
    this.isLoading = false;
    this.loadAttempted = false;
  }

  /**
   * Default application options.
   *
   * @returns {object} The default options.
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'loremaster-usage-monitor',
      title: game.i18n.localize('LOREMASTER.UsageMonitor.Title'),
      template: 'modules/loremaster/templates/usage-monitor.hbs',
      classes: ['loremaster', 'usage-monitor'],
      width: 450,
      height: 'auto',
      resizable: true
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

    // Get configured limits from settings
    const maxTokensPerMonth = game.settings.get(MODULE_ID, 'maxTokensPerMonth') || 0;

    return {
      ...data,
      stats: this.stats,
      isLoading: this.isLoading,
      isGM: game.user.isGM,
      maxTokensPerMonth,
      hasTokenLimit: maxTokensPerMonth > 0
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

    // Refresh button
    html.find('.refresh-btn').on('click', this._onRefresh.bind(this));

    // Reset session button (GM only)
    html.find('.reset-session-btn').on('click', this._onResetSession.bind(this));
  }

  /**
   * Handle window render.
   * Load fresh data when window is opened.
   *
   * @param {jQuery} html - The rendered HTML.
   */
  async _render(force = false, options = {}) {
    await super._render(force, options);

    // Load data on first render (only if not already loading or attempted)
    if (!this.stats && !this.isLoading && !this.loadAttempted) {
      await this._loadStats();
    }
  }

  /**
   * Load usage statistics from the server.
   */
  async _loadStats() {
    if (this.isLoading) return;

    this.isLoading = true;
    this.loadAttempted = true;
    this.render(false);

    try {
      const result = await this.socketClient.getUsageStats();
      this.stats = result;
    } catch (error) {
      console.error('[UsageMonitor] Failed to load stats:', error);
      ui.notifications.error(game.i18n.localize('LOREMASTER.UsageMonitor.LoadError'));
      // Set empty stats to prevent retry loop, but allow manual refresh
      this.stats = {
        allTime: { inputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        session: { inputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0, cacheCreationTokens: 0, cacheReadTokens: 0, sessionStart: null },
        byType: []
      };
    } finally {
      this.isLoading = false;
      this.render(false);
    }
  }

  /**
   * Handle refresh button click.
   *
   * @param {Event} event - The click event.
   */
  async _onRefresh(event) {
    event.preventDefault();
    this.loadAttempted = false; // Allow retry on manual refresh
    await this._loadStats();
  }

  /**
   * Handle reset session button click.
   * Resets the trip meter for a new session.
   *
   * @param {Event} event - The click event.
   */
  async _onResetSession(event) {
    event.preventDefault();

    // Confirm with user
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize('LOREMASTER.UsageMonitor.ResetSession'),
      content: `<p>${game.i18n.localize('LOREMASTER.UsageMonitor.ResetConfirm')}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) return;

    try {
      await this.socketClient.resetSession();
      ui.notifications.info(game.i18n.localize('LOREMASTER.UsageMonitor.SessionReset'));
      await this._loadStats();
    } catch (error) {
      console.error('[UsageMonitor] Failed to reset session:', error);
      ui.notifications.error(game.i18n.format('LOREMASTER.UsageMonitor.ResetError', {
        error: error.message
      }));
    }
  }

  /**
   * Public method to open the monitor and load fresh data.
   */
  async open() {
    this.stats = null; // Force reload
    this.loadAttempted = false; // Reset so we can try loading again
    this.render(true);
  }
}
