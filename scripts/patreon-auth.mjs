/**
 * Patreon Authentication Manager
 *
 * Handles OAuth authentication flow for hosted mode users.
 * Manages session tokens, user info, and provides login/logout functionality.
 *
 * @module patreon-auth
 */

import {
  getSetting,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  getPatreonUser,
  setPatreonUser,
  clearPatreonUser,
  getProxyUrl
} from './config.mjs';

const MODULE_ID = 'loremaster';
const MODULE_NAME = 'Loremaster';

/**
 * OAuth callback message type sent by the proxy server.
 * @constant {string}
 */
const OAUTH_CALLBACK_MESSAGE_TYPE = 'loremaster_oauth_callback';

/**
 * Custom event fired when authentication state changes.
 * @constant {string}
 */
export const AUTH_STATE_CHANGED_EVENT = 'loremaster:authStateChanged';

/**
 * Authentication states.
 * @enum {string}
 */
export const AuthState = {
  LOGGED_OUT: 'logged_out',
  LOGGING_IN: 'logging_in',
  LOGGED_IN: 'logged_in',
  ERROR: 'error'
};

/**
 * PatreonAuthManager - Manages Patreon OAuth authentication for hosted mode.
 *
 * Handles the complete OAuth flow including:
 * - Opening popup for Patreon authorization
 * - Listening for postMessage callbacks
 * - Storing and retrieving session tokens
 * - Checking authentication status with the server
 * - Logout and token cleanup
 */
export class PatreonAuthManager {
  /**
   * Create a PatreonAuthManager instance.
   *
   * @param {Object} options - Configuration options.
   * @param {string} [options.proxyUrl] - The proxy server URL. Defaults to hosted URL.
   */
  constructor(options = {}) {
    /** @type {string} The proxy server URL (HTTP/HTTPS for API calls) */
    this.proxyUrl = this._normalizeToHttpUrl(options.proxyUrl || getProxyUrl());

    /** @type {AuthState} Current authentication state */
    this.state = AuthState.LOGGED_OUT;

    /** @type {Window|null} Reference to OAuth popup window */
    this._oauthPopup = null;

    /** @type {Function|null} Bound message handler for cleanup */
    this._messageHandler = null;

    /** @type {string|null} Error message if auth failed */
    this.errorMessage = null;

    /** @type {Function[]} Callbacks for auth state changes */
    this._stateChangeCallbacks = [];

    // Initialize state from stored data
    this._initializeFromStorage();

    // Set up postMessage listener
    this._setupMessageListener();

    console.log(`${MODULE_NAME} | PatreonAuthManager initialized (proxyUrl: ${this.proxyUrl})`);
  }

  /**
   * Normalize a URL to use HTTP/HTTPS protocol.
   * Converts WebSocket URLs (ws://, wss://) to their HTTP equivalents.
   *
   * @private
   * @param {string} url - The URL to normalize.
   * @returns {string} The URL with HTTP/HTTPS protocol.
   */
  _normalizeToHttpUrl(url) {
    if (!url) return url;
    // Convert wss:// to https:// and ws:// to http://
    return url.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  }

  /**
   * Initialize authentication state from stored session data.
   * Checks if we have a valid stored session.
   *
   * @private
   */
  _initializeFromStorage() {
    const token = getSessionToken();
    const user = getPatreonUser();

    if (token && user) {
      this.state = AuthState.LOGGED_IN;
      console.log(`${MODULE_NAME} | Found stored session for user: ${user.displayName}`);
    } else {
      this.state = AuthState.LOGGED_OUT;
    }
  }

  /**
   * Set up the postMessage listener for OAuth callbacks.
   *
   * @private
   */
  _setupMessageListener() {
    this._messageHandler = this._handleOAuthMessage.bind(this);
    window.addEventListener('message', this._messageHandler);
    console.log(`${MODULE_NAME} | OAuth message listener registered`);
  }

