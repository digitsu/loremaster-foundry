# Voice Integration v2 — Per-NPC Voices + ElevenLabs Audio Tags

**Status**: Approved design, pending implementation plan.
**Date**: 2026-05-15
**Builds on**: `docs/VOICE_INTEGRATION_SPEC.md` (v0.4 voice MVP).
**Owner**: Jerry Chan.

---

## 1. Goal

Extend Loremaster's voice playback in two coupled ways:

1. **ElevenLabs v3 audio tags** in Claude's responses, so dialogue and narration carry emotional cues (`[whispers]`, `[excited]`, `[sighs]`, `[laughs]`, etc.) that the TTS model interprets to vary delivery within a single voice.
2. **Per-NPC voice IDs** so different NPCs in a session speak with different voices. Each NPC's voice ID is set once by the GM via a dialog and remembered per-world.

The Loremaster narrator voice itself stays hardcoded to the current Einstein ID (`n4gY9MeIbTbAMJ5rlJ51`) — it's the world's narrator constant.

Shipping plan: **one spec, two phases.** Phase 1 (v0.5.0) ships emote tags only with the existing single-voice pipeline. Phase 2 (v0.6.0) ships speaker tags, per-NPC voice routing, GM dialog, and segmentation. Each phase gets its own implementation plan + release.

## 2. Non-goals

- Voice ID creation on ElevenLabs (use whatever the GM already has in their account).
- Per-segment streaming playback (deferred from v0.4, deferred again).
- Voice cloning or per-NPC custom voice training.
- Cross-world NPC voice import/export.
- Mixing voices for chorus / multi-character single line.
- Real-time voice preview while typing system prompts.
- Cleanup of orphaned cached MP3s after voice reassignment (v3 backlog).

## 3. Phasing

### Phase 1 — Emote tags only (v0.5.0, ~1-2 days)

| Change | Repo | File |
|---|---|---|
| Switch TTS model `eleven_turbo_v2_5` → `eleven_v3` | proxy | `lib/loremaster_proxy/services/tts_manager.ex` |
| Add v3 audio-tag instructions to the chat system prompt | proxy | `lib/loremaster_proxy/services/context_builder.ex` (or wherever `claude_context.system_prompt` is assembled) |
| Strip emote tags from rendered chat content via `renderChatMessageHTML` hook | client | `scripts/chat-handler.mjs` or new `scripts/message-formatter.mjs` helper |
| (Optional rollback knob) per-world setting `useEmoteTags` defaulting to `true`; when `false`, system prompt omits the tagging instruction and TTSManager swaps back to turbo | both | `scripts/config.mjs` + proxy reads it from socket assigns |

Phase 1 does **not** add UI, data model, or segmentation. The same single voice (Einstein) narrates everything; v3 just delivers it with emotional variation when Claude tags lines.

### Phase 2 — Per-NPC voices (v0.6.0, ~1 week)

Phase 2 adds the per-speaker routing on top of Phase 1's foundation. Detailed component inventory in §6.

## 4. Annotation format and parsing rules

### 4.1 Wire format

Claude's responses use **inline bracket tags**, two kinds:

| Tag shape | Meaning | Example | Stripped before TTS? |
|---|---|---|---|
| `[ProperCaseName]` | Speaker (Phase 2 only) | `[Roland]` | Yes |
| `[lowercase_word]` | ElevenLabs v3 audio tag | `[whispers]` | No (interpreted by v3) |
| `[Loremaster]` | Reserved: narrator voice (hardcoded) | `[Loremaster]` | Yes (treated as narrator) |

Speaker tag stays in effect until the next speaker tag. No tag at the start of the response = narrator.

Full example (Phase 2):
```
[Loremaster] The wind howls outside.
[Roland] [whispers] Did you hear that?
[excited] I can't believe we made it!
[Loremaster] His companion stares back, eyes wide.
```

Phase 1 ships only the audio tags; speaker tags arrive in Phase 2.

### 4.2 Parser rules

