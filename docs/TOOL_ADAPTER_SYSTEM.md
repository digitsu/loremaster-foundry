# Loremaster Tool Adapter System

This document describes how the AI tool system works and how to implement support for additional game systems.

## Architecture Overview

The tool system allows Claude to interact with Foundry VTT by calling functions that execute game actions (rolling dice, querying actors, modifying resources). The system has two parts:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLAUDE API                                │
│  - Receives tool definitions (schemas)                          │
│  - Returns tool_use blocks when it wants to call a tool         │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                    PROXY SERVER (Node.js)                        │
│  server/src/tools/tool-definitions.js                           │
│    → Defines tool schemas for Claude (name, description, params)│
│  server/src/api/claude-client.js                                │
│    → Sends tools to Claude, processes tool_use responses        │
│  server/src/websocket/socket-handler.js                         │
│    → Forwards tool execution requests to Foundry client         │
└─────────────────────────────────────────────────────────────────┘
                              ↕ WebSocket
┌─────────────────────────────────────────────────────────────────┐
│                    FOUNDRY CLIENT (Browser)                      │
│  scripts/socket-client.mjs                                      │
│    → registerToolHandler() - maps tool names to functions       │
│    → _handleToolExecute() - executes tools, returns results     │
│  scripts/tool-handlers.mjs                                      │
│    → Actual tool implementations using Foundry APIs             │
└─────────────────────────────────────────────────────────────────┘
```

## Tool Definition Structure

Tools are defined in `server/src/tools/tool-definitions.js` using the Anthropic tool schema format:

```javascript
{
  name: 'tool_name',           // Unique identifier (snake_case)
  description: 'Description',  // What the tool does (Claude uses this to decide when to call it)
  input_schema: {
    type: 'object',
    properties: {
      param1: {
        type: 'string',
        description: 'What this parameter is for'
      },
      param2: {
        type: 'integer',
        description: 'Numeric parameter'
      },
      param3: {
        type: 'string',
        enum: ['option1', 'option2'],  // Constrained choices
        description: 'Limited options'
      }
    },
    required: ['param1']  // Required parameters
  }
}
```

### Best Practices for Tool Definitions

1. **Descriptive names**: Use clear, action-oriented names (`yze_skill_check` not `roll`)
2. **Detailed descriptions**: Claude uses these to decide when to call tools
3. **System prefixes**: Prefix system-specific tools (e.g., `yze_`, `dnd5e_`)
4. **Parameter descriptions**: Explain what values are expected
5. **Enums for constraints**: Use enums when values are limited

## Tool Handler Structure

Handlers are implemented in `scripts/tool-handlers.mjs`:

```javascript
/**
 * Handler function signature.
 * @param {object} input - Parameters from Claude's tool call
 * @returns {Promise<object>} Result object returned to Claude
 */
async function handleToolName({ param1, param2, param3 = 'default' }) {
  // 1. Validate system compatibility
  if (!isCompatibleSystem()) {
    throw new Error(`Tool not available for ${game.system.id}`);
  }

  // 2. Find/validate game objects
  const actor = findActor(param1);
  if (!actor) {
    throw new Error(`Actor not found: ${param1}`);
  }

  // 3. Perform the action
  const roll = await new Roll('2d6').evaluate();

  // 4. Post to chat (optional but recommended)
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: 'Tool action description'
  });

  // 5. Return structured result for Claude
  return {
    actor: actor.name,
    roll: roll.total,
    success: roll.total >= 7
  };
}
```

### Handler Registration

Handlers must be registered in `registerToolHandlers()`:

```javascript
export function registerToolHandlers(socketClient) {
  // Core tools
  socketClient.registerToolHandler('roll_dice', handleRollDice);

  // System-specific tools
  socketClient.registerToolHandler('yze_skill_check', handleYZESkillCheck);
  socketClient.registerToolHandler('dnd5e_ability_check', handleDnD5eAbilityCheck);

  console.log(`${MODULE_ID} | Tool handlers registered`);
}
```

## Adding Support for a New Game System

### Step 1: Identify System Mechanics

Research the game system to understand:
- Dice mechanics (d20, dice pools, etc.)
- Attributes and skills structure
- Success/failure criteria
- Special mechanics (advantage, criticals, etc.)
- Resource tracking (HP, spell slots, etc.)

### Step 2: Add System Detection

In `tool-handlers.mjs`, add your system to the detection logic:

```javascript
// System ID arrays for detection
const YZE_SYSTEMS = ['yzecoriolis', 'forbidden-lands', 'alienrpg', 'mutant-year-zero', 'vaesen'];
const DND_SYSTEMS = ['dnd5e', 'dnd5e2024'];
const PF_SYSTEMS = ['pf2e', 'pf1e'];

