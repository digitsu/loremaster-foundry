/**
 * voice-input.mjs
 *
 * Voice input: push-to-talk button in the chat sidebar that runs the browser's
 * SpeechRecognition API and writes the transcript into the chat input field.
 * No auto-send — the user reviews and hits Enter.
 *
 * Supports two activation modes controlled by the `pttMode` setting:
 *   - "hold"   : hold the button (or hotkey) to record, release to stop
 *   - "toggle" : click/press once to start, again to stop
 *
 * The hotkey is configurable via the `pttHotkey` setting (default "v").
 * The hotkey listener is suppressed when focus is inside an input or textarea
 * so that normal typing is never intercepted.
 */

import { getSetting } from './config.mjs';

/** Foundry module identifier, used for console log prefixes. */
const MODULE_ID = 'loremaster';

/**
 * Browser SpeechRecognition constructor, normalised across vendor prefixes.
 * Will be null in Firefox/Safari where the API is unsupported.
 *
 * @type {typeof SpeechRecognition | null}
 */
const Recognition =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

/**
 * VoiceInput
 *
 * Injects a push-to-talk (PTT) microphone button into the chat sidebar and
 * manages a SpeechRecognition session.  Transcripts are written into the chat
 * input field without being submitted automatically.
 */
export class VoiceInput {
  constructor() {
    /** @type {SpeechRecognition | null} Active recognition session, if any. */
    this.recognition = null;

    /** @type {boolean} Whether a recognition session is currently active. */
    this.isRecording = false;

    /** @type {HTMLElement | null} The injected PTT button element. */
    this.button = null;

    /**
     * @type {boolean} Whether the microphone-permission dialog has already been
     * shown this session (prevents duplicate dialogs on repeated denials).
     */
    this.permissionWarned = false;
  }

  /**
   * Wire Foundry hooks and global keyboard listeners.
   * Call this once from the `ready` hook (or equivalent) after Foundry is up.
   *
   * @returns {void}
   */
  initialize() {
    Hooks.on('renderChatLog', (app, html) => this._injectButton(html));
    document.addEventListener('keydown', (e) => this._onKeyDown(e));
    document.addEventListener('keyup', (e) => this._onKeyUp(e));
  }

  // ---------------------------------------------------------------------------
  // Private — DOM injection
  // ---------------------------------------------------------------------------

  /**
   * Inject the PTT button into the chat controls toolbar.
   * Safe to call multiple times — guards against double-injection.
   *
   * @param {HTMLElement | jQuery} html - The rendered ChatLog HTML root.
   * @returns {void}
   */
  _injectButton(_html) {
    // Foundry V13: #chat-controls lives outside the ChatLog application's root
    // element (it's a sibling, not a descendant), so querying within the hook's
    // html parameter returns null. Document-level lookup works regardless of
    // where #chat-controls sits in the DOM tree since the id is globally unique.
    const chatControls = document.querySelector('#chat-controls');
    if (!chatControls || chatControls.querySelector('.lm-ptt-btn')) return;

    const btn = document.createElement('a');
    btn.classList.add('lm-ptt-btn');

    const icon = document.createElement('i');

    if (!Recognition) {
      // Feature-detect failure path: show a disabled slash-mic icon with tooltip
      btn.classList.add('lm-ptt-disabled');
      btn.title = game.i18n.localize('LOREMASTER.Voice.PTT.NotSupported');
      icon.classList.add('fas', 'fa-microphone-slash');
    } else {
      btn.title = game.i18n.localize('LOREMASTER.Voice.PTT.Label');
      icon.classList.add('fas', 'fa-microphone');
      btn.addEventListener('mousedown', () => this._start());
      btn.addEventListener('mouseup', () => this._stop());
      // Stop recording when the pointer leaves the button in hold mode so the
      // session does not linger if the user drags off the element.
      btn.addEventListener('mouseleave', () => this._stop());
    }

    btn.appendChild(icon);
    chatControls.prepend(btn);
    this.button = btn;
  }

