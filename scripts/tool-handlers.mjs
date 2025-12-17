/**
 * Loremaster Tool Handlers
 *
 * Implements tool execution handlers for Claude tool use.
 * These handlers are called when Claude requests tool execution
 * via the proxy server.
 */

const MODULE_ID = 'loremaster';

/**
 * Year Zero Engine system IDs.
 *
 * @type {string[]}
 */
const YZE_SYSTEMS = ['yzecoriolis', 'forbidden-lands', 'alienrpg', 'mutant-year-zero', 'vaesen'];

/**
 * Check if current game system is Year Zero Engine.
 *
 * @returns {boolean} True if YZE system.
 */
function isYZESystem() {
  return YZE_SYSTEMS.includes(game.system.id);
}

/**
 * Register all tool handlers with the socket client.
 *
 * @param {SocketClient} socketClient - The socket client instance.
 */
export function registerToolHandlers(socketClient) {
  // Core tools (all systems)
  socketClient.registerToolHandler('roll_dice', handleRollDice);
  socketClient.registerToolHandler('get_actor', handleGetActor);
  socketClient.registerToolHandler('get_scene', handleGetScene);
  socketClient.registerToolHandler('get_combat', handleGetCombat);
  socketClient.registerToolHandler('lookup_item', handleLookupItem);
  socketClient.registerToolHandler('lookup_table', handleLookupTable);
  socketClient.registerToolHandler('speak_as', handleSpeakAs);
  socketClient.registerToolHandler('play_audio', handlePlayAudio);

  // Year Zero Engine tools
  socketClient.registerToolHandler('yze_skill_check', handleYZESkillCheck);
  socketClient.registerToolHandler('yze_attack', handleYZEAttack);
  socketClient.registerToolHandler('yze_push_roll', handleYZEPushRoll);
  socketClient.registerToolHandler('yze_roll_critical', handleYZERollCritical);
  socketClient.registerToolHandler('yze_opposed_roll', handleYZEOpposedRoll);

  // Cross-system tools
  socketClient.registerToolHandler('apply_damage', handleApplyDamage);
  socketClient.registerToolHandler('modify_resource', handleModifyResource);

  console.log(`${MODULE_ID} | Tool handlers registered`);
}

/**
 * Roll dice using Foundry's dice system.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.formula - Dice formula (e.g., "2d6+3").
 * @param {string} [input.label] - Optional label for the roll.
 * @returns {object} Roll result.
 */
async function handleRollDice({ formula, label }) {
  try {
    const roll = await new Roll(formula).evaluate();

    // Create chat message for the roll
    await roll.toMessage({
      speaker: { alias: 'Loremaster' },
      flavor: label || 'Loremaster Roll'
    });

    return {
      formula: roll.formula,
      total: roll.total,
      dice: roll.dice.map(d => ({
        faces: d.faces,
        results: d.results.map(r => r.result)
      }))
    };
  } catch (error) {
    throw new Error(`Invalid dice formula: ${formula}`);
  }
}

/**
 * Get actor data by name.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.name - Actor name to search for.
 * @returns {object} Actor data.
 */
async function handleGetActor({ name }) {
  // Search in world actors
  let actor = game.actors.find(a =>
    a.name.toLowerCase().includes(name.toLowerCase())
  );

  // Search in current scene tokens if not found
  if (!actor && canvas.scene) {
    const token = canvas.scene.tokens.find(t =>
      t.name.toLowerCase().includes(name.toLowerCase())
    );
    if (token) {
      actor = token.actor;
    }
  }

  if (!actor) {
    throw new Error(`Actor not found: ${name}`);
  }

  // Build serialized actor data
  const data = {
    name: actor.name,
    type: actor.type,
    img: actor.img
  };

  // Add system-specific data based on game system
  const system = actor.system;
  if (system) {
    // Common fields
    if (system.attributes) data.attributes = system.attributes;
    if (system.skills) data.skills = system.skills;
    if (system.health) data.health = system.health;
    if (system.hitPoints) data.hitPoints = system.hitPoints;

    // Year Zero Engine specific (Coriolis, Forbidden Lands, etc.)
    if (game.system.id.includes('yze') || game.system.id === 'yzecoriolis') {
      data.attributes = {
        strength: system.attributes?.strength?.value,
        agility: system.attributes?.agility?.value,
        wits: system.attributes?.wits?.value,
        empathy: system.attributes?.empathy?.value
      };
      data.hitPoints = system.hitPoints;
      data.mindPoints = system.mindPoints;
    }
  }

  // Add owned items (weapons, armor, gear)
  data.items = actor.items.map(i => ({
    name: i.name,
    type: i.type,
    img: i.img,
    quantity: i.system?.quantity
  }));

  return data;
}

