/**
 * Status Bar Component
 *
 * Displays a persistent, compact status bar showing Loremaster's connection
 * state at a glance. Positioned below the Foundry navigation bar, it provides
 * instant feedback about server connectivity, tier, and quota.
 *
 * States: connected, connecting, disconnected, reconnecting, auth-required, disabled
 *
 * Usage:
 *   import { statusBar } from './status-bar.mjs';
 *   statusBar.initialize();
 *   statusBar.setConnected('Pro', 1200000, 2000000);
 *   statusBar.setDisconnected();
 */

const MODULE_ID = 'loremaster';

/**
 * State configuration mapping.
 * Each state defines its CSS class, icon, and i18n key for display text.
 *
 * @type {Object<string, {cssClass: string, icon: string, i18nKey: string, fallback: string, expanded: boolean}>}
 */
const STATE_CONFIG = {
  connected: {
    cssClass: 'loremaster-status--connected',
    icon: 'fas fa-circle',
    i18nKey: 'LOREMASTER.Connection.Connected',
    fallback: 'Connected',
    expanded: false
  },
  connecting: {
    cssClass: 'loremaster-status--connecting',
    icon: 'fas fa-spinner fa-spin',
    i18nKey: 'LOREMASTER.Connection.Connecting',
    fallback: 'Connecting...',
    expanded: true
  },
  disconnected: {
    cssClass: 'loremaster-status--disconnected',
    icon: 'fas fa-circle',
    i18nKey: 'LOREMASTER.Connection.Disconnected',
    fallback: 'Disconnected',
    expanded: true
  },
  reconnecting: {
    cssClass: 'loremaster-status--reconnecting',
    icon: 'fas fa-spinner fa-spin',
    i18nKey: 'LOREMASTER.Connection.Reconnecting',
    fallback: 'Reconnecting...',
    expanded: true
  },
  'auth-required': {
    cssClass: 'loremaster-status--auth-required',
    icon: 'fas fa-lock',
    i18nKey: 'LOREMASTER.Connection.AuthRequired',
    fallback: 'Sign in required',
    expanded: true
  },
  disabled: {
    cssClass: 'loremaster-status--disabled',
    icon: 'fas fa-circle',
    i18nKey: 'LOREMASTER.Connection.Disabled',
    fallback: 'Disabled',
    expanded: false
  }
};

/**
 * StatusBar class manages a persistent connection status indicator.
 * Follows the same pattern as ProgressBar: creates a DOM element in initialize(),
 * toggles visibility/state with methods. Singleton instance exported as `statusBar`.
 *
 * The bar also exposes a small dropdown menu (opened via a caret button) that
 * hosts auxiliary toggles such as the "Hear AI voice" toggle. The existing
 * click-to-expand behaviour on the bar itself is preserved unchanged.
 */
export class StatusBar {
  /**
   * Create a new StatusBar instance.
   */
  constructor() {
    /** @type {HTMLElement|null} The root DOM element */
    this.element = null;
    /** @type {string} Current state key from STATE_CONFIG */
    this.currentState = 'disabled';
    /** @type {boolean} Whether the bar is manually collapsed */
    this.collapsed = false;
    /** @type {number|null} Auto-collapse timer ID */
    this.collapseTimer = null;
    /** @type {string} Detail text (tier + quota summary) */
    this.detailText = '';
    /** @type {HTMLElement|null} The dropdown menu panel element */
    this._menuEl = null;
    /** @type {boolean} Whether the dropdown menu is currently open */
    this._menuOpen = false;
  }

