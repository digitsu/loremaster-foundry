/**
 * Loremaster Module
 *
 * Main entry point for the AI-powered Loremaster integration.
 * Provides chat-based interaction with Loremaster through the Foundry VTT interface.
 * Uses a WebSocket connection to the Loremaster proxy server for Claude API access.
 */

import { registerSettings, getSetting, isHostedMode } from './config.mjs';
import { ChatHandler } from './chat-handler.mjs';
import { SocketClient } from './socket-client.mjs';
import { registerToolHandlers } from './tool-handlers.mjs';
import { MessageBatcher } from './message-batcher.mjs';
import { BatchUI, addVetoControls } from './batch-ui.mjs';
import { DataExtractor } from './data-extractor.mjs';
import { ContentManager, registerContentManagerHelpers } from './content-manager.mjs';
import { ConversationManager, registerConversationManagerHelpers } from './conversation-manager.mjs';
import { UsageMonitor, registerUsageMonitorHelpers } from './usage-monitor.mjs';
import { registerWelcomeSettings, checkAndShowWelcome, openWelcomeJournal } from './welcome-journal.mjs';
import { createHouseRulesJournal } from './house-rules-journal.mjs';
import { GMPrepJournalSync } from './gm-prep-journal.mjs';
import { progressBar } from './progress-bar.mjs';
import { statusBar } from './status-bar.mjs';
import { getAuthManager, AuthState, AUTH_STATE_CHANGED_EVENT } from './patreon-auth.mjs';
import { openPatreonLogin, registerPatreonLoginHelpers } from './patreon-login-ui.mjs';

// Module constants
const MODULE_ID = 'loremaster';
const MODULE_NAME = 'Loremaster';

/**
 * Module initialization hook.
 * Called once when the module is first loaded.
 */
Hooks.once('init', () => {
  console.log(`${MODULE_NAME} | Initializing module`);

  // Register module settings
  registerSettings();

  // Register welcome journal settings
  registerWelcomeSettings();

  // Register Handlebars helpers for Content Manager
  registerContentManagerHelpers();

  // Register Handlebars helpers for Conversation Manager
  registerConversationManagerHelpers();

  // Register Handlebars helpers for Usage Monitor
  registerUsageMonitorHelpers();

  // Register Handlebars helpers for Patreon Login
  registerPatreonLoginHelpers();
});

/**
 * Ready hook.
 * Called when Foundry is fully loaded and ready.
 */
Hooks.once('ready', async () => {
  console.log(`${MODULE_NAME} | Module ready`);

  // Initialize the progress bar UI
  progressBar.initialize();

  // Initialize the status bar UI
  statusBar.initialize();

  // Initialize the chat handler
  if (game.settings.get(MODULE_ID, 'enabled')) {
    statusBar.setConnecting();
    // For hosted mode, check auth status first
    if (isHostedMode()) {
      await initializeHostedMode();
    } else {
      await initializeLoremaster();
    }
  } else {
    statusBar.setDisabled();
  }

  // Force re-render of scene controls to show our buttons
  // V13 may cache controls before our hook adds tools
  if (ui.controls) {
    console.log(`${MODULE_NAME} | Re-rendering scene controls`);
    ui.controls.render({reset: true});
  }
});

/**
 * Initialize hosted mode with Patreon authentication.
 * Checks if user is authenticated, shows login UI if not.
 */
async function initializeHostedMode() {
  console.log(`${MODULE_NAME} | Initializing hosted mode`);

  const authManager = getAuthManager();

  // Refresh auth state from storage - important because the singleton may have been
  // created before Foundry's world settings were fully loaded
  console.log(`${MODULE_NAME} | Refreshing auth state from storage...`);
  authManager.refreshFromStorage();

  // Set up listener for auth state changes (for auto-reconnect)
  authManager.onStateChange(async (state, user) => {
    if (state === AuthState.LOGGED_IN && !game.loremaster?.socketClient?.isConnected) {
      console.log(`${MODULE_NAME} | Auth successful, initializing connection...`);
      ui.notifications.info(`${MODULE_NAME}: Connected as ${user?.displayName}. Initializing...`);
      await initializeLoremaster();
    }
  });

  // Check if already authenticated
  if (authManager.isAuthenticated()) {
    console.log(`${MODULE_NAME} | Already authenticated, validating session...`);

    try {
      // Validate the session with the server
      const status = await authManager.checkAuthStatus();

      if (status.authenticated) {
        console.log(`${MODULE_NAME} | Session valid, initializing...`);
        await initializeLoremaster();
        return;
      } else {
        console.log(`${MODULE_NAME} | Session invalid: ${status.reason}`);
        // Session expired, show login UI
      }
    } catch (err) {
      console.error(`${MODULE_NAME} | Failed to validate session:`, err);
      // Network error or server unavailable - show login UI
    }
  }

  // Not authenticated - show login UI
  console.log(`${MODULE_NAME} | Not authenticated, showing login UI`);
  showPatreonLoginPrompt();
}

