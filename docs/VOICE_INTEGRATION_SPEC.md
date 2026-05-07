# Voice Integration — v1 MVP Design Spec

**Status**: Approved design, pending implementation plan.
**Date**: 2026-05-07
**Scope target**: ~1 week of implementation work (mid-tier MVP).
**Owner**: Jerry Chan.

---

## 1. Goal

Add bidirectional voice to Loremaster sessions:

- **TTS (Loremaster speaks)**: ElevenLabs-quality narration of published canon, played in the browsers of opted-in users.
- **STT (players/GM speak)**: browser Web Speech API turns push-to-talk audio into chat input. The GM/player reviews the transcript and hits Enter — no auto-send.

The MVP delivers a single voice for all AI output, deliberately defers per-NPC voices, dialogue segmentation, streaming TTS, and Whisper-via-proxy STT to v2.

## 2. Non-goals (v1)

These are explicitly excluded so v1 fits the time budget:

- Per-NPC voice profiles or dialogue segmentation.
- Streaming TTS (audio playback chunked as Claude generates).
- Whisper or Deepgram-based STT through the proxy. v1 is browser STT only — Firefox and Safari users see a greyed-out PTT button.
- Voice cloning for player characters.
- Retroactive audio for old canon.
- Audio export / canon journal export including audio.
- Live captions while audio plays.
- Multi-language voice routing.
- "Always-on" listening or wake-word triggering.
- Real-time bidirectional voice without the publish gate.

## 3. High-level architecture

```
┌──────────────────────────────────────┐    ┌──────────────────────────┐
│  Foundry browser (per user)          │    │  Elixir proxy            │
│                                      │    │                          │
│  ┌────────────────────────────────┐  │    │  ┌─────────────────────┐ │
│  │ voice-input.mjs (NEW)          │  │    │  │ TTSManager (NEW)    │ │
│  │   PTT button + Web Speech API  │──┼────┼─▶│   ElevenLabs client │ │
│  │   transcript → chat input      │  │    │  │   MP3 cache (FS)    │ │
│  └────────────────────────────────┘  │    │  │   per-canon dedup   │ │
│                                      │    │  └─────────────────────┘ │
│  ┌────────────────────────────────┐  │    │           ▲              │
│  │ voice-output.mjs (NEW)         │◀─┼────┼───────────┘              │
│  │   listens for canon events     │  │    │  request-tts handler     │
│  │   if voiceEnabled, fetch audio │  │    │  serves /audio/<id>.mp3  │
│  │   <audio> playback element     │  │    │                          │
│  └────────────────────────────────┘  │    │  ElevenLabs API key:     │
│                                      │    │   • hosted = OPERATOR    │
│  Settings (NEW keys):                │    │   • self-host = client   │
│    voiceEnabled (per user)           │    │     supplies via auth    │
│    elevenLabsApiKey (self-host only) │    │                          │
│    pttHotkey (default V)             │    └──────────────────────────┘
│    voiceId (default Rachel)          │
└──────────────────────────────────────┘
                 │
                 │  Web Speech API (free, in-browser)
                 ▼
            (no provider call for STT)
```

**Layer summary**:

| Layer | New thing | Existing thing it touches |
|---|---|---|
| Client | `scripts/voice-input.mjs` (PTT + STT), `scripts/voice-output.mjs` (canon → audio playback) | `chat-handler.mjs` (canon-publish event hook), `config.mjs` (settings registration), `status-bar.mjs` (voice toggle menu item) |
| Proxy | `LoremasterProxy.Services.TTSManager` (ElevenLabs client + MP3 cache), `request-tts` handler in `WorldChannel` | `ConversationServer` (canon publish event), `UsageLog` resource (new `audio_chars_consumed` column) |
| Storage | MP3 files keyed by canon message ID, on filesystem under `/data/audio/<world_id>/<canon_id>.mp3` | reuses the same docker volume the PDF cache lives on |

## 4. Data flow

### 4.1 Canon publish → opted-in client → audio playback

