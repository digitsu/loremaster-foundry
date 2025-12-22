/**
 * Cast Selection Dialog
 *
 * Dialog shown when activating an adventure that allows players to claim characters.
 * GM can override assignments and mark which characters Loremaster controls.
 */

const MODULE_ID = 'loremaster';

/**
 * CastSelectionDialog - Modal dialog for character assignment during adventure activation.
 * Extends Foundry's Dialog class for seamless integration.
 */
export class CastSelectionDialog extends Dialog {
  /**
   * Create a new CastSelectionDialog.
   *
   * @param {SocketClient} socketClient - The socket client for server communication.
   * @param {number} scriptId - The GM Prep script ID.
   * @param {string} adventureName - The adventure name for display.
   * @param {Object} dialogData - Dialog configuration.
   * @param {Object} options - Application options.
   */
  constructor(socketClient, scriptId, adventureName, dialogData = {}, options = {}) {
    super(dialogData, options);
    this.socketClient = socketClient;
    this.scriptId = scriptId;
    this.adventureName = adventureName;
    this.characters = [];
    this.pendingAssignments = new Map(); // characterName -> { userId, userName }
  }

  /**
   * Default application options.
   *
   * @returns {Object} The default options.
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['loremaster', 'cast-selection-dialog'],
      width: 650,
      height: 'auto',
      resizable: true
    });
  }

  /**
   * Show the cast selection dialog.
   * Static factory method that loads characters and displays the dialog.
   *
   * @param {SocketClient} socketClient - The socket client.
   * @param {number} scriptId - The GM Prep script ID.
   * @param {string} adventureName - The adventure name.
   * @returns {Promise<Object|null>} The dialog result with assignments, or null if cancelled.
   */
  static async show(socketClient, scriptId, adventureName) {
    return new Promise(async (resolve) => {
      // Load characters from server
      let characters = [];
      try {
        const result = await socketClient.getCharacters(scriptId);
        characters = result.characters || [];
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to load characters:`, error);
        ui.notifications.error('Failed to load character roster');
        resolve(null);
        return;
      }

      // If no characters, extract them first
      if (characters.length === 0) {
        try {
          ui.notifications.info(game.i18n.localize('LOREMASTER.Cast.Extracting'));
          const extractResult = await socketClient.extractCharactersFromScript(scriptId);
          characters = extractResult.characters || [];
        } catch (error) {
          console.error(`${MODULE_ID} | Failed to extract characters:`, error);
        }
      }

      // Filter to playable characters for main selection
      const playableCharacters = characters.filter(c => c.isPlayable);
      const npcCharacters = characters.filter(c => !c.isPlayable);

      const content = CastSelectionDialog._buildContent(playableCharacters, npcCharacters);

      const dialog = new CastSelectionDialog(socketClient, scriptId, adventureName, {
        title: game.i18n.format('LOREMASTER.CastSelection.Title', { name: adventureName }),
        content,
        buttons: {
          start: {
            icon: '<i class="fas fa-play"></i>',
            label: game.i18n.localize('LOREMASTER.CastSelection.StartAdventure'),
            callback: async (html) => {
              const assignments = dialog._collectAssignments(html, characters);
              resolve({ assignments, characters });
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('Cancel'),
            callback: () => resolve(null)
          }
        },
        default: 'start',
        close: () => resolve(null)
      }, {
        classes: ['loremaster', 'cast-selection-dialog']
      });

      dialog.characters = characters;
      dialog.render(true);
    });
  }

  /**
   * Build the dialog content HTML.
   *
   * @param {Array} playableCharacters - Characters that can be claimed by players.
   * @param {Array} npcCharacters - NPC characters for AI control assignment.
   * @returns {string} HTML content.
   * @private
   */
  static _buildContent(playableCharacters, npcCharacters) {
    const players = game.users.contents.map(u => ({
      id: u.id,
      name: u.name,
      isGM: u.isGM
    }));

    let html = `<div class="cast-selection-container">`;

    // Header explanation
    html += `
      <div class="cast-selection-header">
        <p>${game.i18n.localize('LOREMASTER.CastSelection.Instructions')}</p>
      </div>
    `;

    // Playable Characters Section
    if (playableCharacters.length > 0) {
      html += `
        <div class="cast-section playable-characters">
          <h3><i class="fas fa-users"></i> ${game.i18n.localize('LOREMASTER.CastSelection.PlayableCharacters')}</h3>
          <div class="character-grid">
      `;

      for (const char of playableCharacters) {
        html += CastSelectionDialog._buildCharacterCard(char, players, true);
      }

      html += `</div></div>`;
    }

    // NPC Characters Section (for AI control)
    if (npcCharacters.length > 0) {
      html += `
        <div class="cast-section npc-characters">
          <h3><i class="fas fa-robot"></i> ${game.i18n.localize('LOREMASTER.CastSelection.NPCsForAI')}</h3>
          <p class="hint">${game.i18n.localize('LOREMASTER.CastSelection.NPCsHint')}</p>
          <div class="npc-list">
      `;

      for (const char of npcCharacters) {
        html += CastSelectionDialog._buildNPCRow(char);
      }

      html += `</div></div>`;
    }

    // No characters message
    if (playableCharacters.length === 0 && npcCharacters.length === 0) {
      html += `
        <div class="no-characters">
          <i class="fas fa-users-slash"></i>
          <p>${game.i18n.localize('LOREMASTER.CastSelection.NoCharacters')}</p>
        </div>
      `;
    }

    html += `</div>`;

    return html;
  }

  /**
   * Build a character card for playable characters.
   *
   * @param {Object} character - The character data.
   * @param {Array} players - List of players.
   * @param {boolean} isPlayable - Whether character is playable.
   * @returns {string} HTML string.
   * @private
   */
  static _buildCharacterCard(character, players, isPlayable) {
    const roleClass = character.characterRole || 'npc';

    return `
      <div class="character-card ${roleClass}" data-character="${character.characterName}">
        <div class="character-header">
          <span class="character-name">${character.characterName}</span>
          <span class="character-role">${character.characterRole || 'Character'}</span>
        </div>
        ${character.personalitySummary ? `
          <div class="character-description">${character.personalitySummary}</div>
        ` : ''}
        <div class="character-controls">
          <label>${game.i18n.localize('LOREMASTER.CastSelection.ClaimAs')}</label>
          <select class="claim-select" data-character="${character.characterName}">
            <option value="">${game.i18n.localize('LOREMASTER.CastSelection.Unclaimed')}</option>
            ${players.map(p => `
              <option value="${p.id}" ${character.assignedToUserId === p.id ? 'selected' : ''}>
                ${p.name}${p.isGM ? ' (GM)' : ''}
              </option>
            `).join('')}
          </select>
        </div>
      </div>
    `;
  }

  /**
   * Build an NPC row for AI control assignment.
   *
   * @param {Object} character - The character data.
   * @returns {string} HTML string.
   * @private
   */
  static _buildNPCRow(character) {
    const roleClass = character.characterRole || 'npc';

    return `
      <div class="npc-row ${roleClass}" data-character="${character.characterName}">
        <div class="npc-info">
          <span class="npc-name">${character.characterName}</span>
          <span class="npc-role">${character.characterRole || 'NPC'}</span>
        </div>
        <div class="npc-controls">
          <label class="control-checkbox">
            <input type="checkbox" class="ai-control-checkbox"
                   data-character="${character.characterName}"
                   ${character.isLoremasterControlled ? 'checked' : ''}>
            <span>${game.i18n.localize('LOREMASTER.CastSelection.LoremasterRoleplays')}</span>
          </label>
        </div>
      </div>
    `;
  }

  /**
   * Collect assignments from the dialog HTML.
   *
   * @param {jQuery} html - The dialog HTML.
   * @param {Array} allCharacters - All character data.
   * @returns {Array} Array of character assignment objects.
   * @private
   */
  _collectAssignments(html, allCharacters) {
    const assignments = [];

    // Collect player claims for playable characters
    html.find('.claim-select').each((i, select) => {
      const characterName = select.dataset.character;
      const userId = select.value;
      const userName = userId ? game.users.get(userId)?.name : null;

      const character = allCharacters.find(c => c.characterName === characterName);
      if (character) {
        assignments.push({
          ...character,
          assignedToUserId: userId || null,
          assignedToUserName: userName,
          worldId: game.world.id
        });
      }
    });

    // Collect AI control for NPCs
    html.find('.ai-control-checkbox').each((i, checkbox) => {
      const characterName = checkbox.dataset.character;
      const isLoremasterControlled = checkbox.checked;

      // Check if this character isn't already in assignments
      const existing = assignments.find(a => a.characterName === characterName);
      if (!existing) {
        const character = allCharacters.find(c => c.characterName === characterName);
        if (character) {
          assignments.push({
            ...character,
            isLoremasterControlled,
            worldId: game.world.id
          });
        }
      }
    });

    return assignments;
  }

  /**
   * Activate listeners for the dialog.
   *
   * @param {jQuery} html - The dialog HTML.
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Highlight cards when a player claims them
    html.find('.claim-select').on('change', (event) => {
      const card = $(event.target).closest('.character-card');
      if (event.target.value) {
        card.addClass('claimed');
      } else {
        card.removeClass('claimed');
      }
    });
  }
}

/**
 * Show cast selection when setting an active adventure.
 * Call this from the content manager when activating an adventure with a GM Prep script.
 *
 * @param {SocketClient} socketClient - The socket client.
 * @param {number} scriptId - The GM Prep script ID.
 * @param {string} adventureName - The adventure name.
 * @returns {Promise<boolean>} True if adventure should be activated, false if cancelled.
 */
export async function showCastSelectionIfNeeded(socketClient, scriptId, adventureName) {
  // Only show for GM
  if (!game.user.isGM) return true;

  // Show the dialog
  const result = await CastSelectionDialog.show(socketClient, scriptId, adventureName);

  if (!result) {
    return false; // User cancelled
  }

  // Save the assignments
  if (result.assignments.length > 0) {
    try {
      await socketClient.bulkUpdateCharacters(scriptId, result.assignments);
      console.log(`${MODULE_ID} | Saved ${result.assignments.length} character assignments`);
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to save character assignments:`, error);
      ui.notifications.error('Failed to save character assignments');
    }
  }

  return true;
}
