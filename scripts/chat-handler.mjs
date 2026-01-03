/**
 * Loremaster Chat Handler
 *
 * Handles capturing, filtering, and responding to chat messages
 * intended for Loremaster. Communicates with the proxy server via WebSocket.
 * Integrates with MessageBatcher for multi-player message synchronization.
 */

import { getSetting } from './config.mjs';
import { formatResponse } from './message-formatter.mjs';
import { PlayerContext } from './player-context.mjs';

const MODULE_ID = 'loremaster';

/**
 * Valid campaign stages for stage commands.
 */
const VALID_STAGES = ['prologue', 'act_1', 'act_2', 'act_3', 'act_4', 'act_5', 'epilogue', 'appendix'];

/**
 * Stage display names for user-friendly output.
 */
const STAGE_NAMES = {
  prologue: 'Prologue',
  act_1: 'Act 1',
  act_2: 'Act 2',
  act_3: 'Act 3',
  act_4: 'Act 4',
  act_5: 'Act 5',
  epilogue: 'Epilogue',
  appendix: 'Appendix'
};

/**
 * Normalize stage input to canonical format.
 * Accepts formats like "act 1", "act1", "Act 1", "ACT_1" and normalizes to "act_1".
 *
 * @param {string} input - The raw stage input from user.
 * @returns {string} Normalized stage name (e.g., "act_1") or original if no match.
 */
function normalizeStage(input) {
  if (!input) return input;

  const normalized = input.toLowerCase().trim();

  // Direct match
  if (VALID_STAGES.includes(normalized)) {
    return normalized;
  }

  // Handle "act 1", "act1", "act-1" → "act_1"
  const actMatch = normalized.match(/^act\s*[-_]?\s*([1-5])$/);
  if (actMatch) {
    return `act_${actMatch[1]}`;
  }

  // Handle roman numerals: "act i", "act ii", etc.
  const romanMap = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };
  const romanMatch = normalized.match(/^act\s*[-_]?\s*(i{1,3}|iv|v)$/);
  if (romanMatch && romanMap[romanMatch[1]]) {
    return `act_${romanMap[romanMatch[1]]}`;
  }

  return normalized;
}

/**
 * Random thinking phrases displayed while waiting for Loremaster response.
 * Shown as a public chat message to all players.
 */
const THINKING_PHRASES = [
  'Loremaster is thinking...',
  'The Loremaster rubs its digital chin...',
  'Loremaster gazes into a crystal ball...',
  'Loremaster ponders a moment...',
  'Loremaster consults ancient tomes...',
  'The Loremaster strokes its beard thoughtfully...',
  'Loremaster shuffles through scattered notes...',
  'The Loremaster mutters an incantation...',
  'Loremaster peers through the mists of fate...',
  'The Loremaster weighs the threads of destiny...',
  'Loremaster communes with the narrative spirits...',
  'The Loremaster scribbles furiously on parchment...',
  'Loremaster rolls some dice behind the screen...',
  'The Loremaster flips through a dusty grimoire...',
  'Loremaster adjusts its spectacles pensively...',
  'The Loremaster hums an ancient tune...',
  'Loremaster contemplates the cosmic dice...',
  'The Loremaster steeples its fingers mysteriously...',
  'Loremaster consults the Oracle of Plot Hooks...',
  'The Loremaster sketches a quick map...',
  'Loremaster whispers to unseen advisors...',
  'The Loremaster traces runes in the air...',
  'Loremaster checks the alignment of the stars...',
  'The Loremaster brews a pot of inspiration...',
  'Loremaster polishes its storytelling crystal...'
];

/**
 * ChatHandler class manages the chat message pipeline.
 */
export class ChatHandler {
  /**
   * Create a new ChatHandler instance.
   *
   * @param {SocketClient} socketClient - The socket client for proxy communication.
   * @param {MessageBatcher} messageBatcher - The message batcher for multi-player sync.
   */
  constructor(socketClient, messageBatcher = null) {
    this.socketClient = socketClient;
    this.messageBatcher = messageBatcher;
    this.messageQueue = [];
    this.isProcessing = false;
    this.lastBatchId = null;
    this.lastBatch = null;
    this.pendingPrivateResponses = new Map(); // messageId -> response data
    this.thinkingMessageId = null; // ID of the current thinking message
  }

  /**
   * Initialize the chat handler.
   * Sets up hooks for chat message events and private response controls.
   */
  initialize() {
    // Hook into chat message creation
    Hooks.on('chatMessage', this._onChatMessage.bind(this));

    // Hook into chat message rendering to attach button handlers
    Hooks.on('renderChatMessage', this._onRenderChatMessage.bind(this));

    console.log(`${MODULE_ID} | Chat handler initialized`);
  }

  /**
   * Handle chat message render to attach event handlers to private response buttons.
   *
   * @param {ChatMessage} message - The chat message.
   * @param {jQuery} html - The rendered HTML.
   * @param {Object} data - The message data.
   * @private
   */
  _onRenderChatMessage(message, html, data) {
    html = $(html); // Ensure jQuery for Foundry v12 compatibility

    // Check if this is a private Loremaster response
    if (!message.flags?.[MODULE_ID]?.isPrivateResponse) {
      return;
    }

    // Attach publish button handler
    html.find('.loremaster-publish-btn').on('click', async (event) => {
      const messageId = event.currentTarget.dataset.messageId;
      await this.publishPrivateResponse(messageId);
    });

    // Attach iterate button handler
    html.find('.loremaster-iterate-btn').on('click', async (event) => {
      const messageId = event.currentTarget.dataset.messageId;
      await this.iteratePrivateResponse(messageId);
    });

    // Attach discard button handler
    html.find('.loremaster-discard-btn').on('click', async (event) => {
      const messageId = event.currentTarget.dataset.messageId;
      await this.discardPrivateResponse(messageId, message);
    });
  }

