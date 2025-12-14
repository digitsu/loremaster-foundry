/**
 * Loremaster API Client
 *
 * Handles communication with the Claude API for AI responses.
 */

import { getSetting } from './config.mjs';

const MODULE_ID = 'loremaster';
const API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

/**
 * APIClient class manages Claude API communication.
 */
export class APIClient {
  /**
   * Create a new APIClient instance.
   */
  constructor() {
    this.systemPrompt = this._buildSystemPrompt();
  }

  /**
   * Send a message to the Claude API and get a response.
   *
   * @param {string} message - The user's message.
   * @param {object} context - Game context to include.
   * @returns {Promise<string>} The AI response text.
   */
  async sendMessage(message, context = {}) {
    const apiKey = getSetting('apiKey');

    if (!apiKey) {
      throw new Error('API key not configured. Please set your Claude API key in module settings.');
    }

    // Build the full prompt with context
    const userMessage = this._buildUserMessage(message, context);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: this.systemPrompt,
          messages: [
            {
              role: 'user',
              content: userMessage
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.content[0].text;

    } catch (error) {
      console.error(`${MODULE_ID} | API error:`, error);
      throw error;
    }
  }

  /**
   * Build the system prompt for the AI.
   * Establishes the AI's role as a Game Master.
   *
   * @returns {string} The system prompt.
   * @private
   */
  _buildSystemPrompt() {
    return `You are Loremaster, an AI Game Master assistant for tabletop RPG sessions. Your role is to:

1. **Assist the Game Master**: Provide narrative descriptions, NPC dialogue, and story elements when requested.

2. **Stay In Character**: When describing scenes or speaking as NPCs, maintain an immersive tone appropriate to the game's setting.

3. **Support the Rules**: When relevant, reference game mechanics and rules, but prioritize narrative flow over rules lawyering.

4. **Be Collaborative**: You are assisting human players and GMs, not replacing them. Offer suggestions rather than dictating outcomes.

5. **Adapt to Context**: Use the game context provided (current scene, combat state, recent events) to make your responses relevant and coherent with the ongoing session.

Keep responses concise but flavorful. Aim for 1-3 paragraphs unless more detail is specifically requested.`;
  }

  /**
   * Build the user message with context.
   *
   * @param {string} message - The user's raw message.
   * @param {object} context - Game context to include.
   * @returns {string} The formatted user message.
   * @private
   */
  _buildUserMessage(message, context) {
    let fullMessage = '';

    // Add game system info
    if (context.system) {
      fullMessage += `[Game System: ${context.systemTitle || context.system}]\n`;
    }

    // Add scene context
    if (context.scene) {
      fullMessage += `[Current Scene: ${context.scene.name}]\n`;
      if (context.scene.description) {
        fullMessage += `[Scene Description: ${context.scene.description}]\n`;
      }
    }

    // Add combat context
    if (context.combat) {
      fullMessage += `[Combat Active - Round ${context.combat.round}]\n`;
      const combatants = context.combat.combatants
        .map(c => `${c.name}${c.isDefeated ? ' (defeated)' : ''}`)
        .join(', ');
      fullMessage += `[Combatants: ${combatants}]\n`;
    }

    // Add recent chat for continuity
    if (context.recentChat && context.recentChat.length > 0) {
      fullMessage += '[Recent conversation:\n';
      context.recentChat.forEach(msg => {
        fullMessage += `  ${msg.speaker}: ${msg.content.substring(0, 100)}...\n`;
      });
      fullMessage += ']\n';
    }

    // Add the actual user request
    fullMessage += `\nPlayer Request: ${message}`;

    return fullMessage;
  }

  /**
   * Update the system prompt.
   * Allows for dynamic prompt customization.
   *
   * @param {string} prompt - The new system prompt.
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }
}
