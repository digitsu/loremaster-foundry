/**
 * Loremaster Message Batcher
 *
 * Handles collection and batching of multiple player messages
 * before sending them to Claude as simultaneous actions.
 * Supports both timer-based and manual (GM-triggered) modes.
 *
 * Uses Foundry sockets for multi-client synchronization:
 * - GM client is the "authority" and manages the actual batch state/timer
 * - Player clients are "followers" and receive state updates via socket
 */

import { getSetting } from './config.mjs';
import { PlayerContext } from './player-context.mjs';

const MODULE_ID = 'loremaster';
const SOCKET_NAME = `module.${MODULE_ID}`;

/**
 * MessageBatcher class manages the message collection and batching logic.
 * Supports GM-coordinated synchronization across multiple clients.
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
    this.timerDuration = null;
    this.isCollecting = false;
    this.batchId = null;

    // Authority mode: GM manages state, players follow
    this.isAuthority = false;
    this.socketInitialized = false;
  }

  /**
   * Initialize socket handlers for multi-client synchronization.
   * Must be called after Foundry's game.socket is available.
   */
  initializeSocket() {
    if (this.socketInitialized) return;

    // Determine authority based on GM status
    this.isAuthority = game.user.isGM;

    // Register socket event handlers
    game.socket.on(SOCKET_NAME, (data) => {
      this._handleSocketEvent(data);
    });

    this.socketInitialized = true;
    console.log(`${MODULE_ID} | MessageBatcher socket initialized (authority: ${this.isAuthority})`);
  }

  /**
   * Handle incoming socket events.
   *
   * @param {Object} data - Socket event data.
   * @private
   */
  _handleSocketEvent(data) {
    const { event, payload } = data;

    switch (event) {
      case 'batch:add':
        // Only GM handles add events from players
        if (this.isAuthority) {
          this._handleRemoteAdd(payload);
        }
        break;

      case 'batch:state':
        // Only non-GM clients handle state updates
        if (!this.isAuthority) {
          this._handleStateUpdate(payload);
        }
        break;

      case 'batch:timer':
        // Only non-GM clients handle timer updates
        if (!this.isAuthority) {
          this.onTimerTick(payload.seconds);
        }
        break;

      case 'batch:sent':
        // Only non-GM clients handle sent events
        if (!this.isAuthority) {
          this._handleBatchSent();
        }
        break;

      case 'batch:clear':
        // Only non-GM clients handle clear events
        if (!this.isAuthority) {
          this._handleBatchCleared();
        }
        break;
    }
  }

  /**
   * Emit a socket event to all clients.
   *
   * @param {string} event - Event name.
   * @param {Object} payload - Event payload.
   * @private
   */
  _emitSocket(event, payload = {}) {
    game.socket.emit(SOCKET_NAME, { event, payload });
  }

  /**
   * Handle a message add request from a remote player (GM only).
   *
   * @param {Object} payload - Message data from player.
   * @private
   */
  _handleRemoteAdd(payload) {
    const { content, userContext, isGMRuling } = payload;

    if (isGMRuling) {
      // Add GM ruling
      this.gmRulings.push({
        content,
        userId: userContext.userId,
        userName: userContext.userName,
        timestamp: Date.now()
      });
      console.log(`${MODULE_ID} | GM ruling added from remote player`);
    } else {
      // Format and add the message
      const formattedMessage = PlayerContext.formatMessageWithContext({
        content,
        userContext,
        timestamp: Date.now()
      });
      this.messages.push(formattedMessage);
      console.log(`${MODULE_ID} | Message added from remote player (${this.messages.length} total)`);
    }

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
    this._broadcastState();
  }

  /**
   * Handle state update from GM (non-GM clients only).
   *
   * @param {Object} state - Batch state from GM.
   * @private
   */
  _handleStateUpdate(state) {
    this.isCollecting = state.isCollecting;
    this.messages = state.messages || [];
    this.gmRulings = state.gmRulings || [];
    this.batchId = state.batchId;
    this.timerDuration = state.timerDuration;
    this.timerStartTime = state.timerStartTime;

    // Notify UI of state change
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
   * Handle batch sent event (non-GM clients only).
   *
   * @private
   */
  _handleBatchSent() {
    // Clear local state
    this.messages = [];
    this.gmRulings = [];
    this.isCollecting = false;
    this.batchId = null;
    this.timerStartTime = null;
    this.timerDuration = null;

    // Notify UI
    this._notifyUpdate();
    console.log(`${MODULE_ID} | Batch sent (received from GM)`);
  }

  /**
   * Handle batch cleared event (non-GM clients only).
   *
   * @private
   */
  _handleBatchCleared() {
    // Clear local state
    this.messages = [];
    this.gmRulings = [];
    this.isCollecting = false;
    this.batchId = null;
    this.timerStartTime = null;
    this.timerDuration = null;

    // Notify UI
    this._notifyUpdate();
    console.log(`${MODULE_ID} | Batch cleared (received from GM)`);
  }

  /**
   * Broadcast current state to all clients (GM only).
   *
   * @private
   */
  _broadcastState() {
    if (!this.isAuthority) return;

    this._emitSocket('batch:state', {
      isCollecting: this.isCollecting,
      messages: this.messages,
      gmRulings: this.gmRulings,
      batchId: this.batchId,
      timerDuration: this.timerDuration,
      timerStartTime: this.timerStartTime
    });
  }

  /**
   * Add a message to the current batch.
   * For non-GM clients, sends via socket to GM instead of adding locally.
   *
   * @param {string} content - The message content.
   * @param {Object} userContext - The player context from PlayerContext.getUserContext().
   * @returns {boolean} True if message was added/sent, false if batch was sent immediately.
   */
  addMessage(content, userContext) {
    const gmRulingPrefix = getSetting('gmRulingPrefix');
    const isGMRuling = userContext.isGM && PlayerContext.isGMRuling(content, gmRulingPrefix);

    // Check for GM send keyword (manual mode immediate send)
    const gmSendKeyword = getSetting('gmSendKeyword');
    if (userContext.isGM && content.trim() === gmSendKeyword) {
      console.log(`${MODULE_ID} | GM triggered immediate send`);
      this.sendNow();
      return false;
    }

    // If not authority (not GM), send to GM via socket
    if (!this.isAuthority) {
      const rulingContent = isGMRuling
        ? PlayerContext.extractRulingContent(content, gmRulingPrefix)
        : content;

      this._emitSocket('batch:add', {
        content: rulingContent,
        userContext,
        isGMRuling
      });
      console.log(`${MODULE_ID} | Message sent to GM via socket`);
      return true;
    }

    // Authority (GM) handles the message locally
    if (isGMRuling) {
      const rulingContent = PlayerContext.extractRulingContent(content, gmRulingPrefix);
      this.gmRulings.push({
        content: rulingContent,
        userId: userContext.userId,
        userName: userContext.userName,
        timestamp: Date.now()
      });
      console.log(`${MODULE_ID} | GM ruling added to batch`);
    } else {
      // Format and add the message
      const formattedMessage = PlayerContext.formatMessageWithContext({
        content,
        userContext,
        timestamp: Date.now()
      });
      this.messages.push(formattedMessage);
      console.log(`${MODULE_ID} | Message added to batch (${this.messages.length} total)`);
    }

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
    this._broadcastState();
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
    this.timerDuration = duration;

    // Set up the completion timer
    this.timer = setTimeout(() => {
      this._onTimerComplete();
    }, duration);

    // Set up tick updates (every second) - only GM runs real timer
    if (this.isAuthority) {
      this._tickInterval = setInterval(() => {
        const elapsed = Date.now() - this.timerStartTime;
        const remaining = Math.max(0, duration - elapsed);
        const seconds = Math.ceil(remaining / 1000);

        // Local callback
        this.onTimerTick(seconds);

        // Broadcast to other clients
        this._emitSocket('batch:timer', { seconds });
      }, 100);
    }

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
    this._broadcastState(); // Broadcast new timer start time
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
   * Only works for authority (GM) client.
   */
  sendNow() {
    // Only GM can send
    if (!this.isAuthority) {
      console.log(`${MODULE_ID} | Non-GM cannot send batch directly`);
      return;
    }

    if (this.messages.length === 0 && this.gmRulings.length === 0) {
      console.log(`${MODULE_ID} | No messages to send`);
      return;
    }

    this._clearTimer();
    this._sendBatch();
  }

  /**
   * Clear the current batch without sending.
   * Only works for authority (GM) client.
   */
  clearBatch() {
    // Only GM can clear
    if (!this.isAuthority) {
      console.log(`${MODULE_ID} | Non-GM cannot clear batch directly`);
      return;
    }

    this._clearTimer();
    this.messages = [];
    this.gmRulings = [];
    this.isCollecting = false;
    this.batchId = null;
    this.timerStartTime = null;
    this.timerDuration = null;

    console.log(`${MODULE_ID} | Batch cleared`);
    this._notifyUpdate();

    // Broadcast clear event to all clients
    this._emitSocket('batch:clear', {});
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
    this.timerDuration = null;

    console.log(`${MODULE_ID} | Batch sent with ${batch.messages.length} messages and ${batch.gmRulings.length} rulings`);

    // Broadcast sent event to all clients
    this._emitSocket('batch:sent', {});

    // Notify listeners (triggers the actual API call)
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
      timerDuration: getSetting('batchTimerDuration'),
      isAuthority: this.isAuthority
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
   * Check if this client is the authority (GM).
   *
   * @returns {boolean} True if GM.
   */
  isGMAuthority() {
    return this.isAuthority;
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
