/**
 * Tool Executor
 *
 * Routes tool calls from Claude to Foundry VTT client for execution.
 * Handles the communication between the proxy server and Foundry.
 */

import { getToolByName } from './tool-definitions.js';

export class ToolExecutor {
  /**
   * Create a new ToolExecutor instance.
   *
   * @param {SocketHandler} socketHandler - The socket handler for client communication.
   */
  constructor(socketHandler) {
    this.socketHandler = socketHandler;
    console.log('[ToolExecutor] Initialized');
  }

  /**
   * Execute a tool call by forwarding it to the Foundry client.
   *
   * @param {string} worldId - The world ID.
   * @param {string} toolName - The tool name.
   * @param {Object} toolInput - The tool input parameters.
   * @returns {Promise<Object>} The tool execution result.
   */
  async execute(worldId, toolName, toolInput) {
    const tool = getToolByName(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    console.log(`[ToolExecutor] Executing ${toolName} for world ${worldId}`);

    // Forward to Foundry client via WebSocket
    const result = await this.socketHandler.requestToolExecution(
      worldId,
      toolName,
      toolInput
    );

    return result;
  }

  /**
   * Create a tool executor function for use with ClaudeClient.
   *
   * @param {string} worldId - The world ID.
   * @returns {Function} Executor function for tool calls.
   */
  createExecutorForWorld(worldId) {
    return async (toolName, toolInput) => {
      return this.execute(worldId, toolName, toolInput);
    };
  }
}