/**
 * Get current scene information.
 *
 * @returns {object} Scene data.
 */
async function handleGetScene() {
  const scene = canvas.scene;

  if (!scene) {
    throw new Error('No active scene');
  }

  return {
    name: scene.name,
    description: scene.description,
    darkness: scene.darkness,
    weather: scene.weather,
    tokens: scene.tokens.map(t => ({
      name: t.name,
      x: t.x,
      y: t.y,
      hidden: t.hidden,
      disposition: t.disposition
    })),
    notes: scene.notes?.map(n => ({
      text: n.text,
      x: n.x,
      y: n.y
    })) || []
  };
}

/**
 * Get current combat state.
 *
 * @returns {object} Combat data.
 */
async function handleGetCombat() {
  const combat = game.combat;

  if (!combat) {
    return { active: false };
  }

  return {
    active: true,
    round: combat.round,
    turn: combat.turn,
    started: combat.started,
    combatants: combat.combatants.map(c => ({
      name: c.name,
      initiative: c.initiative,
      isDefeated: c.isDefeated,
      isNPC: c.isNPC,
      isOwner: c.isOwner,
      actorId: c.actorId
    })),
    current: combat.combatant ? {
      name: combat.combatant.name,
      initiative: combat.combatant.initiative
    } : null
  };
}

/**
 * Lookup item in compendiums.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.name - Item name to search for.
 * @param {string} [input.type] - Optional item type filter.
 * @returns {object} Item data.
 */
async function handleLookupItem({ name, type }) {
  // Search world items first
  let item = game.items.find(i =>
    i.name.toLowerCase().includes(name.toLowerCase()) &&
    (!type || i.type === type)
  );

  // Search compendiums if not found
  if (!item) {
    for (const pack of game.packs.filter(p => p.documentName === 'Item')) {
      const index = await pack.getIndex();
      const match = index.find(i =>
        i.name.toLowerCase().includes(name.toLowerCase())
      );
      if (match) {
        item = await pack.getDocument(match._id);
        break;
      }
    }
  }

  if (!item) {
    throw new Error(`Item not found: ${name}`);
  }

  return {
    name: item.name,
    type: item.type,
    img: item.img,
    description: item.system?.description || '',
    system: item.system
  };
}

/**
 * Lookup and optionally roll on a roll table.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.name - Table name to search for.
 * @param {boolean} [input.roll] - Whether to roll on the table.
 * @returns {object} Table data or roll result.
 */
async function handleLookupTable({ name, roll = false }) {
  // Search world tables first
  let table = game.tables.find(t =>
    t.name.toLowerCase().includes(name.toLowerCase())
  );

  // Search compendiums if not found
  if (!table) {
    for (const pack of game.packs.filter(p => p.documentName === 'RollTable')) {
      const index = await pack.getIndex();
      const match = index.find(t =>
        t.name.toLowerCase().includes(name.toLowerCase())
      );
      if (match) {
        table = await pack.getDocument(match._id);
        break;
      }
    }
  }

  if (!table) {
    throw new Error(`Table not found: ${name}`);
  }

  const result = {
    name: table.name,
    description: table.description,
    results: table.results.map(r => ({
      text: r.text,
      range: r.range,
      weight: r.weight
    }))
  };

  // Roll on the table if requested
  if (roll) {
    const rollResult = await table.roll();
    result.rolled = {
      total: rollResult.roll.total,
      result: rollResult.results.map(r => r.text).join(', ')
    };
  }

  return result;
}

/**
 * Speak as an NPC/actor in chat.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actor - Actor name to speak as.
 * @param {string} input.message - Message content.
 * @returns {object} Result.
 */
