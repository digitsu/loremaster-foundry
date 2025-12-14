/**
 * WebSocket Handler
 *
 * Manages WebSocket connections from Foundry VTT clients.
 * Handles authentication, chat messages, data sync, and tool execution.
 * Supports multi-player message batching and GM veto capabilities.
 */

import { v4 as uuidv4 } from 'uuid';
import { BatchProcessor } from '../services/batch-processor.js';
import { getMultiplayerSystemPrompt, getVetoCorrectionPrompt } from '../prompts/multiplayer-system.js';
import { getToolDefinitions } from '../tools/tool-definitions.js';

export class SocketHandler {
  /**
   * Create a new SocketHandler instance.
   *
   * @param {WebSocketServer} wss - The WebSocket server instance.
   * @param {ClaudeClient} claudeClient - The Claude API client.
   * @param {ConversationStore} conversationStore - The conversation storage.
   * @param {CredentialsStore} credentialsStore - The encrypted credentials storage.
   * @param {FilesManager} filesManager - The Claude Files API manager.
   * @param {PDFProcessor} pdfProcessor - The PDF processor for adventure uploads.
   */
  constructor(wss, claudeClient, conversationStore, credentialsStore, filesManager = null, pdfProcessor = null) {
    this.wss = wss;
    this.claudeClient = claudeClient;
    this.conversationStore = conversationStore;
    this.credentialsStore = credentialsStore;
    this.filesManager = filesManager;
    this.pdfProcessor = pdfProcessor;

    // Map of worldId -> client connection info
    this.clients = new Map();

    // Pending tool execution callbacks
    this.pendingToolCalls = new Map();

    // Batch processor for multi-player message handling
    this.batchProcessor = new BatchProcessor(conversationStore);

    // Tool executor (set after construction to avoid circular dependency)
    this.toolExecutor = null;

    this.setupHandlers();
    console.log('[SocketHandler] WebSocket handler initialized');
  }

  /**
   * Set the tool executor instance.
   * Called after construction to avoid circular dependency.
   *
   * @param {ToolExecutor} toolExecutor - The tool executor instance.
   */
  setToolExecutor(toolExecutor) {
    this.toolExecutor = toolExecutor;
    console.log('[SocketHandler] Tool executor configured');
  }

  /**
   * Set up WebSocket event handlers.
   */
  setupHandlers() {
    this.wss.on('connection', (ws, req) => {
      const connectionId = uuidv4();
      console.log(`[SocketHandler] New connection: ${connectionId}`);

      ws.connectionId = connectionId;
      ws.isAuthenticated = false;
      ws.worldId = null;

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('[SocketHandler] Error handling message:', error);
          this.sendError(ws, null, error.message);
        }
      });

      ws.on('close', () => {
        console.log(`[SocketHandler] Connection closed: ${connectionId}`);
        if (ws.worldId) {
          this.clients.delete(ws.worldId);
        }
      });

