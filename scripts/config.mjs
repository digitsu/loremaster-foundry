/**
 * Loremaster Configuration
 *
 * Module settings registration and configuration management.
 */

const MODULE_ID = 'loremaster';

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

  // Disable hosted-managed fields when in hosted mode
  Hooks.on('renderSettingsConfig', (app, html) => {
    const mode = game.settings.get(MODULE_ID, 'serverMode');
    if (mode === 'hosted') {
      const hostedOnlyFields = ['proxyUrl', 'apiKey', 'licenseKey'];
      for (const field of hostedOnlyFields) {
        const input = html[0].querySelector(`[name="loremaster.${field}"]`);
        if (input) {
          input.disabled = true;
          input.style.opacity = '0.5';
        }
      }
    }
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