- **Disambiguation**: the parser maintains an allow-list of v3 audio tag tokens. A tag matching the allow-list is treated as an audio tag (lowercase normalized); anything else in brackets is treated as a speaker name.
- **Allow-list seed** (will be tuned during Phase 1 implementation against ElevenLabs's published list): `whispers`, `excited`, `sighs`, `laughs`, `crying`, `shouting`, `nervously`, `sarcastic`, `pleading`, `tired`, `breathless`, `serious`, `surprised`.
- **Name collision** (e.g. NPC named "Roar"): allow-list wins. Documented in the GM dialog tooltip.
- **Multi-paragraph speaker**: continuation across newlines is implicit.
- **Empty segments**: skipped silently.
- **Malformed tags** (e.g. `[unclosed`): treated as literal text.

### 4.3 Render-time stripping (Phase 1)

The `renderChatMessageHTML` hook (the same hook we already use for voice-replay icons in v0.4) regex-strips audio tags from the displayed text. The canon content storage still contains them (so TTS sees them on next request), but chat reads cleanly.

Regex: `/\[(?:whispers|excited|sighs|...)\]/gi` over the message's `.message-content` text nodes.

## 5. Data model (Phase 2)

### 5.1 NPC voice registry

A single per-world Foundry setting:

```javascript
game.settings.register(MODULE_ID, 'npcVoices', {
  scope: 'world',
  config: false,           // managed via custom dialog, not the standard settings UI
  type: Object,
  default: {}
});
```

Shape: `{ [npcName: string]: voiceId: string }`. Empty string `""` = "discovered but not yet assigned".

Storage location: **Foundry world settings**, not the proxy DB. Lifecycle:

- Survives reloads (Foundry persists settings in `world.json`).
- Survives world data export/import via Foundry's standard mechanism.
- Does NOT survive cross-world copy of the module (GM starts fresh in a new world).
- **Hosted-mode users**: each GM's world settings are per-world; no cross-GM sharing. This is the right boundary — voice choices are creative decisions tied to the world's cast.
- **Risk**: if a hosted GM rebuilds their world, mappings reset. Acceptable for v1; v3 may mirror to proxy DB for backup.

### 5.2 GM Prep "discovered NPCs" sidecar

`GMPrepScript` (proxy resource) is unchanged. The GM Prep response payload gains:

```json
{
  "scriptContent": "<existing markdown>",
  "discoveredNpcs": ["Roland", "Innkeeper", "Captain Vance"]
}
```

The client merges `discoveredNpcs` into the world's `npcVoices` setting on every GM Prep completion: any new name is added with an empty voice ID; existing names are left untouched.

### 5.3 Cache key change

`TTSManager.cache_path` extends from `<cache_dir>/<world_id>/<canon_id>.mp3` to `<cache_dir>/<world_id>/<canon_id>__<segment_idx>__<voice_id>.mp3`.

Phase 1: segment_idx = 0 always, voice_id = hardcoded narrator. Phase 2: real values per segment. Cache layout is forward-compatible from Phase 1.

## 6. Components inventory

### 6.1 Phase 1 (v0.5.0)

| Component | New / Modified | Repo | Approx LOC |
|---|---|---|---|
| TTSManager model swap + segment-aware cache_path | Modified | proxy | ~10 |
| Chat system prompt (audio-tag instructions) | Modified | proxy | ~20 |
| Tag-stripping render hook | New helper | client | ~50 |
| `useEmoteTags` per-world setting (rollback knob) | New | client + proxy passthrough | ~30 |

### 6.2 Phase 2 (v0.6.0)

| Component | New / Modified | Repo | Approx LOC |
|---|---|---|---|
| `scripts/npc-voice-dialog.mjs` (GM dialog) | New | client | ~250 |
| `scripts/voice-output.mjs` segmentation + sequential playback | Modified | client | ~150 added |
| `scripts/socket-client.mjs` (`requestTTS` new args) | Modified | client | ~20 |
| `scripts/config.mjs` (`npcVoices` setting) | Modified | client | ~10 |
| Scene-control button to open NPC dialog | Modified | client | ~15 |
| GM Prep prompt + response shape (discoveredNpcs) | Modified | proxy + client | ~40 |
| `world_channel.ex` request-tts (voiceId + segmentIdx params) | Modified | proxy | ~30 |
| `TTSGenerationLock` key extended to (world, canon, segment, voice) | Modified | proxy | ~10 |
| Chat system prompt (add `[Speaker]` instruction) | Modified | proxy | ~15 |

## 7. Data flow

### 7.1 Phase 1: canon publish → audio (single voice, with emote tags)

```
GM clicks Publish
   │
   ▼
chat-handler publishes canon (text includes [whispers] etc.)
   │
   ▼ (existing v0.4 path)
voice-output._handleCanonPublished({canonId, text})
   │ if voiceEnabled
   ▼
socketClient.requestTTS(canonId, text)
   │
   ▼
proxy → TTSManager.fetch_or_generate
   │
   ▼
ElevenLabs v3 POST (model_id: "eleven_v3")
   │ text contains [whispers]/[excited] — v3 interprets them
   ▼
MP3 cached, signed URL returned, browser plays
```

Render hook strips emote tags from the displayed chat content.

### 7.2 Phase 2: canon publish → audio (multi-segment routing)

```
Canon publishes (text: "[Loremaster] x. [Roland] [whispers] y. [Loremaster] z.")
   │
   ▼
voice-output parses into 3 segments:
   [{speaker: 'Loremaster', text: 'x.'},
    {speaker: 'Roland',     text: '[whispers] y.'},
    {speaker: 'Loremaster', text: 'z.'}]
   │
   ▼ (lookup voice IDs)
   - Loremaster: hardcoded narrator
   - Roland: getSetting('npcVoices').Roland → 'v_abc'
   - (if Roland missing) → narrator + auto-add to registry
   │
   ▼ (parallel)
3× socketClient.requestTTS(canonId, segmentIdx, voiceId, text)
   │
   ▼
3 audio URLs returned (cache keys: canon__0__narrator, canon__1__v_abc, canon__2__narrator)
   │
   ▼
<audio> playback chain: segment 0 → onended → segment 1 → onended → segment 2
```

### 7.3 GM Prep extraction (Phase 2)

```
GM clicks "Generate GM Prep"
   │
   ▼ (existing v0.4 path)
proxy: GMPrepPrompts builds prompt with appended instruction:
   "After the script, output a JSON line: {\"discoveredNpcs\":[\"Name1\",...]}"
   │
   ▼
Claude returns script + JSON line
   │
   ▼
proxy parses JSON, includes in gm-prep-complete payload
   │
   ▼
client merges into world's npcVoices setting:
   - new names → added with empty voice ID
   - existing names → left untouched
   │
   ▼
GM opens NPC Voice dialog — sees the new entries highlighted as "needs voice"
```

## 8. Settings and UI

### 8.1 New settings (Phase 1)

| Key | Scope | Type | Default | Visible? |
|---|---|---|---|---|
| `useEmoteTags` | per-world | bool | `true` | yes, in settings panel |

### 8.2 New settings (Phase 2)

| Key | Scope | Type | Default | Visible? |
|---|---|---|---|---|
| `npcVoices` | per-world | Object | `{}` | no — managed by custom dialog |

### 8.3 GM dialog (Phase 2)

Opened from a new button in the Loremaster scene-control group: **🎭 NPC Voices** (mask icon).

Modal layout (~600×500px):

```
┌─────────────────────────────────────────────────────┐
│ NPC Voice Assignments                          [×]  │
├─────────────────────────────────────────────────────┤
│ Loremaster (narrator)         [n4gY9MeIbTbAMJ5rlJ51]│
│                                       (hardcoded)   │
├─────────────────────────────────────────────────────┤
│ ⚠ Roland          [_____________ ] [▶ test] [delete]│
│   Innkeeper       [v_xyz789______] [▶ test] [delete]│
│   Captain Vance   [_____________ ] [▶ test] [delete]│
│                                                     │
│  [+ Add NPC manually]                               │
├─────────────────────────────────────────────────────┤
│ Find voice IDs at https://elevenlabs.io/app/voice-lab
│ [Save]                                  [Cancel]    │
└─────────────────────────────────────────────────────┘
```

- ⚠ icon = voice ID empty (NPC discovered but not assigned).
- `▶ test` button hits `request-tts` with a fixed sample sentence ("The quick brown fox jumps over the lazy dog.") to preview the voice.
- `delete` removes the entry from the registry; if Claude mentions it again, it gets auto-re-added.
- Save persists to world setting; in-flight TTS playback unaffected (next play picks up new mapping via cache-key change).

### 8.4 i18n keys (Phase 2)

`LOREMASTER.NpcVoices.*` namespace:
- `Title` — "NPC Voice Assignments"
- `Narrator` — "Loremaster (narrator)"
- `NeedsVoice` — "Voice not assigned"
- `TestVoice` — "Test voice"
- `Delete` — "Delete"
- `AddManual` — "Add NPC manually"
- `FindIds` — "Find voice IDs at"
- `Save` / `Cancel`
- `OpenDialog` — "NPC Voices" (scene-control button label)

## 9. Error handling matrix

| Failure | Phase | Behavior |
|---|---|---|
| Claude doesn't emit emote tags (model drift) | 1 | Text plays as-is. No error |
| `eleven_v3` returns 5xx / unavailable | 1, 2 | Friendly toast "Voice unavailable, try again". No auto-fallback to turbo (consistent voice across the session) |
| GM enters invalid voice ID (typo) | 2 | First playback returns 404 from ElevenLabs → notification "Voice ID '<id>' not found in your ElevenLabs account" + dialog row highlighted red |
| Speaker name not in registry | 2 | Narrator-voice fallback (playback works) + auto-add NPC to registry with empty voice; dialog shows "needs voice" warning |
| Speaker tag mid-sentence (Claude error) | 2 | Segmenter splits there; audio has weird break. Acceptable rare quirk |
| Multi-paragraph speaker continuation | 2 | All paragraphs until next `[Speaker]` tag belong to current speaker |
| Empty segment between two tags | 2 | Skip silently |
| NPC name collides with v3 audio-tag allow-list (e.g. "Roar") | 2 | Allow-list takes precedence (treated as audio tag). Documented in GM dialog tooltip |
| Concurrent TTS for different segments of same canon | 2 | `TTSGenerationLock` key extended to `{world_id, canon_id, segment_idx, voice_id}` |
| GM Prep extraction returns no NPCs | 2 | Registry stays empty. GM can manually add via "+" button in dialog |
| GM deletes an NPC from registry | 2 | Future canon mentioning that name re-adds it. Cached audio with old voice stays orphaned (v3 cleanup) |
| `useEmoteTags = false` mid-session | 1, 2 | New requests use turbo + un-tagged prompt; cached v3 audio remains for old canon |

## 10. Telemetry

Extending the v0.4 telemetry events:

- `[:loremaster, :tts, :segment_generated]` — counts segments per request (cache hit/miss + voice_id metadata)
- `[:loremaster, :tts, :unknown_npc]` — fallback fired (metadata: world_id, npc_name) — helps GMs identify what needs assignment
- `[:loremaster, :tts, :emote_tag_seen]` (Phase 1) — counts emote-tag usage in responses (validates prompt adherence)

## 11. Cost model

v0.4 framed the cost model as a live experiment with three structural cost-savers (default-off opt-in, lazy on-demand, per-canon cache). v2 keeps the same shape with refinements:

| Phase | Worst-case per-canon cost change | Reason |
|---|---|---|
| Phase 1 | ~3× v0.4 | v3 model is ~3× turbo per char (training-data pricing; verify current) |
| Phase 2 | ~9× v0.4 worst case | v3 (3×) × average segments per canon (assumed ~3 from a typical narration+dialog mix) |

Mitigations are unchanged in shape:
- **Default-off opt-in**: most users still don't trigger TTS.
- **Lazy on-demand**: zero cost when no listener.
- **Per-segment cache**: subsequent listeners hit cache. First listener pays full.
- **Voice-keyed cache**: changing a voice invalidates only that voice's segments, not the full canon.

If the 30-day post-launch telemetry shows segment_count averaging higher than ~3 or unknown_npc fallbacks frequent enough to suggest GMs aren't assigning voices reliably, v0.6.1 ships a soft per-tier audio_chars_consumed cap. Decision is data-driven, not pre-baked.

## 12. Pre-implementation research checklist (Phase 1)

Before Phase 1 implementation starts, the engineer must confirm:

1. **`eleven_v3` model availability and pricing** — was alpha in our training data. Check ElevenLabs's current model list endpoint and per-character pricing. Update spec if model name has changed.
2. **v3 audio tag list** — fetch the current official list of supported tags. Update the parser allow-list in §4.2.
3. **v3 latency vs turbo** — quick benchmark with a 200-char sample. Confirm < 5s p50 (existing timeout headroom).

These three items are blockers for the v0.5.0 deploy, not for the design.

## 13. Acceptance criteria

### Phase 1 (v0.5.0)

1. Canon publishes with `[whispers]` / `[excited]` / etc. in the text. ElevenLabs returns audio with audible variation matching the tag (subjective; verified by ear).
2. Chat display shows clean prose — the bracket tags are stripped from the rendered DOM.
3. `useEmoteTags = false` on a world: system prompt omits the tagging instruction, TTSManager uses turbo, behavior matches v0.4.
4. 30+ canon entries with mixed tag density don't show user-visible errors. Telemetry shows tag-usage frequency.
5. Cost per canon (audio_chars_consumed) is in line with v3 pricing projection.

### Phase 2 (v0.6.0)

1. GM Prep generation extracts NPC names and adds them to `npcVoices` setting on completion.
2. GM Voice dialog opens from scene-control button, shows all entries, allows assigning + testing + deleting.
3. Canon with `[Loremaster] x [Roland] y [Loremaster] z` plays three segments sequentially with the right voices.
4. Unknown NPC names route to narrator and surface in the dialog with a "needs voice" warning.
5. Reassigning a voice ID for an NPC and re-playing the same canon regenerates audio (cache miss for new key).
6. Multiple opted-in users in the same world hear the same canon with the same voice mapping (no per-client drift).
7. Telemetry events fire for at least: segment_generated (both cache states), unknown_npc, emote_tag_seen.
8. `useEmoteTags = false` still works (turbo, single voice, no emote tags); Phase 2 speaker routing should be orthogonal to the emote-tag knob (turbo can still route by speaker, just without emotional cues).

## 14. Dependencies and risks

| Risk | Mitigation |
|---|---|
| `eleven_v3` not yet GA / cost or pricing change | Pre-implementation research checklist (§12) flags before implementation. Rollback knob (`useEmoteTags = false`) preserves v0.4 behavior |
| Claude's tag adherence is inconsistent | Initial prompt instructs sparing tag use ("for emotionally significant moments, not every line"). 30-day telemetry tunes the prompt. v0.5.1 may add prompt-iteration |
| GM workflow friction in Phase 2 dialog | "Test voice" button + ElevenLabs link in the dialog removes the round-trip to verify a voice ID is real |
| Per-segment TTS multiplies HTTP load | Sequential per-segment playback means parallel fetches are fine; ElevenLabs's tier-1 rate limits are well above N=3 segments per canon |
| Foundry world setting size for `npcVoices` | World settings are stored in `world.json`; a 100-NPC world adds ~5KB. Foundry handles this without issue |
| Voice ID typos | "Test voice" sample play immediately reveals bad IDs. 404 from ElevenLabs surfaces as a row-level error in the dialog |

---

*End of spec. Implementation plans (Phase 1, then Phase 2) produced via the `writing-plans` skill.*