function isDnD5eSystem() {
  return DND_SYSTEMS.includes(game.system.id);
}
```

### Step 3: Define Tools (Server-Side)

Add tool definitions to `server/src/tools/tool-definitions.js`:

```javascript
// D&D 5e Tools
{
  name: 'dnd5e_ability_check',
  description: 'Roll a D&D 5e ability check. Rolls 1d20 + ability modifier + proficiency (if applicable). Supports advantage and disadvantage.',
  input_schema: {
    type: 'object',
    properties: {
      actorName: {
        type: 'string',
        description: 'Name of the character making the check'
      },
      ability: {
        type: 'string',
        enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        description: 'Ability to check'
      },
      skill: {
        type: 'string',
        description: 'Optional skill for the check (e.g., "stealth", "perception")'
      },
      advantage: {
        type: 'string',
        enum: ['normal', 'advantage', 'disadvantage'],
        description: 'Roll type (default: normal)'
      },
      dc: {
        type: 'integer',
        description: 'Difficulty Class to beat (optional)'
      }
    },
    required: ['actorName', 'ability']
  }
},
{
  name: 'dnd5e_attack',
  description: 'Make an attack roll with a weapon or spell in D&D 5e. Automatically calculates attack bonus and damage.',
  input_schema: {
    type: 'object',
    properties: {
      actorName: {
        type: 'string',
        description: 'Name of the attacker'
      },
      weaponName: {
        type: 'string',
        description: 'Name of the weapon or spell'
      },
      targetName: {
        type: 'string',
        description: 'Name of the target (optional)'
      },
      advantage: {
        type: 'string',
        enum: ['normal', 'advantage', 'disadvantage'],
        description: 'Attack roll type'
      }
    },
    required: ['actorName', 'weaponName']
  }
},
{
  name: 'dnd5e_saving_throw',
  description: 'Roll a D&D 5e saving throw against a DC.',
  input_schema: {
    type: 'object',
    properties: {
      actorName: {
        type: 'string',
        description: 'Name of the character making the save'
      },
      ability: {
        type: 'string',
        enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        description: 'Saving throw ability'
      },
      dc: {
        type: 'integer',
        description: 'Difficulty Class to beat'
      },
      advantage: {
        type: 'string',
        enum: ['normal', 'advantage', 'disadvantage'],
        description: 'Roll type'
      }
    },
    required: ['actorName', 'ability', 'dc']
  }
}
```

### Step 4: Implement Handlers (Client-Side)

Add handlers to `scripts/tool-handlers.mjs`:

```javascript
// ============================================================================
// D&D 5e Tool Handlers
// ============================================================================

/**
 * Get ability modifier from a D&D 5e actor.
 */
function getDnD5eAbilityMod(actor, ability) {
  const abilityKey = ability.toLowerCase().substring(0, 3);
  const abilities = actor.system.abilities;
  return abilities?.[abilityKey]?.mod ?? 0;
}

/**
 * Get skill modifier from a D&D 5e actor.
 */
function getDnD5eSkillMod(actor, skill) {
  const skillKey = skill.toLowerCase();
  const skills = actor.system.skills;
  return skills?.[skillKey]?.total ?? 0;
}

/**
 * Roll with advantage/disadvantage in D&D 5e.
 */
async function rollD20WithAdvantage(advantage = 'normal') {
  let formula;
  switch (advantage) {
    case 'advantage':
      formula = '2d20kh1';
      break;
    case 'disadvantage':
      formula = '2d20kl1';
      break;
    default:
      formula = '1d20';
  }
  return new Roll(formula).evaluate();
}

/**
 * D&D 5e ability check handler.
 */