  // ---------------------------------------------------------------------------
  // Private — SpeechRecognition lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start a new SpeechRecognition session.
   * No-ops if the API is unavailable or a session is already active.
   *
   * @returns {void}
   */
  _start() {
    if (!Recognition || this.isRecording) return;

    this.recognition = new Recognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = navigator.language || 'en-US';

    this.recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) this._writeToChatInput(transcript);
    };

    this.recognition.onerror = (event) => this._handleError(event);

    this.recognition.onend = () => {
      this.isRecording = false;
      this.button?.classList.remove('lm-ptt-active');
    };

    try {
      this.recognition.start();
      this.isRecording = true;
      this.button?.classList.add('lm-ptt-active');
    } catch (err) {
      console.warn(`${MODULE_ID} | SpeechRecognition.start failed:`, err);
    }
  }

  /**
   * Stop the active SpeechRecognition session.
   * No-ops if no session is running.
   *
   * @returns {void}
   */
  _stop() {
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
    }
  }

  // ---------------------------------------------------------------------------
  // Private — transcript handling
  // ---------------------------------------------------------------------------

  /**
   * Write a transcript string into the Foundry chat input field.
   * Appends to any existing text with a single space separator.
   * Focuses the input so the user can review and press Enter.
   *
   * @param {string} transcript - The recognised speech text to insert.
   * @returns {void}
   */
  _writeToChatInput(transcript) {
    const input = document.querySelector('#chat-message');
    if (!input) return;

    if (input.value.trim()) {
      input.value = `${input.value} ${transcript}`;
    } else {
      input.value = transcript;
    }
    input.focus();
  }

  // ---------------------------------------------------------------------------
  // Private — error handling
  // ---------------------------------------------------------------------------

  /**
   * Handle SpeechRecognition error events.
   * Shows a one-time permission-denied dialog; logs other errors to console.
   *
   * @param {SpeechRecognitionErrorEvent} event - The error event from the API.
   * @returns {void}
   */
  _handleError(event) {
    if (event.error === 'not-allowed') {
      if (!this.permissionWarned) {
        this.permissionWarned = true;
        const dialog = new Dialog({
          title: game.i18n.localize('LOREMASTER.Voice.PermissionDenied.Title'),
          content: this._buildPermissionContent(),
          buttons: { ok: { label: 'OK' } }
        });
        dialog.render(true);
      }
    } else if (event.error !== 'no-speech') {
      // 'no-speech' is expected when the user holds the button without speaking;
      // suppress it to avoid noisy console output during normal usage.
      console.warn(`${MODULE_ID} | SpeechRecognition error: ${event.error}`);
    }
  }

  /**
   * Build the HTML content string for the microphone permission-denied dialog.
   * Constructs DOM nodes via textContent to avoid XSS from i18n string injection.
   *
   * @returns {string} An outerHTML string suitable for Dialog#content.
   */
  _buildPermissionContent() {
    const wrapper = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = game.i18n.localize('LOREMASTER.Voice.PermissionDenied.Body');
    wrapper.appendChild(p);
    return wrapper.outerHTML;
  }

  // ---------------------------------------------------------------------------
  // Private — keyboard hotkey handling
  // ---------------------------------------------------------------------------

  /**
   * Handle keydown events for the configured PTT hotkey.
   * In "hold" mode, starts recording on press; in "toggle" mode, flips state.
   *
   * @param {KeyboardEvent} event - The keydown event.
   * @returns {void}
   */
  _onKeyDown(event) {
    if (this._matchesHotkey(event)) {
      const mode = getSetting('pttMode');
      if (mode === 'hold') {
        this._start();
      } else if (mode === 'toggle') {
        if (this.isRecording) this._stop();
        else this._start();
      }
    }
  }

  /**
   * Handle keyup events for the configured PTT hotkey.
   * Stops recording in "hold" mode on key release.
   *
   * @param {KeyboardEvent} event - The keyup event.
   * @returns {void}
   */
  _onKeyUp(event) {
    if (this._matchesHotkey(event) && getSetting('pttMode') === 'hold') {
      this._stop();
    }
  }

  /**
   * Check whether a keyboard event matches the configured PTT hotkey.
   * Returns false when focus is inside an input or textarea to prevent
   * intercepting normal text entry (e.g. typing "v" in the chat box).
   *
   * @param {KeyboardEvent} event - The keyboard event to test.
   * @returns {boolean} True if this event should trigger PTT behaviour.
   */
  _matchesHotkey(event) {
    if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return false;
    const hotkey = (getSetting('pttHotkey') || 'v').toLowerCase();
    return event.key.toLowerCase() === hotkey;
  }
}
