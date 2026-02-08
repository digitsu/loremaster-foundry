/**
 * Loremaster Configuration
 *
 * Module settings registration and configuration management.
 * Includes custom settings panel with section headers, mode-aware
 * field visibility, and an inline account panel for hosted mode.
 */

import { getAuthManager, AuthState } from './patreon-auth.mjs';
import { TIER_CONFIG } from './patreon-login-ui.mjs';

const MODULE_ID = 'loremaster';
const MODULE_NAME = 'Loremaster';

/**
 * Hosted mode proxy URL.
 * Users connect to this URL when using hosted mode.
 */
const HOSTED_PROXY_URL = 'wss://elixir.loremastervtt.com/socket/websocket';

/**
 * Register all module settings.
 * Called during module initialization.
 */
export function registerSettings() {
  // Master enable/disable toggle
  game.settings.register(MODULE_ID, 'enabled', {
    name: 'Enable Loremaster',
    hint: 'Enable or disable Loremaster functionality.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true
  });

  // Server Mode setting - determines hosted vs self-hosted
  game.settings.register(MODULE_ID, 'serverMode', {
    name: 'Server Mode',
    hint: 'Hosted: Use Loremaster cloud service with Patreon subscription. Self-Hosted: Run your own proxy server with your own API key.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'hosted': 'Hosted (Patreon)',
      'self-hosted': 'Self-Hosted'
    },
    default: 'hosted',
    requiresReload: true,
    onChange: (value) => {
      // Auto-set proxy URL when switching to hosted mode
      if (value === 'hosted') {
        game.settings.set(MODULE_ID, 'proxyUrl', HOSTED_PROXY_URL);
      }
    }
  });

  // Proxy server URL (only shown in self-hosted mode)
  game.settings.register(MODULE_ID, 'proxyUrl', {
    name: 'Proxy Server URL',
    hint: 'URL of the Loremaster proxy server. Auto-configured in hosted mode.',
    scope: 'world',
    config: true,
    type: String,
    default: HOSTED_PROXY_URL
  });

  // API Key setting (only for self-hosted mode)
  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'Claude API Key',
    hint: 'Your Anthropic API key (self-hosted only). Not needed for hosted mode.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });

  // License Key setting (only for self-hosted mode)
  game.settings.register(MODULE_ID, 'licenseKey', {
    name: 'License Key',
    hint: 'Loremaster proxy license key (self-hosted only). Not needed for hosted mode.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });

  // Session Token (hidden - used internally for hosted mode authentication)
  game.settings.register(MODULE_ID, 'sessionToken', {
    scope: 'world',
    config: false,
    type: String,
    default: ''
  });

  // Patreon User Info (hidden - cached from OAuth)
  game.settings.register(MODULE_ID, 'patreonUser', {
    scope: 'world',
    config: false,
    type: Object,
    default: null
  });

  // Chat trigger prefix
  game.settings.register(MODULE_ID, 'triggerPrefix', {
    name: 'Chat Trigger Prefix',
    hint: 'Messages starting with this prefix will be sent to Loremaster. Default: @lm',
    scope: 'world',
    config: true,
    type: String,
    default: '@lm'
  });

  // AI response visibility
  game.settings.register(MODULE_ID, 'responseVisibility', {
    name: 'AI Response Visibility',
    hint: 'Who can see Loremaster responses.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'public': 'Everyone',
      'gm': 'GM Only',
      'whisper': 'Whisper to Requester'
    },
    default: 'public'
  });

  // GM Mode - all responses to GM only
  game.settings.register(MODULE_ID, 'gmMode', {
    name: 'GM Mode',
    hint: 'When enabled, all Loremaster responses are sent only to the GM. The GM reads dialogue and events aloud to players.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false
  });

  // Include game context in prompts
  game.settings.register(MODULE_ID, 'includeGameContext', {
    name: 'Include Game Context',
    hint: 'Include current scene, actors, and combat state in AI prompts.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // System-specific integration
  game.settings.register(MODULE_ID, 'systemIntegration', {
    name: 'Game System Integration',
    hint: 'Enable enhanced integration with the current game system.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // ===== Multi-Player Message Synchronization Settings =====

  // Batching Mode
  game.settings.register(MODULE_ID, 'batchingMode', {
    name: 'Message Batching Mode',
    hint: 'How to collect multiple player messages before sending to AI.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'timer': 'Timer (auto-send after delay)',
      'manual': 'Manual (GM triggers send)'
    },
    default: 'timer'
  });

  // Batch Timer Duration (5 seconds - 5 minutes)
  game.settings.register(MODULE_ID, 'batchTimerDuration', {
    name: 'Batch Timer Duration (seconds)',
    hint: 'Seconds to wait for additional messages before auto-sending (5 seconds - 5 minutes).',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 5,
      max: 300,
      step: 5
    },
    default: 10
  });

  // Player Message Visibility
  game.settings.register(MODULE_ID, 'playerMessageVisibility', {
    name: 'Player Message Visibility',
    hint: 'Who can see other players\' @lm messages before Loremaster responds.',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'all': 'All players see all messages',
      'gm_only': 'Only GM sees all messages',
      'private': 'Each player only sees their own'
    },
    default: 'all'
  });

  // GM Ruling Prefix
  game.settings.register(MODULE_ID, 'gmRulingPrefix', {
    name: 'GM Ruling Prefix',
    hint: 'Prefix for GM override instructions that Claude must follow.',
    scope: 'world',
    config: true,
    type: String,
    default: '[GM RULING:'
  });

  // Show Batch Indicator
  game.settings.register(MODULE_ID, 'showBatchIndicator', {
    name: 'Show Batch Collection Indicator',
    hint: 'Display a visual indicator when messages are being collected.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });

  // GM Send Keyword (for manual mode)
  game.settings.register(MODULE_ID, 'gmSendKeyword', {
    name: 'GM Send Keyword',
    hint: 'Keyword for GM to trigger immediate batch send (e.g., @lm !send).',
    scope: 'world',
    config: true,
    type: String,
    default: '!send'
  });

  // ===== Usage Monitoring Settings =====

  // Maximum tokens per month (for usage tracking display)
  game.settings.register(MODULE_ID, 'maxTokensPerMonth', {
    name: 'LOREMASTER.Settings.MaxTokensPerMonth.Name',
    hint: 'LOREMASTER.Settings.MaxTokensPerMonth.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 0
  });

  // Enhanced settings config hook — organizes settings into sections,
  // hides mode-irrelevant fields, and injects account panel in hosted mode
  Hooks.on('renderSettingsConfig', (app, html) => {
    enhanceSettingsPanel(app, html);
  });

  // Cleanup auth subscription when settings dialog closes
  Hooks.on('closeSettingsConfig', () => {
    cleanupSettingsPanel();
  });

  console.log(`${MODULE_ID} | Settings registered`);
}

/**
 * Get a module setting value.
 *
 * @param {string} key - The setting key.
 * @returns {*} The setting value.
 */
export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

/**
 * Set a module setting value.
 *
 * @param {string} key - The setting key.
 * @param {*} value - The value to set.
 * @returns {Promise} Promise that resolves when setting is saved.
 */
export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/**
 * Check if the module is in hosted mode.
 *
 * @returns {boolean} True if using hosted mode.
 */
export function isHostedMode() {
  return getSetting('serverMode') === 'hosted';
}

/**
 * Check if the module is in self-hosted mode.
 *
 * @returns {boolean} True if using self-hosted mode.
 */
export function isSelfHostedMode() {
  return getSetting('serverMode') === 'self-hosted';
}

/**
 * Get the session token for hosted mode.
 *
 * @returns {string|null} Session token or null if not set.
 */
export function getSessionToken() {
  return getSetting('sessionToken') || null;
}

/**
 * Set the session token for hosted mode.
 *
 * @param {string} token - The session token.
 * @returns {Promise} Promise that resolves when token is saved.
 */
export function setSessionToken(token) {
  return setSetting('sessionToken', token);
}

/**
 * Clear the session token (logout).
 *
 * @returns {Promise} Promise that resolves when token is cleared.
 */
export function clearSessionToken() {
  return setSetting('sessionToken', '');
}

/**
 * Get cached Patreon user info.
 *
 * @returns {Object|null} Patreon user object or null.
 */
export function getPatreonUser() {
  return getSetting('patreonUser');
}

/**
 * Set cached Patreon user info.
 *
 * @param {Object} user - Patreon user info.
 * @returns {Promise} Promise that resolves when user is saved.
 */
export function setPatreonUser(user) {
  return setSetting('patreonUser', user);
}

/**
 * Clear Patreon user info (logout).
 *
 * @returns {Promise} Promise that resolves when user is cleared.
 */
export function clearPatreonUser() {
  return setSetting('patreonUser', null);
}

/**
 * Get the hosted proxy URL constant.
 *
 * @returns {string} The hosted proxy URL.
 */
export function getHostedProxyUrl() {
  return HOSTED_PROXY_URL;
}

/**
 * Get the configured proxy URL.
 * Returns the user-configured URL or the hosted default.
 *
 * @returns {string} The proxy URL to use.
 */
export function getProxyUrl() {
  return getSetting('proxyUrl') || HOSTED_PROXY_URL;
}

// =====================================================================
// Settings Panel Enhancement
// =====================================================================

/**
 * Unsubscribe function for auth state listener, stored for cleanup
 * when the settings dialog closes.
 * @type {Function|null}
 */
let _settingsAuthUnsubscribe = null;

/**
 * Cached state for the inline account panel so we can
 * update it without re-rendering the entire settings dialog.
 * @type {Object}
 */
let _accountPanelState = {
  quota: null,
  isLoadingQuota: false,
  ragStatus: null,
  sharedTier: null,
  isRefreshingTier: false,
  quotaFetchAttempted: false
};

/**
 * Section definitions for organizing Loremaster settings.
 * Each section maps a header label to the setting keys it contains.
 * Order determines display order in the settings panel.
 *
 * @type {Array<{label: string, keys: string[], hostedOnly?: boolean, selfHostedOnly?: boolean}>}
 */
const SETTINGS_SECTIONS = [
  {
    label: 'Connection',
    keys: ['serverMode', 'proxyUrl', 'apiKey', 'licenseKey']
  },
  {
    label: 'Chat',
    keys: ['triggerPrefix', 'responseVisibility', 'gmMode']
  },
  {
    label: 'Context',
    keys: ['includeGameContext', 'systemIntegration']
  },
  {
    label: 'Multi-Player',
    keys: ['batchingMode', 'batchTimerDuration', 'playerMessageVisibility', 'gmRulingPrefix', 'showBatchIndicator', 'gmSendKeyword']
  },
  {
    label: 'Usage',
    keys: ['maxTokensPerMonth'],
    selfHostedOnly: true
  }
];

/**
 * Setting keys that should be hidden when in hosted mode.
 * These are self-hosted-only fields.
 * @type {string[]}
 */
const HOSTED_HIDDEN_FIELDS = ['proxyUrl', 'apiKey', 'licenseKey', 'maxTokensPerMonth'];

/**
 * Enhance the Foundry settings panel for Loremaster.
 * Hides mode-irrelevant fields, adds section headers, and injects the
 * account panel when in hosted mode.
 *
 * @param {Application} app - The SettingsConfig application instance.
 * @param {jQuery|HTMLElement} html - The rendered settings HTML.
 */
function enhanceSettingsPanel(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  const mode = game.settings.get(MODULE_ID, 'serverMode');
  const isHosted = mode === 'hosted';

  // Find the Loremaster settings section — look for our module's form groups
  const firstInput = root.querySelector(`[name="${MODULE_ID}.enabled"]`);
  if (!firstInput) return; // Loremaster settings not rendered (not a GM, etc.)

  // Walk up to find the section container that holds all loremaster settings.
  // In Foundry V13 this is typically a fieldset or a div with a module header.
  const loremasterSection = _findLoremasterSection(root, firstInput);
  if (!loremasterSection) return;

  // --- Inject CSS ---
  _injectSettingsStyles(loremasterSection);

  // --- Hide mode-irrelevant fields ---
  if (isHosted) {
    for (const fieldKey of HOSTED_HIDDEN_FIELDS) {
      _hideFormGroup(root, fieldKey);
    }
  }

  // --- Insert section headers ---
  _insertSectionHeaders(root, isHosted);

  // --- Inject account panel (hosted mode only) ---
  if (isHosted) {
    _injectAccountPanel(root, loremasterSection);
  }
}

/**
 * Clean up resources when the settings dialog closes.
 * Removes the auth state change subscription and resets panel state.
 */
function cleanupSettingsPanel() {
  if (_settingsAuthUnsubscribe) {
    _settingsAuthUnsubscribe();
    _settingsAuthUnsubscribe = null;
  }
  // Reset panel state for next open
  _accountPanelState = {
    quota: null,
    isLoadingQuota: false,
    ragStatus: null,
    sharedTier: null,
    isRefreshingTier: false,
    quotaFetchAttempted: false
  };
}

/**
 * Find the Loremaster settings section element that contains all our form groups.
 * Works with Foundry V12 (section with h2 header) and V13 (fieldset or div).
 *
 * @param {HTMLElement} root - The settings dialog root element.
 * @param {HTMLElement} firstInput - The first Loremaster input element.
 * @returns {HTMLElement|null} The section container, or null if not found.
 */
function _findLoremasterSection(root, firstInput) {
  // Walk up from the first input to find the module section.
  // In V13, settings are grouped under a section with a data-tab or a fieldset.
  let el = firstInput.closest('.form-group');
  if (!el) return null;

  // Keep walking up to find the module-level container.
  // Look for a parent that is a direct child of the settings form content area.
  let section = el.parentElement;

  // V13 uses a <fieldset> per module, V12 uses a <div class="tab"> or similar
  while (section && !section.matches('fieldset, [data-tab], .tab')) {
    section = section.parentElement;
    // Safety: don't walk past the dialog element
    if (section === root || !section) break;
  }

  return section || el.parentElement;
}

/**
 * Hide a form group by setting display:none.
 *
 * @param {HTMLElement} root - The settings dialog root element.
 * @param {string} settingKey - The setting key (without module prefix).
 */
function _hideFormGroup(root, settingKey) {
  const input = root.querySelector(`[name="${MODULE_ID}.${settingKey}"]`);
  if (!input) return;

  const formGroup = input.closest('.form-group');
  if (formGroup) {
    formGroup.style.display = 'none';
  }
}

/**
 * Insert section header dividers between groups of settings.
 * Each header is placed before the first setting in its section.
 *
 * @param {HTMLElement} root - The settings dialog root element.
 * @param {boolean} isHosted - Whether hosted mode is active.
 */
function _insertSectionHeaders(root, isHosted) {
  for (const section of SETTINGS_SECTIONS) {
    // Skip sections that don't apply to the current mode
    if (section.hostedOnly && !isHosted) continue;
    if (section.selfHostedOnly && isHosted) continue;

    // Find the first visible setting key in this section
    const firstVisibleKey = section.keys.find((key) => {
      // Skip hidden fields
      if (isHosted && HOSTED_HIDDEN_FIELDS.includes(key)) return false;
      const input = root.querySelector(`[name="${MODULE_ID}.${key}"]`);
      if (!input) return false;
      const fg = input.closest('.form-group');
      return fg && fg.style.display !== 'none';
    });

    if (!firstVisibleKey) continue;

    const input = root.querySelector(`[name="${MODULE_ID}.${firstVisibleKey}"]`);
    const formGroup = input?.closest('.form-group');
    if (!formGroup) continue;

    // Create section header
    const header = document.createElement('div');
    header.classList.add('loremaster-settings-section');
    header.innerHTML = `<span class="loremaster-section-label">${section.label}</span>`;

    formGroup.parentElement.insertBefore(header, formGroup);
  }
}

/**
 * Inject the inline account panel into the settings dialog (hosted mode only).
 * Placed after the "enabled" toggle, before the Connection section.
 *
 * @param {HTMLElement} root - The settings dialog root element.
 * @param {HTMLElement} section - The Loremaster settings section container.
 */
function _injectAccountPanel(root, section) {
  const authManager = getAuthManager();

  // Create account panel container
  const panelContainer = document.createElement('div');
  panelContainer.classList.add('loremaster-account-panel');
  panelContainer.id = 'loremaster-settings-account-panel';

  // Insert after the "enabled" toggle, before the first section header
  const enabledInput = root.querySelector(`[name="${MODULE_ID}.enabled"]`);
  const enabledFormGroup = enabledInput?.closest('.form-group');
  if (enabledFormGroup && enabledFormGroup.nextSibling) {
    enabledFormGroup.parentElement.insertBefore(panelContainer, enabledFormGroup.nextSibling);
  } else {
    // Fallback: insert at the beginning of section
    section.insertBefore(panelContainer, section.firstChild);
  }

  // Add section header for Account
  const accountHeader = document.createElement('div');
  accountHeader.classList.add('loremaster-settings-section');
  accountHeader.innerHTML = '<span class="loremaster-section-label">Account</span>';
  panelContainer.parentElement.insertBefore(accountHeader, panelContainer);

  // Render initial state
  _renderAccountPanel(panelContainer, authManager);

  // Subscribe to auth state changes for live updates
  _settingsAuthUnsubscribe = authManager.onStateChange(() => {
    const panel = document.getElementById('loremaster-settings-account-panel');
    if (panel) {
      _renderAccountPanel(panel, authManager);
    }
  });

  // Fetch quota/status if already logged in
  if (authManager.isAuthenticated()) {
    _fetchAccountData(authManager);
  }
}

/**
 * Render the account panel HTML based on current auth state.
 * Replaces the panel's innerHTML and attaches event listeners.
 *
 * @param {HTMLElement} container - The account panel container element.
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
function _renderAccountPanel(container, authManager) {
  const state = authManager.getState();
  const user = authManager.getUser();

  let html = '';

  if (state === AuthState.LOGGED_OUT) {
    html = _buildLoggedOutPanel();
  } else if (state === AuthState.LOGGING_IN) {
    html = _buildLoggingInPanel();
  } else if (state === AuthState.LOGGED_IN) {
    html = _buildLoggedInPanel(user);
  } else if (state === AuthState.ERROR) {
    html = _buildErrorPanel(authManager.errorMessage);
  }

  container.innerHTML = html;
  _attachAccountPanelListeners(container, authManager);
}

/**
 * Build HTML for the logged-out account panel state.
 * Shows sign-in and paste-token buttons.
 *
 * @returns {string} HTML string for the logged-out panel.
 */
function _buildLoggedOutPanel() {
  return `
    <div class="lm-account-state lm-account-state--logged-out">
      <div class="lm-account-logo">
        <i class="fas fa-book-open fa-2x"></i>
      </div>
      <div class="lm-account-message">
        <h3>Connect Your Account</h3>
        <p>Sign in with Patreon to use the Loremaster hosted service.</p>
      </div>
      <button type="button" class="lm-signin-btn" data-action="signin">
        <span class="lm-patreon-icon">&#127359;&#65039;</span>
        Sign in with Patreon
      </button>
      <div class="lm-account-divider"><span>or</span></div>
      <button type="button" class="lm-paste-token-btn" data-action="paste-token">
        <i class="fas fa-paste"></i>
        Paste Token Manually
      </button>
      <div class="lm-account-footer">
        <p class="lm-footer-text">Don't have a subscription?</p>
        <a href="https://patreon.com/loremastervtt" target="_blank" class="lm-subscribe-link">Subscribe on Patreon &rarr;</a>
      </div>
    </div>
  `;
}

/**
 * Build HTML for the logging-in account panel state.
 * Shows a spinner and paste-token option.
 *
 * @returns {string} HTML string for the logging-in panel.
 */
function _buildLoggingInPanel() {
  return `
    <div class="lm-account-state lm-account-state--logging-in">
      <div class="lm-account-spinner">
        <i class="fas fa-spinner fa-spin fa-2x"></i>
      </div>
      <div class="lm-account-message">
        <h3>Signing In...</h3>
        <p>Complete the authorization in the popup window.</p>
        <p class="lm-account-hint">If the popup was blocked, allow popups and try again.</p>
      </div>
      <div class="lm-account-divider"><span>or</span></div>
      <button type="button" class="lm-paste-token-btn" data-action="paste-token">
        <i class="fas fa-paste"></i>
        Paste Token Manually
      </button>
    </div>
  `;
}

/**
 * Build HTML for the logged-in account panel state.
 * Shows user info, tier badge, RAG status, shared resources, and quota.
 *
 * @param {Object} user - The authenticated user object.
 * @returns {string} HTML string for the logged-in panel.
 */
function _buildLoggedInPanel(user) {
  const displayName = user?.displayName || 'Unknown';
  const email = user?.email || '';
  const tierName = user?.tierName?.toLowerCase() || 'basic';
  const tierCfg = TIER_CONFIG[tierName] || TIER_CONFIG.basic;

  // Quota display
  const { quota, isLoadingQuota, ragStatus, sharedTier, isRefreshingTier } = _accountPanelState;
  const tokensUsed = quota?.tokensUsed || 0;
  const tokensLimit = quota?.tokensLimit || tierCfg.tokenLimit;
  const quotaPercent = tokensLimit > 0 ? Math.min((tokensUsed / tokensLimit) * 100, 100).toFixed(1) : 0;
  const quotaLevel = tokensLimit > 0 ? ((tokensUsed / tokensLimit) * 100 >= 90 ? 'critical' : (tokensUsed / tokensLimit) * 100 >= 75 ? 'warning' : 'normal') : 'normal';
  const quotaResetDate = quota?.resetDate ? new Date(quota.resetDate).toLocaleDateString() : null;

  // RAG status
  const ragAvailable = ragStatus?.ragAvailable ?? false;
  const ragRequiredTier = ragStatus?.ragRequiredTier || 'Pro';

  // Shared tier
  const sharedCurrent = sharedTier?.tier?.current || 0;
  const sharedMax = sharedTier?.tier?.max || 0;
  const sharedUnlimited = sharedTier?.tier?.max === -1;
  const sharedLevel = sharedMax === 0 ? 'none' : (sharedMax === -1 ? 'available' : (sharedCurrent >= sharedMax ? 'at-limit' : 'available'));

  // Refresh tier button spinning state
  const refreshTierClass = isRefreshingTier ? 'refreshing' : '';

  let sharedHtml = '';
  if (sharedUnlimited) {
    sharedHtml = `<span class="lm-shared-count">${sharedCurrent} activated (unlimited)</span>
      <a href="#" class="lm-manage-shared-link" data-action="manage-shared">[Manage]</a>`;
  } else if (sharedMax === 0) {
    sharedHtml = `<span class="lm-shared-count">Upgrade to access</span>
      <a href="https://patreon.com/loremastervtt" target="_blank" class="lm-subscribe-link">Subscribe &rarr;</a>`;
  } else {
    sharedHtml = `<span class="lm-shared-count">${sharedCurrent} / ${sharedMax} activated</span>
      <a href="#" class="lm-manage-shared-link" data-action="manage-shared">[Manage]</a>`;
  }

  let quotaBarHtml = '';
  if (quota) {
    quotaBarHtml = `
      <div class="lm-quota-bar-container">
        <div class="lm-quota-bar lm-quota-bar--${quotaLevel}" style="width: ${quotaPercent}%"></div>
      </div>
      <div class="lm-quota-details">
        <span class="lm-quota-used">${_formatTokens(tokensUsed)}</span>
        <span class="lm-quota-separator">/</span>
        <span class="lm-quota-limit">${_formatTokens(tokensLimit)}</span>
        <span class="lm-quota-percent">(${quotaPercent}%)</span>
      </div>
      ${quotaResetDate ? `<div class="lm-quota-reset">Resets: ${quotaResetDate}</div>` : ''}
    `;
  } else {
    quotaBarHtml = `
      <div class="lm-quota-bar-container">
        <div class="lm-quota-bar" style="width: 0%"></div>
      </div>
      <div class="lm-quota-details">
        <span class="lm-quota-limit">${_formatTokens(tierCfg.tokenLimit)} tokens/month</span>
      </div>
    `;
  }

  return `
    <div class="lm-account-state lm-account-state--logged-in">
      <div class="lm-account-header">
        <div class="lm-status-icon">&#10003;</div>
        <span class="lm-status-text">Connected</span>
      </div>

      <div class="lm-user-info">
        <div class="lm-user-name">${displayName}</div>
        ${email ? `<div class="lm-user-email">${email}</div>` : ''}
      </div>

      <div class="lm-tier" style="border-color: ${tierCfg.color}">
        <span class="lm-tier-icon">${tierCfg.icon}</span>
        <span class="lm-tier-name" style="color: ${tierCfg.color}">${tierCfg.label}</span>
        <button type="button" class="lm-refresh-tier-btn ${refreshTierClass}" data-action="refresh-tier" title="Refresh tier from Patreon">
          <i class="fas fa-sync-alt"></i>
        </button>
      </div>

      <div class="lm-rag-status ${ragAvailable ? 'rag-unlocked' : 'rag-locked'}">
        ${ragAvailable
          ? '<span class="lm-rag-icon">&#128275;</span><span class="lm-rag-text">Advanced RAG Enabled</span>'
          : `<span class="lm-rag-icon">&#128274;</span><span class="lm-rag-text">Advanced RAG Locked</span><span class="lm-rag-hint">(Requires ${ragRequiredTier} tier)</span>`
        }
      </div>

      <div class="lm-shared-resources shared-${sharedLevel}">
        <span class="lm-shared-icon">&#128218;</span>
        <span class="lm-shared-text">Shared Resources:</span>
        ${sharedHtml}
      </div>

      <div class="lm-quota">
        <div class="lm-quota-header">
          <span class="lm-quota-title">Monthly Usage</span>
          ${isLoadingQuota
            ? '<i class="fas fa-spinner fa-spin"></i>'
            : '<button type="button" class="lm-refresh-quota-btn" data-action="refresh-quota" title="Refresh"><i class="fas fa-sync-alt"></i></button>'
          }
        </div>
        ${quotaBarHtml}
      </div>

      <div class="lm-account-actions">
        <button type="button" class="lm-signout-btn" data-action="signout">
          <i class="fas fa-sign-out-alt"></i>
          Sign Out
        </button>
      </div>
    </div>
  `;
}

/**
 * Build HTML for the error account panel state.
 * Shows error message with retry and paste-token options.
 *
 * @param {string} errorMessage - The error message to display.
 * @returns {string} HTML string for the error panel.
 */
function _buildErrorPanel(errorMessage) {
  return `
    <div class="lm-account-state lm-account-state--error">
      <div class="lm-account-error-icon">
        <i class="fas fa-exclamation-triangle fa-2x"></i>
      </div>
      <div class="lm-account-message">
        <h3>Authentication Failed</h3>
        <p class="lm-error-text">${errorMessage || 'Unknown error'}</p>
      </div>
      <button type="button" class="lm-retry-btn" data-action="signin">
        <i class="fas fa-redo"></i>
        Try Again
      </button>
      <div class="lm-account-divider"><span>or</span></div>
      <button type="button" class="lm-paste-token-btn" data-action="paste-token">
        <i class="fas fa-paste"></i>
        Paste Token Manually
      </button>
      <div class="lm-account-footer">
        <a href="https://patreon.com/loremastervtt" target="_blank" class="lm-subscribe-link">Subscribe on Patreon &rarr;</a>
      </div>
    </div>
  `;
}

/**
 * Attach event listeners to all interactive elements in the account panel.
 * Uses data-action attributes for delegation.
 *
 * @param {HTMLElement} container - The account panel container.
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
function _attachAccountPanelListeners(container, authManager) {
  // Delegate clicks via data-action attributes
  container.addEventListener('click', async (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    event.preventDefault();

    const action = actionEl.dataset.action;

    switch (action) {
      case 'signin':
        authManager.startOAuthFlow();
        break;

      case 'signout':
        await _handleSignOut(authManager);
        break;

      case 'paste-token':
        await _handlePasteToken(authManager);
        break;

      case 'refresh-quota':
        _accountPanelState.quotaFetchAttempted = false;
        _fetchAccountData(authManager);
        break;

      case 'refresh-tier':
        await _handleRefreshTier(authManager);
        break;

      case 'manage-shared':
        if (game.loremaster?.openContentManager) {
          game.loremaster.openContentManager();
        } else {
          ui.notifications.warn(`${MODULE_NAME}: Content Manager not available`);
        }
        break;
    }
  });
}

/**
 * Handle sign out from the settings account panel.
 * Shows confirmation dialog, then logs out and clears panel state.
 *
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
async function _handleSignOut(authManager) {
  const confirmed = await Dialog.confirm({
    title: 'Sign Out',
    content: '<p>Are you sure you want to sign out of Loremaster?</p>',
    yes: () => true,
    no: () => false,
    defaultYes: false
  });

  if (confirmed) {
    await authManager.logout();
    _accountPanelState.quota = null;
    _accountPanelState.ragStatus = null;
    _accountPanelState.sharedTier = null;
  }
}

/**
 * Handle paste token action from the settings account panel.
 * Shows a dialog to manually enter a session token, validates it,
 * and updates auth state on success.
 *
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
async function _handlePasteToken(authManager) {
  const content = `
    <form>
      <div class="form-group">
        <label>Session Token</label>
        <input type="text" name="token" placeholder="Paste your session token here..."
          style="width: 100%; font-family: monospace;">
        <p class="notes" style="margin-top: 0.5rem;">
          Copy the token from the Patreon authorization success page.
        </p>
      </div>
    </form>
  `;

  const token = await Dialog.prompt({
    title: 'Enter Session Token',
    content,
    label: 'Connect',
    callback: (html) => {
      return html.find('input[name="token"]').val()?.trim();
    },
    rejectClose: false
  });

  if (token) {
    // Import config setters dynamically to avoid circular issues at module top
    await setSessionToken(token);

    try {
      const status = await authManager.checkAuthStatus();
      if (status.authenticated) {
        ui.notifications.info(`${MODULE_NAME}: Connected successfully!`);
        authManager.state = AuthState.LOGGED_IN;
        authManager._emitStateChange();
      } else {
        await clearSessionToken();
        ui.notifications.error(`${MODULE_NAME}: Invalid token - ${status.reason}`);
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Token validation error:`, err);
      await clearSessionToken();
      ui.notifications.error(`${MODULE_NAME}: Failed to validate token`);
    }
  }
}

