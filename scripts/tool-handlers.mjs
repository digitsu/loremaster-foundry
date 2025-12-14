/**
 * Loremaster Tool Handlers
 *
 * Implements tool execution handlers for Claude tool use.
 * These handlers are called when Claude requests tool execution
 * via the proxy server.
 */

const MODULE_ID = 'loremaster';

/**
 * Register all tool handlers with the socket client.
 *
 * @param {SocketClient} socketClient - The socket client instance.
 */
export function registerToolHandlers(socketClient) {
  socketClient.registerToolHandler('roll_dice', handleRollDice);
  socketClient.registerToolHandler('get_actor', handleGetActor);
  socketClient.registerToolHandler('get_scene', handleGetScene);
  socketClient.registerToolHandler('get_combat', handleGetCombat);
  socketClient.registerToolHandler('lookup_item', handleLookupItem);
  socketClient.registerToolHandler('lookup_table', handleLookupTable);
  socketClient.registerToolHandler('speak_as', handleSpeakAs);
  socketClient.registerToolHandler('play_audio', handlePlayAudio);

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
