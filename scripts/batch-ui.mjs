/**
 * Loremaster Batch UI
 *
 * Provides the visual interface for batch message collection,
 * including the floating indicator panel and GM controls.
 */

import { getSetting } from './config.mjs';
import { PlayerContext } from './player-context.mjs';

const MODULE_ID = 'loremaster';

/**
 * BatchUI class manages the batch collection indicator and controls.
 */
export class BatchUI {
  /**
   * Create a new BatchUI instance.
   *
   * @param {Object} options - Configuration options.
   * @param {Function} options.onSendNow - Callback for send now button.
   * @param {Function} options.onClear - Callback for clear button.
   */
  constructor(options = {}) {
    this.onSendNow = options.onSendNow || (() => {});
    this.onClear = options.onClear || (() => {});

    this.element = null;
    this.isVisible = false;
    this.currentState = null;
    this.timerValue = 0;
  }

  /**
   * Initialize the UI component.
   * Creates the DOM element and attaches event listeners.
   */
  initialize() {
    this._createIndicator();
    console.log(`${MODULE_ID} | Batch UI initialized`);
  }

  /**
   * Create the batch indicator DOM element.
   *
   * @private
   */
  _createIndicator() {
    // Remove existing element if present
    if (this.element) {
      this.element.remove();
    }

    // Create the indicator panel
    this.element = document.createElement('div');
    this.element.className = 'loremaster-batch-indicator hidden';
    this.element.innerHTML = this._getIndicatorHTML();

    // Attach to document
    document.body.appendChild(this.element);

    // Set up event listeners
    this._attachEventListeners();
  }

  /**
   * Get the HTML template for the indicator.
   *
   * @returns {string} HTML string.
   * @private
   */
  _getIndicatorHTML() {
    return `
      <div class="loremaster-batch-header">
        <div>
          <div class="loremaster-batch-title">
            ${game.i18n?.localize('LOREMASTER.Batch.Title') || 'Collecting Messages'}
            <span class="loremaster-batch-count">0</span>
          </div>
          <div class="loremaster-batch-mode"></div>
        </div>
        <div class="loremaster-batch-timer">--</div>
      </div>
      <div class="loremaster-batch-messages">
        <div class="loremaster-batch-empty">
          ${game.i18n?.localize('LOREMASTER.Batch.Empty') || 'Waiting for player messages...'}
        </div>
      </div>
      <div class="loremaster-batch-controls">
        <button class="loremaster-send-now-btn" type="button">
          ${game.i18n?.localize('LOREMASTER.Batch.SendNow') || 'Send Now'}
        </button>
        <button class="loremaster-clear-batch-btn" type="button">
          ${game.i18n?.localize('LOREMASTER.Batch.Clear') || 'Clear'}
        </button>
      </div>
    `;
  }