```
GM clicks Publish
   │
   ▼
chat-handler.mjs publishes canon
   │
   ▼ (Phoenix push: 'canon-published')
proxy → all clients in world
   │
   ▼
each client's voice-output.mjs receives 'canon-published' event
   │
   ▼
   if (getSetting('voiceEnabled') !== true) { return }    // most users stop here
   │
   ▼ (Phoenix request: 'request-tts' with canonId)
proxy WorldChannel.handle_in("request-tts", %{canonId: id}, socket)
   │
   ▼
TTSManager.fetch_or_generate(canonId, text, api_key)
   │   │
   │   ├─ cache hit  → return file path
   │   │
   │   └─ cache miss → ElevenLabs streaming TTS API
   │                   → write MP3 to cache/<world_id>/<canonId>.mp3
   │                   → return file path
   │
   ▼
proxy serves /audio/<canonId>.mp3 via Plug.Static (signed URL)
   │
   ▼
client receives { audioUrl: "https://proxy/audio/..." }
   │
   ▼
voice-output.mjs creates <audio> element with controls, plays
   │
   ▼
playback complete or user stops via standard browser controls
```

### 4.2 Three load-bearing behaviors

1. **Cache-first dedup**: MP3 keyed by canon UUID. Two opted-in clients in the same world both fire `request-tts`; the second one hits cache. No double-billing for the same canon entry.
2. **No cache warming**: if zero clients are opted in, TTS is never called. Canon stays text-only on the wire. ElevenLabs is touched only when a real listener exists.
3. **Per-world cache namespacing**: cache path is `/data/audio/<world_id>/<canon_id>.mp3` to match the multi-tenant pattern already used for PDFs.

### 4.3 STT flow

```
GM/player holds PTT hotkey (default 'V')
   │
   ▼
voice-input.mjs starts SpeechRecognition (Web Speech API)
   │
   ▼ (release hotkey)
recognition.stop() → transcript fires
   │
   ▼
chat-input field.value = transcript
   │
   ▼ (no auto-send — user reviews + hits Enter)
existing chat path takes over (@lm parsing, batch, etc.)
```

Zero proxy involvement. Web Speech API is supported in Chrome, Edge, and Chromium derivatives. Firefox and Safari fall back to a greyed-out mic button with a tooltip.

### 4.4 Authentication for ElevenLabs

| Mode | Key source | Sent how | Bill goes to |
|---|---|---|---|
| Hosted | `OPERATOR_ELEVENLABS_API_KEY` env var on proxy | Read from app config server-side | Operator (Patreon revenue absorbs) |
| Self-hosted | `getSetting('elevenLabsApiKey')` from GM's Foundry settings | Sent in `phx_join` payload alongside Claude apiKey | User |

Pattern matches the existing Claude apiKey handling. No new auth concepts.

## 5. New components

### 5.1 Client modules

#### `scripts/voice-input.mjs` (~150 LOC)

**Responsibilities**:
- Inject PTT mic button into the chat input toolbar via `renderChatLog` hook.
- Listen for `pttHotkey` keydown/keyup (configurable, default `V`).
- Run `webkitSpeechRecognition` / `SpeechRecognition` while held.
- On release, populate the chat input field with the transcript. Do not send.
- Feature-detect Web Speech API availability; grey out button + tooltip on unsupported browsers.
- Handle mic permission denial with a one-time explanatory dialog.

**Exports**: `initializeVoiceInput()`, `registerVoiceInputHelpers()`.

**Depends on**: `config.mjs` (for hotkey + mode settings), `game.i18n` (for UI strings).

#### `scripts/voice-output.mjs` (~250 LOC)

**Responsibilities**:
- Listen for `canon-published` socket events from the proxy.
- Gate on `getSetting('voiceEnabled')` — return early if false.
- Send `request-tts` Phoenix request with the canon ID; receive an audio URL.
- Create a `<audio controls>` element bound to the canon message DOM node.
- Auto-play once on first arrival; subsequent listens are user-initiated.
- Add a "replay" icon to past canon messages whose audio is cached (call `tts-status` to check).
- Provide a "stop all voice" handler for the status bar toggle.