      ws.on('error', (error) => {
        console.error(`[SocketHandler] WebSocket error: ${error.message}`);
      });
    });
  }

  /**
   * Handle incoming WebSocket message.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} message - The parsed message object.
   */
  async handleMessage(ws, message) {
    const { type, requestId, ...payload } = message;

    console.log(`[SocketHandler] Received message type: ${type}`);

    try {
      let result;

      switch (type) {
        case 'auth':
          result = await this.handleAuth(ws, payload);
          break;

        case 'chat':
          result = await this.handleChat(ws, payload);
          break;

        case 'chat-batch':
          result = await this.handleChatBatch(ws, payload);
          break;

        case 'veto':
          result = await this.handleVeto(ws, payload);
          break;

        case 'sync':
          result = await this.handleSync(ws, payload);
          break;

        case 'list-files':
          result = await this.handleListFiles(ws);
          break;

        case 'delete-file':
          result = await this.handleDeleteFile(ws, payload);
          break;

        case 'pdf-upload':
          result = await this.handlePDFUpload(ws, payload);
          break;

        case 'list-pdfs':
          result = await this.handleListPDFs(ws);
          break;

        case 'delete-pdf':
          result = await this.handleDeletePDF(ws, payload);
          break;

        case 'history':
          result = await this.handleHistory(ws, payload);
          break;

        case 'tool-result':
          result = await this.handleToolResult(ws, payload);
          break;

        case 'new-conversation':
          result = await this.handleNewConversation(ws, payload);
          break;

        case 'list-conversations':
          result = await this.handleListConversations(ws);
          break;

        case 'get-conversation':
          result = await this.handleGetConversation(ws, payload);
          break;

        case 'delete-conversation':
          result = await this.handleDeleteConversation(ws, payload);
          break;

        case 'rename-conversation':
          result = await this.handleRenameConversation(ws, payload);
          break;

        case 'clear-conversation':
          result = await this.handleClearConversation(ws, payload);
          break;

        case 'switch-conversation':
          result = await this.handleSwitchConversation(ws, payload);
          break;

        case 'publish-to-canon':
          result = await this.handlePublishToCanon(ws, payload);
          break;

        case 'list-canon':
          result = await this.handleListCanon(ws, payload);
          break;

        case 'update-canon':
          result = await this.handleUpdateCanon(ws, payload);
          break;

        case 'delete-canon':
          result = await this.handleDeleteCanon(ws, payload);
          break;

        default:
          throw new Error(`Unknown message type: ${type}`);
      }

      this.sendResponse(ws, type, requestId, result);

    } catch (error) {
      console.error(`[SocketHandler] Error handling ${type}:`, error);
      this.sendError(ws, requestId, error.message);
    }
  }

  /**
   * Handle authentication from Foundry client.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The auth payload.
   * @returns {Object} Auth result.
   */
  async handleAuth(ws, { apiKey, worldId, worldName, userId, userName, isGM }) {
    if (!worldId) {
      throw new Error('World ID is required');
    }

    // If API key provided, store it (encrypted)
    if (apiKey) {
      const stored = this.credentialsStore.storeApiKey(worldId, apiKey);
      if (!stored) {
        throw new Error('Failed to store API key');
      }
    } else {
      // If no API key provided, check if one exists
      if (!this.credentialsStore.hasApiKey(worldId)) {
        throw new Error('API key required for first connection');
      }
    }

    // Mark connection as authenticated
    ws.isAuthenticated = true;
    ws.worldId = worldId;
    ws.worldName = worldName;
    ws.userId = userId || null;
    ws.userName = userName || 'Unknown';
    ws.isGM = isGM === true;

    // Store client reference
    this.clients.set(worldId, {
      ws,
      worldName,
      userId,
      userName,
      isGM,
      connectedAt: new Date()
    });

    console.log(`[SocketHandler] Authenticated world: ${worldId} (${worldName}) - User: ${userName} (GM: ${isGM})`);

    return {
      success: true,
      worldId,
      isGM: ws.isGM,
      message: 'Authentication successful'
    };
  }

  /**
   * Handle chat message from Foundry client.
   * Supports private GM chat mode where responses go only to GM until published.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The chat payload.
   * @returns {Object} Chat result with AI response.
   */
  async handleChat(ws, { message, context, isPrivate = false }) {
    this.requireAuth(ws);

    // Private chat requires GM permission
    if (isPrivate && !ws.isGM) {
      throw new Error('Private chat mode requires GM permissions');
    }

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world. Please re-authenticate with your API key.');
    }

    // Get or create conversation
    const conversation = this.conversationStore.getOrCreateConversation(worldId, {
      title: context?.sceneName || 'Session'
    });

    // Get conversation history
    const history = this.conversationStore.getMessagesForContext(conversation.id);

    // Get canon history for this world
    const canonHistory = this.conversationStore.getCanonForContext(worldId, 15000);

    // Store user message (mark as private if applicable)
    const messageRecord = this.conversationStore.addMessage(
      conversation.id,
      'user',
      message,
      { ...context, isPrivate }
    );

    // Build context with world name, user info, and canon
    const fullContext = {
      ...context,
      worldName: ws.worldName,
      speaker: {
        userId: ws.userId,
        userName: ws.userName,
        isGM: ws.isGM
      },
      isPrivate
    };

    // Add canon context if available
    if (canonHistory.messages.length > 0) {
      fullContext.canonHistory = canonHistory.messages;
    }

    // Get file IDs for this world (synced context files + PDFs)
    const fileIds = this._getAllFileIdsForWorld(worldId);

    // Get tool definitions
    const tools = getToolDefinitions();

    // Build additional system prompt for private mode
    let additionalSystemPrompt = '';
    if (isPrivate) {
      additionalSystemPrompt = `
## Private GM Mode
This message is from the GM in private mode. Your response will only be seen by the GM initially.
The GM may iterate on this response with you before publishing it to players.
Feel free to include GM-facing notes like "[GM Note: ...]" if helpful.
`;
    }

    // Add canon context to system prompt if available
    if (canonHistory.messages.length > 0) {
      additionalSystemPrompt += `
## Campaign Canon (Official History)
The following events have been published as official canon for this campaign. These are established facts:

${canonHistory.messages.join('\n\n---\n\n')}

---
Build upon this established history in your responses.
`;
    }

    // Send to Claude with tools
    const response = await this.claudeClient.sendMessage(
      apiKey,
      message,
      fullContext,
      history,
      fileIds,
      tools,
      additionalSystemPrompt ? { additionalSystemPrompt } : undefined
    );

    // Process tool calls if any
    let textContent;
    if (response.stop_reason === 'tool_use' && this.toolExecutor) {
      // Create executor function for this world
      const executor = this.toolExecutor.createExecutorForWorld(worldId);

      // Process tool calls and get final response
      textContent = await this.claudeClient.processToolCalls(
        apiKey,
        response,
        executor,
        fullContext,
        history,
        tools
      );
    } else {
      // Extract text response directly
      textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }

    // Store assistant response (mark as private if applicable)
    const responseRecord = this.conversationStore.addMessage(
      conversation.id,
      'assistant',
      textContent,
      { isPrivate }
    );

    return {
      response: textContent,
      conversationId: conversation.id,
      messageId: responseRecord.id,
      isPrivate,
      canPublish: isPrivate && ws.isGM,
      usage: response.usage
    };
  }

  /**
   * Handle batched chat messages from multiple players.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The batch payload.
   * @returns {Object} Chat result with AI response.
   */
  async handleChatBatch(ws, { batchId, messages, gmRulings, formattedPrompt, context }) {
    this.requireAuth(ws);

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world. Please re-authenticate with your API key.');
    }

    console.log(`[SocketHandler] Processing batch ${batchId} with ${messages.length} messages`);

    // Process the batch
    const processedBatch = await this.batchProcessor.processBatch(
      worldId,
      { batchId, messages, gmRulings, formattedPrompt },
      context
    );

    // Get conversation history
    const history = this.conversationStore.getMessagesForContext(processedBatch.conversationId);

    // Build context with world name and user info
    const fullContext = {
      ...context,
      worldName: ws.worldName,
      speaker: {
        userId: ws.userId,
        userName: ws.userName,
        isGM: ws.isGM
      }
    };

    // Get file IDs for this world (synced context files + PDFs)
    const fileIds = this._getAllFileIdsForWorld(worldId);

    // Get tool definitions
    const tools = getToolDefinitions();

    // Get multiplayer system prompt additions
    const multiplayerPrompt = getMultiplayerSystemPrompt();

    // Send to Claude with multiplayer prompt and tools
    const response = await this.claudeClient.sendMessage(
      apiKey,
      processedBatch.userMessage,
      fullContext,
      history,
      fileIds,
      tools,
      { additionalSystemPrompt: multiplayerPrompt }
    );

    // Process tool calls if any
    let textContent;
    if (response.stop_reason === 'tool_use' && this.toolExecutor) {
      // Create executor function for this world
      const executor = this.toolExecutor.createExecutorForWorld(worldId);

      // Process tool calls and get final response
      textContent = await this.claudeClient.processToolCalls(
        apiKey,
        response,
        executor,
        fullContext,
        history,
        tools
      );
    } else {
      // Extract text response directly
      textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }

    // Store assistant response
    const responseMessage = this.conversationStore.addMessage(
      processedBatch.conversationId,
      'assistant',
      textContent
    );

    // Mark batch as completed
    this.batchProcessor.completeBatch(processedBatch.batchId, responseMessage.id);

    return {
      response: textContent,
      conversationId: processedBatch.conversationId,
      batchId: processedBatch.batchId,
      usage: response.usage
    };
  }

  /**
   * Handle veto request to regenerate an AI response with correction.
   * GM-only: Only the GM can veto and correct AI responses.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The veto payload.
   * @returns {Object} Chat result with new AI response.
   */
  async handleVeto(ws, { batchId, correction, originalBatch, context }) {
    this.requireGM(ws);

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world. Please re-authenticate with your API key.');
    }

    console.log(`[SocketHandler] Processing veto for batch ${batchId}`);

    // Process the veto
    const processedVeto = await this.batchProcessor.processVeto(
      worldId,
      { batchId, correction, originalBatch },
      context
    );

    // Get conversation history
    const history = this.conversationStore.getMessagesForContext(processedVeto.conversationId);

    // Build context with world name and user info
    const fullContext = {
      ...context,
      worldName: ws.worldName,
      speaker: {
        userId: ws.userId,
        userName: ws.userName,
        isGM: ws.isGM
      }
    };

    // Get file IDs for this world (synced context files + PDFs)
    const fileIds = this._getAllFileIdsForWorld(worldId);

    // Get tool definitions
    const tools = getToolDefinitions();

    // Get multiplayer system prompt with veto correction
    const multiplayerPrompt = getMultiplayerSystemPrompt();
    const vetoCorrectionPrompt = getVetoCorrectionPrompt(correction);
    const combinedPrompt = multiplayerPrompt + '\n\n' + vetoCorrectionPrompt;

    // Send to Claude with correction prompt and tools
    const response = await this.claudeClient.sendMessage(
      apiKey,
      processedVeto.vetoMessage,
      fullContext,
      history,
      fileIds,
      tools,
      { additionalSystemPrompt: combinedPrompt }
    );

    // Process tool calls if any
    let textContent;
    if (response.stop_reason === 'tool_use' && this.toolExecutor) {
      // Create executor function for this world
      const executor = this.toolExecutor.createExecutorForWorld(worldId);

      // Process tool calls and get final response
      textContent = await this.claudeClient.processToolCalls(
        apiKey,
        response,
        executor,
        fullContext,
        history,
        tools
      );
    } else {
      // Extract text response directly
      textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
    }

    // Store assistant response
    this.conversationStore.addMessage(
      processedVeto.conversationId,
      'assistant',
      textContent
    );

    return {
      response: textContent,
      conversationId: processedVeto.conversationId,
      originalBatchId: batchId,
      usage: response.usage
    };
  }

  /**
   * Handle data sync request.
   * Uploads game data to Claude Files API for persistent context.
   * GM-only: Only the GM can modify world state files.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The sync payload.
   * @returns {Object} Sync result.
   */
  async handleSync(ws, { worldData, dataType }) {
    this.requireGM(ws);

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world');
    }

    if (!this.filesManager) {
      throw new Error('Files API not configured');
    }

    console.log(`[SocketHandler] Sync request for ${dataType} from world ${ws.worldId}`);

    try {
      // Determine filename and content based on data type
      let filename, content, mimeType;

      switch (dataType) {
        case 'rules':
          filename = `${worldId}-rules.md`;
          content = typeof worldData === 'string' ? worldData : JSON.stringify(worldData, null, 2);
          mimeType = 'text/markdown';
          break;

        case 'compendium':
          filename = `${worldId}-compendium.json`;
          content = typeof worldData === 'string' ? worldData : JSON.stringify(worldData, null, 2);
          mimeType = 'application/json';
          break;

        case 'world_state':
          filename = `${worldId}-world-state.json`;
          content = typeof worldData === 'string' ? worldData : JSON.stringify(worldData, null, 2);
          mimeType = 'application/json';
          break;

        case 'actors':
          filename = `${worldId}-actors.json`;
          content = typeof worldData === 'string' ? worldData : JSON.stringify(worldData, null, 2);
          mimeType = 'application/json';
          break;

        default:
          filename = `${worldId}-${dataType}.json`;
          content = typeof worldData === 'string' ? worldData : JSON.stringify(worldData, null, 2);
          mimeType = 'application/json';
      }

      // Upload and register the file
      const result = await this.filesManager.uploadAndRegister(
        apiKey,
        worldId,
        dataType,
        filename,
        content,
        mimeType
      );

      console.log(`[SocketHandler] Sync complete for ${dataType}: ${result.fileId} (cached: ${result.cached})`);

      return {
        success: true,
        message: result.cached ? 'Using cached file (content unchanged)' : 'File uploaded successfully',
        dataType,
        fileId: result.fileId,
        cached: result.cached,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`[SocketHandler] Sync failed for ${dataType}:`, error.message);
      throw error;
    }
  }

  /**
   * Handle request to list synced files.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @returns {Object} List of synced files.
   */
  async handleListFiles(ws) {
    this.requireAuth(ws);

    if (!this.filesManager) {
      return { files: [] };
    }

    const files = this.filesManager.getFilesForWorld(ws.worldId);
    return { files };
  }

  /**
   * Handle request to delete a synced file.
   * GM-only: Only the GM can delete world state files.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The delete payload.
   * @returns {Object} Delete result.
   */
  async handleDeleteFile(ws, { fileId }) {
    this.requireGM(ws);

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world');
    }

    if (!this.filesManager) {
      throw new Error('Files API not configured');
    }

    await this.filesManager.deleteFile(apiKey, worldId, fileId);

    return {
      success: true,
      message: 'File deleted',
      fileId
    };
  }

  /**
   * Handle conversation history request.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The history payload.
   * @returns {Object} History result.
   */
  async handleHistory(ws, { conversationId, limit = 50 }) {
    this.requireAuth(ws);

    const worldId = ws.worldId;

    // If no conversation ID provided, get all conversations for world
    if (!conversationId) {
      const conversations = this.conversationStore.getConversations(worldId);
      return { conversations };
    }

    // Get messages for specific conversation
    const messages = this.conversationStore.getMessages(conversationId, limit);
    return { messages };
  }

  /**
   * Handle new conversation request.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The new conversation payload.
   * @returns {Object} New conversation result.
   */
  async handleNewConversation(ws, { title }) {
    this.requireAuth(ws);

    const conversation = this.conversationStore.createConversation(
      ws.worldId,
      title || 'New Session'
    );

    return { conversation };
  }

  /**
   * Handle list conversations request.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @returns {Object} List of conversations with stats.
   */
  async handleListConversations(ws) {
    this.requireAuth(ws);

    const conversations = this.conversationStore.getConversations(ws.worldId);

    // Add stats to each conversation
    const conversationsWithStats = conversations.map(conv => ({
      ...conv,
      stats: this.conversationStore.getConversationStats(conv.id)
    }));

    return { conversations: conversationsWithStats };
  }

  /**
   * Handle get conversation request.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The request payload.
   * @returns {Object} Conversation details with messages.
   */
  async handleGetConversation(ws, { conversationId, includeMessages = true, limit = 50 }) {
    this.requireAuth(ws);

    const conversation = this.conversationStore.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Verify world ownership
    if (conversation.world_id !== ws.worldId) {
      throw new Error('Conversation does not belong to this world');
    }

    const result = {
      conversation,
      stats: this.conversationStore.getConversationStats(conversationId)
    };

    if (includeMessages) {
      result.messages = this.conversationStore.getMessages(conversationId, limit);
    }

    return result;
  }

  /**
   * Handle delete conversation request.
   * GM-only: Only the GM can delete conversations.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The request payload.
   * @returns {Object} Delete result.
   */
  async handleDeleteConversation(ws, { conversationId }) {
    this.requireGM(ws);

    const conversation = this.conversationStore.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.world_id !== ws.worldId) {
      throw new Error('Conversation does not belong to this world');
    }

    this.conversationStore.deleteConversation(conversationId);

    return {
      success: true,
      message: 'Conversation deleted',
      conversationId
    };
  }

  /**
   * Handle rename conversation request.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The request payload.
   * @returns {Object} Rename result.
   */
  async handleRenameConversation(ws, { conversationId, title }) {
    this.requireAuth(ws);

    if (!title || title.trim().length === 0) {
      throw new Error('Title is required');
    }

    const conversation = this.conversationStore.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.world_id !== ws.worldId) {
      throw new Error('Conversation does not belong to this world');
    }

    this.conversationStore.updateConversationTitle(conversationId, title.trim());

    return {
      success: true,
      message: 'Conversation renamed',
      conversationId,
      title: title.trim()
    };
  }

  /**
   * Handle clear conversation request.
   * GM-only: Only the GM can clear conversation history.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The request payload.
   * @returns {Object} Clear result.
   */
  async handleClearConversation(ws, { conversationId }) {
    this.requireGM(ws);

    const conversation = this.conversationStore.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.world_id !== ws.worldId) {
      throw new Error('Conversation does not belong to this world');
    }

    this.conversationStore.clearConversation(conversationId);

    return {
      success: true,
      message: 'Conversation cleared',
      conversationId
    };
  }

  /**
   * Handle switch conversation request.
   * Sets the active conversation for subsequent chat messages.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The request payload.
   * @returns {Object} Switch result.
   */
  async handleSwitchConversation(ws, { conversationId }) {
    this.requireAuth(ws);

    const conversation = this.conversationStore.getConversation(conversationId);

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.world_id !== ws.worldId) {
      throw new Error('Conversation does not belong to this world');
    }

    // Store active conversation on the WebSocket
    ws.activeConversationId = conversationId;

    return {
      success: true,
      message: 'Switched conversation',
      conversation
    };
  }

  /**
   * Handle tool result from Foundry client.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The tool result payload.
   * @returns {Object} Acknowledgment.
   */
  async handleToolResult(ws, { toolCallId, result, error }) {
    this.requireAuth(ws);

    const pending = this.pendingToolCalls.get(toolCallId);
    if (pending) {
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
      this.pendingToolCalls.delete(toolCallId);
    }

    return { acknowledged: true };
  }

  /**
   * Request tool execution from Foundry client.
   *
   * @param {string} worldId - The world ID.
   * @param {string} toolName - The tool name.
   * @param {Object} toolInput - The tool input parameters.
   * @returns {Promise<Object>} The tool execution result.
   */
  async requestToolExecution(worldId, toolName, toolInput) {
    const client = this.clients.get(worldId);
    if (!client || !client.ws) {
      throw new Error('No client connected for this world');
    }

    const toolCallId = uuidv4();

    return new Promise((resolve, reject) => {
      // Store pending callback
      this.pendingToolCalls.set(toolCallId, { resolve, reject });

      // Set timeout
      setTimeout(() => {
        if (this.pendingToolCalls.has(toolCallId)) {
          this.pendingToolCalls.delete(toolCallId);
          reject(new Error('Tool execution timeout'));
        }
      }, 30000);

      // Send tool request to Foundry
      client.ws.send(JSON.stringify({
        type: 'tool-execute',
        toolCallId,
        toolName,
        toolInput
      }));
    });
  }

  /**
   * Require authentication for a request.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @throws {Error} If not authenticated.
   */
  requireAuth(ws) {
    if (!ws.isAuthenticated) {
      throw new Error('Not authenticated');
    }
  }

  /**
   * Require GM role for a request.
   * Must be called after requireAuth.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @throws {Error} If user is not a GM.
   */
  requireGM(ws) {
    this.requireAuth(ws);
    if (!ws.isGM) {
      throw new Error('This action requires GM permissions');
    }
  }

  /**
   * Send a success response.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {string} type - The message type.
   * @param {string} requestId - The request ID.
   * @param {Object} data - The response data.
   */
  sendResponse(ws, type, requestId, data) {
    ws.send(JSON.stringify({
      type,
      requestId,
      success: true,
      data
    }));
  }

  /**
   * Send an error response.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {string} requestId - The request ID.
   * @param {string} error - The error message.
   */
  sendError(ws, requestId, error) {
    ws.send(JSON.stringify({
      type: 'error',
      requestId,
      success: false,
      error
    }));
  }

  // ===== PDF Handlers =====

  /**
   * Handle PDF upload request.
   * GM-only: Only the GM can upload adventure content.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The upload payload.
   * @returns {Object} Upload result.
   */
  async handlePDFUpload(ws, { filename, category, displayName, fileData }) {
    this.requireGM(ws);

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world');
    }

    if (!this.pdfProcessor) {
      throw new Error('PDF processing not configured');
    }

    if (!filename || !fileData) {
      throw new Error('Filename and file data are required');
    }

    if (!['adventure', 'supplement', 'reference'].includes(category)) {
      throw new Error('Invalid category. Must be: adventure, supplement, or reference');
    }

    console.log(`[SocketHandler] PDF upload request: ${filename} (${category})`);

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(fileData, 'base64');

    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (pdfBuffer.length > maxSize) {
      throw new Error(`File too large. Maximum size is 50MB.`);
    }

    // Progress callback to send updates to client
    const onProgress = (stage, progress, message) => {
      try {
        ws.send(JSON.stringify({
          type: 'pdf-upload-progress',
          stage,
          progress,
          message
        }));
      } catch (error) {
        console.warn('[SocketHandler] Could not send progress update:', error.message);
      }
    };

    // Process the PDF
    const result = await this.pdfProcessor.processPDF(
      apiKey,
      worldId,
      pdfBuffer,
      filename,
      category,
      displayName,
      onProgress
    );

    return {
      success: true,
      pdf: result
    };
  }

  /**
   * Handle request to list PDFs for a world.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @returns {Object} List of PDFs.
   */
  async handleListPDFs(ws) {
    this.requireAuth(ws);

    if (!this.pdfProcessor) {
      return { pdfs: [] };
    }

    const pdfs = this.pdfProcessor.getPDFsForWorld(ws.worldId);
    const stats = this.pdfProcessor.getStats(ws.worldId);

    return { pdfs, stats };
  }

  /**
   * Handle request to delete a PDF.
   * GM-only: Only the GM can delete adventure content.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The delete payload.
   * @returns {Object} Delete result.
   */
  async handleDeletePDF(ws, { pdfId }) {
    this.requireGM(ws);

    const worldId = ws.worldId;
    const apiKey = this.credentialsStore.getApiKey(worldId);

    if (!apiKey) {
      throw new Error('API key not found for this world');
    }

    if (!this.pdfProcessor) {
      throw new Error('PDF processing not configured');
    }

    if (!pdfId) {
      throw new Error('PDF ID is required');
    }

    await this.pdfProcessor.deletePDF(apiKey, worldId, pdfId);

    return {
      success: true,
      message: 'PDF deleted',
      pdfId
    };
  }

  /**
   * Get all file IDs for a world (synced files + PDFs).
   *
   * @param {string} worldId - The world ID.
   * @returns {Array<string>} Combined array of Claude file_ids.
   * @private
   */
  _getAllFileIdsForWorld(worldId) {
    const fileIds = [];

    // Get synced context files
    if (this.filesManager) {
      const syncedFileIds = this.filesManager.getFileIdsForWorld(worldId);
      fileIds.push(...syncedFileIds);
    }

    // Get PDF file IDs
    if (this.pdfProcessor) {
      const pdfFileIds = this.pdfProcessor.getFileIdsForWorld(worldId);
      fileIds.push(...pdfFileIds);
    }

    return fileIds;
  }

  // ===== Canon Message Handlers =====

  /**
   * Handle publish to canon request.
   * GM publishes a private response to all players and adds to official history.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The publish payload.
   * @returns {Object} Publish result.
   */
  async handlePublishToCanon(ws, { content, messageId, sceneContext }) {
    this.requireGM(ws);

    const worldId = ws.worldId;

    if (!content || content.trim().length === 0) {
      throw new Error('Content is required for publishing to canon');
    }

    // Get current conversation
    const conversation = this.conversationStore.getOrCreateConversation(worldId);

    // Publish to canon
    const canonMessage = this.conversationStore.publishToCanon(
      worldId,
      conversation.id,
      content.trim(),
      {
        publishedBy: ws.userId,
        publishedByName: ws.userName,
        originalMessageId: messageId || null,
        sceneContext: sceneContext || null
      }
    );

    console.log(`[SocketHandler] Published to canon: ${canonMessage.id} by ${ws.userName}`);

    return {
      success: true,
      canonId: canonMessage.id,
      message: 'Published to canon'
    };
  }

  /**
   * Handle list canon request.
   * Returns the official narrative history for this world.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The list payload.
   * @returns {Object} List of canon messages.
   */
  async handleListCanon(ws, { limit = 100, offset = 0 }) {
    this.requireAuth(ws);

    const worldId = ws.worldId;
    const messages = this.conversationStore.getCanonMessages(worldId, limit, offset);
    const count = this.conversationStore.getCanonCount(worldId);

    return {
      canon: messages,
      total: count,
      hasMore: offset + messages.length < count
    };
  }

  /**
   * Handle update canon request.
   * GM corrects an entry in the official narrative history.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The update payload.
   * @returns {Object} Update result.
   */
  async handleUpdateCanon(ws, { canonId, content }) {
    this.requireGM(ws);

    if (!canonId) {
      throw new Error('Canon ID is required');
    }

    if (!content || content.trim().length === 0) {
      throw new Error('Content is required');
    }

    const success = this.conversationStore.updateCanonMessage(
      canonId,
      content.trim(),
      ws.userId
    );

    if (!success) {
      throw new Error(`Canon message not found: ${canonId}`);
    }

    console.log(`[SocketHandler] Updated canon ${canonId} by ${ws.userName}`);

    return {
      success: true,
      canonId,
      message: 'Canon updated'
    };
  }

  /**
   * Handle delete canon request.
   * GM retcons an entry from the official narrative history.
   *
   * @param {WebSocket} ws - The WebSocket connection.
   * @param {Object} payload - The delete payload.
   * @returns {Object} Delete result.
   */
  async handleDeleteCanon(ws, { canonId }) {
    this.requireGM(ws);

    if (!canonId) {
      throw new Error('Canon ID is required');
    }

    const success = this.conversationStore.deleteCanonMessage(canonId);

    if (!success) {
      throw new Error(`Canon message not found: ${canonId}`);
    }

    console.log(`[SocketHandler] Retconned canon ${canonId} by ${ws.userName}`);

    return {
      success: true,
      canonId,
      message: 'Canon retconned (deleted)'
    };
  }
}