  /**
   * Attach event listeners to the indicator buttons.
   *
   * @private
   */
  _attachEventListeners() {
    const sendBtn = this.element.querySelector('.loremaster-send-now-btn');
    const clearBtn = this.element.querySelector('.loremaster-clear-batch-btn');

    if (sendBtn) {
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onSendNow();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.onClear();
      });
    }
  }

  /**
   * Update the indicator with new batch state.
   *
   * @param {Object} state - The batch state from MessageBatcher.
   */
  updateState(state) {
    this.currentState = state;

    // Check if indicator should be shown
    const showIndicator = getSetting('showBatchIndicator');
    const isGM = game.user?.isGM;

    if (!showIndicator || !state.isCollecting) {
      this.hide();
      return;
    }

    this.show();
    this._updateContent(state);
  }

  /**
   * Update the timer display.
   *
   * @param {number} seconds - Remaining seconds.
   */
  updateTimer(seconds) {
    this.timerValue = seconds;
    const timerEl = this.element?.querySelector('.loremaster-batch-timer');
    if (timerEl) {
      timerEl.textContent = `${seconds}s`;
    }
  }

  /**
   * Update the indicator content.
   *
   * @param {Object} state - The batch state.
   * @private
   */
  _updateContent(state) {
    if (!this.element) return;

    // Update message count badge
    const countEl = this.element.querySelector('.loremaster-batch-count');
    if (countEl) {
      const total = state.messageCount + state.rulingCount;
      countEl.textContent = total;
    }

    // Update mode display
    const modeEl = this.element.querySelector('.loremaster-batch-mode');
    if (modeEl) {
      const mode = getSetting('batchingMode');
      const modeText = mode === 'timer'
        ? (game.i18n?.localize('LOREMASTER.Batch.TimerMode') || 'Timer Mode')
        : (game.i18n?.localize('LOREMASTER.Batch.ManualMode') || 'Manual Mode');
      modeEl.textContent = modeText;
    }

    // Update timer display based on mode
    const timerEl = this.element.querySelector('.loremaster-batch-timer');
    if (timerEl) {
      const mode = getSetting('batchingMode');
      if (mode === 'manual') {
        timerEl.textContent = '--';
      }
      // Timer mode updates are handled by updateTimer()
    }

    // Update message list
    this._updateMessageList(state);

    // Update button states (only GM can send/clear)
    this._updateButtonStates();
  }

  /**
   * Update the message list display.
   *
   * @param {Object} state - The batch state.
   * @private
   */
  _updateMessageList(state) {
    const messagesEl = this.element?.querySelector('.loremaster-batch-messages');
    if (!messagesEl) return;

    const allMessages = [...state.messages, ...state.gmRulings.map(r => ({
      ...r,
      isGMRuling: true
    }))];

    if (allMessages.length === 0) {
      messagesEl.innerHTML = `
        <div class="loremaster-batch-empty">
          ${game.i18n?.localize('LOREMASTER.Batch.Empty') || 'Waiting for player messages...'}
        </div>
      `;
      return;
    }

    // Sort by timestamp
    allMessages.sort((a, b) => a.timestamp - b.timestamp);

    // Render messages
    messagesEl.innerHTML = allMessages.map(msg => this._renderMessage(msg)).join('');
  }

  /**
   * Render a single message in the list.
   *
   * @param {Object} msg - The message object.
   * @returns {string} HTML string.
   * @private
   */
  _renderMessage(msg) {
    const isGM = msg.isGM || msg.isGMRuling;
    const classes = ['loremaster-batch-message'];
    if (isGM) classes.push('is-gm');
    if (msg.isGMRuling) classes.push('gm-ruling');

    const playerName = msg.userName || 'Unknown';
    const characterName = msg.characterName;

    // Truncate long messages for display
    const maxLength = 80;
    const displayContent = msg.content.length > maxLength
      ? msg.content.substring(0, maxLength) + '...'
      : msg.content;

    return `
      <div class="${classes.join(' ')}">
        <div class="player-name">${this._escapeHtml(playerName)}</div>
        ${characterName ? `<div class="character-name">as ${this._escapeHtml(characterName)}</div>` : ''}
        <div class="message-content">${this._escapeHtml(displayContent)}</div>
      </div>
    `;
  }

  /**
   * Update button states based on user permissions.
   *
   * @private
   */
  _updateButtonStates() {
    const sendBtn = this.element?.querySelector('.loremaster-send-now-btn');
    const clearBtn = this.element?.querySelector('.loremaster-clear-batch-btn');
    const isGM = game.user?.isGM;

    // Only GM can use controls in manual mode, or override in timer mode
    if (sendBtn) {
      sendBtn.disabled = !isGM;
      sendBtn.title = isGM ? '' : 'Only the GM can send messages';
    }

    if (clearBtn) {
      clearBtn.disabled = !isGM;
      clearBtn.title = isGM ? '' : 'Only the GM can clear the batch';
    }
  }

  /**
   * Show the indicator panel.
   */
  show() {
    if (this.element && !this.isVisible) {
      this.element.classList.remove('hidden');
      this.isVisible = true;
    }
  }

  /**
   * Hide the indicator panel.
   */
  hide() {
    if (this.element && this.isVisible) {
      this.element.classList.add('hidden');
      this.isVisible = false;
    }
  }

  /**
   * Toggle the indicator visibility.
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Escape HTML special characters.
   *
   * @param {string} text - Text to escape.
   * @returns {string} Escaped text.
   * @private
   */
  _escapeHtml(text) {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, char => escapeMap[char]);
  }

  /**
   * Clean up resources.
   */
  destroy() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
    this.isVisible = false;
  }
}