**Exports**: `initializeVoiceOutput()`, `registerVoiceOutputHelpers()`.

**Depends on**: `socket-client.mjs`, `config.mjs`, `chat-handler.mjs` (canon DOM hooks).

### 5.2 Proxy modules

#### `LoremasterProxy.Services.TTSManager`

**Responsibilities**:
- `fetch_or_generate(canon_id, text, api_key, opts) :: {:ok, path} | {:error, reason}`.
- Cache lookup by `canon_id` first.
- On miss: HTTP POST to ElevenLabs `/v1/text-to-speech/{voice_id}` with `output_format: mp3_44100_128`.
- Write MP3 to `/data/audio/<world_id>/<canon_id>.mp3`.
- Log `audio_chars_consumed` against the requesting user via `UsageLog`.
- Emit telemetry: `[:loremaster, :tts, :request]`, `[:loremaster, :tts, :response]`, `[:loremaster, :tts, :error]`.

**API surface**: pure functions for the cache + HTTP path. ElevenLabs HTTP via the existing Finch pool. **One small GenServer** — `TTSGenerationLock` — serializes concurrent generations of the same canon ID so two simultaneous opted-in clients don't both bill ElevenLabs for the same canon entry. The lock keys by `{world_id, canon_id}`; the second arrival waits on a `Task.await` for the first to finish and is then served from cache.

#### `WorldChannel` handlers (extend existing module)

Add three message types to the existing channel:

- `handle_in("request-tts", %{"canonId" => id}, socket)` — primary entry point.
- `handle_in("tts-status", %{"canonId" => id}, socket)` — replies `{:ok, %{cached: true | false}}`. Used on chat-log render to decide whether to show the replay-audio icon next to a past canon message. Cheap (single filesystem stat). Clients may batch by sending a list of canon IDs and getting a map back; v1 does it one at a time for simplicity.
- Push event `tts-audio-ready` is *not* sent eagerly — clients pull. Could be added in v1.1 if telemetry shows pull latency hurts UX.

### 5.3 Static asset routing

`Plug.Static` mounted at `/audio/` reading from `/data/audio/`. URLs are signed with a short TTL (15 min) using `Phoenix.Token` so they can't be guessed by canon ID.

## 6. Settings and UI

### 6.1 New settings (registered in `config.mjs`)

| Key | Scope | Type | Default | Visible when |
|---|---|---|---|---|
| `voiceEnabled` | per-user (client) | bool | `false` | always |
| `elevenLabsApiKey` | per-world (GM only) | string | `""` | self-hosted mode only (hidden in hosted) |
| `voiceId` | per-world (GM only) | string | `"Rachel"` | always |
| `pttHotkey` | per-user (client) | string | `"v"` | always |
| `pttMode` | per-user (client) | enum: `hold`/`toggle` | `hold` | always |
| `voiceVolume` | per-user (client) | number 0–1 | `0.8` | always |

### 6.2 UI placement

| Element | Location | Owning module |
|---|---|---|
| Push-to-talk mic button | Chat input toolbar, left of send | `voice-input.mjs` |
| "Hear AI voice" toggle | Status bar dropdown menu | `voice-output.mjs` |
| Volume slider | Settings panel `## Voice` section | `config.mjs` settings render hook |
| Replay-audio icon on past canon | `renderChatMessageHTML` extension | `voice-output.mjs` |
| Provider settings (API key, voice ID) | Settings panel `## Voice` section | `config.mjs` settings render hook |
| "STT not supported" greyed indicator | Inside the PTT button | `voice-input.mjs` feature detect |

No new top-level scene-control button — voice is ambient to chat, not a scene tool.

### 6.3 i18n keys