async function handleDnD5eAbilityCheck({ actorName, ability, skill, advantage = 'normal', dc }) {
  if (!isDnD5eSystem()) {
    throw new Error(`D&D 5e ability check not available for ${game.system.id}`);
  }

  const actor = findActor(actorName);
  if (!actor) throw new Error(`Actor not found: ${actorName}`);

  // Get modifier
  let modifier;
  let rollLabel;
  if (skill) {
    modifier = getDnD5eSkillMod(actor, skill);
    rollLabel = `${skill.charAt(0).toUpperCase() + skill.slice(1)} (${ability.toUpperCase()})`;
  } else {
    modifier = getDnD5eAbilityMod(actor, ability);
    rollLabel = `${ability.toUpperCase()} Check`;
  }

  // Roll
  const roll = await rollD20WithAdvantage(advantage);
  const total = roll.total + modifier;

  // Determine success
  const isNat20 = roll.dice[0].results.some(r => r.result === 20);
  const isNat1 = roll.dice[0].results.some(r => r.result === 1);
  const success = dc ? total >= dc : null;

  // Post to chat
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${actor.name}: ${rollLabel}</strong>${dc ? ` vs DC ${dc}` : ''}${advantage !== 'normal' ? ` (${advantage})` : ''}`
  });

  return {
    actor: actor.name,
    ability,
    skill: skill || null,
    advantage,
    roll: roll.total,
    modifier,
    total,
    dc: dc || null,
    success,
    isNat20,
    isNat1,
    isCriticalSuccess: isNat20,
    isCriticalFailure: isNat1
  };
}

/**
 * D&D 5e attack handler.
 */
async function handleDnD5eAttack({ actorName, weaponName, targetName, advantage = 'normal' }) {
  if (!isDnD5eSystem()) {
    throw new Error(`D&D 5e attack not available for ${game.system.id}`);
  }

  const actor = findActor(actorName);
  if (!actor) throw new Error(`Actor not found: ${actorName}`);

  // Find weapon
  const weapon = actor.items.find(i =>
    ['weapon', 'spell'].includes(i.type) &&
    i.name.toLowerCase().includes(weaponName.toLowerCase())
  );
  if (!weapon) throw new Error(`Weapon not found: ${weaponName}`);

  // Get attack bonus from weapon
  const attackBonus = weapon.system.attackBonus || 0;
  const profBonus = actor.system.attributes?.prof || 0;
  const abilityMod = getDnD5eAbilityMod(actor, weapon.system.ability || 'str');
  const totalBonus = attackBonus + profBonus + abilityMod;

  // Roll attack
  const attackRoll = await rollD20WithAdvantage(advantage);
  const attackTotal = attackRoll.total + totalBonus;

  const isNat20 = attackRoll.dice[0].results.some(r => r.result === 20);
  const isNat1 = attackRoll.dice[0].results.some(r => r.result === 1);

  // Roll damage
  const damageFormula = weapon.system.damage?.parts?.[0]?.[0] || '1d6';
  const damageRoll = await new Roll(damageFormula).evaluate();
  const damageTotal = isNat20 ? damageRoll.total * 2 : damageRoll.total; // Critical doubles damage

  // Post to chat
  let flavor = `<strong>${actor.name} attacks with ${weapon.name}</strong>`;
  if (targetName) flavor += ` targeting ${targetName}`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `${flavor}<br/>Attack: ${attackTotal} ${isNat20 ? '(Critical!)' : isNat1 ? '(Fumble!)' : ''}<br/>Damage: ${damageTotal}`,
    rolls: [attackRoll, damageRoll]
  });

  return {
    actor: actor.name,
    weapon: weapon.name,
    target: targetName || null,
    attackRoll: attackRoll.total,
    attackBonus: totalBonus,
    attackTotal,
    damageRoll: damageRoll.total,
    damageTotal,
    isCritical: isNat20,
    isFumble: isNat1,
    advantage
  };
}

/**
 * D&D 5e saving throw handler.
 */
async function handleDnD5eSavingThrow({ actorName, ability, dc, advantage = 'normal' }) {
  if (!isDnD5eSystem()) {
    throw new Error(`D&D 5e saving throw not available for ${game.system.id}`);
  }

  const actor = findActor(actorName);
  if (!actor) throw new Error(`Actor not found: ${actorName}`);

  const abilityKey = ability.toLowerCase().substring(0, 3);
  const saveMod = actor.system.abilities?.[abilityKey]?.save ?? 0;

  const roll = await rollD20WithAdvantage(advantage);
  const total = roll.total + saveMod;
  const success = total >= dc;

  const isNat20 = roll.dice[0].results.some(r => r.result === 20);
  const isNat1 = roll.dice[0].results.some(r => r.result === 1);

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${actor.name}: ${ability.toUpperCase()} Save</strong> vs DC ${dc}`
  });

  return {
    actor: actor.name,
    ability,
    roll: roll.total,
    modifier: saveMod,
    total,
    dc,
    success: isNat20 ? true : isNat1 ? false : success,
    isNat20,
    isNat1
  };
}
```

### Step 5: Register Handlers

Add to `registerToolHandlers()`:

```javascript
// D&D 5e tools
socketClient.registerToolHandler('dnd5e_ability_check', handleDnD5eAbilityCheck);
socketClient.registerToolHandler('dnd5e_attack', handleDnD5eAttack);
socketClient.registerToolHandler('dnd5e_saving_throw', handleDnD5eSavingThrow);
```

### Step 6: Test

1. Start the proxy server
2. Load Foundry with your game system
3. Create test actors with appropriate stats
4. Use the `@lm` chat command to trigger tool usage
5. Verify:
   - Tools are called correctly
   - Results appear in chat
   - Return values are accurate
   - Error handling works

## Existing Implementations Reference

### Year Zero Engine (YZE)

**Supported Systems**: yzecoriolis, forbidden-lands, alienrpg, mutant-year-zero, vaesen

**Tools**:
| Tool | Purpose |
|------|---------|
| `yze_skill_check` | Attribute + skill dice pool, count 6s |
| `yze_attack` | Weapon attack with gear bonus |
| `yze_push_roll` | Reroll non-6s, manage darkness points |
| `yze_roll_critical` | Roll on critical injury tables |
| `yze_opposed_roll` | Contested rolls between actors |

**Key Mechanics**:
- d6 dice pools
- 6 = success
- 3+ successes = critical
- Push: reroll non-6s, any 1s cause damage
- Desperation: dice pool ≤ 0 → roll 2d6, need both 6s

**Helper Functions**:
```javascript
isYZESystem()           // Check if current system is YZE
getYZEAttribute(actor, attr)  // Get attribute value
getYZESkill(actor, skill)     // Get skill value
evaluateYZERoll(roll)   // Count successes from roll
```

### Cross-System Tools

These tools work across multiple systems:

| Tool | Purpose |
|------|---------|
| `roll_dice` | Generic Foundry dice roll |
| `get_actor` | Query actor data |
| `get_scene` | Get current scene info |
| `get_combat` | Get combat state |
| `lookup_item` | Search compendiums |
| `lookup_table` | Roll on tables |
| `speak_as` | NPC dialogue |
| `play_audio` | Control playlists |
| `apply_damage` | Reduce HP (handles armor) |
| `modify_resource` | Change HP/MP/stress/etc |

## Future Enhancements

### Phase 3: Dynamic Tool Registration

Currently, all tools are defined statically. A future enhancement could allow clients to register additional tools dynamically:

```javascript
// Client sends available tools on auth
{
  type: 'register-system-tools',
  tools: [
    { name: 'system_specific_tool', description: '...', input_schema: {...} }
  ]
}

