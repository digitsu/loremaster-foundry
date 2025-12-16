/**
 * Loremaster Player Context
 *
 * Extracts user information, character associations, and GM status
 * for multi-player message batching and identification.
 */

const MODULE_ID = 'loremaster';

/**
 * PlayerContext class provides utilities for extracting player information.
 */
export class PlayerContext {
  /**
   * Get context information for the current user.
   *
   * @returns {Object} Player context object with user details.
   */
  static getCurrentUserContext() {
    const user = game.user;
    return this.getUserContext(user);
  }

  /**
   * Get context information for a specific user.
   *
   * @param {User} user - The Foundry User object.
   * @returns {Object} Player context object.
   */
  static getUserContext(user) {
    if (!user) {
      return {
        userId: null,
        userName: 'Unknown',
        characterName: null,
        characterId: null,
        isGM: false,
        color: '#ffffff'
      };
    }

    // Get the user's assigned character (if any)
    const character = user.character;

    return {
      userId: user.id,
      userName: user.name,
      characterName: character?.name || null,
      characterId: character?.id || null,
      isGM: user.isGM,
      color: user.color || '#ffffff'
    };
  }

  /**
   * Get context for all active (online) users.
   *
   * @returns {Array} Array of player context objects for active users.
   */
  static getActiveUsersContext() {
    return game.users
      .filter(u => u.active)
      .map(u => this.getUserContext(u));
  }

  /**
   * Get context for all non-GM players.
   *
   * @returns {Array} Array of player context objects for players only.
   */
  static getPlayersContext() {
    return game.users
      .filter(u => !u.isGM)
      .map(u => this.getUserContext(u));
  }

  /**
   * Get the GM user(s) context.
   *
   * @returns {Array} Array of player context objects for GMs.
   */
  static getGMsContext() {
    return game.users
      .filter(u => u.isGM)
      .map(u => this.getUserContext(u));
  }

  /**
   * Format a player message with full context for the AI.
   *
   * @param {Object} messageData - The message data.
   * @param {string} messageData.content - The message content.
   * @param {Object} messageData.userContext - The player context from getUserContext().
   * @param {number} messageData.timestamp - The message timestamp.
   * @returns {Object} Formatted message object for batching.
   */
  static formatMessageWithContext(messageData) {
    const { content, userContext, timestamp } = messageData;

    return {
      content: content,
      userId: userContext.userId,
      userName: userContext.userName,
      characterName: userContext.characterName,
      characterId: userContext.characterId,
      isGM: userContext.isGM,
      timestamp: timestamp || Date.now()
    };
  }

  /**
   * Format a batch of messages for sending to Claude.
   * Creates a structured text format that Claude can easily parse.
   *
   * @param {Array} messages - Array of formatted message objects.
   * @param {Array} gmRulings - Array of GM ruling objects.
   * @returns {string} Formatted text for Claude prompt.
   */
  static formatBatchForClaude(messages, gmRulings = []) {
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

      if (msg.isGM && !gmRulings.some(r => r.content === msg.content)) {
        lines.push(`[GM - ${msg.userName}]`);
      } else {
        lines.push(`[${speaker}]`);
      }
      lines.push(msg.content);
      lines.push('');
    }

    // Add GM rulings (these are special override instructions)
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
   * Check if a message contains a GM ruling prefix.
   *
   * @param {string} content - The message content.
   * @param {string} rulingPrefix - The GM ruling prefix from settings.
   * @returns {boolean} True if this is a GM ruling.
   */
  static isGMRuling(content, rulingPrefix) {
    return content.trim().startsWith(rulingPrefix);
  }

  /**
   * Extract the ruling content from a GM ruling message.
   *
   * @param {string} content - The full message content.
   * @param {string} rulingPrefix - The GM ruling prefix from settings.
   * @returns {string} The ruling content without the prefix.
   */
  static extractRulingContent(content, rulingPrefix) {
    const trimmed = content.trim();
    if (!trimmed.startsWith(rulingPrefix)) {
      return content;
    }

    // Remove prefix and closing bracket if present
    let ruling = trimmed.slice(rulingPrefix.length);
    if (ruling.endsWith(']')) {
      ruling = ruling.slice(0, -1);
    }
    return ruling.trim();
  }

  /**
   * Get a display string for a player (for UI purposes).
   *
   * @param {Object} userContext - The player context object.
   * @returns {string} Display string like "Character (Player)" or just "Player".
   */
  static getDisplayName(userContext) {
    if (userContext.characterName) {
      return `${userContext.characterName} (${userContext.userName})`;
    }
    return userContext.userName;
  }

  // ===== GM Presence Detection =====

  /**
   * Check if any GM is currently present (active/online) in the game.
   *
   * @returns {boolean} True if at least one GM is active.
   */
  static isGMPresent() {
    return game.users.some(u => u.isGM && u.active);
  }

  /**
   * Check if this is a solo game (single player who is GM).
   * In solo mode, the player acts as their own GM for ruling purposes.
   *
   * @returns {boolean} True if only one user is active and they are GM.
   */
  static isSoloGame() {
    const activeUsers = game.users.filter(u => u.active);
    return activeUsers.length === 1 && activeUsers[0].isGM;
  }

  /**
   * Get the current game mode based on GM presence.
   * Used to determine how Loremaster handles rules discrepancies.
   *
   * @returns {string} Game mode: 'solo', 'gm_present', or 'no_gm'.
   */
  static getGameMode() {
    if (this.isSoloGame()) return 'solo';
    if (this.isGMPresent()) return 'gm_present';
    return 'no_gm';
  }

  /**
   * Get GM presence context for sending to the server.
   * Includes game mode and active user counts.
   *
   * @returns {Object} GM presence context object.
   */
  static getGMPresenceContext() {
    const activeUsers = game.users.filter(u => u.active);
    const activeGMs = activeUsers.filter(u => u.isGM);
    const activePlayers = activeUsers.filter(u => !u.isGM);

    return {
      gameMode: this.getGameMode(),
      isGMPresent: activeGMs.length > 0,
      isSoloGame: this.isSoloGame(),
      activeGMCount: activeGMs.length,
      activePlayerCount: activePlayers.length,
      totalActiveUsers: activeUsers.length
    };
  }
}