  /**
   * Initialize the status bar element in the DOM.
   * Should be called once in the Foundry 'ready' hook.
   *
   * Builds the bar content using safe DOM construction. A small caret button
   * on the right side opens the dropdown menu without interfering with the
   * existing click-to-expand behaviour on the rest of the bar.
   */
  initialize() {
    // Create the status bar container
    this.element = document.createElement('div');
    this.element.id = 'loremaster-status-bar';
    this.element.className = 'loremaster-status-bar loremaster-status--disabled loremaster-status--collapsed';

    // Build inner content using safe DOM construction (no innerHTML for user data)
    const content = document.createElement('div');
    content.className = 'loremaster-status-content';

    const wizardIcon = document.createElement('i');
    wizardIcon.className = 'fas fa-hat-wizard loremaster-status-icon';

    const label = document.createElement('span');
    label.className = 'loremaster-status-label';
    label.textContent = 'Loremaster';

    const stateSpan = document.createElement('span');
    stateSpan.className = 'loremaster-status-state';

    const detailSpan = document.createElement('span');
    detailSpan.className = 'loremaster-status-detail';

    // Caret button — opens the dropdown menu without triggering bar expand/collapse
    const caretBtn = document.createElement('button');
    caretBtn.className = 'loremaster-status-menu-btn';
    caretBtn.title = 'Loremaster options';
    caretBtn.type = 'button';
    const caretIcon = document.createElement('i');
    caretIcon.className = 'fas fa-caret-down';
    caretBtn.appendChild(caretIcon);
    caretBtn.addEventListener('click', (ev) => {
      ev.stopPropagation(); // prevent bar-level click-to-expand
      this._toggleMenu();
    });

    content.append(wizardIcon, label, stateSpan, detailSpan, caretBtn);
    this.element.appendChild(content);

    // Click handler on bar body: toggle expand/collapse or open settings if auth-required
    this.element.addEventListener('click', () => {
      // Close the dropdown if it is open
      if (this._menuOpen) {
        this._closeMenu();
        return;
      }
      if (this.currentState === 'auth-required') {
        game.settings.sheet.render(true);
        return;
      }
      this.collapsed = !this.collapsed;
      this._updateCollapsed();
    });

    // Close menu when clicking anywhere outside the status bar
    document.addEventListener('click', (ev) => {
      if (this._menuOpen && this.element && !this.element.contains(ev.target)) {
        this._closeMenu();
      }
    });

    // Insert into the DOM — after #navigation if it exists, else top of body
    const nav = document.getElementById('navigation');
    if (nav && nav.parentElement) {
      nav.parentElement.insertBefore(this.element, nav.nextSibling);
    } else {
      document.body.insertBefore(this.element, document.body.firstChild);
    }

    // Inject CSS styles
    this._injectStyles();

    console.log(`${MODULE_ID} | Status bar initialized`);
  }

  /**
   * Set status to "connected" with tier and quota info.
   *
   * @param {string} tierName - The user's tier name (e.g., 'Pro').
   * @param {number} tokensUsed - Tokens used this month.
   * @param {number} tokensLimit - Monthly token limit.
   */
  setConnected(tierName, tokensUsed, tokensLimit) {
    const usedStr = this._formatTokens(tokensUsed);
    const limitStr = this._formatTokens(tokensLimit);
    this.detailText = `${tierName} · ${usedStr} / ${limitStr}`;
    this._setState('connected');

    // Auto-collapse after 5 seconds
    this._startAutoCollapse();
  }

  /**
   * Set status to "connecting".
   */
  setConnecting() {
    this.detailText = '';
    this._setState('connecting');
  }

  /**
   * Set status to "disconnected".
   */
  setDisconnected() {
    this.detailText = '';
    this._setState('disconnected');
  }

  /**
   * Set status to "reconnecting" with attempt counter.
   *
   * @param {number} attempt - Current reconnect attempt number.
   * @param {number} max - Maximum reconnect attempts.
   */
  setReconnecting(attempt, max) {
    const text = game.i18n?.format('LOREMASTER.Connection.ReconnectAttempt', { attempt, max })
      || `Reconnecting (${attempt}/${max})...`;
    this.detailText = '';
    this._setState('reconnecting', text);
  }

  /**
   * Set status to "auth-required" (clicking opens settings).
   */
  setAuthRequired() {
    this.detailText = '';
    this._setState('auth-required');
  }