  /**
   * Handle incoming postMessage events from OAuth popup.
   *
   * @private
   * @param {MessageEvent} event - The message event.
   */
  async _handleOAuthMessage(event) {
    // Validate message structure
    if (!event.data || event.data.type !== OAUTH_CALLBACK_MESSAGE_TYPE) {
      return;
    }

    console.log(`${MODULE_NAME} | Received OAuth callback message`);

    // Validate origin - should be from our proxy server
    const expectedOrigin = new URL(this.proxyUrl).origin;
    if (event.origin !== expectedOrigin) {
      console.warn(`${MODULE_NAME} | OAuth message from unexpected origin: ${event.origin} (expected: ${expectedOrigin})`);
      // Still process if it's from the popup we opened
      if (!this._oauthPopup) {
        return;
      }
    }

    const { success, sessionToken, user, error } = event.data;

    // Close the popup if it's still open
    if (this._oauthPopup && !this._oauthPopup.closed) {
      this._oauthPopup.close();
    }
    this._oauthPopup = null;

    if (success && sessionToken) {
      await this._handleAuthSuccess(sessionToken, user);
    } else {
      this._handleAuthError(error || 'Authentication failed');
    }
  }

  /**
   * Handle successful authentication.
   *
   * @private
   * @param {string} sessionToken - The session token from the server.
   * @param {Object} user - User information from Patreon.
   */
  async _handleAuthSuccess(sessionToken, user) {
    console.log(`${MODULE_NAME} | Authentication successful for user: ${user?.displayName}`);

    try {
      // Store session token and user info
      await setSessionToken(sessionToken);
      await setPatreonUser(user);

      // Update state
      this.state = AuthState.LOGGED_IN;
      this.errorMessage = null;

      // Notify listeners
      this._emitStateChange();

      // Show success notification
      ui.notifications.info(`${MODULE_NAME}: Signed in as ${user?.displayName || 'Unknown'}`);

    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to store auth data:`, err);
      this._handleAuthError('Failed to save authentication data');
    }
  }

  /**
   * Handle authentication error.
   *
   * @private
   * @param {string} error - Error message.
   */
  _handleAuthError(error) {
    console.error(`${MODULE_NAME} | Authentication error: ${error}`);

    this.state = AuthState.ERROR;
    this.errorMessage = error;

    // Notify listeners
    this._emitStateChange();

    // Show error notification
    ui.notifications.error(`${MODULE_NAME}: ${error}`);
  }

  /**
   * Emit auth state change event.
   *
   * @private
   */
  _emitStateChange() {
    // Call registered callbacks
    for (const callback of this._stateChangeCallbacks) {
      try {
        callback(this.state, this.getUser());
      } catch (err) {
        console.error(`${MODULE_NAME} | State change callback error:`, err);
      }
    }

    // Dispatch DOM event for broader listeners
    const event = new CustomEvent(AUTH_STATE_CHANGED_EVENT, {
      detail: {
        state: this.state,
        user: this.getUser(),
        error: this.errorMessage
      }
    });
    window.dispatchEvent(event);
  }

  /**
   * Register a callback for auth state changes.
   *
   * @param {Function} callback - Callback function (state, user) => void.
   * @returns {Function} Unsubscribe function.
   */
  onStateChange(callback) {
    this._stateChangeCallbacks.push(callback);
    return () => {
      const index = this._stateChangeCallbacks.indexOf(callback);
      if (index > -1) {
        this._stateChangeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Start the OAuth authentication flow.
   * Opens a popup window to the Patreon authorization page.
   *
   * @returns {boolean} True if popup was opened successfully.
   */
  startOAuthFlow() {
    if (this.state === AuthState.LOGGING_IN) {
      console.warn(`${MODULE_NAME} | OAuth flow already in progress`);
      return false;
    }

    console.log(`${MODULE_NAME} | Starting OAuth flow`);

    // Update state
    this.state = AuthState.LOGGING_IN;
    this.errorMessage = null;
    this._emitStateChange();

    // Build OAuth URL
    const oauthUrl = `${this.proxyUrl}/auth/patreon`;

    // Calculate popup position (centered)
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    // Open popup
    const popupFeatures = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`;

    try {
      this._oauthPopup = window.open(oauthUrl, 'loremaster_patreon_auth', popupFeatures);

      if (!this._oauthPopup || this._oauthPopup.closed) {
        // Popup was blocked
        this._handlePopupBlocked();
        return false;
      }

      // Focus the popup
      this._oauthPopup.focus();

      // Set up popup close detection
      this._watchPopupClose();

      console.log(`${MODULE_NAME} | OAuth popup opened`);
      return true;

    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to open OAuth popup:`, err);
      this._handleAuthError('Failed to open login window');
      return false;
    }
  }

  /**
   * Handle case when popup is blocked by browser.
   *
   * @private
   */
  _handlePopupBlocked() {
    console.warn(`${MODULE_NAME} | OAuth popup was blocked`);

    this.state = AuthState.ERROR;
    this.errorMessage = 'Popup blocked. Please allow popups for this site and try again.';
    this._emitStateChange();

    // Show instructions
    ui.notifications.warn(
      `${MODULE_NAME}: Popup blocked. Please allow popups and try again, or open this URL manually: ${this.proxyUrl}/auth/patreon`,
      { permanent: true }
    );
  }

  /**
   * Watch for popup window closing without completing auth.
   *
   * @private
   */
  _watchPopupClose() {
    const checkPopup = setInterval(() => {
      if (!this._oauthPopup || this._oauthPopup.closed) {
        clearInterval(checkPopup);

        // If we're still in logging_in state, user closed popup without completing
        if (this.state === AuthState.LOGGING_IN) {
          console.log(`${MODULE_NAME} | OAuth popup closed without completing`);
          this.state = AuthState.LOGGED_OUT;
          this.errorMessage = null;
          this._emitStateChange();
        }
      }
    }, 500);

    // Stop checking after 5 minutes
    setTimeout(() => clearInterval(checkPopup), 5 * 60 * 1000);
  }

  /**
   * Check authentication status with the server.
   * Validates the current session token is still valid.
   *
   * @returns {Promise<Object>} Auth status response.
   */
  async checkAuthStatus() {
    const token = getSessionToken();

    if (!token) {
      return { authenticated: false, reason: 'No session token' };
    }

    try {
      const response = await fetch(`${this.proxyUrl}/auth/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid
          await this.logout(false); // Silent logout
          return { authenticated: false, reason: 'Session expired' };
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Update stored user info if provided
      if (data.user) {
        await setPatreonUser(data.user);
      }

      return {
        authenticated: true,
        user: data.user,
        quota: data.quota
      };

    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to check auth status:`, err);
      return { authenticated: false, reason: err.message };
    }
  }

  /**
   * Log out the current user.
   * Clears session token and user info.
   *
   * @param {boolean} [notify=true] - Whether to show notification.
   * @returns {Promise<void>}
   */
  async logout(notify = true) {
    console.log(`${MODULE_NAME} | Logging out`);

    const token = getSessionToken();

    // Clear local storage first
    await clearSessionToken();
    await clearPatreonUser();

    // Update state
    this.state = AuthState.LOGGED_OUT;
    this.errorMessage = null;
    this._emitStateChange();

    // Notify server (best effort, don't wait)
    if (token) {
      fetch(`${this.proxyUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }).catch(err => {
        console.warn(`${MODULE_NAME} | Failed to notify server of logout:`, err);
      });
    }

    if (notify) {
      ui.notifications.info(`${MODULE_NAME}: Signed out`);
    }
  }

