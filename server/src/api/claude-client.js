/**
 * Claude API Client
 *
 * Handles communication with the Claude Messages API.
 * Supports tool use and file references.
 */

import { config } from '../config/default.js';

export class ClaudeClient {
  /**
   * Create a new ClaudeClient instance.
   */
  constructor() {
    this.apiEndpoint = config.claude.apiEndpoint;
    this.model = config.claude.model;
    this.maxTokens = config.claude.maxTokens;
    this.apiVersion = config.claude.apiVersion;
  }

  /**
   * Send a message to Claude and get a response.
   *
   * @param {string} apiKey - The user's Claude API key.
   * @param {string} userMessage - The user's message.
   * @param {Object} context - Game context to include.
   * @param {Array} conversationHistory - Previous messages.
   * @param {Array} fileIds - Claude file_ids to include as context.
   * @param {Array} tools - Tool definitions for function calling.
   * @param {Object} options - Additional options.
   * @param {string} options.additionalSystemPrompt - Extra system prompt content.
   * @returns {Promise<Object>} The Claude API response.
   */
  async sendMessage(apiKey, userMessage, context = {}, conversationHistory = [], fileIds = [], tools = [], options = {}) {
    if (!apiKey) {
      throw new Error('API key not provided');
    }

    // Build system prompt with optional additions
    let systemPrompt = this.buildSystemPrompt(context);
    if (options.additionalSystemPrompt) {
      systemPrompt += '\n\n' + options.additionalSystemPrompt;
    }

    // Build messages array
    const messages = this.buildMessages(userMessage, context, conversationHistory, fileIds);

    // Build request body
    const requestBody = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': this.apiVersion
    };

    // Add beta header if using files
    if (fileIds && fileIds.length > 0) {
      headers['anthropic-beta'] = config.claude.filesApiBeta;
    }

    try {
      console.log(`[ClaudeClient] Sending request to ${this.model}`);

      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        console.error(`[ClaudeClient] API error: ${errorMessage}`);
        throw new Error(`Claude API error: ${errorMessage}`);
      }

      const data = await response.json();
      console.log(`[ClaudeClient] Response received, stop_reason: ${data.stop_reason}`);