/**
 * Show the Patreon login prompt to the user.
 * Called when hosted mode requires authentication.
 */
function showPatreonLoginPrompt() {
  // Update status bar to auth-required state
  statusBar.setAuthRequired();

  // Helper that shows login prompt when user tries to use a feature
  const requireAuth = () => {
    ui.notifications.warn(`${MODULE_NAME}: Please sign in with Patreon first.`);
    openPatreonLogin();
  };

  // Store reference on game object with auth-required stubs for all features
  game.loremaster = {
    MODULE_ID,
    MODULE_NAME,
    openPatreonLogin,
    openGuide: () => openWelcomeJournal(),
    // Retry initialization after login
    retryInit: () => initializeLoremaster(),
    // Stub functions that require auth - open login dialog instead
    openContentManager: requireAuth,
    openConversationManager: requireAuth,
    openHouseRulesJournal: requireAuth,
    openUsageMonitor: requireAuth
  };

  // Show a notification with action
  ui.notifications.warn(
    `${MODULE_NAME}: Please sign in with Patreon to continue.`,
    { permanent: true }
  );

  // Open the login dialog
  openPatreonLogin();
}

/**
 * Initialize the Loremaster system.
 * Sets up WebSocket connection, message batching, and chat handling.
 */
async function initializeLoremaster() {
  console.log(`${MODULE_NAME} | Starting Loremaster`);

  // Clean up existing socket to prevent orphaned reconnect timers
  if (game.loremaster?.socketClient) {
    game.loremaster.socketClient.disconnect();
  }

  // Create socket client instance
  const socketClient = new SocketClient();

  try {
    // Connect to proxy server
    await socketClient.connect();

    // Authenticate with proxy server
    await socketClient.authenticate();

    // Wire reconnect lifecycle callbacks (hosted mode auto-reconnect support)
    socketClient.onAuthRequired = () => {
      console.log(`${MODULE_NAME} | Session expired, showing login UI`);
      ui.notifications.warn(`${MODULE_NAME}: Session expired. Please sign in again.`);
      showPatreonLoginPrompt();
    };

    socketClient.onPermanentDisconnect = () => {
      console.log(`${MODULE_NAME} | Permanently disconnected`);
      statusBar.setDisconnected();
      // No additional action needed — user can use Account button to re-login
    };

    socketClient.onReconnecting = (attempt, max) => {
      statusBar.setReconnecting(attempt, max);
    };

    socketClient.onReconnected = () => {
      const user = isHostedMode() ? getAuthManager()?.getUser() : null;
      const tier = user?.tierName || 'Active';
      statusBar.setConnected(tier, 0, 0);
    };

    // Register tool handlers for Claude tool use
    registerToolHandlers(socketClient);

    // Create the batch UI
    const batchUI = new BatchUI({
      onSendNow: () => {
        messageBatcher.sendNow();
      },
      onClear: () => {
        messageBatcher.clearBatch();
        ui.notifications.info(game.i18n?.localize('LOREMASTER.Batch.Cleared') || 'Batch cleared');
      }
    });
    batchUI.initialize();

    // Create the message batcher
    const messageBatcher = new MessageBatcher({
      onBatchReady: async (batch) => {
        console.log(`${MODULE_NAME} | Batch ready:`, batch);
        try {
          await chatHandler.processBatch(batch);
        } catch (error) {
          console.error(`${MODULE_NAME} | Failed to process batch:`, error);
          ui.notifications.error('Failed to process message batch');
        }
      },
      onBatchUpdate: (state) => {
        batchUI.updateState(state);
      },
      onTimerTick: (seconds) => {
        batchUI.updateTimer(seconds);
      }
    });

    // Initialize socket for multi-client batch synchronization
    // GM becomes the authority, players sync through sockets
    messageBatcher.initializeSocket();

    // Create and initialize chat handler with batcher
    const chatHandler = new ChatHandler(socketClient, messageBatcher);
    chatHandler.initialize();

    // Create data extractor for file sync
    const dataExtractor = new DataExtractor(socketClient);

    // Create content manager for PDF uploads
    const contentManager = new ContentManager(socketClient);

    // Create conversation manager for history management
    const conversationManager = new ConversationManager(socketClient);

    // Create house rules journal manager
    const houseRulesJournal = createHouseRulesJournal(socketClient);

    // Create usage monitor for API usage tracking
    const usageMonitor = new UsageMonitor(socketClient);

    // Create and initialize GM Prep Journal sync (for GM only)
    const gmPrepJournalSync = new GMPrepJournalSync(socketClient);
    gmPrepJournalSync.initialize();

    // Store references on the game object for debugging/access
    game.loremaster = {
      socketClient,
      chatHandler,
      messageBatcher,
      batchUI,
      dataExtractor,
      contentManager,
      conversationManager,
      houseRulesJournal,
      usageMonitor,
      gmPrepJournalSync,
      MODULE_ID,
      MODULE_NAME,
      // Convenience methods
      syncWorldData: () => dataExtractor.showSyncDialog(),
      listSyncedFiles: () => dataExtractor.listSyncedFiles(),
      openContentManager: () => contentManager.render(true),
      openConversationManager: () => conversationManager.render(true),
      openHouseRulesJournal: () => houseRulesJournal.open(),
      openUsageMonitor: () => usageMonitor.open(),
      openPatreonLogin,
      openGuide: () => openWelcomeJournal()
    };

    // Set up hook to add veto controls to AI responses
    // Use renderChatMessageHTML for Foundry V13+ (passes HTMLElement instead of jQuery)
    Hooks.on('renderChatMessageHTML', (message, html, data) => {
      if (message.flags?.[MODULE_ID]?.isAIResponse) {
        const messageId = message.flags[MODULE_ID].batchId || message.id;

        // Foundry V13+: html is an HTMLElement
        const element = html instanceof HTMLElement ? html : html?.[0];
        if (element instanceof HTMLElement) {
          addVetoControls(
            element,
            messageId,
            (id, correction) => chatHandler.vetoResponse(id, correction),
            (id) => chatHandler.regenerateResponse(id)
          );
        }
      }
    });

    ui.notifications.info(`${MODULE_NAME} is now active`);

    // Update status bar to connected state
    // Retrieve tier and quota info for the status display
    const authManager = isHostedMode() ? getAuthManager() : null;
    const tierName = authManager?.getUser()?.tierName || 'Active';
    try {
      const quotaResult = await socketClient.getUsage?.();
      const tokensUsed = quotaResult?.tokensUsed || 0;
      const tokensLimit = quotaResult?.tokensLimit || 0;
      statusBar.setConnected(tierName, tokensUsed, tokensLimit);
    } catch {
      // Quota fetch is optional — show connected without quota details
      statusBar.setConnected(tierName, 0, 0);
    }

    // Show welcome journal on first run or version update
    await checkAndShowWelcome();

  } catch (error) {
    console.error(`${MODULE_NAME} | Failed to initialize:`, error);

    // Handle Patreon auth required specifically
    if (error.message === 'PATREON_AUTH_REQUIRED') {
      console.log(`${MODULE_NAME} | Patreon authentication required`);
      showPatreonLoginPrompt();
      return;
    }

    // Generic error handling
    statusBar.setDisconnected();
    ui.notifications.error(`${MODULE_NAME} failed to start: ${error.message}`);

    // Store reference even on failure for debugging
    // Managers can still work without socket connection for viewing
    const contentManager = new ContentManager(socketClient);
    const conversationManager = new ConversationManager(socketClient);
    const usageMonitor = new UsageMonitor(socketClient);
    game.loremaster = {
      socketClient,
      contentManager,
      conversationManager,
      usageMonitor,
      error,
      MODULE_ID,
      MODULE_NAME,
      openContentManager: () => contentManager.render(true),
      openConversationManager: () => conversationManager.render(true),
      openUsageMonitor: () => usageMonitor.open(),
      openPatreonLogin,
      openGuide: () => openWelcomeJournal()
    };

    // Still show welcome journal even on error
    await checkAndShowWelcome();
  }
}