  /**
   * Set status to "disabled" (module off).
   */
  setDisabled() {
    this.detailText = '';
    this._setState('disabled');
  }

  /**
   * Update the status bar's internal state and DOM.
   *
   * @param {string} state - State key from STATE_CONFIG.
   * @param {string|null} customText - Optional override for the state text.
   * @private
   */
  _setState(state, customText = null) {
    if (!this.element) return;

    const config = STATE_CONFIG[state];
    if (!config) return;

    // Clear auto-collapse timer
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }

    this.currentState = state;

    // Remove all state classes, then add the new one
    for (const s of Object.values(STATE_CONFIG)) {
      this.element.classList.remove(s.cssClass);
    }
    this.element.classList.add(config.cssClass);

    // Update icon
    const iconEl = this.element.querySelector('.loremaster-status-icon');
    if (iconEl) {
      // Keep the wizard hat as the main icon, state icon goes in state element
    }

    // Update state text
    const stateEl = this.element.querySelector('.loremaster-status-state');
    if (stateEl) {
      const stateIcon = document.createElement('i');
      stateIcon.className = config.icon;
      const stateText = customText || game.i18n?.localize(config.i18nKey) || config.fallback;
      stateEl.innerHTML = '';
      stateEl.appendChild(stateIcon);
      stateEl.appendChild(document.createTextNode(' ' + stateText));
    }

    // Update detail text
    const detailEl = this.element.querySelector('.loremaster-status-detail');
    if (detailEl) {
      detailEl.textContent = this.detailText;
    }