async function handleSpeakAs({ actor: actorName, message }) {
  // Find the actor
  let actor = game.actors.find(a =>
    a.name.toLowerCase().includes(actorName.toLowerCase())
  );

  // Check scene tokens
  if (!actor && canvas.scene) {
    const token = canvas.scene.tokens.find(t =>
      t.name.toLowerCase().includes(actorName.toLowerCase())
    );
    if (token) {
      actor = token.actor;
    }
  }

  const speaker = actor
    ? ChatMessage.getSpeaker({ actor })
    : { alias: actorName };

  await ChatMessage.create({
    content: message,
    speaker,
    type: CONST.CHAT_MESSAGE_TYPES.IC,
    flags: {
      [MODULE_ID]: {
        isAISpeech: true
      }
    }
  });

  return {
    success: true,
    speaker: actor?.name || actorName
  };
}

/**
 * Play audio (playlist or sound).
 *
 * @param {object} input - Tool input parameters.
 * @param {string} [input.playlist] - Playlist name.
 * @param {string} [input.track] - Track name within playlist.
 * @param {string} [input.action] - Action: play, stop, pause.
 * @returns {object} Result.
 */
async function handlePlayAudio({ playlist: playlistName, track: trackName, action = 'play' }) {
  // Find playlist
  const playlist = game.playlists.find(p =>
    p.name.toLowerCase().includes((playlistName || '').toLowerCase())
  );

  if (!playlist && playlistName) {
    throw new Error(`Playlist not found: ${playlistName}`);
  }

  if (action === 'stop') {
    // Stop all playing sounds
    if (playlist) {
      await playlist.stopAll();
    } else {
      for (const p of game.playlists) {
        await p.stopAll();
      }
    }
    return { success: true, action: 'stopped' };
  }

  if (!playlist) {
    throw new Error('Playlist name required for play action');
  }

  // Find specific track if provided
  if (trackName) {
    const sound = playlist.sounds.find(s =>
      s.name.toLowerCase().includes(trackName.toLowerCase())
    );
    if (sound) {
      await playlist.playSound(sound);
      return { success: true, playing: sound.name };
    }
    throw new Error(`Track not found: ${trackName}`);
  }

  // Play the playlist
  await playlist.playAll();
  return { success: true, playing: playlist.name };
}

// ============================================================================
// Year Zero Engine Tool Handlers
// ============================================================================

/**
 * Find an actor by name (case-insensitive partial match).
 *
 * @param {string} name - Actor name to search for.
 * @returns {Actor|null} The found actor or null.
 */
function findActor(name) {
  // Search in world actors
  let actor = game.actors.find(a =>
    a.name.toLowerCase().includes(name.toLowerCase())
  );

  // Search in current scene tokens if not found
  if (!actor && canvas.scene) {
    const token = canvas.scene.tokens.find(t =>
      t.name.toLowerCase().includes(name.toLowerCase())
    );
    if (token) {
      actor = token.actor;
    }
  }

  return actor;
}

/**
 * Get attribute value from a YZE actor.
 *
 * @param {Actor} actor - The actor.
 * @param {string} attribute - Attribute name.
 * @returns {number} Attribute value.
 */
function getYZEAttribute(actor, attribute) {
  const attrKey = attribute.toLowerCase();
  const attrs = actor.system.attributes;

  if (!attrs) return 0;

  // Handle different YZE system structures
  if (attrs[attrKey]?.value !== undefined) {
    return attrs[attrKey].value;
  }
  if (attrs[attrKey] !== undefined && typeof attrs[attrKey] === 'number') {
    return attrs[attrKey];
  }

  return 0;
}

/**
 * Get skill value from a YZE actor.
 *
 * @param {Actor} actor - The actor.
 * @param {string} skill - Skill name.
 * @returns {number} Skill value.
 */
function getYZESkill(actor, skill) {
  const skillKey = skill.toLowerCase().replace(/\s+/g, '');
  const skills = actor.system.skills;

  if (!skills) return 0;

  // Try exact match first
  if (skills[skillKey]?.value !== undefined) {
    return skills[skillKey].value;
  }
  if (skills[skillKey] !== undefined && typeof skills[skillKey] === 'number') {
    return skills[skillKey];
  }

  // Try partial match
  for (const key of Object.keys(skills)) {
    if (key.toLowerCase().includes(skillKey) || skillKey.includes(key.toLowerCase())) {
      if (skills[key]?.value !== undefined) return skills[key].value;
      if (typeof skills[key] === 'number') return skills[key];
    }
  }

  return 0;
}

