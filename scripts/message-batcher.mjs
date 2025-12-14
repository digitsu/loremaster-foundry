/**
 * Loremaster Message Batcher
 *
 * Handles collection and batching of multiple player messages
 * before sending them to Claude as simultaneous actions.
 * Supports both timer-based and manual (GM-triggered) modes.
 */

import { getSetting } from './config.mjs';
import { PlayerContext } from './player-context.mjs';

const MODULE_ID = 'loremaster';

/**
 * MessageBatcher class manages the message collection and batching logic.
 */
export class MessageBatcher {
  /**
   * Create a new MessageBatcher instance.
   *
   * @param {Object} options - Configuration options.
   * @param {Function} options.onBatchReady - Callback when batch is ready to send.
   * @param {Function} options.onBatchUpdate - Callback when batch contents change.
   * @param {Function} options.onTimerTick - Callback for timer updates.
   */
  constructor(options = {}) {
    this.onBatchReady = options.onBatchReady || (() => {});
    this.onBatchUpdate = options.onBatchUpdate || (() => {});
    this.onTimerTick = options.onTimerTick || (() => {});

    this.messages = [];
    this.gmRulings = [];
    this.timer = null;
    this.timerStartTime = null;
    this.isCollecting = false;
    this.batchId = null;
  }

  /**
   * Add a message to the current batch.
   *
   * @param {string} content - The message content.
   * @param {Object} userContext - The player context from PlayerContext.getUserContext().
   * @returns {boolean} True if message was added, false if batch was sent immediately.
   */
  addMessage(content, userContext) {
    const gmRulingPrefix = getSetting('gmRulingPrefix');

    // Check if this is a GM ruling
    if (userContext.isGM && PlayerContext.isGMRuling(content, gmRulingPrefix)) {
      const rulingContent = PlayerContext.extractRulingContent(content, gmRulingPrefix);
      this.gmRulings.push({
        content: rulingContent,
        userId: userContext.userId,
        userName: userContext.userName,
        timestamp: Date.now()
      });

      console.log(`${MODULE_ID} | GM ruling added to batch`);
      this._notifyUpdate();
      return true;
    }

    // Check for GM send keyword (manual mode immediate send)
    const gmSendKeyword = getSetting('gmSendKeyword');
    if (userContext.isGM && content.trim() === gmSendKeyword) {
      console.log(`${MODULE_ID} | GM triggered immediate send`);
      this.sendNow();
      return false;
    }

    // Format and add the message
    const formattedMessage = PlayerContext.formatMessageWithContext({
      content,
      userContext,
      timestamp: Date.now()
    });

    this.messages.push(formattedMessage);
    console.log(`${MODULE_ID} | Message added to batch (${this.messages.length} total)`);

    // Start collection if not already collecting
    if (!this.isCollecting) {
      this._startCollection();
    } else {
      // Reset timer if in timer mode (extend window for new messages)
      const batchingMode = getSetting('batchingMode');
      if (batchingMode === 'timer') {
        this._resetTimer();
      }
    }

    this._notifyUpdate();
    return true;
  }

  /**
   * Start the collection window.
   *
   * @private
   */
  _startCollection() {
    this.isCollecting = true;
    this.batchId = this._generateBatchId();

    const batchingMode = getSetting('batchingMode');

    if (batchingMode === 'timer') {
      this._startTimer();
    }

    console.log(`${MODULE_ID} | Started batch collection (mode: ${batchingMode})`);
    this._notifyUpdate();
  }

  /**
   * Start or restart the collection timer.
   *
   * @private
   */
  _startTimer() {
    this._clearTimer();

    const duration = getSetting('batchTimerDuration') * 1000;
    this.timerStartTime = Date.now();

    // Set up the completion timer
    this.timer = setTimeout(() => {
      this._onTimerComplete();
    }, duration);

    // Set up tick updates (every second)
    this._tickInterval = setInterval(() => {
      const elapsed = Date.now() - this.timerStartTime;
      const remaining = Math.max(0, duration - elapsed);
      this.onTimerTick(Math.ceil(remaining / 1000));
    }, 100);

    console.log(`${MODULE_ID} | Timer started (${duration / 1000}s)`);
  }

  /**
   * Reset the timer (extends window for new messages).
   *
   * @private
   */
  _resetTimer() {
    console.log(`${MODULE_ID} | Timer reset`);
    this._startTimer();
  }

  /**
   * Clear the current timer.
   *
   * @private
   */
  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  /**
   * Handle timer completion.
   *
   * @private
   */
  _onTimerComplete() {
    console.log(`${MODULE_ID} | Timer completed, sending batch`);
    this._sendBatch();
  }

  /**
   * Immediately send the current batch (GM action or timer completion).
   */
  sendNow() {
    if (this.messages.length === 0 && this.gmRulings.length === 0) {
      console.log(`${MODULE_ID} | No messages to send`);
      return;
    }

    this._clearTimer();
    this._sendBatch();
  }

  /**
   * Clear the current batch without sending.
   */
  clearBatch() {
    this._clearTimer();
    this.messages = [];
    this.gmRulings = [];
    this.isCollecting = false;
    this.batchId = null;
    this.timerStartTime = null;

    console.log(`${MODULE_ID} | Batch cleared`);
    this._notifyUpdate();
  }

  /**
   * Send the current batch.
   *
   * @private
   */
  _sendBatch() {
    const batch = {
      id: this.batchId,
      messages: [...this.messages],
      gmRulings: [...this.gmRulings],
      formattedPrompt: PlayerContext.formatBatchForClaude(this.messages, this.gmRulings),
      timestamp: Date.now()
    };

    // Reset state
    this.messages = [];
    this.gmRulings = [];
    this.isCollecting = false;
    this.batchId = null;
    this.timerStartTime = null;

    console.log(`${MODULE_ID} | Batch sent with ${batch.messages.length} messages and ${batch.gmRulings.length} rulings`);

    // Notify listeners
    this.onBatchReady(batch);
    this._notifyUpdate();
  }

  /**
   * Notify listeners of batch state changes.
   *
   * @private
   */
  _notifyUpdate() {
    this.onBatchUpdate({
      isCollecting: this.isCollecting,
      messageCount: this.messages.length,
      rulingCount: this.gmRulings.length,
      messages: [...this.messages],
      gmRulings: [...this.gmRulings],
      batchId: this.batchId
    });
  }

  /**
   * Generate a unique batch ID.
   *
   * @returns {string} A unique batch identifier.
   * @private
   */
  _generateBatchId() {
    return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get the current batch state.
   *
   * @returns {Object} Current batch state.
   */
  getState() {
    return {
      isCollecting: this.isCollecting,
      messageCount: this.messages.length,
      rulingCount: this.gmRulings.length,
      messages: [...this.messages],
      gmRulings: [...this.gmRulings],
      batchId: this.batchId,
      mode: getSetting('batchingMode'),
      timerDuration: getSetting('batchTimerDuration')
    };
  }

  /**
   * Check if currently collecting messages.
   *
   * @returns {boolean} True if collection is active.
   */
  isActive() {
    return this.isCollecting;
  }

  /**
   * Get the number of messages in the current batch.
   *
   * @returns {number} Message count.
   */
  getMessageCount() {
    return this.messages.length + this.gmRulings.length;
  }

  /**
   * Cleanup resources.
   */
  destroy() {
    this._clearTimer();
    this.messages = [];
    this.gmRulings = [];
    this.isCollecting = false;
  }
}
