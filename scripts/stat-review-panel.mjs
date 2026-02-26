/**
 * Stat Review Panel
 *
 * Floating GM panel for reviewing AI-proposed stat changes.
 * Shows pending proposals with approve/reject buttons,
 * sync status, and resolved proposal history.
 */

const MODULE_ID = 'loremaster';

export class StatReviewPanel extends Application {
  /**
   * @param {SocketClient} socketClient - Socket client for server communication
   * @param {object} options - Application options
   */
  constructor(socketClient, options = {}) {
    super(options);
    this.socketClient = socketClient;
    this.pendingProposals = [];
    this.resolvedProposals = [];
    this.activeTab = 'pending';
    this._pendingCount = 0;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'loremaster-stat-review',
      title: 'Stat Change Review',
      template: 'modules/loremaster/templates/stat-review-panel.hbs',
      classes: ['loremaster', 'stat-review-panel'],
      width: 420,
      height: 500,
      resizable: true,
      minimizable: true,
      tabs: [{ navSelector: '.tabs', contentSelector: '.tab-content', initial: 'pending' }]
    });
  }

  async getData(options = {}) {
    const data = await super.getData(options);
    return {
      ...data,
      pendingProposals: this.pendingProposals,
      resolvedProposals: this.resolvedProposals,
      pendingCount: this.pendingProposals.length,
      isGM: game.user.isGM
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html = $(html);

    html.find('.approve-btn').on('click', this._onApprove.bind(this));
    html.find('.reject-btn').on('click', this._onReject.bind(this));
    html.find('.refresh-btn').on('click', this._onRefresh.bind(this));
  }

  /**
   * Handle incoming proposal from server.
   * @param {object} proposal - The proposal data
   */
  addProposal(proposal) {
    // Avoid duplicates
    if (this.pendingProposals.find(p => p.proposalId === proposal.proposalId)) return;

    this.pendingProposals.push(proposal);
    this._pendingCount = this.pendingProposals.length;
    this._updateBadge();

    // Show notification
    ui.notifications.info(`${MODULE_ID} | AI proposes changes to ${proposal.actorName}`);

    if (this.rendered) this.render(false);
  }

  /**
   * Handle proposal applied (approved changes applied to actor).
   * @param {object} data - The apply data with actorId, actorName, changes
   */
  handleApply(data) {
    const { actorId, actorName, changes } = data;

    // Find the actor in Foundry and apply changes
    const actor = game.actors.find(a => a.id === actorId) ||
                  game.actors.find(a => a.name === actorName);

    if (!actor) {
      console.warn(`${MODULE_ID} | Cannot find actor ${actorName} (${actorId}) to apply changes`);
      ui.notifications.warn(`Cannot find actor ${actorName} to apply stat changes`);
      return;
    }

    this._applyChangesToActor(actor, changes);
  }

  /**
   * Apply an array of changes to a Foundry actor.
   * @param {Actor} actor - Foundry actor
   * @param {Array} changes - Array of change objects
   */
  async _applyChangesToActor(actor, changes) {
    for (const change of changes) {
      try {
        await this._applySingleChange(actor, change);
      } catch (err) {
        console.error(`${MODULE_ID} | Failed to apply change ${change.type}:`, err);
        ui.notifications.error(`Failed to apply ${change.type} to ${actor.name}: ${err.message}`);
      }
    }
    ui.notifications.info(`Applied ${changes.length} change(s) to ${actor.name}`);
  }

  /**
   * Apply a single change to a Foundry actor.
   * Uses system-agnostic paths where possible.
   */
  async _applySingleChange(actor, change) {
    const { type, value } = change;

    switch (type) {
      case 'hp_change': {
        const hp = actor.system?.attributes?.hp || actor.system?.hp;
        if (hp) {
          const newValue = Math.max(0, Math.min((hp.value || hp.current || 0) + value, hp.max || 999));
          // Try common paths
          if (actor.system?.attributes?.hp !== undefined) {
            await actor.update({ 'system.attributes.hp.value': newValue });
          } else if (actor.system?.hp !== undefined) {
            await actor.update({ 'system.hp.value': newValue });
          }
        }
        break;
      }

      case 'set_temp_hp': {
        if (actor.system?.attributes?.hp?.temp !== undefined) {
          await actor.update({ 'system.attributes.hp.temp': value });
        } else if (actor.system?.hp?.temp !== undefined) {
          await actor.update({ 'system.hp.temp': value });
        }
        break;
      }

      case 'add_condition': {
        // Use Foundry's ActiveEffect system for conditions
        if (typeof actor.toggleStatusEffect === 'function') {
          await actor.toggleStatusEffect(value, { active: true });
        } else {
          // Fallback: create an ActiveEffect
          await actor.createEmbeddedDocuments('ActiveEffect', [{
            name: value,
            icon: 'icons/svg/aura.svg',
            'flags.core.statusId': value
          }]);
        }
        break;
      }

      case 'remove_condition': {
        if (typeof actor.toggleStatusEffect === 'function') {
          await actor.toggleStatusEffect(value, { active: false });
        } else {
          const effect = actor.effects.find(e =>
            e.name?.toLowerCase() === value?.toLowerCase() ||
            e.flags?.core?.statusId === value
          );
          if (effect) await effect.delete();
        }
        break;
      }

      case 'add_item': {
        // Search compendiums or create a basic item
        const item = await this._findOrCreateItem(value);
        if (item) {
          await actor.createEmbeddedDocuments('Item', [item.toObject ? item.toObject() : item]);
        }
        break;
      }

      case 'remove_item': {
        const ownedItem = actor.items.find(i => i.name?.toLowerCase() === value?.toLowerCase());
        if (ownedItem) await ownedItem.delete();
        break;
      }

      case 'use_spell_slot':
      case 'restore_spell_slot': {
        // System-specific — try dnd5e path
        if (actor.system?.spells) {
          const level = `spell${value}`;
          const slots = actor.system.spells[level];
          if (slots) {
            const delta = type === 'use_spell_slot' ? 1 : -1;
            const newUsed = Math.max(0, Math.min((slots.value || 0) - delta, slots.max || 0));
            await actor.update({ [`system.spells.${level}.value`]: newUsed });
          }
        }
        break;
      }

      default:
        console.warn(`${MODULE_ID} | Unknown change type: ${type}`);
    }
  }

  async _findOrCreateItem(name) {
    // Search game items first
    let item = game.items.find(i => i.name?.toLowerCase() === name?.toLowerCase());
    if (item) return item;

    // Search compendiums
    for (const pack of game.packs) {
      if (pack.documentName !== 'Item') continue;
      const index = await pack.getIndex();
      const entry = index.find(e => e.name?.toLowerCase() === name?.toLowerCase());
      if (entry) return await pack.getDocument(entry._id);
    }

    // Create a basic item
    return { name, type: 'loot', system: {} };
  }

  async _onApprove(event) {
    event.preventDefault();
    const proposalId = event.currentTarget.dataset.proposalId;
    if (!proposalId) return;

    try {
      const result = await this.socketClient._sendRequest('char-stat-proposal-resolve', {
        proposalId,
        action: 'approve'
      });

      // Move from pending to resolved
      const idx = this.pendingProposals.findIndex(p => p.proposalId === proposalId);
      if (idx >= 0) {
        const proposal = this.pendingProposals.splice(idx, 1)[0];
        proposal.status = 'approved';
        proposal.resolvedAt = new Date().toISOString();
        this.resolvedProposals.unshift(proposal);
      }

      this._pendingCount = this.pendingProposals.length;
      this._updateBadge();
      if (this.rendered) this.render(false);

      ui.notifications.info(`Approved changes for ${result.actorName || 'character'}`);
    } catch (err) {
      ui.notifications.error(`Failed to approve: ${err.message}`);
    }
  }

  async _onReject(event) {
    event.preventDefault();
    const proposalId = event.currentTarget.dataset.proposalId;
    if (!proposalId) return;

    try {
      const result = await this.socketClient._sendRequest('char-stat-proposal-resolve', {
        proposalId,
        action: 'reject'
      });

      const idx = this.pendingProposals.findIndex(p => p.proposalId === proposalId);
      if (idx >= 0) {
        const proposal = this.pendingProposals.splice(idx, 1)[0];
        proposal.status = 'rejected';
        proposal.resolvedAt = new Date().toISOString();
        this.resolvedProposals.unshift(proposal);
      }

      this._pendingCount = this.pendingProposals.length;
      this._updateBadge();
      if (this.rendered) this.render(false);

      ui.notifications.info(`Rejected changes for ${result.actorName || 'character'}`);
    } catch (err) {
      ui.notifications.error(`Failed to reject: ${err.message}`);
    }
  }

  async _onRefresh(event) {
    event.preventDefault();
    await this.loadProposals();
    if (this.rendered) this.render(false);
  }

  /**
   * Load pending proposals from server.
   */
  async loadProposals() {
    try {
      const result = await this.socketClient._sendRequest('list-pending-proposals', {});
      this.pendingProposals = (result.proposals || []).map(p => ({
        ...p,
        proposalId: p.id || p.proposalId
      }));
      this._pendingCount = this.pendingProposals.length;
      this._updateBadge();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to load proposals:`, err);
    }
  }

  /**
   * Load proposal history from server.
   */
  async loadHistory() {
    try {
      const result = await this.socketClient._sendRequest('list-proposal-history', {});
      this.resolvedProposals = (result.proposals || [])
        .filter(p => p.status !== 'pending')
        .map(p => ({
          ...p,
          proposalId: p.id || p.proposalId
        }));
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to load history:`, err);
    }
  }

  /** Get pending count for badge display */
  get pendingCount() {
    return this._pendingCount;
  }

  /** Update the badge on the toggle button */
  _updateBadge() {
    const badge = document.querySelector('#stat-review-badge');
    if (badge) {
      badge.textContent = this._pendingCount;
      badge.style.display = this._pendingCount > 0 ? 'inline-block' : 'none';
    }
  }
}
