# Self-Hosted ↔ Hosted Parity Audit

**Window**: 2025-12-01 → 2026-06-12 (~6 months)
**Status**: living document — re-audit before each release; flagged with the same date as the release.

---

## TL;DR

Drift is **moderate and well-managed**. Hosted and self-hosted both run the same proxy codebase and ~95% of the same client code. Divergence concentrates in three explicit `isHostedMode()` guards in the client (`scripts/config.mjs:392`) and the proxy's `hosted_mode?()` helper (`world_channel.ex:288`). Everything added in the last 6 months — Voice v1+v2, PDF RAG, character stat sync, audio tag emotes, canon audio replay, Phoenix protocol auto-detect, PDF 64 MB cap — works in self-hosted either automatically or with an API key the user provides.

The three hosted-only features today:

1. **Patreon OAuth + tier system** (replaced by Gumroad license in self-hosted) — by design, won't change
2. **Backup server-side persistence** (self-hosted gets local JSON download) — could be exposed via a setting, deferred
3. **Shared Content library activation in self-hosted** — addressed in v0.6.0 by bypassing the Patreon tier check on the proxy when `hosted_mode == false`. No client setting needed; the existing UI just works.

---

## Feature-by-feature breakdown

Column legend for **Self-hosted**:
- ✅ automatic — works out of the box on the new release
- ⚙ with config — works, user must supply an env var / API key
- 🔁 with proxy update — works, but self-hosted user must redeploy their proxy
- ⚠ partial — degrades gracefully, or only some sub-features work
- ❌ hosted-only — gated by `isHostedMode()` / `hosted_mode?()`; would need code changes to expose

