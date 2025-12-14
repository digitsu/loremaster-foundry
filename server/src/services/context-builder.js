/**
 * Context Builder
 *
 * Builds comprehensive context objects from game state for Claude prompts.
 * Combines current game state with historical context.
 */

/**
 * Build context from Foundry game state.
 *
 * @param {Object} gameState - Current game state from Foundry client.
 * @param {Object} options - Context building options.
 * @returns {Object} Formatted context object.
 */
export function buildContext(gameState, options = {}) {
  const context = {
    systemId: gameState.systemId,
    systemTitle: gameState.systemTitle,
    worldName: gameState.worldName
  };

  // Add scene context
  if (gameState.scene) {
    context.sceneName = gameState.scene.name;
    context.sceneDescription = gameState.scene.description;
  }

  // Add combat context
  if (gameState.combat && gameState.combat.active) {
    context.combat = {
      round: gameState.combat.round,
      turn: gameState.combat.turn,
      combatants: gameState.combat.combatants?.map(c => ({
        name: c.name,
        initiative: c.initiative,
        isDefeated: c.isDefeated,
        isCurrentTurn: c.isCurrentTurn
      })) || []
    };
  }

  // Add visible actors/tokens
  if (options.includeActors && gameState.visibleActors) {
    context.visibleActors = gameState.visibleActors.map(a => ({
      name: a.name,
      type: a.type,
      health: a.health,
      status: a.status
    }));
  }

  // Add recent chat
  if (options.includeChat && gameState.recentChat) {
    context.recentChat = gameState.recentChat.slice(-10).map(msg => ({
      speaker: msg.speaker,
      content: msg.content.substring(0, 200)
    }));
  }

  return context;
}

/**
 * Build minimal context for token-efficient prompts.
 *
 * @param {Object} gameState - Current game state.
 * @returns {Object} Minimal context object.
 */
export function buildMinimalContext(gameState) {
  return {
    systemTitle: gameState.systemTitle,
    worldName: gameState.worldName,
    sceneName: gameState.scene?.name,
    inCombat: gameState.combat?.active || false
  };
}

/**
 * Merge multiple context sources.
 *
 * @param {Object} baseContext - Base context object.
 * @param {Object} additionalContext - Additional context to merge.
 * @returns {Object} Merged context.
 */
export function mergeContext(baseContext, additionalContext) {
  return {
    ...baseContext,
    ...additionalContext,
    // Merge arrays if both exist
    visibleActors: [
      ...(baseContext.visibleActors || []),
      ...(additionalContext.visibleActors || [])
    ],
    recentChat: [
      ...(baseContext.recentChat || []),
      ...(additionalContext.recentChat || [])
    ]
  };
}