/**
 * Evaluate a Year Zero Engine dice roll.
 * In YZE, 6s are successes. 3+ successes = critical.
 *
 * @param {Roll} roll - The evaluated Foundry roll.
 * @returns {object} Evaluation result with successes and status.
 */
function evaluateYZERoll(roll) {
  const results = roll.dice[0]?.results || [];
  const diceValues = results.map(r => r.result);
  const successes = diceValues.filter(v => v === 6).length;
  const ones = diceValues.filter(v => v === 1).length;

  return {
    diceRolled: diceValues.length,
    results: diceValues,
    successes,
    ones,
    isSuccess: successes > 0,
    isCritical: successes >= 3,
    isFailure: successes === 0
  };
}

/**
 * Roll a Year Zero Engine skill check.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actorName - Name of the actor making the roll.
 * @param {string} input.attribute - Attribute to use.
 * @param {string} input.skill - Skill to use.
 * @param {number} [input.modifier] - Bonus/penalty dice.
 * @param {string} [input.label] - Description of the roll.
 * @returns {object} Roll result.
 */
async function handleYZESkillCheck({ actorName, attribute, skill, modifier = 0, label }) {
  if (!isYZESystem()) {
    throw new Error(`YZE skill check not available for ${game.system.id}. Use roll_dice instead.`);
  }

  const actor = findActor(actorName);
  if (!actor) {
    throw new Error(`Actor not found: ${actorName}`);
  }

  const attrValue = getYZEAttribute(actor, attribute);
  const skillValue = getYZESkill(actor, skill);
  let totalDice = attrValue + skillValue + modifier;

  // Desperation roll: if dice pool <= 0, roll 2 dice (need both 6s)
  const isDesperation = totalDice <= 0;
  if (isDesperation) {
    totalDice = 2;
  }

  const formula = `${totalDice}d6`;
  const roll = await new Roll(formula).evaluate();
  const evaluation = evaluateYZERoll(roll);

  // For desperation rolls, need 2 successes to succeed
  if (isDesperation) {
    evaluation.isSuccess = evaluation.successes >= 2;
    evaluation.isFailure = evaluation.successes < 2;
  }

  // Post to chat
  const rollLabel = label || `${actor.name}: ${attribute} + ${skill}`;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${rollLabel}</strong>${isDesperation ? ' (Desperation Roll!)' : ''}`
  });

  return {
    actor: actor.name,
    attribute: { name: attribute, value: attrValue },
    skill: { name: skill, value: skillValue },
    modifier,
    ...evaluation,
    isDesperation,
    canPush: !isDesperation,
    status: evaluation.isCritical ? 'critical_success' :
            evaluation.isSuccess ? 'success' : 'failure'
  };
}

/**
 * Make an attack roll with a weapon in YZE.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actorName - Name of the actor attacking.
 * @param {string} input.weaponName - Name of the weapon.
 * @param {string} [input.targetName] - Name of the target.
 * @param {number} [input.modifier] - Situational modifier.
 * @returns {object} Attack result.
 */
async function handleYZEAttack({ actorName, weaponName, targetName, modifier = 0 }) {
  if (!isYZESystem()) {
    throw new Error(`YZE attack not available for ${game.system.id}. Use roll_dice instead.`);
  }

  const actor = findActor(actorName);
  if (!actor) {
    throw new Error(`Actor not found: ${actorName}`);
  }

  // Find the weapon
  const weapon = actor.items.find(i =>
    i.type === 'weapon' && i.name.toLowerCase().includes(weaponName.toLowerCase())
  );
  if (!weapon) {
    throw new Error(`Weapon not found: ${weaponName}`);
  }

  // Get weapon properties
  const weaponData = weapon.system;
  const attrKey = weaponData.attribute || (weaponData.melee ? 'strength' : 'agility');
  const skillKey = weaponData.skill || (weaponData.melee ? 'meleecombat' : 'rangedcombat');
  const gearBonus = weaponData.bonus || weaponData.gearBonus || 0;
  const damage = weaponData.damage || weaponData.baseDamage || 1;
  const crit = weaponData.crit || weaponData.criticalScore || 1;

  const attrValue = getYZEAttribute(actor, attrKey);
  const skillValue = getYZESkill(actor, skillKey);
  let totalDice = attrValue + skillValue + gearBonus + modifier;

  const isDesperation = totalDice <= 0;
  if (isDesperation) {
    totalDice = 2;
  }

  const formula = `${totalDice}d6`;
  const roll = await new Roll(formula).evaluate();
  const evaluation = evaluateYZERoll(roll);

  if (isDesperation) {
    evaluation.isSuccess = evaluation.successes >= 2;
    evaluation.isFailure = evaluation.successes < 2;
  }

  // Calculate potential damage (base damage + extra successes beyond first)
  const extraSuccesses = Math.max(0, evaluation.successes - 1);
  const potentialDamage = evaluation.isSuccess ? damage + extraSuccesses : 0;

  // Build flavor text
  let flavor = `<strong>${actor.name} attacks with ${weapon.name}</strong>`;
  if (targetName) {
    flavor += ` targeting ${targetName}`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor
  });

  return {
    actor: actor.name,
    weapon: weapon.name,
    target: targetName || null,
    attribute: { name: attrKey, value: attrValue },
    skill: { name: skillKey, value: skillValue },
    gearBonus,
    modifier,
    ...evaluation,
    isDesperation,
    damage: {
      base: damage,
      extraSuccesses,
      total: potentialDamage
    },
    critThreshold: crit,
    isCriticalHit: evaluation.successes >= crit,
    canPush: !isDesperation && evaluation.isFailure,
    status: evaluation.isCritical ? 'critical_success' :
            evaluation.isSuccess ? 'hit' : 'miss'
  };
}

/**
 * Push a Year Zero Engine roll - reroll all non-6s.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actorName - Name of the actor pushing.
 * @param {number[]} input.previousResults - Previous dice results.
 * @param {string} [input.label] - Description of the roll.
 * @returns {object} Push result.
 */
async function handleYZEPushRoll({ actorName, previousResults, label }) {
  if (!isYZESystem()) {
    throw new Error(`YZE push roll not available for ${game.system.id}.`);
  }

  const actor = findActor(actorName);
  if (!actor) {
    throw new Error(`Actor not found: ${actorName}`);
  }

  // Count dice to reroll (non-6s)
  const keptSixes = previousResults.filter(r => r === 6);
  const diceToReroll = previousResults.filter(r => r !== 6).length;

  if (diceToReroll === 0) {
    throw new Error('No dice to reroll - all dice show 6.');
  }

  // Roll new dice
  const formula = `${diceToReroll}d6`;
  const roll = await new Roll(formula).evaluate();
  const newResults = roll.dice[0]?.results.map(r => r.result) || [];

  // Combine kept sixes with new results
  const allResults = [...keptSixes, ...newResults];
  const successes = allResults.filter(v => v === 6).length;
  const newOnes = newResults.filter(v => v === 1).length;

  // Post to chat
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>PUSHED ROLL${label ? `: ${label}` : ''}</strong><br/>Kept ${keptSixes.length} sixes, rerolled ${diceToReroll} dice`
  });

  // Add Darkness Point (or spend for NPCs in Coriolis)
  let darknessPointChange = null;
  if (game.system.id === 'yzecoriolis') {
    try {
      const isNPC = actor.type === 'npc';
      const currentDP = game.settings.get('yzecoriolis', 'darknessPoints') || 0;
      if (isNPC) {
        if (currentDP > 0) {
          await game.settings.set('yzecoriolis', 'darknessPoints', currentDP - 1);
          darknessPointChange = { type: 'spent', amount: 1, newTotal: currentDP - 1 };
        }
      } else {
        await game.settings.set('yzecoriolis', 'darknessPoints', currentDP + 1);
        darknessPointChange = { type: 'added', amount: 1, newTotal: currentDP + 1 };
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Could not modify darkness points:`, e);
    }
  }

  return {
    actor: actor.name,
    previousResults,
    keptSixes: keptSixes.length,
    rerolled: diceToReroll,
    newResults,
    finalResults: allResults,
    successes,
    newOnes,
    bpiDamage: newOnes, // Banes/stress from 1s
    isSuccess: successes > 0,
    isCritical: successes >= 3,
    darknessPointChange,
    status: successes >= 3 ? 'critical_success' :
            successes > 0 ? 'success' : 'failure'
  };
}

/**
 * Roll on a critical injury table.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actorName - Name of the actor.
 * @param {string} input.criticalType - Type of critical (injury, stress, etc).
 * @param {number} [input.modifier] - Modifier to the roll.
 * @returns {object} Critical roll result.
 */
async function handleYZERollCritical({ actorName, criticalType, modifier = 0 }) {
  if (!isYZESystem()) {
    throw new Error(`YZE critical roll not available for ${game.system.id}.`);
  }

  const actor = findActor(actorName);
  if (!actor) {
    throw new Error(`Actor not found: ${actorName}`);
  }

  // Map critical types to table names by system
  const tableNameMap = {
    yzecoriolis: {
      injury: 'Critical Injuries',
      damage: 'Critical Injuries',
      stress: 'Critical Injuries',
      mental: 'Critical Injuries'
    },
    'forbidden-lands': {
      injury: 'Critical Injuries',
      damage: 'Critical Injuries'
    },
    alienrpg: {
      injury: 'Critical Injury',
      stress: 'Panic',
      mental: 'Panic'
    }
  };

  const tableNames = tableNameMap[game.system.id] || tableNameMap.yzecoriolis;
  const tableName = tableNames[criticalType] || tableNames.injury || 'Critical Injuries';

  // Find the table
  let table = game.tables.find(t =>
    t.name.toLowerCase().includes(tableName.toLowerCase())
  );

  // Search compendiums if not in world
  if (!table) {
    for (const pack of game.packs.filter(p => p.documentName === 'RollTable')) {
      const index = await pack.getIndex();
      const match = index.find(t =>
        t.name.toLowerCase().includes(tableName.toLowerCase())
      );
      if (match) {
        table = await pack.getDocument(match._id);
        break;
      }
    }
  }

  if (!table) {
    // Fall back to generic d66 roll
    const formula = modifier !== 0 ? `1d66 + ${modifier}` : '1d66';
    const roll = await new Roll(formula).evaluate();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${actor.name}: Critical ${criticalType}</strong><br/>No ${tableName} table found - generic d66 roll`
    });

    return {
      actor: actor.name,
      criticalType,
      roll: roll.total,
      modifier,
      tableFound: false,
      result: `Roll: ${roll.total} (consult ${tableName} table manually)`
    };
  }

  // Roll on the table
  const rollResult = await table.roll();

  return {
    actor: actor.name,
    criticalType,
    table: table.name,
    roll: rollResult.roll.total,
    modifier,
    tableFound: true,
    result: rollResult.results.map(r => ({
      text: r.text,
      range: r.range
    }))
  };
}

