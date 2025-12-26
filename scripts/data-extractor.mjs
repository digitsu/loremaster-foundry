/**
 * Loremaster Data Extractor
 *
 * Extracts and serializes game data from Foundry VTT for syncing
 * to the proxy server and Claude Files API.
 */

const MODULE_ID = 'loremaster';

/**
 * DataExtractor class handles extraction and serialization of game data.
 */
export class DataExtractor {
  /**
   * Create a new DataExtractor instance.
   *
   * @param {SocketClient} socketClient - The socket client for syncing data.
   */
  constructor(socketClient) {
    this.socketClient = socketClient;
  }

  /**
   * Extract and sync all game data to the proxy server.
   *
   * @returns {Promise<object>} Sync results.
   */
  async syncAll() {
    const results = {};

    try {
      // Sync system rules
      results.rules = await this.syncRules();

      // Sync compendium data
      results.compendium = await this.syncCompendium();

      // Sync current world state
      results.worldState = await this.syncWorldState();

      console.log(`${MODULE_ID} | All data synced successfully`);
      return results;

    } catch (error) {
      console.error(`${MODULE_ID} | Sync failed:`, error);
      throw error;
    }
  }

  /**
   * Extract and sync game system rules.
   *
   * @returns {Promise<object>} Sync result.
   */
  async syncRules() {
    const rulesData = this.extractRules();
    return this.socketClient.syncData(rulesData, 'rules');
  }

  /**
   * Extract and sync compendium data.
   *
   * @returns {Promise<object>} Sync result.
   */
  async syncCompendium() {
    const compendiumData = await this.extractCompendium();
    return this.socketClient.syncData(compendiumData, 'compendium');
  }

  /**
   * Extract and sync current world state.
   *
   * @returns {Promise<object>} Sync result.
   */
  async syncWorldState() {
    const worldData = this.extractWorldState();
    return this.socketClient.syncData(worldData, 'world_state');
  }

  /**
   * Extract game system rules and configuration.
   *
   * @returns {object} Serialized rules data.
   */
  extractRules() {
    const system = game.system;

    const data = {
      id: system.id,
      title: system.title,
      version: system.version,
      description: system.description
    };

    // Extract system-specific configuration
    if (game.system.id === 'yzecoriolis') {
      data.config = this._extractCoriolisConfig();
    } else if (game.system.id === 'forbidden-lands') {
      data.config = this._extractForbiddenLandsConfig();
    } else if (game.system.id === 'alienrpg') {
      data.config = this._extractAlienConfig();
    } else {
      // Generic extraction
      data.config = this._extractGenericConfig();
    }

    return data;
  }

  /**
   * Extract compendium data from all relevant packs.
   *
   * @returns {Promise<object>} Serialized compendium data.
   */
  async extractCompendium() {
    const data = {
      items: [],
      actors: [],
      tables: [],
      journals: []
    };

    // Get system compendium packs
    const systemPacks = game.packs.filter(p =>
      p.metadata.packageType === 'system' ||
      p.metadata.packageName === game.system.id
    );

    for (const pack of systemPacks) {
      const docs = await pack.getDocuments();

      for (const doc of docs) {
        switch (pack.documentName) {
          case 'Item':
            data.items.push(this._serializeItem(doc));
            break;
          case 'Actor':
            data.actors.push(this._serializeActor(doc));
            break;
          case 'RollTable':
            data.tables.push(this._serializeTable(doc));
            break;
          case 'JournalEntry':
            data.journals.push(this._serializeJournal(doc));
            break;
        }
      }
    }

    return data;
  }

  /**
   * Extract current world state.
   *
   * @returns {object} Serialized world state.
   */
  extractWorldState() {
    return {
      world: {
        id: game.world.id,
        title: game.world.title,
        description: game.world.description,
        system: game.system.id
      },
      actors: game.actors.map(a => this._serializeActor(a)),
      scenes: game.scenes.map(s => this._serializeScene(s)),
      activeScene: canvas.scene ? this._serializeScene(canvas.scene) : null,
      combat: game.combat ? this._serializeCombat(game.combat) : null,
      users: game.users.map(u => ({
        name: u.name,
        role: u.role,
        active: u.active,
        character: u.character?.name
      }))
    };
  }

