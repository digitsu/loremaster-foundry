/**
 * Loremaster Configuration
 *
 * Module settings registration and configuration management.
 */

const MODULE_ID = 'loremaster';

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

  // Proxy server URL
  game.settings.register(MODULE_ID, 'proxyUrl', {
    name: 'Proxy Server URL',
    hint: 'URL of the Loremaster proxy server (e.g., http://localhost:3001).',
    scope: 'world',
    config: true,
    type: String,
    default: 'http://localhost:3001'
  });

  // API Key setting (stored securely, sent to proxy on first connection)
  game.settings.register(MODULE_ID, 'apiKey', {
    name: 'Claude API Key',
    hint: 'Your Anthropic API key for Claude. This is sent to the proxy server and stored encrypted.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });

  // License Key setting (for self-hosted proxy servers)
  game.settings.register(MODULE_ID, 'licenseKey', {
    name: 'License Key',
    hint: 'Loremaster proxy license key (format: LM-XXXX-XXXX-XXXX-XXXX). Required for production servers.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
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

  // Batch Timer Duration (3-30 seconds)
  game.settings.register(MODULE_ID, 'batchTimerDuration', {
    name: 'Batch Timer Duration (seconds)',
    hint: 'Seconds to wait for additional messages before auto-sending (3-30 seconds).',
    scope: 'world',
    config: true,
    type: Number,
    range: {
      min: 3,
      max: 30,
      step: 1
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
