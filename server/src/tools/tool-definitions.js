/**
 * Tool Definitions
 *
 * Defines the tools available to Claude for interacting with Foundry VTT.
 * Each tool has a name, description, and input schema following the
 * Anthropic tool use specification.
 */

export const tools = [
  {
    name: 'roll_dice',
    description: 'Roll dice using Foundry VTT dice notation. Returns the roll result including individual dice values and total successes.',
    input_schema: {
      type: 'object',
      properties: {
        formula: {
          type: 'string',
          description: 'Dice formula (e.g., "2d6+3", "8d6" for Year Zero Engine)'
        },
        label: {
          type: 'string',
          description: 'Optional label for the roll (e.g., "Attack Roll")'
        }
      },
      required: ['formula']
    }
  },
  {
    name: 'get_actor',
    description: 'Get detailed information about an actor (character, NPC, or ship) including their stats, skills, and inventory.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the actor to look up'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'get_scene',
    description: 'Get information about the current active scene including visible tokens and scene description.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_combat',
    description: 'Get the current combat state including round, turn, and all combatants with their initiative.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'lookup_item',
    description: 'Search compendiums for an item by name. Returns item details including stats and description.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the item to search for'
        },
        type: {
          type: 'string',
          description: 'Optional item type filter (weapon, armor, gear, talent)',
          enum: ['weapon', 'armor', 'gear', 'talent']
        }
      },
      required: ['name']
    }
  },
  {
    name: 'lookup_table',
    description: 'Find a roll table by name and optionally roll on it.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the roll table'
        },
        roll: {
          type: 'boolean',
          description: 'Whether to roll on the table (default: false)'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'speak_as',
    description: 'Post a chat message as an NPC or character. The message will appear in Foundry chat with the specified speaker.',
    input_schema: {
      type: 'object',
      properties: {
        actor: {
          type: 'string',
          description: 'Name of the actor to speak as'
        },
        message: {
          type: 'string',
          description: 'The message content'
        }
      },
      required: ['actor', 'message']
    }
  },
  {
    name: 'play_audio',
    description: 'Play ambient music or sound effects from a playlist.',
    input_schema: {
      type: 'object',
      properties: {
        playlist: {
          type: 'string',
          description: 'Name of the playlist'
        },
        track: {
          type: 'string',
          description: 'Optional specific track name'
        }
      },
      required: []
    }
  }
];

/**
 * Get all tool definitions for Claude API.
 *
 * @returns {Array} Array of tool definitions.
 */
export function getToolDefinitions() {
  return tools;
}

/**
 * Get a specific tool definition by name.
 *
 * @param {string} name - Tool name.
 * @returns {Object|null} Tool definition or null if not found.
 */
export function getToolByName(name) {
  return tools.find(t => t.name === name) || null;
}