  /**
   * Extract Coriolis-specific system configuration.
   *
   * @returns {object} Coriolis config.
   * @private
   */
  _extractCoriolisConfig() {
    const config = game.yzecoriolis?.config || {};

    return {
      attributes: ['strength', 'agility', 'wits', 'empathy'],
      skills: config.skills || [
        'dexterity', 'force', 'infiltration', 'manipulation',
        'meleecombat', 'observation', 'rangedcombat', 'survival',
        'command', 'culture', 'datadjinn', 'medicurgy',
        'mysticpowers', 'pilot', 'science', 'technology'
      ],
      concepts: config.concepts || [],
      origins: config.origins || [],
      icons: config.icons || [],
      darknessPoints: game.settings.get('yzecoriolis', 'darknessPoints') || 0
    };
  }

  /**
   * Extract Forbidden Lands system configuration.
   *
   * @returns {object} Forbidden Lands config.
   * @private
   */
  _extractForbiddenLandsConfig() {
    return {
      attributes: ['strength', 'agility', 'wits', 'empathy'],
      skills: [
        'might', 'endurance', 'melee', 'crafting',
        'stealth', 'sleightofhand', 'move', 'marksmanship',
        'scouting', 'lore', 'survival', 'insight',
        'manipulation', 'performance', 'healing', 'animalhandling'
      ]
    };
  }

  /**
   * Extract Alien RPG system configuration.
   *
   * @returns {object} Alien config.
   * @private
   */
  _extractAlienConfig() {
    return {
      attributes: ['strength', 'agility', 'wits', 'empathy'],
      skills: [
        'heavyMachinery', 'closeCombat', 'stamina',
        'rangedCombat', 'mobility', 'piloting',
        'observation', 'comtech', 'survival',
        'manipulation', 'command', 'medicalAid'
      ],
      stressLevels: true
    };
  }

  /**
   * Extract generic system configuration.
   *
   * @returns {object} Generic config.
   * @private
   */
  _extractGenericConfig() {
    const config = {};

    // Try to extract common patterns
    if (CONFIG[game.system.id]) {
      const sysConfig = CONFIG[game.system.id];
      if (sysConfig.abilities) config.abilities = Object.keys(sysConfig.abilities);
      if (sysConfig.skills) config.skills = Object.keys(sysConfig.skills);
      if (sysConfig.attributes) config.attributes = Object.keys(sysConfig.attributes);
    }

    return config;
  }