  /**
   * Handle incoming chat messages.
   * Filters for Loremaster triggers and routes to batcher or direct processing.
   * Supports private GM chat mode with @lm! prefix.
   * Supports GM commands with /lm prefix.
   *
   * @param {ChatLog} chatLog - The chat log instance.
   * @param {string} message - The raw message content.
   * @param {object} chatData - The chat message data.
   * @returns {boolean} False to prevent default handling if message is for AI.
   * @private
   */
  _onChatMessage(chatLog, message, chatData) {
    const triggerPrefix = getSetting('triggerPrefix');
    const privateTriggerPrefix = triggerPrefix + '!'; // e.g., @lm! for private
    const commandPrefix = '/lm '; // Slash command prefix

    // Check for /lm commands first (GM only)
    if (message.toLowerCase().startsWith(commandPrefix)) {
      if (!game.user?.isGM) {
        ui.notifications.warn('Loremaster commands are GM only.');
        return false;
      }
      this._handleCommand(message.slice(commandPrefix.length).trim());
      return false;
    }

    // Check if message is intended for Loremaster
    const isPrivate = message.startsWith(privateTriggerPrefix);
    const isPublic = message.startsWith(triggerPrefix) && !isPrivate;

    if (!isPrivate && !isPublic) {
      return true; // Allow normal processing
    }

    // Private mode requires GM
    if (isPrivate && !game.user?.isGM) {
      ui.notifications.warn(game.i18n?.localize('LOREMASTER.Private.GMOnly') || 'Private chat mode is GM only. Use @lm instead.');
      return false;
    }

    // Extract the actual message (remove trigger prefix)
    const prefix = isPrivate ? privateTriggerPrefix : triggerPrefix;
    const aiMessage = message.slice(prefix.length).trim();

    if (!aiMessage) {
      ui.notifications.warn('Please provide a message for Loremaster.');
      return false;
    }

    // Get player context for the current user
    const userContext = PlayerContext.getCurrentUserContext();

    // Handle private GM messages differently
    if (isPrivate) {
      this._processPrivateMessage(aiMessage, userContext);
      return false;
    }

    // Route through batcher if available, otherwise direct process
    if (this.messageBatcher) {
      // Show player message in chat based on visibility settings
      this._showPlayerMessage(aiMessage, userContext);

      // Add to batch
      this.messageBatcher.addMessage(aiMessage, userContext);
    } else {
      // Fall back to direct processing (original behavior)
      this._queueMessage({
        content: aiMessage,
        user: game.user,
        timestamp: Date.now()
      });
    }

    // Prevent default chat message creation
    return false;
  }