| Feature | Where | Self-hosted | Required config | Notes / file refs |
|---|---|---|---|---|
| Voice Output v1 (ElevenLabs TTS) | client + proxy | ⚙ | User's ElevenLabs API key in world settings (`elevenLabsApiKey`) | `proxy/lib/.../voice/tts_manager.ex`; client `scripts/voice-output.mjs` |
| Voice Output v2 (audio tags, v3 model) | client + proxy | ⚙ | Same key + `useEmoteTags` toggle (default true) | `proxy: 5800f45 feat(voice-v2): TTSManager selects v3 model`; client `f70a9d8 feat(voice-v2): send useEmoteTags` |
| Voice Input (PTT + Web Speech STT) | client | ✅ | Mic permission; default hotkey backtick | `scripts/voice-input.mjs` (8c86acd) |
| PDF upload + RAG embeddings | client + proxy | ⚙ | Proxy needs `VOYAGE_API_KEY`; without it, falls back to text-only | `proxy: bff366a feat: warn at startup when VOYAGE_API_KEY is missing` |
| PDF auto-compress (Ghostscript) + OCR fallback (tesseract) | proxy | 🔁 | User runs the OCR-enabled image | `proxy: c24a198 feat: auto-compress oversized PDFs; 495caf5 fix: add tesseract-ocr to Docker runtime` |
| PDF upload cap 64 MB + extended timeout | client | ✅ | none | `client: 8d1d3be feat: raise PDF upload cap to 64 MB` |
| Character stat sync Phase 1 (read-only snapshot) | client + proxy | ✅ | none | `proxy: a45c8c4 Phase 1`; client `22f3359 feat(foundry): add Phase 1` |
| Character stat sync Phase 2 (`update_character_stat` tool + GM Review Panel) | client + proxy | ✅* | none — proxy ships the tool unconditionally | `proxy: 5aa4172 Phase 2: AI stat change proposals + GM review`; *spot-check tier gating in `proxy/lib/.../claude/tools.ex` before promising* |
| Canon publish / iterate / discard + audio cache replay | client + proxy | ⚙ for audio | optional ElevenLabs key | `client: ef2a533 feat(voice): replay-audio icon on cached past canon messages` |
| GM Prep journal sync (debounced 30s) | client + proxy | ✅ | none | `scripts/gm-prep-journal.mjs` |
| Multi-player batch UI (GM-only since v0.4.1) | client | ✅ | none | `client: ea9244c feat(batch): hide batch indicator from non-GM clients` |
| Phoenix protocol auto-detect from proxy URL | client | ✅ | none | `client: 8bd6d1d fix: default to Phoenix mode for all self-hosted proxy URLs` |
| Pre-flight self-hosted API key check | client | ✅ | none | `client: b08b823 fix: pre-flight self-hosted API key check; open settings instead of cryptic error` |
| Adventure module registration (today's prod fix) | proxy | 🔁 | proxy redeploy | `proxy: 494db0a fix(content): accept :registered_by` (this branch) |
| Backups — create / list / restore (server-side persisted) | client + proxy | ❌ | hosted-only | `client/scripts/content-manager.mjs:2557 if (isHostedMode())` — self-hosted gets a JSON file download instead |
| Shared Content library — browse + activate + publish | client + proxy | **✅ in v0.6.0** | admin email in `ADMIN_EMAILS` proxy env for publish actions | Recon turned up that the client UI was never gated on `isHostedMode` — the only blocker was proxy tier-check enforcement on activate. v0.6.0 fix: `SharedContentManager.activate/4` accepts `enforce_tier_limit:`; channel handler passes `socket.assigns.hosted_mode`; `get_tier_info/2` returns `unlimited` for self-hosted. Branch: `feat/v0.6.0-self-host-shared-library` (`d2a85fb`). |
| Patreon OAuth + tier display ("Knave/Knight/Lord") | client + proxy | ❌ | hosted-only by design | `scripts/patreon-auth.mjs`; `scripts/patreon-login-ui.mjs`. Replaced by Gumroad license in self-hosted |
| Quota status-bar pill | client | ⚠ | shows `—` (no per-period limits in self-hosted) | `scripts/status-bar.mjs`. Self-hosted pays Anthropic per token directly, no enforced cap |
| Tier-gated feature unlocks (e.g. shared library activation cap, RAG model selection) | proxy | ⚠ → ✅ in v0.6.0 | bypassed in non-hosted | `proxy: world_channel.ex:8421` |

---

## Self-hosted-only advantages

Worth surfacing in marketing copy + welcome journal:

- No monthly token quota — pay Anthropic directly per token (cheaper for heavy users)
- No tier cap on activations / features — what you can deploy, you can use
- Your data stays on your proxy; nothing transits Loremaster's infra
- You can run a customer-branded ElevenLabs voice without going through us

---

## Re-packaging to Gumroad

**Code**: zero blockers. The release pipeline (`.github/workflows/release.yml`) builds `module.zip` from the latest tag — the same artifact Gumroad serves. Cut v0.6.0, attach the zip, done.

**Customer-facing release notes** (for the Gumroad changelog and welcome journal):

> **Loremaster v0.6.0 — Self-Hosted Update**
>
> What's new since your last download:
> - **Voice Output (TTS)** — bring your own ElevenLabs API key, get full Loremaster narration including emotional audio tags
> - **Voice Input (PTT)** — push-to-talk speech-to-text in supported browsers (default hotkey: backtick)
> - **Character Stat Sync** — Loremaster can read and propose changes to your characters; you review and approve in the GM panel
> - **PDF auto-compression** — large adventure PDFs upload cleanly without manual prep
> - **PDF upload cap raised to 64 MB** (was 16 MB)
> - **OCR fallback for scanned PDFs** — text extracted even from image-based PDFs (proxy redeploy required)
> - **Phoenix protocol auto-detect** — no more guessing `ws://` vs `wss://` in your proxy URL
> - **Pre-flight API key check** — friendlier error if your Claude key isn't set
> - **Local shared library** — *new in v0.6.0:* publish PDFs once, activate them in any world you GM
>
> Requires: redeployment of the latest proxy image to pick up the matching server-side features.
>
> What you still won't have vs. the hosted version:
> - Server-side persisted backups (self-hosted gets local file downloads instead)
> - Patreon tier system (you have a license — that *is* your tier)

**Welcome-journal additions**: a paragraph under "First-time setup" listing required env vars on the proxy and what each enables. **Verified env-var names** (corrected from the first draft; see proxy `docs/DEPLOY.md` for the full table):

- `DEPLOYMENT_MODE=self_hosted` — **critical**, defaults to `hosted` if unset (boots in hosted mode with Patreon enforcement active).
- `ENCRYPTION_KEY` — required hex-encoded 32-byte Cloak vault key; proxy raises at startup if missing.
- `OPERATOR_CLAUDE_API_KEY` — optional operator-default; in self-hosted mode the client sends its own Anthropic key per world.
- `OPERATOR_ELEVENLABS_API_KEY` — optional operator-default for voice; same per-world override pattern.
- `VOYAGE_API_KEY` — enables RAG embeddings; absence triggers graceful text-only fallback.
- `ENABLE_RAG` — explicit toggle; auto-enables when `VOYAGE_API_KEY` is set.
- `LICENSE_SECRET_KEY` / `GUMROAD_PRODUCT_ID` — license validation; permissive if absent for private deployments.

---

## Open questions / deferred work

- **Should server-persisted backups become opt-in for self-hosted too?** The proxy already supports them; the client just doesn't call `listBackups()` in self-hosted. Would be a similar refactor pattern to the local shared library (`enableServerBackups` setting). Not in v0.6.0 — defer until a user asks.
- **Should the audit doc auto-regenerate from git history?** Today it's a hand-curated list. A `scripts/audit-parity.sh` that walks `git log` since the last release tag and pre-fills the table would reduce drift between this doc and reality. Not worth building until parity becomes a recurring release-gate.
- **Spot-check Phase 2 stat-sync tier gating** before the Gumroad release-notes go out — the audit's claim that it's unconditional in self-hosted needs verification at `proxy/lib/.../claude/tools.ex`.

---

## File references for code searches

| What | Where |
|---|---|
| Client mode detection | `scripts/config.mjs:392` (`isHostedMode()`) |
| Proxy mode detection | `lib/loremaster_proxy_web/channels/world_channel.ex:288` (`hosted_mode?()`) |
| Client hosted-only guards | `scripts/content-manager.mjs:208, 2557, 2601`; `scripts/socket-client.mjs:255, 349, 357, 2226, 2327, 2347, 2369, 2383, 2393`; `scripts/loremaster.mjs:80, 215, 253, 407, 577` |
| Proxy shared-library tier check | `lib/loremaster_proxy_web/channels/world_channel.ex:8421` (`SharedContentManager.check_tier_limit/1`) |
| Voice settings registration | `scripts/config.mjs:277-350` (`elevenLabsApiKey`, `voiceId`, `useEmoteTags`) |
| Proxy RAG config | `config/runtime.exs` (`VOYAGE_API_KEY`) |