New `LOREMASTER.Voice.*` namespace in `lang/en.json`:
- `Voice.Toggle.Label` — "Hear AI voice"
- `Voice.PTT.Label` — "Push to talk"
- `Voice.PTT.NotSupported` — "Voice input requires Chrome or Edge."
- `Voice.PermissionDenied.Title` — "Microphone access denied"
- `Voice.PermissionDenied.Body` — "Loremaster needs microphone access for push-to-talk. Enable it in your browser site settings and reload."
- `Voice.SettingsHeader` — "## Voice"
- `Voice.Provider.ApiKey` — "ElevenLabs API key"
- `Voice.Provider.VoiceId` — "Voice ID"
- `Voice.Volume` — "Voice volume"
- `Voice.Hotkey` — "Push-to-talk key"
- `Voice.Hotkey.Mode.Hold` — "Hold to talk"
- `Voice.Hotkey.Mode.Toggle` — "Press to start/stop"

## 7. Error handling matrix

| Failure | Behavior | Notes |
|---|---|---|
| ElevenLabs API key invalid (self-hosted) | Settings panel notice; silent on canon publish | Reuse the existing "set your API key" pattern from the Claude-key flow. |
| ElevenLabs API key missing (hosted/operator) | Server logs error, silent client-side | Ops issue, not user issue. Surface in the proxy `/health` JSON. |
| ElevenLabs returns 429 | Retry once with 2s backoff, then silent fallback | Tier-1 cap is generous; rare. |
| ElevenLabs 5xx / network timeout | Silent fallback, friendly toast: "Voice unavailable, try again" | 30s timeout on TTS calls. |
| Cache write fails (disk full) | Log warning, serve audio inline (no caching) | Audio still works for the requesting client. |
| Browser doesn't support Web Speech API | PTT button greyed out with tooltip | Documented in README. v2 can add Whisper-via-proxy. |
| Mic permission denied | First denial: explanatory dialog; subsequent: button shows "Mic permission needed" | Standard browser permissions UX. |
| TTS request for non-existent canon ID | 404 from proxy, client logs warn, no crash | Defensive only. |

## 8. Quota and telemetry

### 8.1 Hosted mode

- Add `audio_chars_consumed` column to `UsageLog` Ash resource.
- Each TTSManager generation logs the char count against the requesting user.
- **No per-tier audio cap in v1** — see §9.

### 8.2 Self-hosted mode

- TTSManager logs char counts to the same column for ops visibility, but no quota gate. User pays their own ElevenLabs bill.

### 8.3 Telemetry

Existing `:telemetry` pattern, three new events:

- `[:loremaster, :tts, :request]` — counts cache hits vs ElevenLabs calls (metadata: `cache_hit`, `world_id`)
- `[:loremaster, :tts, :response]` — duration (metadata: `chars`, `voice_id`)
- `[:loremaster, :tts, :error]` — error class (metadata: `error_type`, `provider`)

These feed into existing dashboards / log aggregation without new infrastructure.

## 9. v1 cost model: live experiment, not a guess

ElevenLabs at $180/1M chars × ~28k chars/heavy-session is a known unit cost. What we **do not know** yet:

- How many users actually opt in (default-off helps, but real adoption rate is unknown).
- How many opt-in users listen to all canon vs cherry-pick the dramatic moments.
- How many sessions per month a typical voice user runs.

Rather than guess and pre-build a per-tier cap, **v1 deliberately ships with no cap and three cost-saving features baked into the architecture**:

1. **Default-off opt-in** — most users won't trigger TTS at all.
2. **Lazy on-demand generation** — zero cost when no listener is online.
3. **Per-canon MP3 cache dedup** — multiple listeners on the same canon entry pay once.

Day-1 telemetry on `audio_chars_consumed` per user feeds a 30-day review. If real-world numbers stay sane → consider adding a soft cap in v1.1 with data behind it. If they don't → cap immediately as a hot-patch (the cap mechanism itself is small; v1 omits it deliberately).

## 10. Browser support matrix

