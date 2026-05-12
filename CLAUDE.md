# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Role

This repo is the **development source** for the Loremaster Foundry VTT module. It is NOT the live module Foundry loads at runtime.

| Path | Purpose |
|------|---------|
| `~/work/loremaster` (this repo) | Git source — develop here |
| `~/foundrydata/Data/modules/loremaster` | Installed copy Foundry actually loads — overwritten by auto-updates and reinstalls; never edit directly |

To test changes in Foundry, copy or symlink files from this repo into the installed location. Never edit the installed copy as your primary workflow — those edits will be lost.

The proxy server is an **Elixir** application (the older Node.js proxy is deprecated and should not be referenced). It lives in a separate repo. This repo only contains the client module.

## Build & Release

There is **no build step**. The module is plain ES modules + Handlebars + CSS loaded directly by Foundry.

- **Run/test**: copy or symlink files into `~/foundrydata/Data/modules/loremaster`, then reload Foundry.
- **No package.json, no bundler, no test runner.** Manual in-Foundry testing is the verification path.
- **Release**: bump `module.json` `version`, commit, tag, and create a GitHub Release. `.github/workflows/release.yml` then:
  1. Rewrites `module.json` with manifest/download URLs pointing at the release.
  2. Builds `module.zip` from `module.json`, `scripts/`, `styles/`, `lang/`, `templates/`, `README.md`, `LICENSE.md` (excludes `CLAUDE.md`, `.claude/`, `TODO.md`, `docs/`).
  3. Attaches both files to the release and notifies the Foundry Package Registry (requires `FOUNDRY_PACKAGE_RELEASE_TOKEN` secret).
- **Sync to public repo**: `.github/workflows/publish-public.yml` mirrors this private repo to `github.com/digitsu/loremaster-foundry`, the public-facing manifest source.

If you add new top-level files or directories the module needs at runtime, update the `zip -r` list in `release.yml` or they will be missing from releases.

## Architecture

Loremaster is a three-tier system:

```
Foundry VTT (browser)  ──WebSocket──▶  Proxy Server (Elixir)  ──HTTPS──▶  Claude API
   [this repo]                          [separate repo]                  [Anthropic]
```

This repo is only the browser-side tier. All Claude API calls, conversation persistence, PDF processing, Patreon auth verification, and quota enforcement happen in the Elixir proxy. The client never sees the Anthropic API key. Production deployment is on Hetzner.

Note: an older Node.js proxy implementation is deprecated. Any reference to Node-side files (`socket-handler.js`, `claude-client.js`, `conversation-store.js`, etc.) is stale and should be ignored — the Elixir proxy is the source of truth.

### Two Server Modes

Settings drive a fork in initialization (`scripts/loremaster.mjs` `ready` hook):

- **Hosted mode** (`isHostedMode()` true): proxy URL is locked to the hosted endpoint, Patreon OAuth flow runs via `patreon-auth.mjs` / `patreon-login-ui.mjs`, tier-gated quotas enforced server-side. Claude API key and license fields are disabled in the settings UI.
- **Self-hosted mode**: user supplies their own proxy URL, Claude API key, and Gumroad license key. No Patreon flow.

`config.mjs` is the single source of truth for which mode is active. New features that touch auth, settings UI, or server URLs must check `isHostedMode()` rather than assuming one mode.

### Client-Side Module Layout (`scripts/`)

Entry point: `loremaster.mjs` registers settings, hooks (`init`, `ready`, `renderChatMessage`, `getSceneControlButtons`, etc.), and wires modules together.

Functional groups:

- **Transport & auth**: `socket-client.mjs` (WebSocket to proxy), `api-client.mjs`, `patreon-auth.mjs`, `patreon-login-ui.mjs`
- **Chat pipeline**: `chat-handler.mjs` (`@lm` / `@lm!` parsing, publish/iterate/discard), `message-batcher.mjs` (multi-player batching), `batch-ui.mjs`, `message-formatter.mjs`
- **Game state extraction**: `data-extractor.mjs` (actors, scenes, combat → context for Claude), `player-context.mjs`, `tool-handlers.mjs` (Claude tool-use callbacks: dice rolls, actor queries, etc.)
- **Content & cast**: `content-manager.mjs` (PDF upload, adventures, Cast tab), `cast-selection-dialog.mjs`, `gm-prep-journal.mjs` (debounced 30s sync of GM Prep journals back to server), `shared-content-admin.mjs`
- **Conversation lifecycle**: `conversation-manager.mjs` (history UI, compaction, archive, journal export)
- **Status / monitoring UI**: `status-bar.mjs` (persistent connection/tier/quota pill, 6 states with auto-collapse), `progress-bar.mjs`, `usage-monitor.mjs` (token usage + cost estimation), `stat-review-panel.mjs`
- **Onboarding & docs**: `welcome-journal.mjs`, `house-rules-journal.mjs`
- **Config**: `config.mjs` (settings registration, mode helpers)
- **Voice**: `voice-input.mjs` (PTT + Web Speech API STT), `voice-output.mjs` (canon-published listener + audio playback + replay icon)

### Templates, Styles, i18n

