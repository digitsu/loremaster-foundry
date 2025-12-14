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
      speaker: {
        alias: 'Loremaster (Private)'
      },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
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
      speaker: {
        alias: speaker
      },
      style: CONST.CHAT_MESSAGE_STYLES.OOC,
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
      // Show typing indicator
      this._showTypingIndicator();

      // Build context for AI
      const context = this._buildContext();

      // Send to AI via proxy server and get response
      const response = await this.socketClient.sendMessage(messageData.content, context);

      // Create response chat message
      await this._createResponseMessage(response, messageData);

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing message:`, error);
      ui.notifications.error('Failed to get Loremaster response. Check console for details.');
    } finally {
      // Hide typing indicator
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

    // Format the response with markdown conversion and styling
    const formattedContent = formatResponse(response);

    const messageData = {
      content: formattedContent,
      speaker: {
        alias: 'Loremaster'
      },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        [MODULE_ID]: {
          isAIResponse: true,
          originalUser: originalMessage.user.id
        }
      }
    };

    // Handle visibility settings
    if (visibility === 'whisper') {
      messageData.whisper = [originalMessage.user.id];
    } else if (visibility === 'gm') {
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    await ChatMessage.create(messageData);
  }

  /**
   * Show a typing indicator in the chat.
   *
   * @private
   */
  _showTypingIndicator() {
    // TODO: Implement visual typing indicator
    console.log(`${MODULE_ID} | AI is thinking...`);
  }

  /**
   * Hide the typing indicator.
   *
   * @private
   */
  _hideTypingIndicator() {
    // TODO: Implement visual typing indicator removal
    console.log(`${MODULE_ID} | AI finished thinking`);
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
      // Show typing indicator
      this._showTypingIndicator();

      // Build context for AI
      const context = this._buildContext();

      // Send batched message to AI via proxy
      // The formattedPrompt contains all player actions in structured format
      const response = await this.socketClient.sendBatchedMessage(batch, context);

      // Create response chat message
      await this._createBatchResponseMessage(response, batch);

    } catch (error) {
      console.error(`${MODULE_ID} | Error processing batch:`, error);
      ui.notifications.error('Failed to get Loremaster response. Check console for details.');
      throw error;
    } finally {
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

    // Format the response with markdown conversion and styling
    const formattedContent = formatResponse(response);

    // Collect all user IDs from the batch for whisper targeting
    const batchUserIds = [...new Set(batch.messages.map(m => m.userId))];

    const messageData = {
      content: formattedContent,
      speaker: {
        alias: 'Loremaster'
      },
      style: CONST.CHAT_MESSAGE_STYLES.OTHER,
      flags: {
        [MODULE_ID]: {
          isAIResponse: true,
          isBatchResponse: true,
          batchId: batch.id,
          participantUserIds: batchUserIds
        }
      }
    };

    // Handle visibility settings
    if (visibility === 'whisper') {
      // Whisper to all participants
      messageData.whisper = batchUserIds;
    } else if (visibility === 'gm') {
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    await ChatMessage.create(messageData);
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
        speaker: {
          alias: 'Loremaster'
        },
        style: CONST.CHAT_MESSAGE_STYLES.OTHER,
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