/**
 * Handle refresh tier action from the settings account panel.
 * Calls the proxy server to re-verify Patreon membership and update tier.
 *
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
async function _handleRefreshTier(authManager) {
  if (_accountPanelState.isRefreshingTier) return;

  _accountPanelState.isRefreshingTier = true;
  _rerenderAccountPanel(authManager);

  try {
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
        _accountPanelState.ragStatus = {
          ragAvailable: result.ragAvailable,
          ragRequiredTier: result.ragRequiredTier
        };
      } else {
        ui.notifications.info(`${MODULE_NAME}: Tier verified (${result.newTier})`);
      }

      if (authManager.user) {
        authManager.user.tierName = result.newTier;
        authManager.user.patronStatus = result.patronStatus;
      }
    } else {
      ui.notifications.error(`${MODULE_NAME}: ${result.error || 'Failed to verify tier'}`);
    }
  } catch (err) {
    console.error(`${MODULE_NAME} | Tier refresh error:`, err);
    ui.notifications.error(`${MODULE_NAME}: Failed to refresh tier`);
  } finally {
    _accountPanelState.isRefreshingTier = false;
    _rerenderAccountPanel(authManager);
  }
}

/**
 * Fetch quota, RAG status, and shared tier data for the account panel.
 * Updates the cached state and re-renders the panel.
 *
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
async function _fetchAccountData(authManager) {
  if (!authManager.isAuthenticated()) {
    _accountPanelState.quota = null;
    return;
  }

  if (_accountPanelState.isLoadingQuota || _accountPanelState.quotaFetchAttempted) {
    return;
  }

  _accountPanelState.isLoadingQuota = true;
  _accountPanelState.quotaFetchAttempted = true;
  _rerenderAccountPanel(authManager);

  try {
    const status = await authManager.checkAuthStatus();
    if (status.authenticated && status.quota) {
      _accountPanelState.quota = status.quota;
    }
  } catch (err) {
    console.error(`${MODULE_NAME} | Failed to fetch quota:`, err);
  } finally {
    _accountPanelState.isLoadingQuota = false;
    _rerenderAccountPanel(authManager);
  }

  // Also fetch RAG and shared tier (non-blocking)
  _fetchRagStatus();
  _fetchSharedTierStatus();
}

/**
 * Fetch RAG status from the server via socket client.
 * Updates panel state and re-renders on success.
 */