  /**
   * Check if user is currently authenticated.
   *
   * @returns {boolean} True if authenticated.
   */
  isAuthenticated() {
    return this.state === AuthState.LOGGED_IN && !!getSessionToken();
  }

  /**
   * Get the current authentication state.
   *
   * @returns {AuthState} Current state.
   */
  getState() {
    return this.state;
  }

  /**
   * Get the current user info.
   *
   * @returns {Object|null} User info or null if not logged in.
   */
  getUser() {
    return getPatreonUser();
  }

  /**
   * Get the session token.
   *
   * @returns {string|null} Session token or null if not logged in.
   */
  getToken() {
    return getSessionToken();
  }

  /**
   * Clean up resources.
   * Call this when the module is being unloaded.
   */
  destroy() {
    // Remove message listener
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }

    // Close any open popup
    if (this._oauthPopup && !this._oauthPopup.closed) {
      this._oauthPopup.close();
    }
    this._oauthPopup = null;

    // Clear callbacks
    this._stateChangeCallbacks = [];

    console.log(`${MODULE_NAME} | PatreonAuthManager destroyed`);
  }
}

/**
 * Singleton instance of PatreonAuthManager.
 * @type {PatreonAuthManager|null}
 */
let authManagerInstance = null;

/**
 * Get or create the PatreonAuthManager singleton.
 *
 * @param {Object} [options] - Options to pass to constructor (only used on first call).
 * @returns {PatreonAuthManager} The auth manager instance.
 */
export function getAuthManager(options) {
  if (!authManagerInstance) {
    authManagerInstance = new PatreonAuthManager(options);
  }
  return authManagerInstance;
}

/**
 * Reset the auth manager singleton.
 * Useful for testing or when proxy URL changes.
 */
export function resetAuthManager() {
  if (authManagerInstance) {
    authManagerInstance.destroy();
    authManagerInstance = null;
  }
}
