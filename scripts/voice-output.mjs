/**
 * Voice Output Module
 *
 * Listens for canon-published events, fetches TTS audio from the proxy, and
 * plays the resulting MP3 in the local browser. Opt-in per user via the
 * `voiceEnabled` setting. Volume is controlled by the `voiceVolume` setting.
 *
 * Canon publish is a local flow (GM action in chat-handler.mjs) rather than a
 * server-pushed event. Injection happens via game.loremaster.voiceOutput exposed
 * on the global game object; chat-handler.mjs calls _handleCanonPublished()
 * directly after publishToCanon() succeeds.
 *
 * Audio URL resolution: the proxy returns a path like /audio/<world>/<id>?token=...
 * which is relative to the proxy host — not the Foundry server. _resolveAudioUrl()
 * prepends the proxy origin (derived from the configured proxyUrl ws/wss setting)
 * so the browser fetches audio from the correct host.
 */

import { getSetting } from './config.mjs';

const MODULE_ID = 'loremaster';

export class VoiceOutput {
  /**
   * Create a VoiceOutput instance.
   *
   * @param {SocketClient} socketClient - Connected socket client used to request TTS audio.
   */
  constructor(socketClient) {
    /** @type {SocketClient} */
    this.socketClient = socketClient;

    /**
     * Map of canonId → HTMLAudioElement for currently playing audio.
     * Used by stopAll() to pause any in-flight playback.
     * @type {Map<string, HTMLAudioElement>}
     */
    this.activeAudios = new Map();

    /**
     * Whether this instance has already been initialized.
     * Prevents double-subscription if initialize() is called again after a
     * Foundry world reload within the same module lifecycle.
     * @type {boolean}
     */
    this.subscribed = false;
  }

  /**
   * Subscribe to canon-published events via a callback property on the socket client.
   * Safe to call multiple times — the subscribed flag prevents duplicate wiring.
   */
  initialize() {
    if (this.subscribed) return;
    this.subscribed = true;

    console.log(`${MODULE_ID} | Voice output initialized`);
  }

  /**
   * Handle a canon-published event. Called directly by chat-handler.mjs after
   * a response is successfully published to canon.
   *
   * Exits early if the user has not opted in to voice output (voiceEnabled setting).
   *
   * @param {object} canonEvent - Canon event data.
   * @param {string} canonEvent.canonId - Server-assigned UUID for the canon entry.
   * @param {string} canonEvent.text - Plain text content of the canon entry.
   */
  async _handleCanonPublished({ canonId, text }) {
    if (getSetting('voiceEnabled') !== true) return;
    if (!canonId || !text) return;

    let result;
    try {
      result = await this.socketClient.requestTTS(canonId, text);
    } catch (err) {
      this._notifyVoiceUnavailable(err);
      return;
    }

    if (!result?.audioUrl) return;

    this._play(canonId, this._resolveAudioUrl(result.audioUrl));
  }

  /**
   * Resolve a potentially relative audio URL against the proxy origin.
   *
   * The proxy returns paths like /audio/<world>/<id>?token=... which are
   * relative to the proxy host, not Foundry's host. This converts the
   * configured proxyUrl (a WebSocket URL) to an HTTP origin and prepends it.
   *
   * @param {string} audioUrl - URL returned by the proxy (may be relative or absolute).
   * @returns {string} Fully-qualified URL safe to pass to new Audio().
   */
  _resolveAudioUrl(audioUrl) {
    if (!audioUrl.startsWith('/')) return audioUrl;

    const proxyUrl = getSetting('proxyUrl') || '';
    const httpProxyUrl = proxyUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
      .replace(/\/socket\/websocket$/, '')
      .replace(/\/$/, '');

    return `${httpProxyUrl}${audioUrl}`;
  }