/**
 * Make an opposed roll between two actors.
 *
 * @param {object} input - Tool input parameters.
 * @returns {object} Opposed roll result.
 */
async function handleYZEOpposedRoll({
  actorName, actorAttribute, actorSkill,
  opponentName, opponentAttribute, opponentSkill,
  label
}) {
  if (!isYZESystem()) {
    throw new Error(`YZE opposed roll not available for ${game.system.id}.`);
  }

  const actor = findActor(actorName);
  const opponent = findActor(opponentName);

  if (!actor) throw new Error(`Actor not found: ${actorName}`);
  if (!opponent) throw new Error(`Opponent not found: ${opponentName}`);

  // Roll for actor
  const actorAttrValue = getYZEAttribute(actor, actorAttribute);
  const actorSkillValue = getYZESkill(actor, actorSkill);
  const actorDice = Math.max(2, actorAttrValue + actorSkillValue);

  const actorRoll = await new Roll(`${actorDice}d6`).evaluate();
  const actorEval = evaluateYZERoll(actorRoll);

  // Roll for opponent
  const oppAttrValue = getYZEAttribute(opponent, opponentAttribute);
  const oppSkillValue = getYZESkill(opponent, opponentSkill);
  const oppDice = Math.max(2, oppAttrValue + oppSkillValue);

  const oppRoll = await new Roll(`${oppDice}d6`).evaluate();
  const oppEval = evaluateYZERoll(oppRoll);

  // Determine winner
  let winner = null;
  let margin = actorEval.successes - oppEval.successes;
  if (actorEval.successes > oppEval.successes) {
    winner = actor.name;
  } else if (oppEval.successes > actorEval.successes) {
    winner = opponent.name;
    margin = -margin;
  }

  // Post combined result to chat
  const rollLabel = label || 'Opposed Roll';
  await ChatMessage.create({
    speaker: { alias: 'Loremaster' },
    content: `<strong>${rollLabel}</strong><br/>
      ${actor.name} (${actorAttribute}+${actorSkill}): ${actorEval.successes} successes<br/>
      ${opponent.name} (${opponentAttribute}+${opponentSkill}): ${oppEval.successes} successes<br/>
      <strong>Winner: ${winner || 'Tie!'}</strong>`,
    flags: { [MODULE_ID]: { isAISpeech: true } }
  });

  return {
    actor: {
      name: actor.name,
      attribute: { name: actorAttribute, value: actorAttrValue },
      skill: { name: actorSkill, value: actorSkillValue },
      diceRolled: actorDice,
      results: actorEval.results,
      successes: actorEval.successes
    },
    opponent: {
      name: opponent.name,
      attribute: { name: opponentAttribute, value: oppAttrValue },
      skill: { name: opponentSkill, value: oppSkillValue },
      diceRolled: oppDice,
      results: oppEval.results,
      successes: oppEval.successes
    },
    winner,
    margin: Math.abs(margin),
    isTie: winner === null
  };
}