- `templates/*.hbs` — Handlebars templates for each ApplicationV2/Dialog UI. Helpers are registered from each module's `register*Helpers()` function called in the `init` hook.
- `styles/loremaster.css` — single stylesheet; no preprocessor.
- `lang/en.json` — i18n keys grouped by feature (`SharedContent`, `PatreonLogin`, `Connection`, `SettingsPanel`, ...). Use `game.i18n.localize()` for any user-facing string.

### Cross-Cutting Concerns

- **Game-system adapters**: tool handlers in `tool-handlers.mjs` are designed for system-agnostic dispatch via an adapter pattern. Year Zero Engine (Coriolis, Forbidden Lands, Alien) is implemented; D&D 5e and Pathfinder 2e are planned. See `docs/TOOL_ADAPTER_SYSTEM.md` before adding new system support.
- **Canon system**: published AI responses become permanent campaign history fed back into future Claude context. The publish/iterate/discard flow is concentrated in `chat-handler.mjs`.
- **Rules discrepancies**: `docs/RULES_DISCREPANCY_SPEC.md` covers the PDF-vs-Foundry conflict detection and GM-ruling persistence flow.
- **Wire-protocol contract**: `loremaster-proxy-elixir/docs/MESSAGE_PROTOCOL.md` documents every Phoenix channel message type (request payload, reply shape, correlation strategy, and gotchas). Consult this before adding or modifying any `socket-client.mjs` message.

## Foundry V12+ API Gotchas

These are non-obvious and have bitten us. Foundry V12+ broke the old ChatMessage construction patterns:

**DO NOT USE** (causes `element.addEventListener is not a function` and notification errors):
```javascript
speaker: { alias: 'Loremaster' }       // raw object — broken
style: CONST.CHAT_MESSAGE_STYLES.OTHER  // causes addEventListener error
type: CONST.CHAT_MESSAGE_TYPES.IC       // deprecated, also broken
```

**USE INSTEAD**:
```javascript
speaker: ChatMessage.getSpeaker({ alias: 'Loremaster' })
// or with an actor:
speaker: ChatMessage.getSpeaker({ actor: someActor })
// Omit `style` and `type` entirely.
```

Rules of thumb:
- Always use `ChatMessage.getSpeaker()` for speaker data.
- Omit `style` and `type` from `ChatMessage.create()` calls completely. Both deprecated forms throw at render time.
- Scene controls use the `getSceneControlButtons` hook. Tool entries require `name`, `title`, `icon`, `button`, `visible`, `onClick`.

### Chat messages persist their content HTML forever

`ChatMessage.content` is stored in the world DB at the moment the message is
created. The `renderChatMessageHTML` hook re-binds JS handlers on every render,
but **the HTML inside `content` is whatever was templated at creation time and
is never regenerated**. This bites in two ways:

1. **Stale data attributes**: if a buggy version of the module rendered a
   button with `data-message-id="${undefined}"` (literal string `"undefined"`),
   that broken attribute is now baked into every old message in the world DB.
   Even after the bug is fixed, those old messages render with the broken
   attribute and the new event handler can't recover the correct ID.
2. **Stale template structure**: if you change a template from a text+icon
   button to an icon-only one, old messages still render with the old text
   AND child-element structure. Any code that walks the DOM (e.g.
   `btn.children[0].tagName === 'I'`) will get the old shape.

**Symptom**: clicking buttons on old messages does nothing — not even a console
log fires — because the click handler reads `event.currentTarget.dataset.X`,
gets a stale value, and the lookup fails silently. New messages from the
same session work fine.

**How to detect** during dev/testing:

```javascript
// In browser console, compare a stale message's button vs a fresh one.
const all = document.querySelectorAll('.loremaster-publish-btn');
console.log('Total:', all.length);
all.forEach((b, i) => console.log(
  `[${i}] id=${b.dataset.messageId} children=${b.children.length}`,
  'text=', JSON.stringify(b.textContent.trim())
));
```

**How to avoid**:

- When changing the HTML structure of any persisted chat-message content
  (buttons, data attributes, classes), assume **all existing messages in
  affected worlds will keep the old structure forever**. Test against fresh
  messages only; verify by either deleting old test messages or filtering for
  messages created after the fix landed.
- Better long-term: **render action buttons via the `renderChatMessageHTML`
  hook from flags**, not via stored HTML. The hook re-runs on every render so
  the buttons always match current code. The flag (e.g.
  `flags.loremaster.isPrivateResponse`) is the durable contract; the HTML
  isn't. We don't currently do this for the private-response controls and it's
  a known refactor target.

## Git Commit Guidelines

- Claude-related files (`.claude/`, `CLAUDE.md`, `.omc/`) may be committed.
- **Never** add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any AI attribution lines to commit messages. Keep messages clean and focused on the change.

## Reference Docs

| Document | Description |
|----------|-------------|
| `docs/TOOL_ADAPTER_SYSTEM.md` | How to add support for new game systems |
| `docs/RULES_DISCREPANCY_SPEC.md` | Rules discrepancy detection testing spec |
| `README.md` | User-facing setup, hosted vs self-hosted, Patreon tiers |
| `TODO.md` | Feature roadmap and completed milestones |
| `module.json` | Foundry manifest — source of truth for current version and compatibility |