      return data;

    } catch (error) {
      console.error('[ClaudeClient] Request failed:', error.message);
      throw error;
    }
  }

  /**
   * Process a response that may contain tool calls.
   * Returns the final text response after all tool calls are resolved.
   *
   * @param {string} apiKey - The user's Claude API key.
   * @param {Object} initialResponse - The initial Claude response.
   * @param {Function} toolExecutor - Function to execute tool calls.
   * @param {Object} context - Game context.
   * @param {Array} conversationHistory - Conversation history.
   * @param {Array} tools - Tool definitions.
   * @returns {Promise<string>} The final text response.
   */
  async processToolCalls(apiKey, initialResponse, toolExecutor, context, conversationHistory, tools) {
    let response = initialResponse;
    const messages = [...conversationHistory];

    // Loop until we get a final response (no more tool calls)
    while (response.stop_reason === 'tool_use') {
      // Extract tool use blocks
      const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) break;

      // Add assistant's response with tool calls to messages
      messages.push({
        role: 'assistant',
        content: response.content
      });

      // Execute each tool and collect results
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        console.log(`[ClaudeClient] Executing tool: ${toolUse.name}`);

        try {
          const result = await toolExecutor(toolUse.name, toolUse.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        } catch (error) {
          console.error(`[ClaudeClient] Tool execution error: ${error.message}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: error.message }),
            is_error: true
          });
        }
      }

      // Add tool results to messages
      messages.push({
        role: 'user',
        content: toolResults
      });

      // Send follow-up request
      const requestBody = {
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.buildSystemPrompt(context),
        messages,
        tools
      };

      const followUpResponse = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': this.apiVersion
        },
        body: JSON.stringify(requestBody)
      });

      if (!followUpResponse.ok) {
        const errorData = await followUpResponse.json().catch(() => ({}));
        throw new Error(`Claude API error: ${errorData.error?.message || followUpResponse.status}`);
      }

      response = await followUpResponse.json();
    }

    // Extract final text response
    const textBlocks = response.content.filter(block => block.type === 'text');
    return textBlocks.map(block => block.text).join('\n');
  }

  /**
   * Build the system prompt for Loremaster.
   *
   * @param {Object} context - Game context.
   * @returns {string} The system prompt.
   */
  buildSystemPrompt(context) {
    return `You are Loremaster, an AI Game Master assistant for ${context.systemTitle || 'tabletop RPG'} sessions.

## Your Role
- Provide immersive narrative descriptions and NPC dialogue
- Reference the uploaded rules documents for mechanics when available
- Use the compendium data for lore-accurate responses
- Track ongoing story threads from conversation history
- Support the human GM, don't override their decisions

## Current Session Context
- World: ${context.worldName || 'Unknown'}
- Scene: ${context.sceneName || 'No active scene'}
- Combat: ${context.combat ? `Round ${context.combat.round}` : 'Not in combat'}

## Response Guidelines
- Stay in character for NPCs
- Use sensory details (sight, sound, smell)
- Keep responses 1-3 paragraphs unless more detail requested
- When you need game data, use the available tools
- Suggest dice rolls when appropriate using the roll_dice tool`;
  }

  /**
   * Build the messages array for the API request.
   *
   * @param {string} userMessage - The user's message.
   * @param {Object} context - Game context.
   * @param {Array} history - Conversation history.
   * @param {Array} fileIds - File IDs to include.
   * @returns {Array} Messages array for Claude API.
   */
  buildMessages(userMessage, context, history, fileIds) {
    const messages = [];

    // Add conversation history
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Build current user message
    const userContent = [];

    // Add file references as document blocks (if any)
    for (const fileId of fileIds) {
      userContent.push({
        type: 'document',
        source: {
          type: 'file',
          file_id: fileId
        }
      });
    }

    // Add current game state as inline context
    if (context && Object.keys(context).length > 0) {
      userContent.push({
        type: 'text',
        text: this.formatInlineContext(context)
      });
    }

    // Add user's actual message
    userContent.push({
      type: 'text',
      text: userMessage
    });

    // If only text content, simplify to string
    if (userContent.length === 1 && userContent[0].type === 'text') {
      messages.push({ role: 'user', content: userContent[0].text });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    return messages;
  }

  /**
   * Send a raw message to Claude with direct control over messages and system prompt.
   * Used for specialized tasks like GM Prep script generation.
   *
   * @param {string} apiKey - The user's Claude API key.
   * @param {Array} messages - Array of message objects for Claude API.
   * @param {Object} options - Request options.
   * @param {string} options.systemPrompt - The system prompt to use.
   * @param {Array} options.fileIds - Claude file_ids to include as context.
   * @param {number} options.maxTokens - Maximum tokens for response.
   * @returns {Promise<Object>} The Claude API response.
   */
  async sendMessageRaw(apiKey, messages, options = {}) {
    if (!apiKey) {
      throw new Error('API key not provided');
    }

    const fileIds = options.fileIds || [];
    const maxTokens = options.maxTokens || this.maxTokens;

    // If file IDs provided, prepend document blocks to first user message
    if (fileIds.length > 0) {
      const processedMessages = messages.map((msg, index) => {
        if (msg.role === 'user' && index === 0) {
          // Add file references to first user message
          const content = [];
          for (const fileId of fileIds) {
            content.push({
              type: 'document',
              source: {
                type: 'file',
                file_id: fileId
              }
            });
          }
          // Add original content
          if (typeof msg.content === 'string') {
            content.push({ type: 'text', text: msg.content });
          } else if (Array.isArray(msg.content)) {
            content.push(...msg.content);
          }
          return { ...msg, content };
        }
        return msg;
      });
      messages = processedMessages;
    }

    // Build request body
    const requestBody = {
      model: this.model,
      max_tokens: maxTokens,
      messages
    };

    if (options.systemPrompt) {
      requestBody.system = options.systemPrompt;
    }

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': this.apiVersion
    };

    // Add beta header if using files
    if (fileIds.length > 0) {
      headers['anthropic-beta'] = config.claude.filesApiBeta;
    }

    try {
      console.log(`[ClaudeClient] Sending raw request to ${this.model} (maxTokens: ${maxTokens})`);

      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
        console.error(`[ClaudeClient] API error: ${errorMessage}`);
        throw new Error(`Claude API error: ${errorMessage}`);
      }

      const data = await response.json();
      console.log(`[ClaudeClient] Raw response received, stop_reason: ${data.stop_reason}`);

      return data;

    } catch (error) {
      console.error('[ClaudeClient] Raw request failed:', error.message);
      throw error;
    }
  }

  /**
   * Format game context as inline text.
   *
   * @param {Object} context - Game context object.
   * @returns {string} Formatted context string.
   */
  formatInlineContext(context) {
    let text = '[Current Game State]\n';

    if (context.sceneName) {
      text += `Scene: ${context.sceneName}\n`;
    }

    if (context.sceneDescription) {
      text += `Description: ${context.sceneDescription}\n`;
    }

    if (context.combat) {
      text += `Combat: Round ${context.combat.round}, Turn ${context.combat.turn}\n`;
      if (context.combat.combatants) {
        const combatantList = context.combat.combatants
          .map(c => `${c.name}${c.isDefeated ? ' (defeated)' : ''}`)
          .join(', ');
        text += `Combatants: ${combatantList}\n`;
      }
    }

    if (context.recentChat && context.recentChat.length > 0) {
      text += '\n[Recent Chat]\n';
      for (const msg of context.recentChat.slice(-5)) {
        text += `${msg.speaker}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n`;
      }
    }

    return text;
  }
}