async function _fetchRagStatus() {
  try {
    const loremaster = game.modules.get('loremaster');
    const socketClient = loremaster?.api?.getSocketClient?.();

    if (socketClient && socketClient.isAuthenticated) {
      const ragStatus = await socketClient.getRagStatus();
      _accountPanelState.ragStatus = ragStatus;
      _rerenderAccountPanel(getAuthManager());
    }
  } catch (err) {
    console.error(`${MODULE_NAME} | Failed to fetch RAG status:`, err);
  }
}

/**
 * Fetch shared tier status from the server via socket client.
 * Updates panel state and re-renders on success.
 */
async function _fetchSharedTierStatus() {
  try {
    const loremaster = game.modules.get('loremaster');
    const socketClient = loremaster?.api?.getSocketClient?.();

    if (socketClient && socketClient.isAuthenticated) {
      const sharedTier = await socketClient.getSharedTierStatus();
      _accountPanelState.sharedTier = sharedTier;
      _rerenderAccountPanel(getAuthManager());
    }
  } catch (err) {
    console.error(`${MODULE_NAME} | Failed to fetch shared tier status:`, err);
  }
}

/**
 * Re-render the account panel in-place if it exists in the DOM.
 *
 * @param {PatreonAuthManager} authManager - The auth manager instance.
 */