// ============================================================================
// Cross-System Tool Handlers
// ============================================================================

/**
 * Apply damage to an actor.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actorName - Name of the actor.
 * @param {number} input.amount - Amount of damage.
 * @param {string} [input.damageType] - Type of damage.
 * @param {boolean} [input.ignoreArmor] - Whether to ignore armor.
 * @returns {object} Damage result.
 */
async function handleApplyDamage({ actorName, amount, damageType = 'physical', ignoreArmor = false }) {
  const actor = findActor(actorName);
  if (!actor) {
    throw new Error(`Actor not found: ${actorName}`);
  }

  const system = actor.system;
  let currentHP, maxHP, newHP, hpPath;

  // Determine HP path based on game system
  if (isYZESystem()) {
    // Year Zero Engine systems
    if (damageType === 'stress' || damageType === 'mental') {
      currentHP = system.mindPoints?.value ?? system.stress?.value ?? 0;
      maxHP = system.mindPoints?.max ?? system.stress?.max ?? 10;
      hpPath = system.mindPoints ? 'system.mindPoints.value' : 'system.stress.value';
    } else {
      currentHP = system.hitPoints?.value ?? system.health?.value ?? 0;
      maxHP = system.hitPoints?.max ?? system.health?.max ?? 10;
      hpPath = system.hitPoints ? 'system.hitPoints.value' : 'system.health.value';
    }
  } else {
    // Generic system handling
    currentHP = system.attributes?.hp?.value ?? system.hp?.value ?? system.health?.value ?? 0;
    maxHP = system.attributes?.hp?.max ?? system.hp?.max ?? system.health?.max ?? 10;
    hpPath = 'system.attributes.hp.value';
  }

  // Calculate damage (could factor in armor here)
  let actualDamage = amount;
  let armorReduction = 0;

  if (!ignoreArmor && isYZESystem()) {
    // Get armor value
    const armor = actor.items.find(i => i.type === 'armor' && i.system.equipped);
    if (armor) {
      armorReduction = armor.system.armorRating || armor.system.rating || 0;
      actualDamage = Math.max(0, amount - armorReduction);
    }
  }

  newHP = Math.max(0, currentHP - actualDamage);

  // Update the actor
  await actor.update({ [hpPath]: newHP });

  // Post to chat
  await ChatMessage.create({
    speaker: { alias: 'Loremaster' },
    content: `<strong>${actor.name}</strong> takes <strong>${actualDamage}</strong> ${damageType} damage.${armorReduction > 0 ? ` (${armorReduction} absorbed by armor)` : ''}<br/>HP: ${currentHP} → ${newHP}`,
    flags: { [MODULE_ID]: { isAISpeech: true } }
  });

  return {
    actor: actor.name,
    damageType,
    damageRequested: amount,
    armorReduction,
    actualDamage,
    previousHP: currentHP,
    newHP,
    maxHP,
    isIncapacitated: newHP === 0
  };
}

