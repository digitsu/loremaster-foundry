/**
 * Batch Processor Service
 *
 * Handles processing of batched player messages for multi-player
 * synchronization. Formats messages, manages batch state, and
 * integrates with conversation storage.
 */

/**
 * BatchProcessor class handles server-side batch operations.
 */
export class BatchProcessor {
  /**
   * Create a new BatchProcessor instance.
   *
   * @param {ConversationStore} conversationStore - The conversation storage.
   */
  constructor(conversationStore) {
    this.conversationStore = conversationStore;
  }

  /**
   * Process an incoming batch request from the client.
   *
   * @param {string} worldId - The world ID.
   * @param {Object} batchData - The batch data from the client.
   * @param {string} batchData.batchId - The batch ID.
   * @param {Array} batchData.messages - Array of player messages.
   * @param {Array} batchData.gmRulings - Array of GM rulings.
   * @param {string} batchData.formattedPrompt - Pre-formatted prompt from client.
   * @param {Object} context - Game context.
   * @returns {Object} Processed batch ready for Claude.
   */
  async processBatch(worldId, batchData, context = {}) {
    const { batchId, messages, gmRulings, formattedPrompt } = batchData;

    // Get or create conversation
    const conversation = this.conversationStore.getOrCreateConversation(worldId, {
      title: context?.sceneName || 'Session'
    });

    // Create batch record in database
    const batch = this.conversationStore.createBatch(
      conversation.id,
      worldId,
      messages,
      gmRulings,
      context?.batchTimerDuration || 10
    );

    // Build the combined user message
    const userMessage = this.buildUserMessage(formattedPrompt, messages, gmRulings);

    // Store as single user message in conversation (aggregated)
    this.conversationStore.addMessage(
      conversation.id,
      'user',
      userMessage,
      context
    );

    return {
      conversationId: conversation.id,
      batchId: batch.id,
      userMessage,
      hasGmRulings: gmRulings.length > 0,
      participantCount: new Set(messages.map(m => m.userId)).size
    };
  }

  /**
   * Build the combined user message from batch data.
   *
   * @param {string} formattedPrompt - Pre-formatted prompt from client.
   * @param {Array} messages - Array of player messages.
   * @param {Array} gmRulings - Array of GM rulings.
   * @returns {string} The combined message for Claude.
   */
  buildUserMessage(formattedPrompt, messages, gmRulings) {
    // The client has already formatted the prompt, but we can
    // add server-side enhancements if needed
    if (formattedPrompt) {
      return formattedPrompt;
    }

    // Fallback: build prompt on server if client didn't provide
    return this.formatBatchForClaude(messages, gmRulings);
  }

  /**
   * Format a batch of messages for Claude (server-side fallback).
   *
   * @param {Array} messages - Array of player messages.
   * @param {Array} gmRulings - Array of GM rulings.
   * @returns {string} Formatted text for Claude.
   */
  formatBatchForClaude(messages, gmRulings) {
    if (messages.length === 0 && gmRulings.length === 0) {
      return '';
    }

    const lines = ['=== SIMULTANEOUS PLAYER ACTIONS ==='];
    lines.push('The following actions are happening at the same in-game time.');
    lines.push('');

    // Add player messages
    for (const msg of messages) {
      const speaker = msg.characterName
        ? `${msg.characterName} (Player: ${msg.userName})`
        : msg.userName;

      if (msg.isGM) {
        lines.push(`[GM - ${msg.userName}]`);
      } else {
        lines.push(`[${speaker}]`);
      }
      lines.push(msg.content);
      lines.push('');
    }

    // Add GM rulings
    if (gmRulings.length > 0) {
      for (const ruling of gmRulings) {
        lines.push('[GM RULING - MUST FOLLOW]');
        lines.push(ruling.content);
        lines.push('');
      }
    }

    lines.push('=== END PLAYER ACTIONS ===');

    return lines.join('\n');
  }

  /**
   * Process a veto request.
   *
   * @param {string} worldId - The world ID.
   * @param {Object} vetoData - The veto request data.
   * @param {string} vetoData.batchId - The batch ID being vetoed.
   * @param {string} vetoData.correction - The GM's correction.
   * @param {Object} vetoData.originalBatch - The original batch data.
   * @param {Object} context - Game context.
   * @returns {Object} Processed veto ready for Claude.
   */
  async processVeto(worldId, vetoData, context = {}) {
    const { batchId, correction, originalBatch } = vetoData;

    // Get the conversation
    const conversation = this.conversationStore.getOrCreateConversation(worldId);

    // Update batch status to vetoed
    const existingBatch = this.conversationStore.getBatch(batchId);
    if (existingBatch) {
      this.conversationStore.updateBatchStatus(batchId, 'vetoed', {
        correction
      });
    }

    // Build the veto message
    const vetoMessage = this.buildVetoMessage(originalBatch, correction);

    // Store the veto message
    this.conversationStore.addMessage(
      conversation.id,
      'user',
      vetoMessage,
      context
    );

    return {
      conversationId: conversation.id,
      vetoMessage,
      originalBatchId: batchId
    };
  }

  /**
   * Build the veto message for Claude.
   *
   * @param {Object} originalBatch - The original batch data.
   * @param {string} correction - The GM's correction.
   * @returns {string} The veto message for Claude.
   */
  buildVetoMessage(originalBatch, correction) {
    const lines = [];

    lines.push('=== GM VETO - REGENERATE RESPONSE ===');
    lines.push('');
    lines.push('The GM has vetoed the previous response. Please regenerate with the following correction:');
    lines.push('');
    lines.push('--- GM CORRECTION ---');
    lines.push(correction);
    lines.push('--- END CORRECTION ---');
    lines.push('');
    lines.push('Original player actions (respond to these again with the correction applied):');
    lines.push('');

    // Include the original formatted prompt
    if (originalBatch.formattedPrompt) {
      lines.push(originalBatch.formattedPrompt);
    } else {
      lines.push(this.formatBatchForClaude(originalBatch.messages, originalBatch.gmRulings));
    }

    return lines.join('\n');
  }

  /**
   * Mark a batch as completed with the response message ID.
   *
   * @param {string} batchId - The batch ID.
   * @param {number} responseMessageId - The response message ID.
   */
  completeBatch(batchId, responseMessageId) {
    this.conversationStore.updateBatchStatus(batchId, 'completed', {
      responseMessageId
    });
  }
}