/**
 * Hook to add a top-level Loremaster control group to the scene controls.
 * Creates a dedicated "Loremaster" category with a wizard hat icon in the left toolbar,
 * containing buttons for Content Manager, Conversations, House Rules, Usage, Guide, and Account.
 * Compatible with Foundry V12 (array) and V13 (object/Record) control formats.
 */
Hooks.on('getSceneControlButtons', (controls) => {
  // Only show Loremaster controls for the GM
  if (!game.user?.isGM) return;

  // Build the tool definitions for our control group.
  // All tools use button: true (action buttons, not mode selectors).
  // Note: Do NOT set activeTool on the control group to any button tool.
  // Foundry V13's #onChangeTool has an early return (tool === this.tool)
  // that fires before the button handler, preventing onChange from being called
  // on already-active tools. Leaving activeTool unset ensures this.tool is
  // undefined so the early return never triggers for button tools.
  const loremasterTools = {
    'loremaster-content': {
      name: 'loremaster-content',
      order: 1,
      title: game.i18n?.localize('LOREMASTER.ContentManager.Title') || 'Loremaster Content Manager',
      icon: 'fa-solid fa-brain',
      button: true,
      visible: true,
      onChange: () => {
        if (game.loremaster?.openContentManager) {
          game.loremaster.openContentManager();
        } else {
          ui.notifications.warn('Loremaster not initialized');
        }
      }
    },
    'loremaster-conversations': {
      name: 'loremaster-conversations',
      order: 2,
      title: game.i18n?.localize('LOREMASTER.ConversationManager.Title') || 'Loremaster Conversations',
      icon: 'fa-solid fa-comments',
      button: true,
      visible: true,
      onChange: () => {
        if (game.loremaster?.openConversationManager) {
          game.loremaster.openConversationManager();
        } else {
          ui.notifications.warn('Loremaster not initialized');
        }
      }
    },
    'loremaster-house-rules': {
      name: 'loremaster-house-rules',
      order: 3,
      title: game.i18n?.localize('LOREMASTER.HouseRules.Title') || 'Loremaster House Rules',
      icon: 'fa-solid fa-gavel',
      button: true,
      visible: true,
      onChange: () => {
        if (game.loremaster?.openHouseRulesJournal) {
          game.loremaster.openHouseRulesJournal();
        } else {
          ui.notifications.warn('Loremaster not initialized');
        }
      }
    },
    'loremaster-usage': {
      name: 'loremaster-usage',
      order: 4,
      title: game.i18n?.localize('LOREMASTER.UsageMonitor.Title') || 'API Usage Monitor',
      icon: 'fa-solid fa-chart-bar',
      button: true,
      visible: true,
      onChange: () => {
        if (game.loremaster?.openUsageMonitor) {
          game.loremaster.openUsageMonitor();
        } else {
          ui.notifications.warn('Loremaster not initialized');
        }
      }
    },
    'loremaster-guide': {
      name: 'loremaster-guide',
      order: 5,
      title: game.i18n?.localize('LOREMASTER.Guide.Title') || 'Loremaster Guide',
      icon: 'fa-solid fa-book',
      button: true,
      visible: true,
      onChange: () => {
        if (game.loremaster?.openGuide) {
          game.loremaster.openGuide();
        } else {
          ui.notifications.warn('Loremaster not initialized');
        }
      }
    }
  };

  // Add Account button in hosted mode
  if (isHostedMode()) {
    loremasterTools['loremaster-account'] = {
      name: 'loremaster-account',
      order: 6,
      title: game.i18n?.localize('LOREMASTER.Account.Title') || 'Loremaster Account',
      icon: 'fa-solid fa-user-circle',
      button: true,
      visible: true,
      onChange: () => {
        // Open Foundry settings — the renderSettingsConfig hook
        // injects the account panel inline with the settings
        game.settings.sheet.render(true);
      }
    };
  }

  // Define the top-level Loremaster control group.
  // Note: activeTool is intentionally omitted — see comment on loremasterTools above.
  const loremasterControlGroup = {
    name: 'loremaster',
    order: 11,
    title: game.i18n?.localize('LOREMASTER.SceneControls.Title') || 'Loremaster',
    icon: 'fa-solid fa-hat-wizard',
    visible: true,
    tools: loremasterTools
  };

  // V13: controls is a plain object (Record<string, SceneControl>)
  // V12: controls is an array of SceneControl objects
  if (Array.isArray(controls)) {
    // V12 fallback — tools must be an array
    loremasterControlGroup.tools = Object.values(loremasterTools);
    controls.push(loremasterControlGroup);
  } else if (controls && typeof controls === 'object') {
    // V13 — assign as a keyed property
    controls.loremaster = loremasterControlGroup;
  }
});

/**
 * Export module ID for use in other files.
 */
export { MODULE_ID, MODULE_NAME };