/**
 * Create and show a veto dialog for GM to correct an AI response.
 *
 * @param {Object} options - Dialog options.
 * @param {string} options.messageId - The message ID being vetoed.
 * @param {Function} options.onSubmit - Callback with correction text.
 * @returns {Promise} Resolves when dialog is closed.
 */
export async function showVetoDialog(options = {}) {
  return new Promise((resolve, reject) => {
    const title = game.i18n?.localize('LOREMASTER.Veto.DialogTitle') || 'Veto AI Response';
    const label = game.i18n?.localize('LOREMASTER.Veto.CorrectionLabel') || 'What should be corrected?';
    const placeholder = game.i18n?.localize('LOREMASTER.Veto.CorrectionPlaceholder') ||
      'Explain what was wrong and how the AI should adjust its response...';
    const submitText = game.i18n?.localize('LOREMASTER.Veto.Submit') || 'Submit Correction';
    const cancelText = game.i18n?.localize('LOREMASTER.Veto.Cancel') || 'Cancel';

    const content = `
      <div class="loremaster-veto-dialog">
        <label for="veto-correction">${label}</label>
        <textarea id="veto-correction" placeholder="${placeholder}"></textarea>
      </div>
    `;

    new Dialog({
      title: title,
      content: content,
      buttons: {
        submit: {
          icon: '<i class="fas fa-check"></i>',
          label: submitText,
          callback: (html) => {
            html = $(html); // Ensure jQuery for Foundry v12 compatibility
            const correction = html.find('#veto-correction').val()?.trim();
            if (correction) {
              options.onSubmit?.(correction);
              resolve(correction);
            } else {
              ui.notifications?.warn('Please provide a correction.');
              reject(new Error('No correction provided'));
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: cancelText,
          callback: () => {
            resolve(null);
          }
        }
      },
      default: 'submit',
      close: () => {
        resolve(null);
      }
    }).render(true);
  });
}

/**
 * Add veto controls to an AI response message.
 *
 * @param {HTMLElement} messageElement - The chat message element.
 * @param {string} messageId - The message database ID.
 * @param {Function} onVeto - Callback when veto is clicked.
 * @param {Function} onRegenerate - Callback when regenerate is clicked.
 */
export function addVetoControls(messageElement, messageId, onVeto, onRegenerate) {
  // Only show for GM
  if (!game.user?.isGM) return;

  // Check if controls already exist
  if (messageElement.querySelector('.loremaster-response-controls')) return;

  const vetoText = game.i18n?.localize('LOREMASTER.Veto.Button') || 'Veto';
  const regenText = game.i18n?.localize('LOREMASTER.Veto.Regenerate') || 'Regenerate';

  const controlsHtml = `
    <div class="loremaster-response-controls">
      <button class="loremaster-veto-btn" type="button" data-message-id="${messageId}">
        <i class="fas fa-times-circle"></i> ${vetoText}
      </button>
      <button class="loremaster-regenerate-btn" type="button" data-message-id="${messageId}">
        <i class="fas fa-redo"></i> ${regenText}
      </button>
    </div>
  `;

  // Find the message content and append controls
  const contentEl = messageElement.querySelector('.message-content') ||
                    messageElement.querySelector('.loremaster-response');
  if (contentEl) {
    contentEl.insertAdjacentHTML('afterend', controlsHtml);

    // Attach event listeners
    const vetoBtn = messageElement.querySelector('.loremaster-veto-btn');
    const regenBtn = messageElement.querySelector('.loremaster-regenerate-btn');

    if (vetoBtn) {
      vetoBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const correction = await showVetoDialog({
          messageId: messageId,
          onSubmit: (text) => onVeto?.(messageId, text)
        });
      });
    }

    if (regenBtn) {
      regenBtn.addEventListener('click', (e) => {
        e.preventDefault();
        onRegenerate?.(messageId);
      });
    }
  }
}
