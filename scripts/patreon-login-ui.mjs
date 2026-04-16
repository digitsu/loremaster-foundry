/**
 * Patreon Login UI
 *
 * Application window for Patreon authentication in hosted mode.
 * Shows login button, user info, tier status, and quota usage.
 *
 * @module patreon-login-ui
 */

import {
  getAuthManager,
  AuthState,
  AUTH_STATE_CHANGED_EVENT
} from './patreon-auth.mjs';
import { isHostedMode, getProxyUrl, classifyFetchError } from './config.mjs';

const MODULE_ID = 'loremaster';
const MODULE_NAME = 'Loremaster';

/**
 * Tier display configuration.
 * Maps tier names to display labels, icons, colors, and token limits.
 * Exported for reuse in settings panel account display.
 */
export const TIER_CONFIG = {
  basic: {
    label: 'Knave',
    icon: '⚔️',
    color: '#a0a0a0',
    tokenLimit: 500000
  },
  pro: {
    label: 'Knight',
    icon: '🛡️',
    color: '#d4af37',
    tokenLimit: 2000000
  },
  premium: {
    label: 'Lord',
    icon: '👑',
    color: '#f4d03f',
    tokenLimit: 5000000
  }
};

/**
 * Register Handlebars helpers for the Patreon Login template.
 * Called once during module initialization.
 */
