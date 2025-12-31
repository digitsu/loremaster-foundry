/**
 * Loremaster Socket Client
 *
 * WebSocket client for communication with the Loremaster proxy server.
 * Handles authentication, chat messages, data sync, and tool execution.
 */

import { getSetting, setSetting } from './config.mjs';

const MODULE_ID = 'loremaster';

/**
 * SocketClient class manages WebSocket connection to the proxy server.
 */
export class SocketClient {
  /**
   * Create a new SocketClient instance.
   */
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.isGM = false;
    this.licenseStatus = null;
    this.pendingRequests = new Map();
    this.progressCallbacks = new Map();
    this.requestIdCounter = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    this.toolHandlers = new Map();
  }

  /**
   * Connect to the proxy server.
   *
   * @returns {Promise<boolean>} True if connection successful.
   */
  async connect() {
    const proxyUrl = getSetting('proxyUrl');

    if (!proxyUrl) {
      throw new Error('Proxy URL not configured. Please set the proxy URL in module settings.');
    }

    // Convert HTTP URL to WebSocket URL
    const wsUrl = proxyUrl.replace(/^http/, 'ws');

    return new Promise((resolve, reject) => {
      try {
        console.log(`${MODULE_ID} | Connecting to proxy server: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log(`${MODULE_ID} | WebSocket connected`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          resolve(true);
        };

        this.ws.onclose = (event) => {
          console.log(`${MODULE_ID} | WebSocket disconnected: ${event.code}`);
          this.isConnected = false;
          this.isAuthenticated = false;
          this._handleDisconnect();
        };

        this.ws.onerror = (error) => {
          console.error(`${MODULE_ID} | WebSocket error:`, error);
          reject(new Error('Failed to connect to proxy server'));
        };

        this.ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Authenticate with the proxy server.
   * Sends user info including GM status for access control.
   *
   * @returns {Promise<object>} Authentication result.
   */
  async authenticate() {
    if (!this.isConnected) {
      throw new Error('Not connected to proxy server');
    }

    const apiKey = getSetting('apiKey');
    const licenseKey = getSetting('licenseKey');
    const worldId = game.world.id;
    const worldName = game.world.title;

    // Include user info for access control
    const userId = game.user.id;
    const userName = game.user.name;
    const isGM = game.user.isGM;

    // Build auth payload
    const payload = {
      worldId,
      worldName,
      userId,
      userName,
      isGM
    };

    // Only send API key if it's been set (non-empty)
    if (apiKey) {
      payload.apiKey = apiKey;
    }

    // Send license key if configured (for production proxy servers)
    if (licenseKey) {
      payload.licenseKey = licenseKey;
    }

    const result = await this._sendRequest('auth', payload);
    this.isAuthenticated = result.success;
    this.isGM = result.isGM || false;
    this.licenseStatus = result.license || null;

    if (result.success) {
      console.log(`${MODULE_ID} | Authenticated with proxy server (GM: ${this.isGM})`);
      if (this.licenseStatus) {
        console.log(`${MODULE_ID} | License: ${this.licenseStatus.isValid ? 'Valid' : 'Invalid'} (${this.licenseStatus.tier})`);
      }
    }

    return result;
  }

  /**
   * Get the current license status from the proxy server.
   *
   * @returns {Object|null} License status object or null if not authenticated.
   */
  getLicenseStatus() {
    return this.licenseStatus;
  }

  /**
   * Send a chat message to the AI.
   *
   * @param {string} message - The user's message.
   * @param {object} context - Game context to include.
   * @param {boolean} isPrivate - If true, response only goes to GM (GM only).
   * @returns {Promise<object>} The AI response object including response text and metadata.
   */
  async sendMessage(message, context = {}, isPrivate = false) {
    this._requireAuth();

    const result = await this._sendRequest('chat', {
      message,
      context,
      isPrivate
    });

    return {
      response: result.response,
      messageId: result.messageId,
      conversationId: result.conversationId,
      isPrivate: result.isPrivate,
      canPublish: result.canPublish,
      usage: result.usage
    };
  }

  /**
   * Send a private chat message to the AI (GM only).
   * Response only goes to GM until published.
   *
   * @param {string} message - The user's message.
   * @param {object} context - Game context to include.
   * @returns {Promise<object>} The AI response object including response text and metadata.
   */
  async sendPrivateMessage(message, context = {}) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Private messages require GM permissions');
    }

    return this.sendMessage(message, context, true);
  }

  /**
   * Send a batched message to the AI (multi-player synchronization).
   *
   * @param {object} batch - The batch object from MessageBatcher.
   * @param {string} batch.id - The batch ID.
   * @param {Array} batch.messages - Array of player messages.
   * @param {Array} batch.gmRulings - Array of GM rulings.
   * @param {string} batch.formattedPrompt - Pre-formatted prompt for Claude.
   * @param {object} context - Game context to include.
   * @returns {Promise<string>} The AI response text.
   */
  async sendBatchedMessage(batch, context = {}) {
    this._requireAuth();

    const result = await this._sendRequest('chat-batch', {
      batchId: batch.id,
      messages: batch.messages,
      gmRulings: batch.gmRulings,
      formattedPrompt: batch.formattedPrompt,
      context
    });

    return result.response;
  }

  /**
   * Send a veto request to regenerate an AI response with correction.
   *
   * @param {string} batchId - The batch ID being vetoed.
   * @param {string} correction - The GM's correction instructions.
   * @param {object} originalBatch - The original batch data.
   * @param {object} context - Game context to include.
   * @returns {Promise<string>} The new AI response text.
   */
  async sendVeto(batchId, correction, originalBatch, context = {}) {
    this._requireAuth();

    const result = await this._sendRequest('veto', {
      batchId,
      correction,
      originalBatch: {
        id: originalBatch.id,
        messages: originalBatch.messages,
        gmRulings: originalBatch.gmRulings,
        formattedPrompt: originalBatch.formattedPrompt
      },
      context
    });

    return result.response;
  }

  /**
   * Sync world data to the proxy server.
   *
   * @param {object} worldData - The serialized world data.
   * @param {string} dataType - Type of data (rules, compendium, world_state).
   * @returns {Promise<object>} Sync result.
   */
  async syncData(worldData, dataType) {
    this._requireAuth();

    return this._sendRequest('sync', {
      worldData,
      dataType
    });
  }

  /**
   * List all synced files for this world.
   *
   * @returns {Promise<object>} List of synced files.
   */
  async listFiles() {
    this._requireAuth();

    return this._sendRequest('list-files', {});
  }

  /**
   * Delete a synced file.
   *
   * @param {string} fileId - The Claude file_id to delete.
   * @returns {Promise<object>} Delete result.
   */
  async deleteFile(fileId) {
    this._requireAuth();

    return this._sendRequest('delete-file', { fileId });
  }

  /**
   * Upload a PDF document for processing and context extraction.
   *
   * @param {string} filename - Original filename.
   * @param {string} category - Category: 'adventure', 'supplement', 'reference'.
   * @param {string} displayName - User-provided display name.
   * @param {string} fileData - Base64-encoded PDF file data.
   * @param {Function} onProgress - Progress callback: (stage, progress, message) => void.
   * @returns {Promise<object>} Upload result with PDF record details.
   */
  async uploadPDF(filename, category, displayName, fileData, onProgress = null) {
    this._requireAuth();

    const requestId = `req_${++this.requestIdCounter}`;

    // Store progress callback if provided
    if (onProgress) {
      this.progressCallbacks.set(requestId, onProgress);
    }

    return new Promise((resolve, reject) => {
      // Set up timeout (5 minutes for large PDFs)
      const timeout = 300000;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.progressCallbacks.delete(requestId);
        reject(new Error('PDF upload timeout'));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          reject(error);
        }
      });

      // Send request
      this.ws.send(JSON.stringify({
        type: 'pdf-upload',
        requestId,
        filename,
        category,
        displayName,
        fileData
      }));
    });
  }

  /**
   * List all PDF documents for the current world.
   *
   * @returns {Promise<Array>} Array of PDF document records.
   */
  async listPDFs() {
    this._requireAuth();

    const result = await this._sendRequest('list-pdfs', {});
    return result.pdfs || [];
  }

  /**
   * Delete a PDF document.
   *
   * @param {number} pdfId - The PDF document ID.
   * @returns {Promise<object>} Delete result.
   */
  async deletePDF(pdfId) {
    this._requireAuth();

    return this._sendRequest('delete-pdf', { pdfId });
  }

  /**
   * Get PDF statistics for the current world.
   *
   * @returns {Promise<object>} Statistics object with counts and sizes.
   */
  async getPDFStats() {
    this._requireAuth();

    const result = await this._sendRequest('list-pdfs', {});
    return result.stats || {
      total: 0,
      completed: 0,
      failed: 0,
      processing: 0,
      pending: 0,
      totalSize: 0,
      totalTextLength: 0
    };
  }

  /**
   * Get conversation history.
   *
   * @param {string} conversationId - Optional conversation ID.
   * @param {number} limit - Maximum messages to retrieve.
   * @returns {Promise<object>} History result.
   */
  async getHistory(conversationId = null, limit = 50) {
    this._requireAuth();

    return this._sendRequest('history', {
      conversationId,
      limit
    });
  }

  /**
   * Start a new conversation.
   *
   * @param {string} title - Optional conversation title.
   * @returns {Promise<object>} New conversation result.
   */
  async newConversation(title = null) {
    this._requireAuth();

    return this._sendRequest('new-conversation', {
      title
    });
  }

  /**
   * List all conversations for the current world.
   *
   * @param {number} limit - Maximum conversations to retrieve.
   * @param {number} offset - Offset for pagination.
   * @returns {Promise<object>} Object with conversations array and hasMore flag.
   */
  async listConversations(limit = 50, offset = 0) {
    this._requireAuth();

    return this._sendRequest('list-conversations', {
      limit,
      offset
    });
  }

  /**
   * Get a specific conversation with its messages.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {number} messageLimit - Maximum messages to retrieve.
   * @returns {Promise<object>} Conversation object with messages.
   */
  async getConversation(conversationId, messageLimit = 100) {
    this._requireAuth();

    return this._sendRequest('get-conversation', {
      conversationId,
      messageLimit
    });
  }

  /**
   * Delete a conversation and all its messages.
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {Promise<object>} Delete result.
   */
  async deleteConversation(conversationId) {
    this._requireAuth();

    return this._sendRequest('delete-conversation', {
      conversationId
    });
  }

  /**
   * Rename a conversation.
   *
   * @param {string} conversationId - The conversation ID.
   * @param {string} title - The new title.
   * @returns {Promise<object>} Rename result.
   */
  async renameConversation(conversationId, title) {
    this._requireAuth();

    return this._sendRequest('rename-conversation', {
      conversationId,
      title
    });
  }

  /**
   * Clear all messages from a conversation but keep the conversation record.
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {Promise<object>} Clear result.
   */
  async clearConversation(conversationId) {
    this._requireAuth();

    return this._sendRequest('clear-conversation', {
      conversationId
    });
  }

  /**
   * Switch to a different conversation.
   *
   * @param {string} conversationId - The conversation ID to switch to.
   * @returns {Promise<object>} Switch result with conversation details.
   */
  async switchConversation(conversationId) {
    this._requireAuth();

    return this._sendRequest('switch-conversation', {
      conversationId
    });
  }

  // ===== Canon (Official History) Methods =====

  /**
   * Publish a message to canon (official narrative history).
   * GM only - makes a response part of the permanent campaign history.
   *
   * @param {string} content - The content to publish.
   * @param {number} messageId - Optional original message ID.
   * @param {object} sceneContext - Optional scene context.
   * @returns {Promise<object>} Publish result with canon ID.
   */
  async publishToCanon(content, messageId = null, sceneContext = null) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Publishing to canon requires GM permissions');
    }

    return this._sendRequest('publish-to-canon', {
      content,
      messageId,
      sceneContext
    });
  }

  /**
   * List canon messages for the current world.
   *
   * @param {number} limit - Maximum messages to retrieve.
   * @param {number} offset - Offset for pagination.
   * @returns {Promise<object>} Object with canon array and total count.
   */
  async listCanon(limit = 100, offset = 0) {
    this._requireAuth();

    return this._sendRequest('list-canon', {
      limit,
      offset
    });
  }

  /**
   * Update a canon message (GM correction).
   *
   * @param {number} canonId - The canon message ID.
   * @param {string} content - The corrected content.
   * @returns {Promise<object>} Update result.
   */
  async updateCanon(canonId, content) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Updating canon requires GM permissions');
    }

    return this._sendRequest('update-canon', {
      canonId,
      content
    });
  }

  /**
   * Delete a canon message (GM retcon).
   *
   * @param {number} canonId - The canon message ID.
   * @returns {Promise<object>} Delete result.
   */
  async deleteCanon(canonId) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Deleting canon requires GM permissions');
    }

    return this._sendRequest('delete-canon', {
      canonId
    });
  }

  // ===== House Rules Methods =====

  /**
   * Submit a new GM ruling for a rules discrepancy.
   *
   * @param {object} ruling - The ruling details.
   * @param {string} ruling.ruleContext - Short description of the rule situation.
   * @param {string} ruling.foundryInterpretation - What Foundry/system says.
   * @param {string} ruling.pdfInterpretation - What the PDF says.
   * @param {string} ruling.gmRuling - The GM's decision.
   * @param {string} ruling.rulingType - 'session' or 'persistent'.
   * @param {number} ruling.sourcePdfId - Optional source PDF ID.
   * @returns {Promise<object>} Ruling result with ID.
   */
  async submitRuling(ruling) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Submitting rulings requires GM permissions');
    }

    return this._sendRequest('submit-ruling', ruling);
  }

  /**
   * List house rules for the current world.
   *
   * @param {boolean} persistentOnly - If true, only return persistent rules.
   * @returns {Promise<Array>} Array of ruling records.
   */
  async listRulings(persistentOnly = false) {
    this._requireAuth();

    const result = await this._sendRequest('list-rulings', {
      persistentOnly
    });
    return result.rulings || [];
  }

  /**
   * Update an existing ruling.
   *
   * @param {number} rulingId - The ruling ID.
   * @param {object} updates - Fields to update.
   * @returns {Promise<object>} Update result.
   */
  async updateRuling(rulingId, updates) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Updating rulings requires GM permissions');
    }

    return this._sendRequest('update-ruling', {
      rulingId,
      ...updates
    });
  }

  /**
   * Delete a ruling.
   *
   * @param {number} rulingId - The ruling ID.
   * @returns {Promise<object>} Delete result.
   */
  async deleteRuling(rulingId) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Deleting rulings requires GM permissions');
    }

    return this._sendRequest('delete-ruling', {
      rulingId
    });
  }

  /**
   * Get the house rules document as markdown.
   * For use with the Foundry Journal interface.
   *
   * @returns {Promise<object>} Object with markdown content.
   */
  async getHouseRulesDocument() {
    this._requireAuth();

    return this._sendRequest('get-house-rules-document', {});
  }

  /**
   * Update the house rules document from markdown.
   * For use with the Foundry Journal interface.
   *
   * @param {string} markdown - The markdown content.
   * @returns {Promise<object>} Update result.
   */
  async updateHouseRulesDocument(markdown) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Updating house rules requires GM permissions');
    }

    return this._sendRequest('update-house-rules-document', {
      markdown
    });
  }

  /**
   * Get house rules statistics for the current world.
   *
   * @returns {Promise<object>} Statistics object.
   */
  async getHouseRulesStats() {
    this._requireAuth();

    return this._sendRequest('get-house-rules-stats', {});
  }

  // ===== GM Prep Methods =====

  /**
   * Generate a GM Prep script for an adventure PDF.
   * GM-only operation that sends PDF to Claude for script generation.
   *
   * @param {number} pdfId - The PDF document ID.
   * @param {string} adventureName - Display name for the adventure.
   * @param {boolean} overwrite - If true, overwrite existing script.
   * @param {Function} onProgress - Progress callback: (stage, progress, message) => void.
   * @returns {Promise<object>} Generation result with script content.
   */
  async generateGMPrep(pdfId, adventureName, overwrite = false, onProgress = null) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('GM Prep generation requires GM permissions');
    }

    const requestId = `req_${++this.requestIdCounter}`;

    // Store progress callback if provided
    if (onProgress) {
      this.progressCallbacks.set(requestId, onProgress);
    }

    return new Promise((resolve, reject) => {
      // Set up timeout (3 minutes for script generation)
      const timeout = 180000;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.progressCallbacks.delete(requestId);
        reject(new Error('GM Prep generation timeout'));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          reject(error);
        }
      });

      // Send request
      this.ws.send(JSON.stringify({
        type: 'generate-gm-prep',
        requestId,
        pdfId,
        adventureName,
        overwrite
      }));
    });
  }

  /**
   * Get a GM Prep script by PDF ID or script ID.
   *
   * @param {object} params - Query parameters.
   * @param {number} params.pdfId - The PDF document ID.
   * @param {number} params.scriptId - The script ID.
   * @returns {Promise<object>} Object with script record or null.
   */
  async getGMPrep({ pdfId, scriptId } = {}) {
    this._requireAuth();

    return this._sendRequest('get-gm-prep', { pdfId, scriptId });
  }

  /**
   * Get GM Prep status for a PDF (without full content).
   *
   * @param {number} pdfId - The PDF document ID.
   * @returns {Promise<object>} Status object with hasScript, status, scriptId.
   */
  async getGMPrepStatus(pdfId) {
    this._requireAuth();

    return this._sendRequest('get-gm-prep-status', { pdfId });
  }

  /**
   * Delete a GM Prep script.
   *
   * @param {number} scriptId - The script ID.
   * @returns {Promise<object>} Delete result.
   */
  async deleteGMPrep(scriptId) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Deleting GM Prep requires GM permissions');
    }

    return this._sendRequest('delete-gm-prep', { scriptId });
  }

  /**
   * Update the journal UUID for a GM Prep script.
   * Called after creating/updating the Foundry journal entry.
   *
   * @param {number} scriptId - The script ID.
   * @param {string} journalUuid - The Foundry journal UUID.
   * @returns {Promise<object>} Update result.
   */
  async updateGMPrepJournal(scriptId, journalUuid) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Updating GM Prep journal requires GM permissions');
    }

    return this._sendRequest('update-gm-prep-journal', { scriptId, journalUuid });
  }

  // ===== Active Adventure Methods =====

  /**
   * Get the current active adventure for this world.
   *
   * @returns {Promise<object>} Object with activeAdventure or null.
   */
  async getActiveAdventure() {
    this._requireAuth();
    return this._sendRequest('get-active-adventure', {});
  }

  /**
   * Set the active adventure.
   * GM only. Optionally includes transition handling.
   *
   * @param {string} adventureType - 'pdf' or 'module'.
   * @param {number|string} adventureId - PDF ID or module ID.
   * @param {object} options - Optional transition options.
   * @param {string} options.transitionType - 'immediate' or 'narrative'.
   * @param {string} options.transitionPrompt - GM instructions for narrative bridge.
   * @returns {Promise<object>} Result with new active adventure.
   */
  async setActiveAdventure(adventureType, adventureId, options = {}) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Setting active adventure requires GM permissions');
    }
    return this._sendRequest('set-active-adventure', {
      adventureType,
      adventureId,
      ...options
    });
  }

  /**
   * Clear the active adventure (no adventure selected).
   *
   * @returns {Promise<object>} Result.
   */
  async clearActiveAdventure() {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Clearing active adventure requires GM permissions');
    }
    return this._sendRequest('clear-active-adventure', {});
  }

  /**
   * List all available adventures (PDFs + registered modules).
   *
   * @returns {Promise<object>} Object with pdfAdventures and moduleAdventures arrays.
   */
  async listAvailableAdventures() {
    this._requireAuth();
    return this._sendRequest('list-available-adventures', {});
  }

  /**
   * Register a Foundry module as an adventure source.
   * GM only.
   *
   * @param {string} moduleId - The Foundry module ID.
   * @param {string} moduleName - Display name.
   * @param {string} description - Optional description.
   * @returns {Promise<object>} Result with created record.
   */
  async registerAdventureModule(moduleId, moduleName, description = null) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Registering adventure modules requires GM permissions');
    }
    return this._sendRequest('register-adventure-module', {
      moduleId,
      moduleName,
      description
    });
  }

  /**
   * Unregister a Foundry module from adventure sources.
   *
   * @param {string} moduleId - The Foundry module ID.
   * @returns {Promise<object>} Result.
   */
  async unregisterAdventureModule(moduleId) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Unregistering adventure modules requires GM permissions');
    }
    return this._sendRequest('unregister-adventure-module', { moduleId });
  }

  /**
   * Get current transition state.
   *
   * @returns {Promise<object>} Transition state info.
   */
  async getTransitionState() {
    this._requireAuth();
    return this._sendRequest('get-transition-state', {});
  }

  /**
   * Mark an adventure transition as complete.
   * GM only.
   *
   * @returns {Promise<object>} Result.
   */
  async completeTransition() {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Completing transition requires GM permissions');
    }
    return this._sendRequest('complete-transition', {});
  }

  // ===== Usage Monitoring Methods =====

  /**
   * Get API usage statistics for the current world.
   * Returns both all-time totals and session (trip meter) totals.
   *
   * @returns {Promise<object>} Usage statistics with allTime, session, and byType properties.
   */
  async getUsageStats() {
    this._requireAuth();
    return this._sendRequest('get-usage-stats', {});
  }

  /**
   * Reset the session marker for trip meter functionality.
   * GM only. Starts a new session for tracking usage.
   *
   * @returns {Promise<object>} Result with new session start time.
   */
  async resetSession() {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Resetting session requires GM permissions');
    }
    return this._sendRequest('reset-session', {});
  }

  // ===== Conversation Compaction Methods =====

  /**
   * Compact a conversation and generate an AI summary.
   * GM only. Archives the conversation and creates a summary for future reference.
   *
   * @param {string} conversationId - The conversation ID to compact.
   * @returns {Promise<object>} Result with summary, token count, and validation.
   */
  async compactConversation(conversationId) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Compacting conversations requires GM permissions');
    }
    return this._sendRequest('compact-conversation', { conversationId }, 120000);
  }

  /**
   * Create a new conversation that inherits context from a compacted conversation.
   * The new conversation will include the previous summary as context.
   *
   * @param {string} previousConversationId - The compacted conversation to inherit from.
   * @param {string} title - Optional title for the new conversation.
   * @returns {Promise<object>} Result with new conversation and previous conversation info.
   */
  async createConversationFromSummary(previousConversationId, title = null) {
    this._requireAuth();
    return this._sendRequest('create-conversation-from-summary', {
      previousConversationId,
      title
    });
  }

  /**
   * Get the summary and status of a conversation.
   *
   * @param {string} conversationId - The conversation ID.
   * @returns {Promise<object>} Conversation summary info including status, summary text, and parent.
   */
  async getConversationSummary(conversationId) {
    this._requireAuth();
    return this._sendRequest('get-conversation-summary', { conversationId });
  }

  // ===== Character Assignment Methods =====

  /**
   * Get all character assignments for a GM Prep script.
   *
   * @param {number} scriptId - The GM Prep script ID.
   * @returns {Promise<object>} Object with characters array.
   */
  async getCharacters(scriptId) {
    this._requireAuth();
    return this._sendRequest('get-characters', { scriptId });
  }

  /**
   * Update a single character's assignment.
   * GM only.
   *
   * @param {number} scriptId - The GM Prep script ID.
   * @param {string} characterName - The character name.
   * @param {object} assignment - Assignment updates.
   * @param {string} assignment.assignedToUserId - User ID to assign.
   * @param {string} assignment.assignedToUserName - User display name.
   * @param {boolean} assignment.isGMControlled - Whether GM controls character.
   * @param {boolean} assignment.isLoremasterControlled - Whether AI controls character.
   * @param {string} assignment.notes - GM notes about character.
   * @returns {Promise<object>} Update result.
   */
  async updateCharacterAssignment(scriptId, characterName, assignment) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Updating character assignments requires GM permissions');
    }
    return this._sendRequest('update-character-assignment', {
      scriptId,
      characterName,
      assignment
    });
  }

  /**
   * Bulk update multiple character assignments.
   * GM only.
   *
   * @param {number} scriptId - The GM Prep script ID.
   * @param {Array} characters - Array of character objects with updates.
   * @returns {Promise<object>} Result with updated and created counts.
   */
  async bulkUpdateCharacters(scriptId, characters) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Bulk updating characters requires GM permissions');
    }
    return this._sendRequest('bulk-update-characters', {
      scriptId,
      characters
    });
  }

  /**
   * Extract characters from a GM Prep script.
   * GM only. Parses the script content and saves characters to database.
   *
   * @param {number} scriptId - The GM Prep script ID.
   * @returns {Promise<object>} Result with extracted characters array.
   */
  async extractCharactersFromScript(scriptId) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Extracting characters requires GM permissions');
    }
    return this._sendRequest('extract-characters-from-script', { scriptId });
  }

  // ===== Journal Sync Methods =====

  /**
   * Sync GM Prep script content back to the server.
   * GM only. Called after journal edits to update server and re-upload to Claude.
   *
   * @param {number} scriptId - The GM Prep script ID.
   * @param {string} content - The updated script content (markdown).
   * @returns {Promise<object>} Sync result with new Claude file ID.
   */
  async syncGMPrepScript(scriptId, content) {
    this._requireAuth();
    if (!this.isGM) {
      throw new Error('Syncing GM Prep scripts requires GM permissions');
    }
    return this._sendRequest('sync-gm-prep-script', {
      scriptId,
      content
    });
  }

  // ===== Foundry Module Import Methods =====

  /**
   * Discover available Foundry modules that can be imported for RAG.
   * Returns modules with their import status.
   *
   * @returns {Promise<object>} Object with available, enabled, and modules arrays.
   */
  async discoverFoundryModules() {
    this._requireAuth();
    return this._sendRequest('discover-foundry-modules', {});
  }

  /**
   * Get the import status of all Foundry modules.
   *
   * @returns {Promise<object>} Object with modules array and their import status.
   */
  async getModuleImportStatus() {
    this._requireAuth();
    return this._sendRequest('get-module-import-status', {});
  }

  /**
   * Import a Foundry module's content for RAG retrieval.
   * GM only. Chunks content and generates embeddings.
   *
   * @param {string} moduleId - The Foundry module ID to import.
   * @param {Function} onProgress - Progress callback: (stage, progress, message) => void.
   * @returns {Promise<object>} Import result with chunk count and token count.
   */
  async importFoundryModule(moduleId, onProgress = null) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Importing modules requires GM permissions');
    }

    const requestId = `req_${++this.requestIdCounter}`;

    // Store progress callback if provided
    if (onProgress) {
      this.progressCallbacks.set(requestId, onProgress);
    }

    return new Promise((resolve, reject) => {
      // Set up timeout (5 minutes for module import)
      const timeout = 300000;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.progressCallbacks.delete(requestId);
        reject(new Error('Module import timeout'));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          reject(error);
        }
      });

      // Send request
      this.ws.send(JSON.stringify({
        type: 'import-foundry-module',
        requestId,
        moduleId
      }));
    });
  }

  /**
   * Delete imported content for a Foundry module.
   * GM only. Removes chunks and embeddings.
   *
   * @param {string} moduleId - The Foundry module ID.
   * @returns {Promise<object>} Delete result.
   */
  async deleteModuleContent(moduleId) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Deleting module content requires GM permissions');
    }

    return this._sendRequest('delete-module-content', { moduleId });
  }

  // ===== Embedding Methods =====

  /**
   * Generate embeddings for existing content.
   * Rechunks PDFs that don't have chunks and generates embeddings via Voyage API.
   * GM only operation.
   *
   * @param {Function} onProgress - Progress callback: (stage, progress, message) => void.
   * @returns {Promise<object>} Result with processing stats.
   */
  async generateEmbeddings(onProgress = null) {
    this._requireAuth();

    if (!this.isGM) {
      throw new Error('Generating embeddings requires GM permissions');
    }

    const requestId = `req_${++this.requestIdCounter}`;

    // Store progress callback if provided
    if (onProgress) {
      this.progressCallbacks.set(requestId, onProgress);
    }

    return new Promise((resolve, reject) => {
      // Set up timeout (5 minutes for embedding generation)
      const timeout = 300000;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.progressCallbacks.delete(requestId);
        reject(new Error('Embedding generation timeout'));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          this.progressCallbacks.delete(requestId);
          reject(error);
        }
      });

      // Send request
      this.ws.send(JSON.stringify({
        type: 'generate-embeddings',
        requestId
      }));
    });
  }

  /**
   * Register a tool handler for execution requests from the proxy.
   *
   * @param {string} toolName - The tool name.
   * @param {Function} handler - The handler function.
   */
  registerToolHandler(toolName, handler) {
    this.toolHandlers.set(toolName, handler);
  }

  /**
   * Disconnect from the proxy server.
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isAuthenticated = false;
  }

  /**
   * Send a request to the proxy server.
   *
   * @param {string} type - Message type.
   * @param {object} payload - Request payload.
   * @param {number} timeout - Request timeout in ms.
   * @returns {Promise<object>} Response data.
   * @private
   */
  _sendRequest(type, payload, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestIdCounter}`;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${type}`));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          reject(error);
        }
      });

      // Send request
      this.ws.send(JSON.stringify({
        type,
        requestId,
        ...payload
      }));
    });
  }

  /**
   * Handle incoming WebSocket message.
   *
   * @param {string} data - Raw message data.
   * @private
   */
  _handleMessage(data) {
    try {
      const message = JSON.parse(data);

      // Handle license-related errors specially
      if (message.type === 'error' && message.error?.toLowerCase().includes('license')) {
        console.error(`${MODULE_ID} | License error: ${message.error}`);
        ui.notifications.error(`Loremaster: ${message.error}`, { permanent: true });

        // Prompt GM to configure license
        if (game.user.isGM) {
          new Dialog({
            title: 'Loremaster License Required',
            content: `<p>${message.error}</p><p>Please configure a valid license key in Module Settings.</p>`,
            buttons: {
              settings: {
                label: 'Open Settings',
                callback: () => game.settings.sheet.render(true)
              },
              close: { label: 'Close' }
            }
          }).render(true);
        }
        return;
      }

      // Handle tool execution requests from proxy
      if (message.type === 'tool-execute') {
        this._handleToolExecute(message);
        return;
      }

      // Handle PDF upload progress updates
      if (message.type === 'pdf-upload-progress') {
        this._handlePDFProgress(message);
        return;
      }

      // Handle GM Prep progress updates
      if (message.type === 'gm-prep-progress') {
        this._handleGMPrepProgress(message);
        return;
      }

      // Handle embedding progress updates
      if (message.type === 'embedding-progress') {
        this._handleEmbeddingProgress(message);
        return;
      }

      // Handle module import progress updates
      if (message.type === 'module-import-progress') {
        this._handleModuleImportProgress(message);
        return;
      }

      // Handle response to pending request
      const { requestId, success, data: responseData, error } = message;

      if (requestId && this.pendingRequests.has(requestId)) {
        const pending = this.pendingRequests.get(requestId);

        if (success) {
          pending.resolve(responseData);
        } else {
          pending.reject(new Error(error || 'Unknown error'));
        }
      }

    } catch (error) {
      console.error(`${MODULE_ID} | Error parsing message:`, error);
    }
  }

  /**
   * Handle PDF upload progress message.
   *
   * @param {object} message - Progress message with requestId, stage, progress, message.
   * @private
   */
  _handlePDFProgress(message) {
    const { requestId, stage, progress, message: progressMessage } = message;

    const callback = this.progressCallbacks.get(requestId);
    if (callback) {
      try {
        callback(stage, progress, progressMessage);
      } catch (error) {
        console.error(`${MODULE_ID} | Error in progress callback:`, error);
      }
    }
  }

  /**
   * Handle GM Prep progress message.
   *
   * @param {object} message - Progress message with requestId, stage, progress, message.
   * @private
   */
  _handleGMPrepProgress(message) {
    const { requestId, stage, progress, message: progressMessage } = message;

    // Find the most recent pending generateGMPrep request callback
    // Progress messages may not have requestId, so check all callbacks
    for (const [reqId, callback] of this.progressCallbacks) {
      if (reqId.startsWith('req_')) {
        try {
          callback(stage, progress, progressMessage);
        } catch (error) {
          console.error(`${MODULE_ID} | Error in GM Prep progress callback:`, error);
        }
        break; // Only call the most recent one
      }
    }
  }

  /**
   * Handle embedding progress message.
   *
   * @param {object} message - Progress message with requestId, stage, progress, message.
   * @private
   */
  _handleEmbeddingProgress(message) {
    const { requestId, stage, progress, message: progressMessage } = message;

    // Use requestId if available, otherwise find the most recent callback
    if (requestId && this.progressCallbacks.has(requestId)) {
      const callback = this.progressCallbacks.get(requestId);
      try {
        callback(stage, progress, progressMessage);
      } catch (error) {
        console.error(`${MODULE_ID} | Error in embedding progress callback:`, error);
      }
    } else {
      // Fallback: find any pending callback
      for (const [reqId, callback] of this.progressCallbacks) {
        if (reqId.startsWith('req_')) {
          try {
            callback(stage, progress, progressMessage);
          } catch (error) {
            console.error(`${MODULE_ID} | Error in embedding progress callback:`, error);
          }
          break;
        }
      }
    }
  }

  /**
   * Handle module import progress message.
   *
   * @param {object} message - Progress message with requestId, stage, progress, message.
   * @private
   */
  _handleModuleImportProgress(message) {
    const { requestId, stage, progress, message: progressMessage } = message;

    // Use requestId if available
    if (requestId && this.progressCallbacks.has(requestId)) {
      const callback = this.progressCallbacks.get(requestId);
      try {
        callback(stage, progress, progressMessage);
      } catch (error) {
        console.error(`${MODULE_ID} | Error in module import progress callback:`, error);
      }
    } else {
      // Fallback: find any pending callback
      for (const [reqId, callback] of this.progressCallbacks) {
        if (reqId.startsWith('req_')) {
          try {
            callback(stage, progress, progressMessage);
          } catch (error) {
            console.error(`${MODULE_ID} | Error in module import progress callback:`, error);
          }
          break;
        }
      }
    }
  }

  /**
   * Handle tool execution request from proxy.
   *
   * @param {object} message - Tool execution message.
   * @private
   */
  async _handleToolExecute(message) {
    const { toolCallId, toolName, toolInput } = message;

    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      // Send error response
      this.ws.send(JSON.stringify({
        type: 'tool-result',
        toolCallId,
        error: `Unknown tool: ${toolName}`
      }));
      return;
    }

    try {
      const result = await handler(toolInput);
      this.ws.send(JSON.stringify({
        type: 'tool-result',
        toolCallId,
        result
      }));
    } catch (error) {
      this.ws.send(JSON.stringify({
        type: 'tool-result',
        toolCallId,
        error: error.message
      }));
    }
  }

  /**
   * Handle disconnection and attempt reconnect.
   *
   * @private
   */
  _handleDisconnect() {
    // Reject all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection lost'));
    }
    this.pendingRequests.clear();

    // Attempt reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(`${MODULE_ID} | Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      setTimeout(async () => {
        try {
          await this.connect();
          await this.authenticate();
          ui.notifications.info('Loremaster reconnected to server');
        } catch (error) {
          console.error(`${MODULE_ID} | Reconnect failed:`, error);
        }
      }, delay);
    } else {
      ui.notifications.error('Loremaster lost connection to server');
    }
  }

  /**
   * Require authentication before sending requests.
   *
   * @throws {Error} If not authenticated.
   * @private
   */
  _requireAuth() {
    if (!this.isConnected) {
      throw new Error('Not connected to proxy server');
    }
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated with proxy server');
    }
  }
}