| Browser | TTS playback | STT (Web Speech API) | Notes |
|---|---|---|---|
| Chrome (desktop) | ✅ | ✅ | Primary target. |
| Chrome (Android) | ✅ | ✅ | Works but PTT hotkey needs an on-screen button. |
| Edge | ✅ | ✅ | Same as Chrome. |
| Brave / Vivaldi / Arc | ✅ | ✅ | Chromium-based. |
| Firefox | ✅ | ❌ | TTS playback works (it's just `<audio>`); STT button greyed out. |
| Safari (desktop) | ✅ | ❌ | Same as Firefox. |
| Safari (iOS) | ✅ | ❌ | Same. Mobile Foundry usage is low-priority anyway. |

## 11. Implementation phasing (high level)

The writing-plans skill will produce a detailed plan; this is a pre-sketch:

1. **Proxy backbone** (~2 days)
   - `TTSManager` module with ElevenLabs client + cache
   - `request-tts` and `tts-status` handlers in `WorldChannel`
   - `audio_chars_consumed` migration on `UsageLog`
   - Plug.Static + signed-URL audio serving
   - Tests against an ElevenLabs sandbox key

2. **Client output** (~1.5 days)
   - `voice-output.mjs`: socket listener, audio fetch, playback element
   - Settings registration for `voiceEnabled` + `voiceId` + `voiceVolume`
   - Status bar voice-toggle menu item
   - Replay icon on past canon

3. **Client input** (~1 day)
   - `voice-input.mjs`: PTT button injection, Web Speech API plumbing
   - Settings registration for `pttHotkey` + `pttMode`
   - Feature-detect + Firefox/Safari fallback UI

4. **Self-hosted key path** (~0.5 day)
   - Settings panel `elevenLabsApiKey` field, hidden in hosted mode
   - Auth payload extension to send the key on `phx_join`
   - Proxy fallback to operator key when client-supplied key is empty

5. **Polish + i18n** (~1 day)
   - All `LOREMASTER.Voice.*` strings wired through `game.i18n`
   - README updates for new settings + browser support matrix
   - End-to-end smoke test with a real ElevenLabs key on dev

**Total**: ~6 working days. Buffer to one calendar week.

## 12. Dependencies and risks

- **External**: ElevenLabs API SLA. Fallback is silent — an outage degrades voice but doesn't break chat.
- **Browser**: Web Speech API non-portability (Firefox/Safari). Documented limitation; v2 adds proxy-routed STT.
- **Cost**: addressed in §9 via live-experiment framing.
- **Concurrency**: cache write race when two opted-in clients request the same brand-new canon ID simultaneously. Mitigation: `TTSManager` uses a per-canon-ID lock (Erlang `:global` or a small GenServer registry) so only the first request actually generates; the second waits on the same future.
- **Disk space**: ~100-500KB per canon entry × N canons × M worlds. Rough cap of 2GB/world before manual cleanup. Add a TTL-based or LRU sweeper in v1.1; v1 just monitors.

---

## Acceptance criteria

A v1 ship is acceptable when **all** of these are true on the dev proxy:

1. A self-hosted Foundry user with a valid ElevenLabs key can hold the PTT hotkey, speak, and see their transcript appear in the chat input field.
2. The same user, with `voiceEnabled = true`, hears Claude's published canon spoken by the configured voice.
3. A second user in the same world, also `voiceEnabled = true`, hears the same canon entry without billing a second ElevenLabs request (verifiable via `[:loremaster, :tts, :request]` telemetry showing one miss + one hit).
4. A third user with `voiceEnabled = false` does not download or generate audio (verifiable: no `request-tts` event from that client in the proxy log).
5. A Firefox user sees the PTT button greyed out with the documented tooltip; Loremaster otherwise functions normally.
6. A user with an invalid ElevenLabs key (self-hosted) sees a settings notice and no audio plays; no client-side crash.
7. Past canon messages with cached audio show a replay icon that plays the cached MP3 with no new ElevenLabs charge.
8. Telemetry events fire for at least: cache hit, cache miss, ElevenLabs error, total chars consumed per user.

---

*End of design. Implementation plan produced via the `writing-plans` skill.*