export function registerPatreonLoginHelpers() {
  // Format token numbers with K/M suffix
  Handlebars.registerHelper('formatTokens', (num) => {
    if (typeof num !== 'number' || isNaN(num)) return '0';
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K`;
    }
    return num.toLocaleString();
  });

  // Get tier configuration
  // Note: Handlebars may pass options object if value is undefined, so we check for string type
  Handlebars.registerHelper('tierLabel', (tierName) => {
    const name = typeof tierName === 'string' ? tierName.toLowerCase() : 'basic';
    const tier = TIER_CONFIG[name] || TIER_CONFIG.basic;
    return tier.label;
  });

  Handlebars.registerHelper('tierIcon', (tierName) => {
    const name = typeof tierName === 'string' ? tierName.toLowerCase() : 'basic';
    const tier = TIER_CONFIG[name] || TIER_CONFIG.basic;
    return tier.icon;
  });

  Handlebars.registerHelper('tierColor', (tierName) => {
    const name = typeof tierName === 'string' ? tierName.toLowerCase() : 'basic';
    const tier = TIER_CONFIG[name] || TIER_CONFIG.basic;
    return tier.color;
  });

  // Calculate quota percentage
  Handlebars.registerHelper('quotaPercent', (used, limit) => {
    if (!limit || limit <= 0) return 0;
    return Math.min((used / limit) * 100, 100).toFixed(1);
  });

  // Get quota bar color class
  Handlebars.registerHelper('quotaLevel', (used, limit) => {
    if (!limit || limit <= 0) return 'normal';
    const percent = (used / limit) * 100;
    if (percent >= 90) return 'critical';
    if (percent >= 75) return 'warning';
    return 'normal';
  });

  // Get shared tier level class
  Handlebars.registerHelper('sharedTierLevel', (current, max) => {
    if (max === 0) return 'none';
    if (max === -1) return 'available'; // Unlimited
    if (current >= max) return 'at-limit';
    return 'available';
  });
}

/**
 * PatreonLoginUI Application class for Patreon authentication.
 * Extends Foundry's Application class to provide a login dialog.
 *
 * Displays different content based on authentication state:
 * - Logged out: Sign in button
 * - Logging in: Loading spinner
 * - Logged in: User info, tier, quota
 * - Error: Error message with retry option
 */
export class PatreonLoginUI extends Application {
  /**
   * Create a new PatreonLoginUI instance.
   *
   * @param {Object} options - Application options.
   */
  constructor(options = {}) {
    super(options);

    /** @type {PatreonAuthManager} Auth manager instance */
    this.authManager = getAuthManager();

    /** @type {Object|null} Quota data from server */
    this.quota = null;

    /** @type {boolean} Whether quota is being loaded */
    this.isLoadingQuota = false;

    /** @type {Object|null} RAG status from server */
    this.ragStatus = null;

    /** @type {Object|null} Shared tier status from server */
    this.sharedTier = null;

    /**
     * Per-section fetch error state — populated by classifyFetchError on failure
     * so the dialog can render a retry affordance instead of silently swallowing.
     * Each entry is null on success or { reason, retryable } on failure.
     * @type {{quota: ?Object, ragStatus: ?Object, sharedTier: ?Object}}
     */
    this.errorState = { quota: null, ragStatus: null, sharedTier: null };

    /** @type {boolean} Whether tier is being refreshed */
    this.isRefreshingTier = false;

    /** @type {Function|null} Unsubscribe function for auth state changes */
    this._unsubscribe = null;

    // Subscribe to auth state changes
    this._setupAuthListener();
  }

  /**
   * Default application options.
   *
   * @returns {Object} The default options.
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'loremaster-patreon-login',
      title: 'Loremaster Account',
      template: 'modules/loremaster/templates/patreon-login.hbs',
      classes: ['loremaster', 'patreon-login'],
      width: 400,
      height: 'auto',
      resizable: false
    });
  }

  /**
   * Set up listener for authentication state changes.
   *
   * @private
   */
  _setupAuthListener() {
    this._unsubscribe = this.authManager.onStateChange((state, user) => {
      console.log(`${MODULE_NAME} | Auth state changed: ${state}`);

      // If just logged in, fetch quota
      if (state === AuthState.LOGGED_IN) {
        this._fetchQuota();
      }

      // Re-render the UI
      if (this.rendered) {
        this.render(false);
      }
    });
  }

  /**
   * Fetch quota information from the server.
   *
   * @private
   */
  async _fetchQuota() {
    if (!this.authManager.isAuthenticated()) {
      this.quota = null;
      return;
    }

    // Prevent re-entry
    if (this.isLoadingQuota || this._quotaFetchAttempted) {
      return;
    }

    this.isLoadingQuota = true;
    this._quotaFetchAttempted = true;
    this.errorState.quota = null;
    if (this.rendered) this.render(false);

    try {
      const status = await this.authManager.checkAuthStatus();
      if (status.authenticated && status.quota) {
        this.quota = status.quota;
      } else if (!status.authenticated) {
        // checkAuthStatus returns { authenticated: false } for BOTH real auth
        // expiry (401 → reason: 'Session expired') and network errors (fetch
        // failed → reason: err.message). Only show the session-expired notice
        // for actual auth failures; treat everything else as a retryable
        // network error with an error banner.
        const isAuthExpired = status.reason === 'Session expired' || status.reason === 'No session token';
        if (isAuthExpired) {
          ui.notifications.warn(`${MODULE_NAME}: ${game.i18n?.localize('LOREMASTER.Connection.SessionExpiredNotice') || 'Your session expired — please sign in again.'}`);
        } else {
          this.errorState.quota = { reason: status.reason || 'Server unavailable', retryable: true };
        }
        this._quotaFetchAttempted = false;
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to fetch quota:`, err);
      this.errorState.quota = classifyFetchError(err);
      this._quotaFetchAttempted = false;
    } finally {
      this.isLoadingQuota = false;
      if (this.rendered) this.render(false);
    }

    // Also fetch RAG status and shared tier status
    this._fetchRagStatus();
    this._fetchSharedTierStatus();
  }

  /**
   * Fetch RAG status from the server.
   *
   * @private
   */
  async _fetchRagStatus() {
    try {
      // Get socket client from Loremaster module
      const loremaster = game.modules.get('loremaster');
      const socketClient = loremaster?.api?.getSocketClient?.();

      if (socketClient && socketClient.isAuthenticated) {
        this.errorState.ragStatus = null;
        const ragStatus = await socketClient.getRagStatus();
        this.ragStatus = ragStatus;
        if (this.rendered) this.render(false);
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to fetch RAG status:`, err);
      this.errorState.ragStatus = classifyFetchError(err);
      if (this.rendered) this.render(false);
    }
  }

  /**
   * Fetch shared tier status from the server.
   * Gets current activation count and tier limits for shared content.
   *
   * @private
   */
  async _fetchSharedTierStatus() {
    try {
      // Get socket client from Loremaster module
      const loremaster = game.modules.get('loremaster');
      const socketClient = loremaster?.api?.getSocketClient?.();

      if (socketClient && socketClient.isAuthenticated) {
        this.errorState.sharedTier = null;
        const sharedTier = await socketClient.getSharedTierStatus();
        this.sharedTier = sharedTier;
        if (this.rendered) this.render(false);
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to fetch shared tier status:`, err);
      this.errorState.sharedTier = classifyFetchError(err);
      if (this.rendered) this.render(false);
    }
  }

  /**
   * Refresh the user's tier from Patreon.
   * Called when the Refresh Tier button is clicked.
   *
   * @private
   */
  async _refreshTier() {
    if (this.isRefreshingTier) return;

    this.isRefreshingTier = true;
    if (this.rendered) this.render(false);

    try {
      // Get socket client from Loremaster module
      const loremaster = game.modules.get('loremaster');
      const socketClient = loremaster?.api?.getSocketClient?.();

      if (!socketClient || !socketClient.isAuthenticated) {
        ui.notifications.warn(`${MODULE_NAME}: Not connected to server`);
        return;
      }

      const result = await socketClient.verifyMembership();

      if (result.success) {
        if (result.tierChanged) {
          ui.notifications.info(
            `${MODULE_NAME}: Tier updated from ${result.oldTier} to ${result.newTier}!`
          );
          // Refresh RAG status since tier changed
          this.ragStatus = {
            ragAvailable: result.ragAvailable,
            ragRequiredTier: result.ragRequiredTier
          };
        } else {
          ui.notifications.info(`${MODULE_NAME}: Tier verified (${result.newTier})`);
        }

        // Update auth manager user info
        if (this.authManager.user) {
          this.authManager.user.tierName = result.newTier;
          this.authManager.user.patronStatus = result.patronStatus;
        }
      } else {
        ui.notifications.error(`${MODULE_NAME}: ${result.error || 'Failed to verify tier'}`);
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Tier refresh error:`, err);
      ui.notifications.error(`${MODULE_NAME}: Failed to refresh tier`);
    } finally {
      this.isRefreshingTier = false;
      if (this.rendered) this.render(false);
    }
  }

  /**
   * Get data for template rendering.
   *
   * @param {Object} options - Render options.
   * @returns {Object} Template data.
   */
  async getData(options = {}) {
    const data = await super.getData(options);
    const state = this.authManager.getState();
    const user = this.authManager.getUser();

    // Get tier config for display
    const tierName = user?.tierName?.toLowerCase() || 'basic';
    const tierConfig = TIER_CONFIG[tierName] || TIER_CONFIG.basic;

    return {
      ...data,
      // Auth state
      state,
      isLoggedOut: state === AuthState.LOGGED_OUT,
      isLoggingIn: state === AuthState.LOGGING_IN,
      isLoggedIn: state === AuthState.LOGGED_IN,
      isError: state === AuthState.ERROR,
      errorMessage: this.authManager.errorMessage,

      // User info
      user,
      displayName: user?.displayName || 'Unknown',
      email: user?.email || '',

      // Tier info
      tierName: tierConfig.label,
      tierIcon: tierConfig.icon,
      tierColor: tierConfig.color,
      tokenLimit: tierConfig.tokenLimit,

      // Quota info
      quota: this.quota,
      isLoadingQuota: this.isLoadingQuota,
      tokensUsed: this.quota?.tokensUsed || 0,
      tokensLimit: this.quota?.tokensLimit || tierConfig.tokenLimit,
      quotaResetDate: this.quota?.resetDate ? new Date(this.quota.resetDate).toLocaleDateString() : null,

      // RAG status
      ragAvailable: this.ragStatus?.ragAvailable ?? false,
      ragRequiredTier: TIER_CONFIG[this.ragStatus?.ragRequiredTier]?.label || TIER_CONFIG['pro']?.label || 'Knight',
      isRefreshingTier: this.isRefreshingTier,

      // Shared tier status
      sharedTier: this.sharedTier,
      sharedTierCurrent: this.sharedTier?.tier?.current || 0,
      sharedTierMax: this.sharedTier?.tier?.max || 0,
      sharedTierName: this.sharedTier?.tier?.name || 'free',
      sharedTierUnlimited: this.sharedTier?.tier?.max === -1,

      // Config
      isHostedMode: isHostedMode(),
      patreonUrl: 'https://patreon.com/loremastervtt',

      // Per-section fetch error state — see classifyFetchError in config.mjs.
      // Template renders {{#if errorState.X}} blocks above each section.
      errorState: this.errorState
    };
  }

  /**
   * Activate event listeners for the application.
   *
   * @param {jQuery} html - The rendered HTML.
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Get the element - handle both jQuery and HTMLElement
    const element = html instanceof jQuery ? html[0] : html;

    console.log(`${MODULE_NAME} | PatreonLoginUI activating listeners`, { element, isJQuery: html instanceof jQuery });

    // Sign in button
    const loginBtn = element.querySelector('.patreon-login-btn');
    if (loginBtn) {
      console.log(`${MODULE_NAME} | Found login button`);
      loginBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._onSignIn();
      });
    }

    // Sign out button
    const logoutBtn = element.querySelector('.patreon-logout-btn');
    if (logoutBtn) {
      console.log(`${MODULE_NAME} | Found logout button`);
      logoutBtn.addEventListener('click', (event) => {
        event.preventDefault();
        console.log(`${MODULE_NAME} | Logout button clicked`);
        this._onSignOut();
      });
    } else {
      console.log(`${MODULE_NAME} | Logout button NOT found in DOM`);
    }

    // Retry button (on error)
    const retryBtn = element.querySelector('.patreon-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._onSignIn();
      });
    }

    // Paste token button
    const pasteBtn = element.querySelector('.patreon-paste-token-btn');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._onPasteToken();
      });
    }

    // Subscribe link
    const subscribeLink = element.querySelector('.patreon-subscribe-link');
    if (subscribeLink) {
      subscribeLink.addEventListener('click', (event) => {
        event.preventDefault();
        window.open('https://patreon.com/loremastervtt', '_blank');
      });
    }

    // Refresh quota button
    const refreshBtn = element.querySelector('.refresh-quota-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (event) => {
        event.preventDefault();
        // Reset the fetch attempted flag so refresh actually works
        this._quotaFetchAttempted = false;
        this._fetchQuota();
      });
    }

    // Per-section retry buttons — shown by the error banner when the
    // corresponding fetch has failed (issue #1). Each clears its section's
    // error + re-renders for instant feedback, then refires the fetch.
    const retryQuotaBtn = element.querySelector('.patreon-retry-quota-btn');
    if (retryQuotaBtn) {
      retryQuotaBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.errorState.quota = null;
        this._quotaFetchAttempted = false;
        if (this.rendered) this.render(false);
        this._fetchQuota();
      });
    }

    const retryRagBtn = element.querySelector('.patreon-retry-rag-btn');
    if (retryRagBtn) {
      retryRagBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.errorState.ragStatus = null;
        if (this.rendered) this.render(false);
        this._fetchRagStatus();
      });
    }

    const retrySharedBtn = element.querySelector('.patreon-retry-shared-btn');
    if (retrySharedBtn) {
      retrySharedBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.errorState.sharedTier = null;
        if (this.rendered) this.render(false);
        this._fetchSharedTierStatus();
      });
    }

    // Refresh tier button
    const refreshTierBtn = element.querySelector('.refresh-tier-btn');
    if (refreshTierBtn) {
      refreshTierBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this._refreshTier();
      });

      // Add spinning class if currently refreshing
      if (this.isRefreshingTier) {
        refreshTierBtn.classList.add('refreshing');
      }
    }

    // Manage shared content link
    const manageSharedLink = element.querySelector('.manage-shared-link');
    if (manageSharedLink) {
      manageSharedLink.addEventListener('click', (event) => {
        event.preventDefault();
        this._onManageSharedContent();
      });
    }
  }

  /**
   * Handle sign in button click.
   *
   * @private
   */
  _onSignIn() {
    console.log(`${MODULE_NAME} | Sign in clicked`);
    this.authManager.startOAuthFlow();
  }

  /**
   * Handle sign out button click.
   *
   * @private
   */
  async _onSignOut() {
    console.log(`${MODULE_NAME} | Sign out clicked`);

    // Confirm sign out — use explicit Dialog for V13 compatibility
    const confirmed = await new Promise((resolve) => {
      new Dialog({
        title: game.i18n?.localize('LOREMASTER.PatreonLogin.SignOutDialogTitle') || 'Sign Out',
        content: `<p>${game.i18n?.localize('LOREMASTER.PatreonLogin.SignOutConfirm') || 'Are you sure you want to sign out of Loremaster?'}</p>`,
        buttons: {
          yes: { icon: '<i class="fas fa-check"></i>', label: 'Yes', callback: () => resolve(true) },
          no: { icon: '<i class="fas fa-times"></i>', label: 'No', callback: () => resolve(false) }
        },
        default: 'no',
        close: () => resolve(false)
      }).render(true);
    });

    if (confirmed) {
      await this.authManager.logout();
      this.quota = null;
    }
  }

  /**
   * Handle paste token button click.
   * Shows a dialog to manually enter a session token.
   *
   * @private
   */
  async _onPasteToken() {
    console.log(`${MODULE_NAME} | Paste token clicked`);

    // Show dialog to enter token
    const content = `
      <form>
        <div class="form-group">
          <label>${game.i18n?.localize('LOREMASTER.PatreonLogin.SessionTokenLabel') || 'Session Token'}</label>
          <input type="text" name="token" placeholder="${game.i18n?.localize('LOREMASTER.PatreonLogin.SessionTokenPlaceholder') || 'Paste your session token here...'}"
            style="width: 100%; font-family: monospace;">
          <p class="notes" style="margin-top: 0.5rem;">
            ${game.i18n?.localize('LOREMASTER.PatreonLogin.SessionTokenHint') || 'Copy the token from the Patreon authorization success page.'}
          </p>
        </div>
      </form>
    `;

    // Use explicit Dialog for V13 compatibility
    const token = await new Promise((resolve) => {
      new Dialog({
        title: game.i18n?.localize('LOREMASTER.PatreonLogin.EnterTokenTitle') || 'Enter Session Token',
        content,
        buttons: {
          connect: {
            icon: '<i class="fas fa-plug"></i>',
            label: game.i18n?.localize('LOREMASTER.PatreonLogin.ConnectBtn') || 'Connect',
            callback: (html) => resolve(html.find('input[name="token"]').val()?.trim())
          }
        },
        default: 'connect',
        close: () => resolve(null)
      }).render(true);
    });

    if (token) {
      await this._validateAndSaveToken(token);
    }
  }

  /**
   * Validate a token with the server and save it if valid.
   *
   * @private
   * @param {string} token - The session token to validate.
   */
  async _validateAndSaveToken(token) {
    console.log(`${MODULE_NAME} | Validating manual token...`);

    // Temporarily set the token to validate it
    const { setSessionToken, clearSessionToken } = await import('./config.mjs');
    await setSessionToken(token);

    try {
      // Check if token is valid
      const status = await this.authManager.checkAuthStatus();

      if (status.authenticated) {
        console.log(`${MODULE_NAME} | Manual token valid!`);
        ui.notifications.info(`${MODULE_NAME}: ${game.i18n?.localize('LOREMASTER.PatreonLogin.ConnectedSuccess') || 'Connected successfully!'}`);

        // Update auth manager state
        this.authManager.state = AuthState.LOGGED_IN;
        this.authManager._emitStateChange();
      } else {
        // Token invalid - clear it
        console.warn(`${MODULE_NAME} | Manual token invalid: ${status.reason}`);
        await clearSessionToken();
        ui.notifications.error(`${MODULE_NAME}: ${game.i18n?.format('LOREMASTER.PatreonLogin.InvalidToken', { reason: status.reason }) || `Invalid token - ${status.reason}`}`);
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Token validation error:`, err);
      await clearSessionToken();
      ui.notifications.error(`${MODULE_NAME}: ${game.i18n?.localize('LOREMASTER.PatreonLogin.ValidationFailed') || 'Failed to validate token'}`);
    }
  }

  /**
   * Handle manage shared content link click.
   * Opens Content Manager to the PDFs tab.
   *
   * @private
   */
  _onManageSharedContent() {
    console.log(`${MODULE_NAME} | Manage shared content clicked`);

    // Get Content Manager from game object
    if (game.loremaster?.openContentManager) {
      game.loremaster.openContentManager();
    } else {
      ui.notifications.warn(`${MODULE_NAME}: ${game.i18n?.localize('LOREMASTER.PatreonLogin.ContentManagerUnavailable') || 'Content Manager not available'}`);
    }
  }

  /**
   * Called when the application is rendered.
   *
   * @param {boolean} force - Force re-render.
   * @param {Object} options - Render options.
   */
  async _render(force = false, options = {}) {
    await super._render(force, options);

    // Fetch quota on first render if logged in
    if (this.authManager.isAuthenticated() && !this.quota && !this.isLoadingQuota) {
      this._fetchQuota();
    }
  }

  /**
   * Clean up when the application is closed.
   *
   * @param {Object} options - Close options.
   */
  async close(options = {}) {
    // Unsubscribe from auth changes
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    return super.close(options);
  }

  /**
   * Open the login UI.
   * Convenience method that renders and brings to front.
   */
  open() {
    this.render(true);
  }
}

/**
 * Singleton instance of PatreonLoginUI.
 * @type {PatreonLoginUI|null}
 */
let loginUIInstance = null;

/**
 * Get or create the PatreonLoginUI singleton.
 *
 * @returns {PatreonLoginUI} The login UI instance.
 */
export function getLoginUI() {
  if (!loginUIInstance) {
    loginUIInstance = new PatreonLoginUI();
  }
  return loginUIInstance;
}

/**
 * Open the Patreon login dialog.
 * Convenience function for external callers.
 */
export function openPatreonLogin() {
  getLoginUI().open();
}