// Server merges with base tools per-session
```

### Phase 4: Plugin Adapter Pattern

For cleaner separation, each system could have its own adapter file:

```
scripts/
  systems/
    base-adapter.mjs        // Base class with common logic
    yze-adapter.mjs         // Year Zero Engine
    dnd5e-adapter.mjs       // D&D 5e
    pf2e-adapter.mjs        // Pathfinder 2e
    index.mjs               // Auto-detects and loads appropriate adapter
```

Each adapter would export:
- Tool definitions
- Handler implementations
- System-specific context formatting
- Helper functions

## Troubleshooting

### Tool Not Being Called

1. Check tool definition description - Claude uses this to decide when to call
2. Verify tool is in `tool-definitions.js` and exported
3. Check handler is registered in `registerToolHandlers()`

### Handler Errors

1. Check system compatibility first
2. Validate all required parameters
3. Use `findActor()` helper for consistent actor lookup
4. Always return structured objects, not primitives

### Chat Messages Not Appearing

1. Verify `ChatMessage.create()` or `roll.toMessage()` is awaited
2. Check speaker configuration
3. Verify no errors in browser console

### Foundry API Issues

1. Check Foundry version compatibility
2. Verify `game.system.id` matches expected value
3. Use browser devtools to inspect actor/item structures
4. Test API calls in browser console first