  /**
   * Serialize an item for export.
   *
   * @param {Item} item - The item to serialize.
   * @returns {object} Serialized item.
   * @private
   */
  _serializeItem(item) {
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      img: item.img,
      system: item.system,
      description: item.system?.description || ''
    };
  }

  /**
   * Serialize an actor for export.
   *
   * @param {Actor} actor - The actor to serialize.
   * @returns {object} Serialized actor.
   * @private
   */
  _serializeActor(actor) {
    return {
      id: actor.id,
      name: actor.name,
      type: actor.type,
      img: actor.img,
      system: actor.system,
      items: actor.items.map(i => this._serializeItem(i))
    };
  }

  /**
   * Serialize a scene for export.
   *
   * @param {Scene} scene - The scene to serialize.
   * @returns {object} Serialized scene.
   * @private
   */
  _serializeScene(scene) {
    return {
      id: scene.id,
      name: scene.name,
      description: scene.description,
      tokens: scene.tokens.map(t => ({
        id: t.id,
        name: t.name,
        actorId: t.actorId,
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
   * Serialize a roll table for export.
   *
   * @param {RollTable} table - The table to serialize.
   * @returns {object} Serialized table.
   * @private
   */
  _serializeTable(table) {
    return {
      id: table.id,
      name: table.name,
      description: table.description,
      formula: table.formula,
      results: table.results.map(r => ({
        range: r.range,
        text: r.text,
        weight: r.weight
      }))
    };
  }

  /**
   * Serialize a journal entry for export.
   *
   * @param {JournalEntry} journal - The journal to serialize.
   * @returns {object} Serialized journal.
   * @private
   */
  _serializeJournal(journal) {
    return {
      id: journal.id,
      name: journal.name,
      pages: journal.pages?.map(p => ({
        name: p.name,
        type: p.type,
        text: p.text?.content || ''
      })) || []
    };
  }

  /**
   * Serialize combat state for export.
   *
   * @param {Combat} combat - The combat to serialize.
   * @returns {object} Serialized combat.
   * @private
   */
  _serializeCombat(combat) {
    return {
      id: combat.id,
      round: combat.round,
      turn: combat.turn,
      started: combat.started,
      combatants: combat.combatants.map(c => ({
        id: c.id,
        name: c.name,
        actorId: c.actorId,
        initiative: c.initiative,
        isDefeated: c.isDefeated,
        isNPC: c.isNPC
      }))
    };
  }

  /**
   * Show sync dialog for selecting what data to sync.
   * GM-only: Only the GM can sync world data to Loremaster.
   *
   * @returns {Promise<Object|null>} Sync results or null if cancelled.
   */
  async showSyncDialog() {
    // Only GMs can sync world data
    if (!game.user.isGM) {
      ui.notifications.warn('Only the GM can sync world data to Loremaster');
      return null;
    }

    return new Promise((resolve) => {
      const content = `
        <form class="loremaster-sync-dialog">
          <p>Select data to sync to Loremaster AI:</p>
          <div class="form-group">
            <label>
              <input type="checkbox" name="rules" checked>
              System Rules & Configuration
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="actors" checked>
              World Actors (Characters & NPCs)
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="compendium">
              Compendium Data (may be large)
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" name="worldState" checked>
              Current World State
            </label>
          </div>
        </form>
      `;

      new Dialog({
        title: 'Sync World Data',
        content,
        buttons: {
          sync: {
            icon: '<i class="fas fa-sync"></i>',
            label: 'Sync',
            callback: async (html) => {
              html = $(html); // Ensure jQuery for Foundry v12 compatibility
              const options = {
                rules: html.find('[name="rules"]').prop('checked'),
                actors: html.find('[name="actors"]').prop('checked'),
                compendium: html.find('[name="compendium"]').prop('checked'),
                worldState: html.find('[name="worldState"]').prop('checked')
              };

              ui.notifications.info('Syncing world data...');

              try {
                const results = await this.syncSelected(options);
                ui.notifications.info('World data synced successfully!');
                resolve(results);
              } catch (error) {
                console.error(`${MODULE_ID} | Sync failed:`, error);
                ui.notifications.error(`Sync failed: ${error.message}`);
                resolve(null);
              }
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => resolve(null)
          }
        },
        default: 'sync'
      }).render(true);
    });
  }

  /**
   * Sync selected data types.
   *
   * @param {Object} options - What to sync.
   * @returns {Promise<Object>} Sync results.
   */
  async syncSelected(options) {
    const results = {};

    if (options.rules) {
      results.rules = await this.syncRules();
    }

    if (options.actors) {
      const actorData = game.actors.map(a => this._serializeActor(a));
      results.actors = await this.socketClient.syncData(actorData, 'actors');
    }

    if (options.compendium) {
      results.compendium = await this.syncCompendium();
    }

    if (options.worldState) {
      results.worldState = await this.syncWorldState();
    }

    return results;
  }

  /**
   * List currently synced files.
   *
   * @returns {Promise<Array>} Array of synced files.
   */
  async listSyncedFiles() {
    return this.socketClient.listFiles();
  }

  /**
   * Delete a synced file.
   *
   * @param {string} fileId - The file ID to delete.
   * @returns {Promise<Object>} Delete result.
   */
  async deleteSyncedFile(fileId) {
    return this.socketClient.deleteFile(fileId);
  }
}
