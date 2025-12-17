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
  },

  // Year Zero Engine Tools (Coriolis, Forbidden Lands, Alien RPG, Mutant Year Zero, Vaesen)
  {
    name: 'yze_skill_check',
    description: 'Roll a Year Zero Engine skill check. Rolls attribute + skill dice (d6s), counting 6s as successes. Use for Coriolis, Forbidden Lands, Alien RPG, Mutant Year Zero, or Vaesen.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the actor making the roll'
        },
        attribute: {
          type: 'string',
          description: 'Attribute name (e.g., strength, agility, wits, empathy)'
        },
        skill: {
          type: 'string',
          description: 'Skill name (e.g., rangedCombat, meleeCombat, observation)'
        },
        modifier: {
          type: 'integer',
          description: 'Bonus or penalty dice (positive or negative)'
        },
        label: {
          type: 'string',
          description: 'Description of what the roll is for'
        }
      },
      required: ['actorName', 'attribute', 'skill']
    }
  },
  {
    name: 'yze_attack',
    description: 'Make an attack roll with a weapon in Year Zero Engine. Rolls attribute + skill + weapon bonus dice. Returns successes, damage potential, and weapon effects.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the actor making the attack'
        },
        weaponName: {
          type: 'string',
          description: 'Name of the weapon to attack with'
        },
        targetName: {
          type: 'string',
          description: 'Name of the target (optional, for narrative)'
        },
        modifier: {
          type: 'integer',
          description: 'Situational modifier dice (positive or negative)'
        }
      },
      required: ['actorName', 'weaponName']
    }
  },
  {
    name: 'yze_push_roll',
    description: 'Push a Year Zero Engine roll - reroll all dice that did not show 6 or 1. This is risky: any 1s rolled cause damage/stress to the character. Only use when the player explicitly wants to push.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the actor pushing the roll'
        },
        previousResults: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Array of dice results from the previous roll'
        },
        label: {
          type: 'string',
          description: 'Description of the original roll being pushed'
        }
      },
      required: ['actorName', 'previousResults']
    }
  },
  {
    name: 'yze_roll_critical',
    description: 'Roll on a critical injury or critical damage table. Use when a character takes critical damage or when the rules call for a critical roll.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the actor receiving the critical'
        },
        criticalType: {
          type: 'string',
          enum: ['injury', 'stress', 'damage', 'mental'],
          description: 'Type of critical table to roll on'
        },
        modifier: {
          type: 'integer',
          description: 'Modifier to the critical roll (e.g., +1 for each previous critical)'
        }
      },
      required: ['actorName', 'criticalType']
    }
  },
  {
    name: 'yze_opposed_roll',
    description: 'Make an opposed roll between two actors in Year Zero Engine. Both roll their dice pools, comparing successes.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the initiating actor'
        },
        actorAttribute: {
          type: 'string',
          description: 'Attribute for the initiating actor'
        },
        actorSkill: {
          type: 'string',
          description: 'Skill for the initiating actor'
        },
        opponentName: {
          type: 'string',
          description: 'Name of the opposing actor'
        },
        opponentAttribute: {
          type: 'string',
          description: 'Attribute for the opponent'
        },
        opponentSkill: {
          type: 'string',
          description: 'Skill for the opponent'
        },
        label: {
          type: 'string',
          description: 'Description of the contest'
        }
      },
      required: ['actorName', 'actorAttribute', 'actorSkill', 'opponentName', 'opponentAttribute', 'opponentSkill']
    }
  },
  {
    name: 'apply_damage',
    description: 'Apply damage to an actor, reducing their HP/health. Works across game systems.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the actor to damage'
        },
        amount: {
          type: 'integer',
          description: 'Amount of damage to apply'
        },
        damageType: {
          type: 'string',
          description: 'Type of damage (e.g., physical, stress, radiation)'
        },
        ignoreArmor: {
          type: 'boolean',
          description: 'Whether damage bypasses armor'
        }
      },
      required: ['actorName', 'amount']
    }
  },
  {
    name: 'modify_resource',
    description: 'Modify a character resource like HP, stress, supplies, ammo, or darkness points.',
    input_schema: {
      type: 'object',
      properties: {
        actorName: {
          type: 'string',
          description: 'Name of the actor (or "gm" for GM resources like Darkness Points)'
        },
        resource: {
          type: 'string',
          description: 'Resource to modify (e.g., hp, stress, supply, ammo, darknessPoints)'
        },
        amount: {
          type: 'integer',
          description: 'Amount to add (positive) or remove (negative)'
        },
        reason: {
          type: 'string',
          description: 'Reason for the modification'
        }
      },
      required: ['actorName', 'resource', 'amount']
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