    // Expand for non-stable states, respect collapsed for stable states
    if (config.expanded) {
      this.collapsed = false;
    }
    this._updateCollapsed();
  }

  /**
   * Start the auto-collapse timer (5 seconds after connected).
   *
   * @private
   */
  _startAutoCollapse() {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
    }
    this.collapsed = false;
    this._updateCollapsed();

    this.collapseTimer = setTimeout(() => {
      this.collapseTimer = null;
      this.collapsed = true;
      this._updateCollapsed();
    }, 5000);
  }

  /**
   * Update the collapsed/expanded CSS class on the element.
   *
   * @private
   */
  _updateCollapsed() {
    if (!this.element) return;
    if (this.collapsed) {
      this.element.classList.add('loremaster-status--collapsed');
    } else {
      this.element.classList.remove('loremaster-status--collapsed');
    }
  }

  /**
   * Format token count with K/M suffix for display.
   *
   * @param {number} num - Token count.
   * @returns {string} Formatted string (e.g., '1.2M', '500K').
   * @private
   */
  _formatTokens(num) {
    if (!num || num <= 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return String(num);
  }

  /**
   * Toggle the dropdown menu open or closed.
   *
   * @private
   */
  _toggleMenu() {
    if (this._menuOpen) {
      this._closeMenu();
    } else {
      this._openMenu();
    }
  }

  /**
   * Open the dropdown menu, building (or rebuilding) its contents first.
   *
   * @private
   */
  _openMenu() {
    // Remove any stale menu element
    if (this._menuEl && this._menuEl.parentElement) {
      this._menuEl.parentElement.removeChild(this._menuEl);
    }
    this._menuEl = this._buildMenu();
    this.element.appendChild(this._menuEl);
    this._menuOpen = true;

    // Rotate caret to indicate open state
    const caret = this.element.querySelector('.loremaster-status-menu-btn i');
    if (caret) caret.className = 'fas fa-caret-up';
  }

  /**
   * Close the dropdown menu and remove it from the DOM.
   *
   * @private
   */
  _closeMenu() {
    if (this._menuEl && this._menuEl.parentElement) {
      this._menuEl.parentElement.removeChild(this._menuEl);
    }
    this._menuEl = null;
    this._menuOpen = false;

    // Restore caret icon
    const caret = this.element.querySelector('.loremaster-status-menu-btn i');
    if (caret) caret.className = 'fas fa-caret-down';
  }

  /**
   * Build the dropdown menu element and populate it with menu items.
   * Currently includes the "Hear AI voice" toggle. Additional items can be
   * appended here in future tasks.
   *
   * @returns {HTMLElement} The constructed menu panel element.
   * @private
   */
  _buildMenu() {
    const menu = document.createElement('div');
    menu.className = 'lm-statusbar-menu';

    menu.appendChild(this._buildVoiceToggle());

    return menu;
  }

  /**
   * Build a menu item that toggles the "Hear AI voice" (`voiceEnabled`) setting.
   *
   * Reads the current value of `game.settings.get('loremaster', 'voiceEnabled')`,
   * renders the correct icon and on/off label, and wires a click handler that:
   *   1. Flips the setting.
   *   2. Calls `game.loremaster.voiceOutput.stopAll()` if toggling off.
   *   3. Rebuilds the menu so the new state is reflected immediately.
   *
   * All DOM construction uses createElement / classList / textContent — no innerHTML.
   *
   * @returns {HTMLElement} The constructed menu item element.
   * @private
   */
  _buildVoiceToggle() {
    const enabled = game.settings.get('loremaster', 'voiceEnabled');

    const item = document.createElement('div');
    item.classList.add('lm-statusbar-menu-item', 'lm-voice-toggle');

    const icon = document.createElement('i');
    icon.classList.add('fas', enabled ? 'fa-volume-up' : 'fa-volume-mute');

    const label = document.createElement('span');
    label.textContent = game.i18n.localize('LOREMASTER.Voice.Toggle.Label');

    const state = document.createElement('span');
    state.classList.add('lm-toggle-state');
    state.textContent = enabled ? 'on' : 'off';

    item.append(icon, label, state);

    item.addEventListener('click', async (ev) => {
      ev.stopPropagation(); // prevent the bar's document-level close handler firing first
      const next = !game.settings.get('loremaster', 'voiceEnabled');
      await game.settings.set('loremaster', 'voiceEnabled', next);
      if (!next) {
        game.loremaster?.voiceOutput?.stopAll();
      }
      // Rebuild the menu in-place so the icon and state label reflect the new value
      this._openMenu();
    });

    return item;
  }

  /**
   * Inject CSS styles for the status bar into the document.
   * Uses Foundry CSS variables for theming.
   *
   * @private
   */
  _injectStyles() {
    if (document.getElementById('loremaster-status-bar-styles')) return;

    const style = document.createElement('style');
    style.id = 'loremaster-status-bar-styles';
    style.textContent = `
      /* Status Bar Container */
      .loremaster-status-bar {
        position: fixed;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 90;
        background: rgba(26, 26, 46, 0.85);
        border: 1px solid rgba(201, 132, 26, 0.3);
        border-radius: 16px;
        cursor: pointer;
        user-select: none;
        transition: all 0.3s ease;
        backdrop-filter: blur(4px);
        overflow: hidden;
        max-width: 400px;
      }

      .loremaster-status-bar:hover {
        background: rgba(26, 26, 46, 0.95);
        border-color: rgba(201, 132, 26, 0.6);
      }

      /* Collapsed state — show only the wizard hat icon */
      .loremaster-status-bar.loremaster-status--collapsed .loremaster-status-label,
      .loremaster-status-bar.loremaster-status--collapsed .loremaster-status-state,
      .loremaster-status-bar.loremaster-status--collapsed .loremaster-status-detail {
        width: 0;
        opacity: 0;
        overflow: hidden;
        margin: 0;
        padding: 0;
      }

      .loremaster-status-bar:hover .loremaster-status-label,
      .loremaster-status-bar:hover .loremaster-status-state,
      .loremaster-status-bar:hover .loremaster-status-detail {
        width: auto;
        opacity: 1;
        margin-left: 0;
      }

      /* Content layout */
      .loremaster-status-content {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        font-size: 0.75rem;
        white-space: nowrap;
      }

      /* Wizard hat icon */
      .loremaster-status-icon {
        color: #d4af37;
        font-size: 0.85rem;
        flex-shrink: 0;
      }

      /* Label */
      .loremaster-status-label {
        color: #d4af37;
        font-weight: 600;
        font-size: 0.75rem;
        transition: width 0.3s ease, opacity 0.3s ease;
      }

      /* State text */
      .loremaster-status-state {
        font-size: 0.75rem;
        font-weight: 500;
        transition: width 0.3s ease, opacity 0.3s ease;
      }

      .loremaster-status-state i {
        font-size: 0.5rem;
        vertical-align: middle;
        margin-right: 3px;
      }

      /* Detail text (tier + quota) */
      .loremaster-status-detail {
        color: var(--color-text-dark-secondary, #7a7971);
        font-size: 0.7rem;
        transition: width 0.3s ease, opacity 0.3s ease;
      }

      /* === State Colors === */

      /* Connected — green dot */
      .loremaster-status--connected .loremaster-status-state {
        color: #4ade80;
      }
      .loremaster-status--connected .loremaster-status-state i {
        color: #4ade80;
      }

      /* Connecting — yellow spinner */
      .loremaster-status--connecting .loremaster-status-state {
        color: #fbbf24;
      }

      /* Disconnected — red dot */
      .loremaster-status--disconnected .loremaster-status-state {
        color: #f87171;
      }
      .loremaster-status--disconnected .loremaster-status-state i {
        color: #f87171;
      }

      /* Reconnecting — yellow spinner */
      .loremaster-status--reconnecting .loremaster-status-state {
        color: #fbbf24;
      }

      /* Auth required — orange lock */
      .loremaster-status--auth-required .loremaster-status-state {
        color: #fb923c;
      }
      .loremaster-status--auth-required {
        border-color: rgba(251, 146, 60, 0.4);
      }

      /* Disabled — grey */
      .loremaster-status--disabled .loremaster-status-state {
        color: #6b7280;
      }
      .loremaster-status--disabled .loremaster-status-state i {
        color: #6b7280;
      }
      .loremaster-status--disabled {
        opacity: 0.6;
      }

      /* === Caret / menu button === */

      .loremaster-status-menu-btn {
        background: none;
        border: none;
        padding: 0 2px;
        margin-left: 2px;
        cursor: pointer;
        color: rgba(212, 175, 55, 0.6);
        font-size: 0.7rem;
        line-height: 1;
        flex-shrink: 0;
        transition: color 0.2s ease;
      }
      .loremaster-status-menu-btn:hover {
        color: #d4af37;
      }

      /* === Dropdown menu panel === */

      .lm-statusbar-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(26, 26, 46, 0.97);
        border: 1px solid rgba(201, 132, 26, 0.4);
        border-radius: 8px;
        padding: 4px 0;
        min-width: 180px;
        z-index: 91;
        backdrop-filter: blur(4px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      }

      /* === Menu items === */

      .lm-statusbar-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 0.75rem;
        color: #c9c9b8;
        white-space: nowrap;
        transition: background 0.15s ease;
      }
      .lm-statusbar-menu-item:hover {
        background: rgba(201, 132, 26, 0.15);
        color: #d4af37;
      }
      .lm-statusbar-menu-item i {
        width: 14px;
        text-align: center;
        color: #d4af37;
        font-size: 0.8rem;
      }
      .lm-statusbar-menu-item span {
        flex: 1;
      }
      .lm-statusbar-menu-item .lm-toggle-state {
        flex: none;
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        color: #6b7280;
        letter-spacing: 0.05em;
      }
      .lm-voice-toggle .lm-toggle-state {
        color: #6b7280;
      }
      .lm-voice-toggle:has(i.fa-volume-up) .lm-toggle-state {
        color: #4ade80;
      }
    `;

    document.head.appendChild(style);
  }
}

/** Singleton StatusBar instance for module-wide use */
export const statusBar = new StatusBar();