/**
 * Modify a character resource.
 *
 * @param {object} input - Tool input parameters.
 * @param {string} input.actorName - Name of the actor (or "gm" for GM resources).
 * @param {string} input.resource - Resource to modify.
 * @param {number} input.amount - Amount to add (positive) or remove (negative).
 * @param {string} [input.reason] - Reason for modification.
 * @returns {object} Modification result.
 */
async function handleModifyResource({ actorName, resource, amount, reason }) {
  const resourceKey = resource.toLowerCase().replace(/\s+/g, '');

  // Handle GM-level resources (like Darkness Points)
  if (actorName.toLowerCase() === 'gm') {
    if (resourceKey === 'darknesspoints' && game.system.id === 'yzecoriolis') {
      const currentValue = game.settings.get('yzecoriolis', 'darknessPoints') || 0;
      const newValue = Math.max(0, currentValue + amount);
      await game.settings.set('yzecoriolis', 'darknessPoints', newValue);

      await ChatMessage.create({
        speaker: { alias: 'Loremaster' },
        content: `<strong>Darkness Points:</strong> ${currentValue} → ${newValue}${reason ? ` (${reason})` : ''}`,
        whisper: ChatMessage.getWhisperRecipients('GM'),
        flags: { [MODULE_ID]: { isAISpeech: true } }
      });

      return {
        resource: 'Darkness Points',
        previousValue: currentValue,
        change: amount,
        newValue,
        reason
      };
    }
    throw new Error(`Unknown GM resource: ${resource}`);
  }

  // Handle actor resources
  const actor = findActor(actorName);
  if (!actor) {
    throw new Error(`Actor not found: ${actorName}`);
  }

  const system = actor.system;
  let currentValue, maxValue, newValue, path;

  // Map resource names to system paths
  const resourcePaths = {
    hp: { path: 'system.hitPoints.value', max: 'system.hitPoints.max' },
    hitpoints: { path: 'system.hitPoints.value', max: 'system.hitPoints.max' },
    health: { path: 'system.hitPoints.value', max: 'system.hitPoints.max' },
    mp: { path: 'system.mindPoints.value', max: 'system.mindPoints.max' },
    mindpoints: { path: 'system.mindPoints.value', max: 'system.mindPoints.max' },
    stress: { path: 'system.stress.value', max: 'system.stress.max' },
    radiation: { path: 'system.radiation.value', max: 'system.radiation.max' }
  };

  const mapping = resourcePaths[resourceKey];
  if (mapping) {
    path = mapping.path;
    const pathParts = mapping.path.split('.');
    const maxParts = mapping.max.split('.');

    currentValue = pathParts.reduce((obj, key) => obj?.[key], actor) ?? 0;
    maxValue = maxParts.reduce((obj, key) => obj?.[key], actor);
    newValue = maxValue !== undefined
      ? Math.min(maxValue, Math.max(0, currentValue + amount))
      : Math.max(0, currentValue + amount);
  } else {
    throw new Error(`Unknown resource: ${resource}. Try: hp, mp, stress, radiation`);
  }

  // Update the actor
  await actor.update({ [path]: newValue });

  // Post to chat
  const changeText = amount >= 0 ? `+${amount}` : `${amount}`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<strong>${actor.name}</strong> ${resource}: ${currentValue} → ${newValue} (${changeText})${reason ? ` - ${reason}` : ''}`,
    flags: { [MODULE_ID]: { isAISpeech: true } }
  });

  return {
    actor: actor.name,
    resource,
    previousValue: currentValue,
    change: amount,
    newValue,
    maxValue,
    reason
  };
}
