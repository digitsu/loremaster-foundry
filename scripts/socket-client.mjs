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
    const worldId = game.world.id;
    const worldName = game.world.title;

    // Include user info for access control
    const userId = game.user.id;
    const userName = game.user.name;
    const isGM = game.user.isGM;

    // Only send API key if it's been set (non-empty)
    const payload = {
      worldId,
      worldName,
      userId,
      userName,
      isGM
    };

    if (apiKey) {
      payload.apiKey = apiKey;
    }

    const result = await this._sendRequest('auth', payload);
    this.isAuthenticated = result.success;
    this.isGM = result.isGM || false;

    if (result.success) {
      console.log(`${MODULE_ID} | Authenticated with proxy server (GM: ${this.isGM})`);
    }

    return result;
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
