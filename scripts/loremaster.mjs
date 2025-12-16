/**
 * Loremaster Module
 *
 * Main entry point for the AI-powered Loremaster integration.
 * Provides chat-based interaction with Loremaster through the Foundry VTT interface.
 * Uses a WebSocket connection to the Loremaster proxy server for Claude API access.
 */

import { registerSettings, getSetting } from './config.mjs';
import { ChatHandler } from './chat-handler.mjs';
import { SocketClient } from './socket-client.mjs';
import { registerToolHandlers } from './tool-handlers.mjs';
import { MessageBatcher } from './message-batcher.mjs';
import { BatchUI, addVetoControls } from './batch-ui.mjs';
import { DataExtractor } from './data-extractor.mjs';
import { ContentManager, registerContentManagerHelpers } from './content-manager.mjs';
import { ConversationManager, registerConversationManagerHelpers } from './conversation-manager.mjs';
import { registerWelcomeSettings, checkAndShowWelcome, openWelcomeJournal } from './welcome-journal.mjs';
import { createHouseRulesJournal } from './house-rules-journal.mjs';

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
});

/**
 * Ready hook.
 * Called when Foundry is fully loaded and ready.
 */
Hooks.once('ready', async () => {
  console.log(`${MODULE_NAME} | Module ready`);

  // Initialize the chat handler
  if (game.settings.get(MODULE_ID, 'enabled')) {
    await initializeLoremaster();
  }

  // Force re-render of scene controls to show our buttons
  // V13 may cache controls before our hook adds tools
  if (ui.controls) {
    console.log(`${MODULE_NAME} | Re-initializing scene controls`);
    ui.controls.initialize();
  }
});

/**
 * Initialize the Loremaster system.
 * Sets up WebSocket connection, message batching, and chat handling.
 */
async function initializeLoremaster() {
  console.log(`${MODULE_NAME} | Starting Loremaster`);

  // Create socket client instance
  const socketClient = new SocketClient();

  try {
    // Connect to proxy server
    await socketClient.connect();

    // Authenticate with proxy server
    await socketClient.authenticate();

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
      MODULE_ID,
      MODULE_NAME,
      // Convenience methods
      syncWorldData: () => dataExtractor.showSyncDialog(),
      listSyncedFiles: () => dataExtractor.listSyncedFiles(),
      openContentManager: () => contentManager.render(true),
      openConversationManager: () => conversationManager.render(true),
      openHouseRulesJournal: () => houseRulesJournal.open(),
      openGuide: () => openWelcomeJournal()
    };

    // Set up hook to add veto controls to AI responses
    Hooks.on('renderChatMessage', (message, html, data) => {
      if (message.flags?.[MODULE_ID]?.isAIResponse) {
        const messageId = message.flags[MODULE_ID].batchId || message.id;
        addVetoControls(
          html[0],
          messageId,
          (id, correction) => chatHandler.vetoResponse(id, correction),
          (id) => chatHandler.regenerateResponse(id)
        );
      }
    });

    ui.notifications.info(`${MODULE_NAME} is now active`);

    // Show welcome journal on first run or version update
    await checkAndShowWelcome();

  } catch (error) {
    console.error(`${MODULE_NAME} | Failed to initialize:`, error);
    ui.notifications.error(`${MODULE_NAME} failed to start: ${error.message}`);

    // Store reference even on failure for debugging
    // Managers can still work without socket connection for viewing
    const contentManager = new ContentManager(socketClient);
    const conversationManager = new ConversationManager(socketClient);
    game.loremaster = {
      socketClient,
      contentManager,
      conversationManager,
      error,
      MODULE_ID,
      MODULE_NAME,
      openContentManager: () => contentManager.render(true),
      openConversationManager: () => conversationManager.render(true),
      openGuide: () => openWelcomeJournal()
    };

    // Still show welcome journal even on error
    await checkAndShowWelcome();
  }
}

/**
 * Hook to add Loremaster controls to the scene controls.
 * Adds buttons for Content Manager, Conversation Manager, and Guide.
 * Compatible with Foundry V13.
 */
Hooks.on('getSceneControlButtons', (controls) => {
  console.log(`${MODULE_NAME} | getSceneControlButtons hook fired`);
  console.log(`${MODULE_NAME} | Controls type:`, typeof controls, Array.isArray(controls));
  console.log(`${MODULE_NAME} | Controls:`, controls);

  // V13 might pass controls differently - let's inspect
  if (Array.isArray(controls)) {
    console.log(`${MODULE_NAME} | Control names:`, controls.map(c => c.name));
  } else if (controls && typeof controls === 'object') {
    console.log(`${MODULE_NAME} | Controls keys:`, Object.keys(controls));
  }

  // Try to find or access the notes control group
  let notesControls;

  if (Array.isArray(controls)) {
    notesControls = controls.find(c => c.name === 'notes');
  } else if (controls?.notes) {
    notesControls = controls.notes;
  }

  console.log(`${MODULE_NAME} | Notes controls found:`, !!notesControls);

  if (notesControls) {
    console.log(`${MODULE_NAME} | Notes controls structure:`, notesControls);
    console.log(`${MODULE_NAME} | Notes tools type:`, typeof notesControls.tools, Array.isArray(notesControls.tools));
  }

  if (!notesControls) {
    console.warn(`${MODULE_NAME} | Could not find notes control group`);
    return;
  }

  // Ensure tools is an array or Map we can add to
  if (!notesControls.tools) {
    console.warn(`${MODULE_NAME} | Notes controls has no tools property`);
    return;
  }

  console.log(`${MODULE_NAME} | Adding buttons (isGM: ${game.user?.isGM})`);

  // Define our tools - V13 tool structure (matching 'clear' button)
  // V13 button tools use: name, title, icon, order, button: true, visible: true, onChange
  const loremasterTools = [];

  if (game.user?.isGM) {
    loremasterTools.push({
      name: 'loremaster-content',
      order: 5,
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
    });

    loremasterTools.push({
      name: 'loremaster-conversations',
      order: 6,
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
    });

    loremasterTools.push({
      name: 'loremaster-house-rules',
      order: 7,
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
    });

    loremasterTools.push({
      name: 'loremaster-guide',
      order: 8,
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
    });
  }

  // Add tools based on the structure type
  if (Array.isArray(notesControls.tools)) {
    loremasterTools.forEach(tool => notesControls.tools.push(tool));
    console.log(`${MODULE_NAME} | Added ${loremasterTools.length} tools via array push`);
  } else if (notesControls.tools instanceof Map) {
    loremasterTools.forEach(tool => notesControls.tools.set(tool.name, tool));
    console.log(`${MODULE_NAME} | Added ${loremasterTools.length} tools via Map.set`);
  } else if (typeof notesControls.tools === 'object') {
    loremasterTools.forEach(tool => notesControls.tools[tool.name] = tool);
    console.log(`${MODULE_NAME} | Added ${loremasterTools.length} tools via object property`);
  }

  console.log(`${MODULE_NAME} | Final tools:`, notesControls.tools);
});

/**
 * Export module ID for use in other files.
 */
export { MODULE_ID, MODULE_NAME };