  /**
   * Handle /lm commands for GM operations.
   * Supports: stage, advance, back, status, help
   *
   * @param {string} commandStr - The command string after /lm prefix.
   * @private
   */
  async _handleCommand(commandStr) {
    const parts = commandStr.split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    console.log(`${MODULE_ID} | Handling command: ${command}`, args);

    try {
      switch (command) {
        case 'stage':
          await this._handleStageCommand(args);
          break;

        case 'advance':
        case 'next':
          await this._handleAdvanceCommand(args);
          break;

        case 'back':
        case 'previous':
        case 'prev':
          await this._handleBackCommand(args);
          break;

        case 'status':
        case 'progress':
          await this._handleStatusCommand(args);
          break;

        case 'clear':
          await this._handleClearCommand(args);
          break;

        case 'clear-progress':
          await this._handleClearProgressCommand(args);
          break;

        case 'help':
        case '?':
          this._showCommandHelp();
          break;

        default:
          ui.notifications.warn(`Unknown command: ${command}. Use /lm help for available commands.`);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Command error:`, error);
      ui.notifications.error(`Command failed: ${error.message}`);
    }
  }

  /**
   * Handle /lm stage <stage> [adventureId] command.
   * Sets the campaign stage for a module or PDF adventure.
   *
   * @param {Array} args - Command arguments [stage, adventureId?].
   * @private
   */
  async _handleStageCommand(args) {
    if (args.length === 0) {
      ui.notifications.warn('Usage: /lm stage <stage> [adventureId]');
      ui.notifications.info(`Valid stages: ${VALID_STAGES.join(', ')}`);
      return;
    }

    // Normalize stage input (accepts "act 1", "act1", "act i", etc.)
    const stage = normalizeStage(args[0]);
    const adventureId = args[1] || null;

    // Validate stage
    if (!VALID_STAGES.includes(stage)) {
      ui.notifications.error(`Invalid stage: ${args[0]}`);
      ui.notifications.info(`Valid stages: prologue, act 1-5, epilogue, appendix`);
      return;
    }

    // If no adventureId, try to get active adventure
    let adventureType = null;
    let targetId = adventureId;

    if (!targetId) {
      const activeAdventure = await this.socketClient.getActiveAdventure();
      if (activeAdventure?.activeAdventure) {
        adventureType = activeAdventure.activeAdventure.adventureType;
        targetId = activeAdventure.activeAdventure.adventureId;
      } else {
        ui.notifications.warn('No adventure specified and no active adventure set. Use: /lm stage <stage> <adventureId>');
        return;
      }
    }

    let result;
    let displayName;

    // Check if this is a PDF adventure (numeric ID or 'pdf:' prefix)
    const isPdfAdventure = adventureType === 'pdf' ||
      (adventureId && (adventureId.startsWith('pdf:') || !isNaN(parseInt(adventureId, 10))));

    if (isPdfAdventure) {
      // Handle PDF adventure
      const pdfId = adventureId?.startsWith('pdf:')
        ? parseInt(adventureId.replace('pdf:', ''), 10)
        : parseInt(targetId, 10);

      result = await this.socketClient.setPdfCampaignProgress(pdfId, stage);
      displayName = `PDF adventure #${pdfId}`;
    } else {
      // Handle module adventure
      result = await this.socketClient.setCampaignProgress(targetId, stage);
      displayName = `module: ${targetId}`;
    }

    if (result.success) {
      const stageName = STAGE_NAMES[stage] || stage;
      this._showSystemMessage(`Campaign stage set to **${stageName}** for ${displayName}`);
      ui.notifications.info(`Campaign stage set to ${stageName}`);
    }
  }

  /**
   * Handle /lm advance [adventureId] command.
   * Advances to the next campaign stage for a module or PDF adventure.
   *
   * @param {Array} args - Command arguments [adventureId?].
   * @private
   */
  async _handleAdvanceCommand(args) {
    const adventureId = args[0] || null;

    // If no adventureId, try to get active adventure
    let adventureType = null;
    let targetId = adventureId;

    if (!targetId) {
      const activeAdventure = await this.socketClient.getActiveAdventure();
      if (activeAdventure?.activeAdventure) {
        adventureType = activeAdventure.activeAdventure.adventureType;
        targetId = activeAdventure.activeAdventure.adventureId;
      } else {
        ui.notifications.warn('No adventure specified and no active adventure set.');
        return;
      }
    }

    let result;

    // Check if this is a PDF adventure
    const isPdfAdventure = adventureType === 'pdf' ||
      (adventureId && (adventureId.startsWith('pdf:') || !isNaN(parseInt(adventureId, 10))));

    if (isPdfAdventure) {
      const pdfId = adventureId?.startsWith('pdf:')
        ? parseInt(adventureId.replace('pdf:', ''), 10)
        : parseInt(targetId, 10);

      result = await this.socketClient.advancePdfCampaignStage(pdfId);
    } else {
      result = await this.socketClient.advanceCampaignStage(targetId);
    }

    if (result.success) {
      const newStage = result.progress?.currentStage;
      const stageName = STAGE_NAMES[newStage] || newStage;
      this._showSystemMessage(`Campaign advanced to **${stageName}**`);
      ui.notifications.info(`Campaign advanced to ${stageName}`);
    }
  }

  /**
   * Handle /lm back [adventureId] command.
   * Regresses to the previous campaign stage for a module or PDF adventure.
   *
   * @param {Array} args - Command arguments [adventureId?].
   * @private
   */
  async _handleBackCommand(args) {
    const adventureId = args[0] || null;

    // If no adventureId, try to get active adventure
    let adventureType = null;
    let targetId = adventureId;

    if (!targetId) {
      const activeAdventure = await this.socketClient.getActiveAdventure();
      if (activeAdventure?.activeAdventure) {
        adventureType = activeAdventure.activeAdventure.adventureType;
        targetId = activeAdventure.activeAdventure.adventureId;
      } else {
        ui.notifications.warn('No adventure specified and no active adventure set.');
        return;
      }
    }

    let result;

    // Check if this is a PDF adventure
    const isPdfAdventure = adventureType === 'pdf' ||
      (adventureId && (adventureId.startsWith('pdf:') || !isNaN(parseInt(adventureId, 10))));

    if (isPdfAdventure) {
      const pdfId = adventureId?.startsWith('pdf:')
        ? parseInt(adventureId.replace('pdf:', ''), 10)
        : parseInt(targetId, 10);

      result = await this.socketClient.regressPdfCampaignStage(pdfId);
    } else {
      result = await this.socketClient.regressCampaignStage(targetId);
    }

    if (result.success) {
      const newStage = result.progress?.currentStage;
      const stageName = STAGE_NAMES[newStage] || newStage;
      this._showSystemMessage(`Campaign regressed to **${stageName}**`);
      ui.notifications.info(`Campaign regressed to ${stageName}`);
    }
  }

  /**
   * Handle /lm status [adventureId] command.
   * Shows current campaign progress and stage statistics for modules or PDF adventures.
   *
   * @param {Array} args - Command arguments [adventureId?].
   * @private
   */
  async _handleStatusCommand(args) {
    const adventureId = args[0] || null;

    // If no adventureId, try to get active adventure or show all progress
    let adventureType = null;
    let targetId = adventureId;

    if (!targetId) {
      const activeAdventure = await this.socketClient.getActiveAdventure();
      if (activeAdventure?.activeAdventure) {
        adventureType = activeAdventure.activeAdventure.adventureType;
        targetId = activeAdventure.activeAdventure.adventureId;
      }
    }

    // Check if this is a PDF adventure
    const isPdfAdventure = adventureType === 'pdf' ||
      (adventureId && (adventureId.startsWith('pdf:') || !isNaN(parseInt(adventureId, 10))));

    if (targetId) {
      if (isPdfAdventure) {
        // Show stats for PDF adventure
        const pdfId = adventureId?.startsWith('pdf:')
          ? parseInt(adventureId.replace('pdf:', ''), 10)
          : parseInt(targetId, 10);

        const stats = await this.socketClient.getPdfStageStats(pdfId);
        const currentStage = stats.currentStage || 'Not set';
        const stageName = STAGE_NAMES[currentStage] || currentStage;

        let statusMsg = `**Campaign Progress: PDF Adventure #${pdfId}**\n`;
        statusMsg += `Adventure Type: ${stats.isAdventure ? 'Stage-based' : 'Reference'}\n`;
        statusMsg += `Current Stage: **${stageName}**\n\n`;
        statusMsg += `**Stage Content:**\n`;

        for (const [stage, data] of Object.entries(stats.stages || {})) {
          const name = STAGE_NAMES[stage] || stage;
          const marker = stage === currentStage ? ' ← Current' : '';
          statusMsg += `- ${name}: ${data.count} chunks (~${data.tokens?.toLocaleString()} tokens)${marker}\n`;
        }

        this._showSystemMessage(statusMsg);
      } else {
        // Show stats for module adventure
        const stats = await this.socketClient.getModuleStageStats(targetId);
        const currentStage = stats.currentStage || 'Not set';
        const stageName = STAGE_NAMES[currentStage] || currentStage;

        let statusMsg = `**Campaign Progress: ${stats.moduleName || targetId}**\n`;
        statusMsg += `Current Stage: **${stageName}**\n\n`;
        statusMsg += `**Stage Content:**\n`;

        for (const [stage, data] of Object.entries(stats.stages || {})) {
          const name = STAGE_NAMES[stage] || stage;
          const marker = stage === currentStage ? ' ← Current' : '';
          statusMsg += `- ${name}: ${data.chunkCount} chunks (~${data.totalTokens?.toLocaleString()} tokens)${marker}\n`;
        }

        this._showSystemMessage(statusMsg);
      }
    } else {
      // Show active adventure first, then all progress records
      const activeAdventure = await this.socketClient.getActiveAdventure();
      const moduleResult = await this.socketClient.getCampaignProgress();
      const pdfResult = await this.socketClient.getPdfCampaignProgress();
      const moduleProgressList = moduleResult.progress || [];
      const pdfProgressList = pdfResult.progress || [];

      let statusMsg = '**Campaign Status:**\n\n';

      // Show active adventure
      if (activeAdventure?.activeAdventure) {
        const active = activeAdventure.activeAdventure;
        const typeLabel = active.adventure_type === 'pdf' ? 'PDF' : 'Module';
        const idLabel = active.adventure_type === 'pdf' ? `pdf:${active.pdf_id}` : active.module_id;
        statusMsg += `**Active Adventure:** ${active.adventure_name} (${typeLabel}: ${idLabel})\n\n`;
      } else {
        statusMsg += '**Active Adventure:** None selected\n';
        statusMsg += '_Use Content Manager or `/lm set-adventure` to select one._\n\n';
      }

      // Show saved progress records
      if (moduleProgressList.length === 0 && pdfProgressList.length === 0) {
        statusMsg += '*No saved campaign progress.*';
      } else {
        statusMsg += '**Saved Progress:**\n';

        if (moduleProgressList.length > 0) {
          for (const p of moduleProgressList) {
            const stageName = STAGE_NAMES[p.currentStage] || p.currentStage;
            statusMsg += `- ${p.moduleId}: ${stageName}\n`;
          }
        }

        if (pdfProgressList.length > 0) {
          for (const p of pdfProgressList) {
            const stageName = STAGE_NAMES[p.currentStage] || p.currentStage;
            statusMsg += `- pdf:${p.pdfId}: ${stageName}\n`;
          }
        }

        statusMsg += '\n_Use `/lm clear-progress <id>` to remove old progress._';
      }

      this._showSystemMessage(statusMsg);
    }
  }

  /**
   * Handle /lm clear command.
   * Clears the active adventure (GM only).
   *
   * @param {Array} args - Command arguments (unused).
   * @private
   */
  async _handleClearCommand(args) {
    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can clear the active adventure.');
      return;
    }

    try {
      const activeAdventure = await this.socketClient.getActiveAdventure();

      if (!activeAdventure?.activeAdventure) {
        this._showSystemMessage('No active adventure to clear.');
        return;
      }

      const adventureName = activeAdventure.activeAdventure.adventure_name;
      await this.socketClient.clearActiveAdventure();

      this._showSystemMessage(`Active adventure **${adventureName}** has been cleared.`);
      ui.notifications.info('Active adventure cleared.');
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to clear active adventure:`, error);
      ui.notifications.error(`Failed to clear: ${error.message}`);
    }
  }

  /**
   * Handle /lm clear-progress <adventureId> command.
   * Clears saved campaign progress for an adventure (GM only).
   *
   * @param {Array} args - Command arguments [adventureId].
   * @private
   */
  async _handleClearProgressCommand(args) {
    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can clear campaign progress.');
      return;
    }

    if (args.length === 0) {
      ui.notifications.warn('Usage: /lm clear-progress <adventureId>');
      ui.notifications.info('Example: /lm clear-progress pdf:5 or /lm clear-progress coriolis-ghazali');
      return;
    }

    const adventureId = args[0];

    try {
      // Check if this is a PDF adventure
      const isPdfAdventure = adventureId.startsWith('pdf:') || !isNaN(parseInt(adventureId, 10));

      if (isPdfAdventure) {
        const pdfId = adventureId.startsWith('pdf:')
          ? parseInt(adventureId.replace('pdf:', ''), 10)
          : parseInt(adventureId, 10);

        // Delete PDF progress via proxy
        const result = await this.socketClient.deletePdfCampaignProgress(pdfId);

        if (result.success) {
          this._showSystemMessage(`Campaign progress for **pdf:${pdfId}** has been cleared.`);
          ui.notifications.info('Campaign progress cleared.');
        } else {
          this._showSystemMessage(`No progress found for pdf:${pdfId}.`);
        }
      } else {
        // Delete module progress via proxy
        const result = await this.socketClient.deleteCampaignProgress(adventureId);

        if (result.success) {
          this._showSystemMessage(`Campaign progress for **${adventureId}** has been cleared.`);
          ui.notifications.info('Campaign progress cleared.');
        } else {
          this._showSystemMessage(`No progress found for ${adventureId}.`);
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to clear campaign progress:`, error);
      ui.notifications.error(`Failed to clear progress: ${error.message}`);
    }
  }

  /**
   * Show command help.
   *
   * @private
   */
  _showCommandHelp() {
    const helpMsg = `**Loremaster Commands:**

**/lm stage <stage> [adventureId]** - Set campaign stage
  Stages: prologue, act 1-5, epilogue, appendix
  Example: \`/lm stage act 1\` or \`/lm stage act_1\`
  Example: \`/lm stage act 2 pdf:5\` (for PDF adventure #5)

**/lm advance [adventureId]** - Advance to next stage
  Example: \`/lm advance\`

**/lm back [adventureId]** - Go back to previous stage
  Example: \`/lm back\`

**/lm status [adventureId]** - Show campaign progress
  Example: \`/lm status\`
  Example: \`/lm status pdf:5\` (for PDF adventure #5)

**/lm clear** - Clear active adventure (GM only)
  Example: \`/lm clear\`

**/lm clear-progress <adventureId>** - Delete saved progress (GM only)
  Example: \`/lm clear-progress pdf:5\`
  Example: \`/lm clear-progress coriolis-ghazali\`

**/lm help** - Show this help message

*Note: If adventureId is omitted, uses the active adventure (module or PDF).*
*For PDF adventures, use 'pdf:ID' format or just the numeric ID.*`;

    this._showSystemMessage(helpMsg);
  }

  /**
   * Show a system message in chat (GM only, styled differently).
   *
   * @param {string} content - The message content (supports markdown).
   * @private
   */
  async _showSystemMessage(content) {
    const formattedContent = formatResponse(content);

    const messageData = {
      content: `<div class="loremaster-system-message">${formattedContent}</div>`,
      speaker: ChatMessage.getSpeaker({ alias: 'Loremaster System' }),
      user: game.user.id,
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      flags: {
        [MODULE_ID]: {
          isSystemMessage: true
        }
      }
    };

    await ChatMessage.create(messageData);
  }

  /**
   * Process a private GM message.
   * Response only goes to GM with option to publish.
   *
   * @param {string} message - The message content.
   * @param {Object} userContext - The player context.
   * @private
   */
  async _processPrivateMessage(message, userContext) {
    console.log(`${MODULE_ID} | Processing private GM message`);

    try {
      this._showTypingIndicator();

      // Build context
      const context = this._buildContext();

      // Send private message
      const result = await this.socketClient.sendPrivateMessage(message, context);

      // Store for potential publishing
      this.pendingPrivateResponses.set(result.messageId, {
        content: result.response,
        messageId: result.messageId,
        conversationId: result.conversationId,
        originalMessage: message,
        timestamp: Date.now()
      });

      // Create private response message (GM only)
      await this._createPrivateResponseMessage(result);

      ui.notifications.info(game.i18n?.localize('LOREMASTER.Private.ResponseReady') || 'Private response ready. Click Publish to share with players.');

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing private message:`, error);
      ui.notifications.error('Failed to get private Loremaster response.');
    } finally {
      this._hideTypingIndicator();
    }
  }

  /**
   * Create a private response message visible only to GM.
   * Includes Publish button to make it public.
   *
   * @param {Object} result - The response result from socket.
   * @private
   */
  async _createPrivateResponseMessage(result) {
    const formattedContent = formatResponse(result.response);

    const messageContent = `
      <div class="loremaster-private-response">
        <div class="private-badge">
          <i class="fas fa-lock"></i> ${game.i18n?.localize('LOREMASTER.Private.Badge') || 'Private GM Response'}
        </div>
        <div class="response-content">${formattedContent}</div>
        <div class="private-controls">
          <button type="button" class="loremaster-publish-btn" data-message-id="${result.messageId}">
            <i class="fas fa-bullhorn"></i> ${game.i18n?.localize('LOREMASTER.Private.Publish') || 'Publish to Players'}
          </button>
          <button type="button" class="loremaster-iterate-btn" data-message-id="${result.messageId}">
            <i class="fas fa-redo"></i> ${game.i18n?.localize('LOREMASTER.Private.Iterate') || 'Refine'}
          </button>
          <button type="button" class="loremaster-discard-btn" data-message-id="${result.messageId}">
            <i class="fas fa-trash"></i> ${game.i18n?.localize('LOREMASTER.Private.Discard') || 'Discard'}
          </button>
        </div>
      </div>
    `;

    const messageData = {
      content: messageContent,
      speaker: ChatMessage.getSpeaker({ alias: 'Loremaster (Private)' }),
      user: game.user.id,  // Explicit user for compatibility with older system hooks
      whisper: game.users.filter(u => u.isGM).map(u => u.id), // GM only
      flags: {
        [MODULE_ID]: {
          isAIResponse: true,
          isPrivateResponse: true,
          messageId: result.messageId,
          canPublish: true
        }
      }
    };

    await ChatMessage.create(messageData);
  }

  /**
   * Show a player's @lm message in chat based on visibility settings.
   *
   * @param {string} content - The message content.
   * @param {Object} userContext - The player context.
   * @private
   */
  async _showPlayerMessage(content, userContext) {
    const visibility = getSetting('playerMessageVisibility');
    const gmRulingPrefix = getSetting('gmRulingPrefix');
    const isRuling = userContext.isGM && PlayerContext.isGMRuling(content, gmRulingPrefix);

    // Build speaker info
    const speaker = userContext.characterName
      ? `${userContext.characterName} (${userContext.userName})`
      : userContext.userName;

    // Build message HTML
    const classes = ['loremaster-player-message'];
    if (userContext.isGM) classes.push('is-gm');

    const messageContent = `
      <div class="${classes.join(' ')}">
        <div class="speaker-info">
          <span class="speaker-name">${userContext.userName}</span>
          ${userContext.characterName ? `<span class="character-name">as ${userContext.characterName}</span>` : ''}
          ${isRuling ? '<span class="ruling-tag">[GM RULING]</span>' : ''}
        </div>
        <div class="message-text">${content}</div>
      </div>
    `;

    const messageData = {
      content: messageContent,
      speaker: ChatMessage.getSpeaker({ alias: speaker }),
      user: game.user.id,  // Explicit user for compatibility with older system hooks
      flags: {
        [MODULE_ID]: {
          isPlayerMessage: true,
          isGMRuling: isRuling,
          userId: userContext.userId
        }
      }
    };

    // Handle visibility settings
    if (visibility === 'gm_only' && !userContext.isGM) {
      // Only GM sees player messages
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    } else if (visibility === 'private') {
      // Each player only sees their own + GM sees all
      const recipients = [userContext.userId];
      game.users.filter(u => u.isGM && u.id !== userContext.userId).forEach(u => recipients.push(u.id));
      messageData.whisper = recipients;
    }
    // 'all' visibility = no whisper restriction

    await ChatMessage.create(messageData);
  }

  /**
   * Queue a message for AI processing.
   *
   * @param {object} messageData - The message data to queue.
   * @private
   */
  _queueMessage(messageData) {
    this.messageQueue.push(messageData);

    // Process queue if not already processing
    if (!this.isProcessing) {
      this._processQueue();
    }
  }

  /**
   * Process the message queue.
   * Handles messages one at a time to maintain order.
   *
   * @private
   */
  async _processQueue() {
    if (this.messageQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const messageData = this.messageQueue.shift();

    try {
      // Show public thinking message to all players
      await this._showThinkingMessage();

      // Show local typing indicator
      this._showTypingIndicator();

      // Build context for AI
      const context = this._buildContext();

      // Send to AI via proxy server and get response
      const response = await this.socketClient.sendMessage(messageData.content, context);

      // Hide thinking message before showing response
      await this._hideThinkingMessage();

      // Create response chat message
      await this._createResponseMessage(response, messageData);

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing message:`, error);
      ui.notifications.error('Failed to get Loremaster response. Check console for details.');
    } finally {
      // Hide thinking message and typing indicator
      await this._hideThinkingMessage();
      this._hideTypingIndicator();

      // Continue processing queue
      this._processQueue();
    }
  }

  /**
   * Build context object for AI prompts.
   * Includes game state if enabled in settings.
   *
   * @returns {object} Context object for AI.
   * @private
   */
  _buildContext() {
    const context = {
      system: game.system.id,
      systemTitle: game.system.title
    };

    if (!getSetting('includeGameContext')) {
      return context;
    }

    // Add active scene info
    if (canvas.scene) {
      context.scene = {
        name: canvas.scene.name,
        description: canvas.scene.description
      };
    }

    // Add combat state if active
    if (game.combat) {
      context.combat = {
        round: game.combat.round,
        turn: game.combat.turn,
        combatants: game.combat.combatants.map(c => ({
          name: c.name,
          initiative: c.initiative,
          isDefeated: c.isDefeated
        }))
      };
    }

    // Add recent chat history (last 10 messages)
    context.recentChat = game.messages.contents
      .slice(-10)
      .map(m => ({
        speaker: m.speaker?.alias || 'Unknown',
        content: m.content
      }));

    return context;
  }

  /**
   * Create a chat message with the AI response.
   *
   * @param {string} response - The AI response text.
   * @param {object} originalMessage - The original message data.
   * @private
   */
  async _createResponseMessage(response, originalMessage) {
    const visibility = getSetting('responseVisibility');
    const gmMode = getSetting('gmMode');

    // Format the response with markdown conversion and styling
    const formattedContent = formatResponse(response);

    const messageData = {
      content: formattedContent,
      speaker: ChatMessage.getSpeaker({ alias: 'Loremaster' }),
      user: game.user.id,  // Explicit user for compatibility with older system hooks
      flags: {
        [MODULE_ID]: {
          isAIResponse: true,
          originalUser: originalMessage.user.id
        }
      }
    };

    // GM Mode takes precedence - all responses to GM only
    if (gmMode) {
      const gmUsers = game.users.filter(u => u.isGM).map(u => u.id);
      if (gmUsers.length === 0) {
        ui.notifications.warn(game.i18n.localize('LOREMASTER.Messages.GMModeNoGM'));
      }
      messageData.whisper = gmUsers;
    } else if (visibility === 'whisper') {
      messageData.whisper = [originalMessage.user.id];
    } else if (visibility === 'gm') {
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    await ChatMessage.create(messageData);
  }

  /**
   * Show a typing indicator in the chat.
   * Creates a temporary chat message with a spinning indicator.
   *
   * @private
   */
  _showTypingIndicator() {
    // Remove any existing indicator first
    this._hideTypingIndicator();

    // Create the indicator element
    const indicatorHtml = `
      <div id="loremaster-typing-indicator" class="loremaster-typing-container">
        <div class="loremaster-typing">
          <div class="loremaster-processing-spinner"></div>
          <span class="loremaster-processing-text">Loremaster is thinking...</span>
        </div>
      </div>
    `;

    // Append to chat log
    const chatLog = document.querySelector('#chat-log');
    if (chatLog) {
      chatLog.insertAdjacentHTML('beforeend', indicatorHtml);
      // Scroll to bottom to show indicator
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    console.log(`${MODULE_ID} | AI is thinking...`);
  }

  /**
   * Hide the typing indicator.
   * Removes the temporary indicator element from the chat.
   *
   * @private
   */
  _hideTypingIndicator() {
    const indicator = document.getElementById('loremaster-typing-indicator');
    if (indicator) {
      indicator.remove();
    }
    console.log(`${MODULE_ID} | AI finished thinking`);
  }

  /**
   * Show a public thinking message in chat.
   * Displays a random thinking phrase from Loremaster to all players.
   *
   * @private
   */
  async _showThinkingMessage() {
    // Remove any existing thinking message first
    await this._hideThinkingMessage();

    // Select a random thinking phrase
    const phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];

    // Create public chat message
    const messageData = {
      content: `<div class="loremaster-thinking-message"><em>${phrase}</em></div>`,
      speaker: ChatMessage.getSpeaker({ alias: 'Loremaster' }),
      user: game.user.id,  // Explicit user for compatibility with older system hooks
      flags: {
        [MODULE_ID]: {
          isThinkingMessage: true
        }
      }
    };

    try {
      const message = await ChatMessage.create(messageData);
      this.thinkingMessageId = message.id;
      console.log(`${MODULE_ID} | Showing thinking message: "${phrase}"`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to create thinking message:`, error);
    }
  }

  /**
   * Hide the thinking message from chat.
   * Deletes the temporary thinking message when response arrives.
   *
   * @private
   */
  async _hideThinkingMessage() {
    if (this.thinkingMessageId) {
      try {
        const message = game.messages.get(this.thinkingMessageId);
        if (message) {
          await message.delete();
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to delete thinking message:`, error);
      }
      this.thinkingMessageId = null;
    }
  }

  // ===== Batch Processing Methods =====

  /**
   * Process a batch of messages from the MessageBatcher.
   *
   * @param {Object} batch - The batch object from MessageBatcher.
   * @param {string} batch.id - The batch ID.
   * @param {Array} batch.messages - Array of player messages.
   * @param {Array} batch.gmRulings - Array of GM rulings.
   * @param {string} batch.formattedPrompt - Pre-formatted prompt for Claude.
   */
  async processBatch(batch) {
    console.log(`${MODULE_ID} | Processing batch ${batch.id}`);

    // Store for potential veto/regenerate
    this.lastBatchId = batch.id;
    this.lastBatch = batch;

    try {
      // Show public thinking message to all players
      await this._showThinkingMessage();

      // Show local typing indicator
      this._showTypingIndicator();

      // Build context for AI
      const context = this._buildContext();

      // Send batched message to AI via proxy
      // The formattedPrompt contains all player actions in structured format
      const response = await this.socketClient.sendBatchedMessage(batch, context);

      // Hide thinking message before showing response
      await this._hideThinkingMessage();

      // Create response chat message
      await this._createBatchResponseMessage(response, batch);

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing batch:`, error);
      ui.notifications.error('Failed to get Loremaster response. Check console for details.');
      throw error;
    } finally {
      await this._hideThinkingMessage();
      this._hideTypingIndicator();
    }
  }

  /**
   * Create a chat message with the AI response for a batch.
   *
   * @param {string} response - The AI response text.
   * @param {Object} batch - The original batch data.
   * @private
   */
  async _createBatchResponseMessage(response, batch) {
    const visibility = getSetting('responseVisibility');
    const gmMode = getSetting('gmMode');

    // Check for empty response
    if (!response || response.length === 0) {
      console.error(`${MODULE_ID} | ERROR: Empty response received from server`);
      ui.notifications.error('Received empty response from Loremaster');
      return;
    }

    // Ensure response is a string
    const responseText = typeof response === 'string' ? response : String(response);

    // Format the response with markdown conversion and styling
    // (formatResponse auto-detects if already HTML-formatted)
    const formattedContent = formatResponse(responseText);

    // Collect all user IDs from the batch for whisper targeting
    const batchUserIds = [...new Set(batch.messages.map(m => m.userId))];

    const messageData = {
      content: formattedContent,
      speaker: ChatMessage.getSpeaker({ alias: 'Loremaster' }),
      user: game.user.id,  // Explicit user for compatibility with older system hooks
      flags: {
        [MODULE_ID]: {
          isAIResponse: true,
          isBatchResponse: true,
          batchId: batch.id,
          participantUserIds: batchUserIds
        }
      }
    };

    // GM Mode takes precedence - all responses to GM only
    if (gmMode) {
      const gmUsers = game.users.filter(u => u.isGM).map(u => u.id);
      if (gmUsers.length === 0) {
        ui.notifications.warn(game.i18n.localize('LOREMASTER.Messages.GMModeNoGM'));
      }
      messageData.whisper = gmUsers;
    } else if (visibility === 'whisper') {
      // Whisper to all participants
      messageData.whisper = batchUserIds;
    } else if (visibility === 'gm') {
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    try {
      await ChatMessage.create(messageData);
    } catch (err) {
      console.error(`${MODULE_ID} | ChatMessage.create failed:`, err);
      throw err;
    }
  }

  /**
   * Veto an AI response and request regeneration with correction.
   * GM-only action.
   *
   * @param {string} messageId - The message/batch ID to veto.
   * @param {string} correction - The GM's correction instructions.
   */
  async vetoResponse(messageId, correction) {
    if (!game.user?.isGM) {
      ui.notifications.warn('Only the GM can veto responses.');
      return;
    }

    console.log(`${MODULE_ID} | Vetoing response ${messageId} with correction`);

    // Find the original batch
    const batch = this.lastBatch;
    if (!batch || batch.id !== messageId) {
      ui.notifications.error('Cannot find the original batch for this response.');
      return;
    }

    try {
      this._showTypingIndicator();

      // Build context
      const context = this._buildContext();

      // Send veto request to proxy
      const response = await this.socketClient.sendVeto(messageId, correction, batch, context);

      // Create new response message
      await this._createBatchResponseMessage(response, {
        ...batch,
        id: `${batch.id}-veto`
      });

      ui.notifications.info(game.i18n?.localize('LOREMASTER.Veto.Success') || 'Response vetoed. Regenerating...');

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing veto:`, error);
      ui.notifications.error(game.i18n?.localize('LOREMASTER.Veto.Error') || 'Failed to veto response');
    } finally {
      this._hideTypingIndicator();
    }
  }

  /**
   * Regenerate an AI response without correction (simple retry).
   * GM-only action.
   *
   * @param {string} messageId - The message/batch ID to regenerate.
   */
  async regenerateResponse(messageId) {
    if (!game.user?.isGM) {
      ui.notifications.warn('Only the GM can regenerate responses.');
      return;
    }

    console.log(`${MODULE_ID} | Regenerating response ${messageId}`);

    // Find the original batch
    const batch = this.lastBatch;
    if (!batch || batch.id !== messageId) {
      ui.notifications.error('Cannot find the original batch for this response.');
      return;
    }

    try {
      this._showTypingIndicator();

      // Build context
      const context = this._buildContext();

      // Resend the batch
      const response = await this.socketClient.sendBatchedMessage(batch, context);

      // Create new response message
      await this._createBatchResponseMessage(response, {
        ...batch,
        id: `${batch.id}-regen`
      });

    } catch (error) {
      console.error(`${MODULE_ID} | Error regenerating response:`, error);
      ui.notifications.error('Failed to regenerate response');
    } finally {
      this._hideTypingIndicator();
    }
  }

  // ===== Private Response Methods =====

  /**
   * Publish a private response to all players and add to canon.
   * Makes the response visible to all players and records it as official narrative history.
   *
   * @param {string} messageId - The message ID of the private response.
   */
  async publishPrivateResponse(messageId) {
    if (!game.user?.isGM) {
      ui.notifications.warn('Only the GM can publish responses.');
      return;
    }

    const pendingResponse = this.pendingPrivateResponses.get(messageId);
    if (!pendingResponse) {
      ui.notifications.error('Cannot find the private response to publish.');
      return;
    }

    console.log(`${MODULE_ID} | Publishing private response ${messageId}`);

    try {
      // Get current scene context for canon entry
      const sceneContext = canvas.scene ? {
        name: canvas.scene.name,
        id: canvas.scene.id
      } : null;

      // Publish to canon on the server
      await this.socketClient.publishToCanon(
        pendingResponse.content,
        pendingResponse.messageId,
        sceneContext
      );

      // Create public chat message for all players
      const formattedContent = formatResponse(pendingResponse.content);

      const messageData = {
        content: formattedContent,
        speaker: ChatMessage.getSpeaker({ alias: 'Loremaster' }),
        user: game.user.id,  // Explicit user for compatibility with older system hooks
        flags: {
          [MODULE_ID]: {
            isAIResponse: true,
            isCanon: true,
            originalMessageId: messageId
          }
        }
      };

      await ChatMessage.create(messageData);

      // Remove from pending
      this.pendingPrivateResponses.delete(messageId);

      // Find and delete the private GM message
      const privateMessage = game.messages.find(m =>
        m.flags?.[MODULE_ID]?.isPrivateResponse &&
        m.flags?.[MODULE_ID]?.messageId === messageId
      );
      if (privateMessage) {
        await privateMessage.delete();
      }

      ui.notifications.info(game.i18n?.localize('LOREMASTER.Private.Published') || 'Response published to players and added to canon.');

    } catch (error) {
      console.error(`${MODULE_ID} | Error publishing response:`, error);
      ui.notifications.error(game.i18n?.localize('LOREMASTER.Private.PublishError') || 'Failed to publish response');
    }
  }

  /**
   * Iterate on a private response with additional instructions.
   * Opens a dialog for the GM to provide refinement instructions.
   *
   * @param {string} messageId - The message ID of the private response.
   */
  async iteratePrivateResponse(messageId) {
    if (!game.user?.isGM) {
      ui.notifications.warn('Only the GM can iterate on responses.');
      return;
    }

    const pendingResponse = this.pendingPrivateResponses.get(messageId);
    if (!pendingResponse) {
      ui.notifications.error('Cannot find the private response to iterate.');
      return;
    }

    console.log(`${MODULE_ID} | Opening iterate dialog for ${messageId}`);

    // Create a dialog for refinement instructions
    const content = `
      <form class="loremaster-iterate-dialog">
        <div class="form-group">
          <label>${game.i18n?.localize('LOREMASTER.Private.IterateLabel') || 'How should Loremaster refine this response?'}</label>
          <textarea name="refinement" rows="4" placeholder="${game.i18n?.localize('LOREMASTER.Private.IteratePlaceholder') || 'Provide instructions for refining the response...'}"></textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n?.localize('LOREMASTER.Private.OriginalResponse') || 'Original Response:'}</label>
          <div class="original-response-preview">${pendingResponse.content.substring(0, 300)}${pendingResponse.content.length > 300 ? '...' : ''}</div>
        </div>
      </form>
    `;

    new Dialog({
      title: game.i18n?.localize('LOREMASTER.Private.IterateTitle') || 'Refine Response',
      content: content,
      buttons: {
        submit: {
          icon: '<i class="fas fa-sync"></i>',
          label: game.i18n?.localize('LOREMASTER.Private.IterateSubmit') || 'Refine',
          callback: async (html) => {
            html = $(html); // Ensure jQuery for Foundry v12 compatibility
            const refinement = html.find('textarea[name="refinement"]').val().trim();
            if (!refinement) {
              ui.notifications.warn('Please provide refinement instructions.');
              return;
            }
            await this._processIteration(messageId, pendingResponse, refinement);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n?.localize('LOREMASTER.Private.Cancel') || 'Cancel'
        }
      },
      default: 'submit'
    }).render(true);
  }

  /**
   * Process an iteration request for a private response.
   *
   * @param {string} messageId - The original message ID.
   * @param {Object} pendingResponse - The pending response data.
   * @param {string} refinement - The GM's refinement instructions.
   * @private
   */
  async _processIteration(messageId, pendingResponse, refinement) {
    console.log(`${MODULE_ID} | Processing iteration for ${messageId}`);

    try {
      this._showTypingIndicator();

      // Build context including the previous response
      const context = this._buildContext();
      context.previousResponse = pendingResponse.content;

      // Build the refinement message
      const iterationMessage = `
[GM Refinement Request]
Previous response from Loremaster:
---
${pendingResponse.content}
---

GM's refinement instructions:
${refinement}

Please provide an updated response based on these instructions.
`;

      // Send as a new private message
      const result = await this.socketClient.sendPrivateMessage(iterationMessage, context);

      // Update the pending response with the new content
      this.pendingPrivateResponses.set(result.messageId, {
        content: result.response,
        messageId: result.messageId,
        conversationId: result.conversationId,
        originalMessage: pendingResponse.originalMessage,
        previousIterations: [...(pendingResponse.previousIterations || []), pendingResponse.content],
        timestamp: Date.now()
      });

      // Remove the old pending response
      this.pendingPrivateResponses.delete(messageId);

      // Delete the old private message
      const oldPrivateMessage = game.messages.find(m =>
        m.flags?.[MODULE_ID]?.isPrivateResponse &&
        m.flags?.[MODULE_ID]?.messageId === messageId
      );
      if (oldPrivateMessage) {
        await oldPrivateMessage.delete();
      }

      // Create new private response message
      await this._createPrivateResponseMessage(result);

      ui.notifications.info(game.i18n?.localize('LOREMASTER.Private.IterateSuccess') || 'Response refined. Review the new version.');

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing iteration:`, error);
      ui.notifications.error(game.i18n?.localize('LOREMASTER.Private.IterateError') || 'Failed to refine response');
    } finally {
      this._hideTypingIndicator();
    }
  }

  /**
   * Discard a private response without publishing.
   *
   * @param {string} messageId - The message ID of the private response.
   * @param {ChatMessage} chatMessage - The chat message to delete.
   */
  async discardPrivateResponse(messageId, chatMessage) {
    if (!game.user?.isGM) {
      ui.notifications.warn('Only the GM can discard responses.');
      return;
    }

    console.log(`${MODULE_ID} | Discarding private response ${messageId}`);

    // Confirm discard
    const confirmed = await Dialog.confirm({
      title: game.i18n?.localize('LOREMASTER.Private.DiscardTitle') || 'Discard Response',
      content: `<p>${game.i18n?.localize('LOREMASTER.Private.DiscardConfirm') || 'Are you sure you want to discard this response? It will not be saved to canon.'}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });

    if (!confirmed) {
      return;
    }

    try {
      // Remove from pending responses
      this.pendingPrivateResponses.delete(messageId);

      // Delete the chat message
      if (chatMessage) {
        await chatMessage.delete();
      } else {
        // Try to find it
        const privateMessage = game.messages.find(m =>
          m.flags?.[MODULE_ID]?.isPrivateResponse &&
          m.flags?.[MODULE_ID]?.messageId === messageId
        );
        if (privateMessage) {
          await privateMessage.delete();
        }
      }

      ui.notifications.info(game.i18n?.localize('LOREMASTER.Private.Discarded') || 'Response discarded.');

    } catch (error) {
      console.error(`${MODULE_ID} | Error discarding response:`, error);
      ui.notifications.error('Failed to discard response');
    }
  }
}