function _rerenderAccountPanel(authManager) {
  const panel = document.getElementById('loremaster-settings-account-panel');
  if (panel) {
    _renderAccountPanel(panel, authManager);
  }
}

/**
 * Format a token number with K/M suffix for display.
 *
 * @param {number} num - The token count.
 * @returns {string} Formatted string (e.g., "1.5M", "500K", "0").
 */
function _formatTokens(num) {
  if (typeof num !== 'number' || isNaN(num)) return '0';
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(0)}K`;
  }
  return num.toLocaleString();
}

/**
 * Inject CSS styles for the custom settings panel elements.
 * Adds a <style> block at the top of the Loremaster settings section.
 *
 * @param {HTMLElement} section - The Loremaster settings section container.
 */
function _injectSettingsStyles(section) {
  // Avoid injecting styles multiple times
  if (section.querySelector('#loremaster-settings-styles')) return;

  const style = document.createElement('style');
  style.id = 'loremaster-settings-styles';
  style.textContent = `
    /* ============================
       Loremaster Settings Sections
       ============================ */

    .loremaster-settings-section {
      display: flex;
      align-items: center;
      margin: 1rem 0 0.5rem 0;
      padding: 0;
    }

    .loremaster-settings-section::before,
    .loremaster-settings-section::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-border-light, #b5b3a4);
    }

    .loremaster-section-label {
      padding: 0 0.75rem;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--color-text-dark-secondary, #4b4a44);
      white-space: nowrap;
    }

    /* ============================
       Loremaster Account Panel
       ============================ */

    .loremaster-account-panel {
      margin: 0.5rem 0 0.75rem 0;
      padding: 1rem;
      background: var(--color-bg-option, rgba(0,0,0,0.05));
      border: 1px solid var(--color-border-light, #b5b3a4);
      border-radius: 8px;
    }

    .lm-account-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.75rem;
    }

    /* Logo */
    .lm-account-logo {
      color: #d4af37;
      filter: drop-shadow(0 0 10px rgba(212, 175, 55, 0.3));
    }

    /* Messages */
    .lm-account-message h3 {
      margin: 0 0 0.25rem 0;
      font-size: 1.1rem;
      color: var(--color-text-dark-primary, #191813);
    }

    .lm-account-message p {
      margin: 0;
      color: var(--color-text-dark-secondary, #4b4a44);
      font-size: 0.85rem;
    }

    .lm-account-hint {
      font-size: 0.75rem !important;
      color: var(--color-text-dark-tertiary, #7a7971) !important;
      font-style: italic;
    }

    /* Sign in button */
    .lm-signin-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.6rem 1.25rem;
      font-size: 0.95rem;
      font-weight: 600;
      color: #ffffff;
      background: linear-gradient(135deg, #f96854 0%, #ff424d 100%);
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      width: 100%;
      max-width: 260px;
    }

    .lm-signin-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(249, 104, 84, 0.4);
    }

    .lm-patreon-icon {
      font-size: 1.1rem;
    }

    /* Divider */
    .lm-account-divider {
      display: flex;
      align-items: center;
      width: 100%;
      max-width: 260px;
      margin: 0.25rem 0;
    }

    .lm-account-divider::before,
    .lm-account-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-border-light);
    }

    .lm-account-divider span {
      padding: 0 0.75rem;
      color: var(--color-text-dark-secondary, #4b4a44);
      font-size: 0.8rem;
    }

    /* Paste token button */
    .lm-paste-token-btn,
    .lm-retry-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      font-size: 0.85rem;
      color: var(--color-text-dark-primary, #191813);
      background: var(--color-bg-btn);
      border: 1px solid var(--color-border-light);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
      max-width: 260px;
    }

    .lm-paste-token-btn:hover,
    .lm-retry-btn:hover {
      border-color: #d4af37;
      color: #d4af37;
    }

    /* Footer */
    .lm-account-footer {
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--color-border-light);
      width: 100%;
    }

    .lm-footer-text {
      margin: 0 0 0.25rem 0;
      font-size: 0.8rem;
      color: var(--color-text-dark-secondary, #4b4a44);
    }

    .lm-subscribe-link {
      color: #d4af37;
      text-decoration: none;
      font-size: 0.85rem;
      transition: color 0.2s;
    }

    .lm-subscribe-link:hover {
      color: #f4d03f;
      text-decoration: underline;
    }

    /* Spinner */
    .lm-account-spinner {
      color: #d4af37;
      margin: 0.5rem 0;
    }

    /* Logged-in: status header */
    .lm-account-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      background: rgba(74, 222, 128, 0.15);
      border: 1px solid rgba(74, 222, 128, 0.3);
      border-radius: 20px;
    }

    .lm-status-icon {
      color: #4ade80;
      font-weight: bold;
    }

    .lm-status-text {
      color: #4ade80;
      font-weight: 600;
      font-size: 0.85rem;
    }

    .lm-user-info {
      margin: 0.25rem 0;
    }

    .lm-user-name {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text-dark-primary, #191813);
    }

    .lm-user-email {
      font-size: 0.8rem;
      color: var(--color-text-dark-secondary, #4b4a44);
    }

    /* Tier badge */
    .lm-tier {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      background: rgba(212, 175, 55, 0.1);
      border: 1px solid;
      border-radius: 20px;
    }

    .lm-tier-icon {
      font-size: 0.85rem;
    }

    .lm-tier-name {
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .lm-refresh-tier-btn {
      background: none;
      border: none;
      color: var(--color-text-dark-secondary, #4b4a44);
      cursor: pointer;
      padding: 0.2rem;
      margin-left: 0.25rem;
      transition: color 0.2s, transform 0.3s;
    }

    .lm-refresh-tier-btn:hover {
      color: #d4af37;
    }

    .lm-refresh-tier-btn.refreshing {
      animation: lm-spin 1s linear infinite;
    }

    @keyframes lm-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* RAG status */
    .lm-rag-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8rem;
      width: 100%;
    }

    .lm-rag-status.rag-unlocked {
      background: rgba(74, 222, 128, 0.15);
      border: 1px solid rgba(74, 222, 128, 0.3);
      color: #4ade80;
    }

    .lm-rag-status.rag-locked {
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.2);
      color: var(--color-text-dark-secondary, #4b4a44);
    }

    .lm-rag-icon {
      font-size: 0.9rem;
    }

    .lm-rag-text {
      font-weight: 600;
    }

    .lm-rag-hint {
      font-size: 0.7rem;
      color: var(--color-text-dark-tertiary, #7a7971);
      font-style: italic;
    }

    /* Shared resources */
    .lm-shared-resources {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8rem;
      width: 100%;
    }

    .lm-shared-resources.shared-available {
      background: rgba(74, 222, 128, 0.15);
      border: 1px solid rgba(74, 222, 128, 0.3);
      color: #4ade80;
    }

    .lm-shared-resources.shared-at-limit {
      background: rgba(251, 191, 36, 0.15);
      border: 1px solid rgba(251, 191, 36, 0.3);
      color: #fbbf24;
    }

    .lm-shared-resources.shared-none {
      background: rgba(156, 163, 175, 0.15);
      border: 1px solid rgba(156, 163, 175, 0.3);
      color: var(--color-text-dark-secondary, #4b4a44);
    }

    .lm-shared-icon {
      font-size: 0.9rem;
    }

    .lm-shared-text {
      font-weight: 600;
    }

    .lm-shared-count {
      font-size: 0.8rem;
    }

    .lm-manage-shared-link {
      color: #d4af37;
      text-decoration: none;
      font-size: 0.8rem;
      font-weight: 600;
      margin-left: 0.25rem;
      transition: color 0.2s;
      cursor: pointer;
    }

    .lm-manage-shared-link:hover {
      color: #f4d03f;
      text-decoration: underline;
    }

    /* Quota */
    .lm-quota {
      width: 100%;
      padding: 0.75rem;
      background: var(--color-bg-option);
      border: 1px solid var(--color-border-light);
      border-radius: 8px;
    }

    .lm-quota-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .lm-quota-title {
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--color-text-dark-primary, #191813);
    }

    .lm-refresh-quota-btn {
      background: none;
      border: none;
      color: var(--color-text-dark-secondary, #4b4a44);
      cursor: pointer;
      padding: 0.2rem;
      transition: color 0.2s;
    }

    .lm-refresh-quota-btn:hover {
      color: #d4af37;
    }

    .lm-quota-bar-container {
      height: 10px;
      background: var(--color-bg-btn);
      border-radius: 5px;
      overflow: hidden;
      margin-bottom: 0.4rem;
    }

    .lm-quota-bar {
      height: 100%;
      background: linear-gradient(90deg, #4ade80 0%, #22c55e 100%);
      border-radius: 5px;
      transition: width 0.3s ease;
    }

    .lm-quota-bar--warning {
      background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%);
    }

    .lm-quota-bar--critical {
      background: linear-gradient(90deg, #f87171 0%, #ef4444 100%);
    }

    .lm-quota-details {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      font-size: 0.8rem;
      color: var(--color-text-dark-primary, #191813);
    }

    .lm-quota-used {
      font-weight: 600;
    }

    .lm-quota-separator {
      color: var(--color-text-dark-secondary, #4b4a44);
    }

    .lm-quota-percent {
      color: var(--color-text-dark-secondary, #4b4a44);
      font-size: 0.75rem;
    }

    .lm-quota-reset {
      margin-top: 0.35rem;
      font-size: 0.75rem;
      color: var(--color-text-dark-secondary, #4b4a44);
      text-align: center;
    }

    .lm-quota-limit {
      color: var(--color-text-dark-secondary, #4b4a44);
    }

    /* Sign out button */
    .lm-account-actions {
      width: 100%;
    }

    .lm-signout-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.45rem 0.75rem;
      font-size: 0.85rem;
      color: var(--color-text-dark-secondary, #4b4a44);
      background: var(--color-bg-btn);
      border: 1px solid var(--color-border-light);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      width: 100%;
    }

    .lm-signout-btn:hover {
      color: var(--color-text-dark-primary, #191813);
      border-color: var(--color-border-dark-highlight, #7a7971);
    }

    /* Error state */
    .lm-account-state--error .lm-account-error-icon {
      color: #f87171;
      margin: 0.25rem 0;
    }

    .lm-error-text {
      color: #f87171 !important;
    }
  `;

  section.insertBefore(style, section.firstChild);
}