  /**
   * Instantiate and play an HTMLAudioElement for the given canon entry.
   * Respects the voiceVolume setting (default 0.8). Tracks the audio
   * instance in activeAudios so stopAll() can interrupt it if needed.
   *
   * @param {string} canonId - Canon message UUID (used as map key).
   * @param {string} audioUrl - Fully-qualified audio URL to play.
   */
  _play(canonId, audioUrl) {
    const audio = new Audio(audioUrl);
    audio.volume = getSetting('voiceVolume') ?? 0.8;
    audio.controls = false;
    audio.preload = 'auto';

    audio.addEventListener('ended', () => {
      this.activeAudios.delete(canonId);
    });

    audio.addEventListener('error', (e) => {
      console.warn(`${MODULE_ID} | Audio playback error for ${canonId}:`, e);
      this.activeAudios.delete(canonId);
    });

    this.activeAudios.set(canonId, audio);

    audio.play().catch((err) => {
      console.warn(`${MODULE_ID} | Audio autoplay blocked: ${err.message}`);
    });
  }

  /**
   * Inject a "replay audio" icon on canon messages whose audio is cached on the proxy.
   * Called from the renderChatMessageHTML hook in loremaster.mjs whenever a canon
   * message is rendered (including on initial load and after world reloads).
   *
   * The check is intentionally lightweight — getTTSStatus() asks the proxy whether
   * the MP3 is already cached and returns immediately without triggering generation.
   * If the proxy is unavailable or the audio is not cached, the function exits
   * silently so the chat message renders normally.
   *
   * The replay button click calls requestTTS() which, because the audio is cached,
   * returns the URL immediately without a second ElevenLabs call.
   *
   * NOTE: voiceEnabled is NOT checked here — the icon appears for all users whose
   * canon entry has cached audio. Auto-play is gated by voiceEnabled in
   * _handleCanonPublished(). The replay button is an explicit user opt-in action.
   *
   * @param {ChatMessage} message - The Foundry chat message being rendered.
   * @param {HTMLElement|jQuery} html - The rendered HTML element (V13+: HTMLElement).
   */
  async decorateChatMessage(message, html) {
    if (!message.flags?.loremaster?.isCanon) return;

    // Use the server-assigned canonId if present, fall back to the Foundry message id.
    const canonId = message.flags.loremaster.canonId || message.id;

    let status;
    try {
      status = await this.socketClient.getTTSStatus(canonId);
    } catch {
      return;
    }

    if (!status?.cached) return;

    // Build the replay button using safe DOM construction (no innerHTML).
    const replayBtn = document.createElement('button');
    replayBtn.classList.add('lm-replay-audio');
    replayBtn.title = 'Replay audio';

    const icon = document.createElement('i');
    icon.classList.add('fas', 'fa-play-circle');
    replayBtn.appendChild(icon);

    replayBtn.addEventListener('click', async () => {
      const text = message.content || '';
      let result;
      try {
        result = await this.socketClient.requestTTS(canonId, text);
      } catch (err) {
        this._notifyVoiceUnavailable(err);
        return;
      }
      if (result?.audioUrl) this._play(canonId, this._resolveAudioUrl(result.audioUrl));
    });

    // Support both V13 HTMLElement and older jQuery-wrapped elements.
    const element = html instanceof HTMLElement ? html : html?.[0];
    element?.querySelector('.message-content')?.appendChild(replayBtn);
  }

  /**
   * Stop all currently playing audio immediately.
   * Pauses each active HTMLAudioElement and clears the tracking map.
   */
  stopAll() {
    for (const audio of this.activeAudios.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.activeAudios.clear();
  }

  /**
   * Surface TTS errors to the user when appropriate.
   * Rate-limit errors are shown as UI warnings; other failures are console-only
   * to avoid spamming players with technical errors.
   *
   * @param {Error} err - The error from requestTTS().
   */
  _notifyVoiceUnavailable(err) {
    const msg = err?.message || 'Voice service unavailable';
    if (msg.includes('rate-limit')) {
      ui.notifications.warn(`Loremaster: ${msg}`);
    } else {
      console.warn(`${MODULE_ID} | TTS request failed: ${msg}`);
    }
  }
}
