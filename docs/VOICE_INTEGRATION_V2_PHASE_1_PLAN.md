# Voice Integration v2 — Phase 1 (v0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) OR `oh-my-claudecode:team` for parallel execution OR `superpowers:executing-plans` for inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of `docs/VOICE_INTEGRATION_V2_SPEC.md` — switch the proxy's TTS model from `eleven_turbo_v2_5` to `eleven_v3` and prompt Claude to emit ElevenLabs v3 audio tags (`[whispers]`, `[excited]`, etc.) inside its responses. Single voice (Einstein) still narrates everything; v3 delivers it with emotional variation. Tag-stripping render hook hides the brackets from chat display. A per-world `useEmoteTags` setting (default `true`) rolls back to turbo behavior when off.

**Architecture:** No new components. Three small surface changes in the proxy (TTS model literal, system-prompt assembly, join-params plumbing for the rollback knob), three small client changes (register setting, send on join, render-hook tag stripper). Builds on v0.4 voice infrastructure without disturbing it.

**Tech Stack:** Elixir / Phoenix / Ash / Finch (proxy). Plain ES modules + Foundry V13 hooks (client). ElevenLabs v3 model + audio-tag interpretation.

**Branching:** Both repos work on `feat/voice-v2-phase1` off `main`. Fast-forward merge when smoke test passes; module tag `v0.5.0` + proxy deploy on the same day.

**Repository layout:**
- Foundry module: `~/work/loremaster` (this plan lives here)
- Elixir proxy: `~/work/loremaster-proxy-elixir`

---

## Phase 0 — Pre-flight research + branch setup

### Task 0a: Verify ElevenLabs v3 production status

**Files:** none — research only.

- [ ] **Step 1: Check v3 model availability**

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/models | jq '.[] | select(.model_id == "eleven_v3" or (.model_id | tostring | contains("v3"))) | {model_id, name, can_use_style, can_be_finetuned, language_codes}'
```

Expected: `eleven_v3` (or whatever its current canonical ID is) appears in the model list. Note the actual model_id string for use in Task 1.

- [ ] **Step 2: Check current per-character pricing**

Open https://elevenlabs.io/pricing in a browser. Note:
- Cost per 1k characters for `eleven_turbo_v2_5` (current Loremaster default)
- Cost per 1k characters for `eleven_v3`
- Document the ratio (training-data estimate was ~3×; confirm or correct)

- [ ] **Step 3: Fetch the official audio-tag list**

Check https://elevenlabs.io/docs/api-reference/text-to-speech (or the v3-specific docs page) for the canonical list of audio tags. Compare against the spec's seed allow-list:
`whispers, excited, sighs, laughs, crying, shouting, nervously, sarcastic, pleading, tired, breathless, serious, surprised`

Document any additions or renames. This list becomes the parser allow-list in Phase 2 — for Phase 1 we just need to know which tags Claude should be instructed to use.

- [ ] **Step 4: Quick latency benchmark**

```bash
# Replace VOICE_ID with n4gY9MeIbTbAMJ5rlJ51 (Einstein) and KEY with your ElevenLabs API key
time curl -s -o /tmp/v3.mp3 -X POST \
  https://api.elevenlabs.io/v1/text-to-speech/n4gY9MeIbTbAMJ5rlJ51 \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"[whispers] The wind howls outside. [excited] I can'\''t believe we made it!", "model_id":"eleven_v3"}'

# Then turbo for comparison
time curl -s -o /tmp/turbo.mp3 -X POST \
  https://api.elevenlabs.io/v1/text-to-speech/n4gY9MeIbTbAMJ5rlJ51 \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"The wind howls outside. I can'\''t believe we made it!", "model_id":"eleven_turbo_v2_5"}'
```

Expected: v3 latency < 5s p50 for ~200 char text (existing 30s receive_timeout has plenty of headroom). Listen to /tmp/v3.mp3 to confirm tag interpretation works audibly.

- [ ] **Step 5: Record findings**

Update `docs/VOICE_INTEGRATION_V2_SPEC.md` §12 (Pre-implementation research checklist) with the actual current values. Commit as a docs-only change before starting Task 1.

```bash
git add docs/VOICE_INTEGRATION_V2_SPEC.md
git commit -m "docs(voice): verified eleven_v3 pre-implementation checklist

- Model ID: <actual current ID>
- Pricing: <current $/1M chars> vs turbo's <current $/1M chars>
- Audio tag list confirmed matches spec seed, with <additions/changes>
- Latency: v3 p50 ~<N>s for 200 chars; under 5s threshold"
```

### Task 0b: Create feature branches in both repos

**Files:** branch state only.

- [ ] **Step 1: Module branch**

```bash
cd ~/work/loremaster
git checkout main && git pull origin main
git checkout -b feat/voice-v2-phase1
```

- [ ] **Step 2: Proxy branch**

```bash
cd ~/work/loremaster-proxy-elixir
git checkout main && git pull origin main
git checkout -b feat/voice-v2-phase1
```

- [ ] **Step 3: Verify**

```bash
cd ~/work/loremaster && git branch --show-current
cd ~/work/loremaster-proxy-elixir && git branch --show-current
```

Both should print `feat/voice-v2-phase1`.

---

## Phase 1 — Proxy changes

### Task 1: TTSManager — conditional model selection

**Files:**
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/services/tts_manager.ex`
- Modify: `~/work/loremaster-proxy-elixir/test/loremaster_proxy/services/tts_manager_test.exs`

- [ ] **Step 1: Write a failing test asserting model_id is selected by opts**

Append to `test/loremaster_proxy/services/tts_manager_test.exs`:

```elixir
  test "fetch_or_generate uses eleven_v3 when use_emote_tags: true", %{cache_dir: dir} do
    captured_model = :counters.new(2, [])  # [0] = v3 count, [1] = turbo count

    Mox.expect(VoiceIntTestMock, :post, fn _url, _headers, body ->
      case Jason.decode!(body) do
        %{"model_id" => "eleven_v3"} -> :counters.add(captured_model, 1, 1)
        %{"model_id" => "eleven_turbo_v2_5"} -> :counters.add(captured_model, 2, 1)
        _ -> :ok
      end
      {:ok, %{status: 200, body: <<255, 251, 144, 100, 1, 2>>}}
    end)

    Application.put_env(:loremaster_proxy, :elevenlabs,
      operator_api_key: "k", api_endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
      audio_cache_dir: dir, http_client: VoiceIntTestMock)

    {:ok, _, :cache_miss} =
      TTSManager.fetch_or_generate("w-mid", "c-#{System.unique_integer([:positive])}",
        "[whispers] hi", "voice-x", "key", use_emote_tags: true)

    assert :counters.get(captured_model, 1) == 1
    assert :counters.get(captured_model, 2) == 0
  end

  test "fetch_or_generate uses eleven_turbo_v2_5 when use_emote_tags: false", %{cache_dir: dir} do
    test_pid = self()

    Mox.expect(VoiceIntTestMock, :post, fn _url, _headers, body ->
      send(test_pid, {:model_used, Jason.decode!(body)["model_id"]})
      {:ok, %{status: 200, body: <<255, 251, 144, 100, 1, 2>>}}
    end)

    Application.put_env(:loremaster_proxy, :elevenlabs,
      operator_api_key: "k", api_endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
      audio_cache_dir: dir, http_client: VoiceIntTestMock)

    {:ok, _, :cache_miss} =
      TTSManager.fetch_or_generate("w-mid-off", "c-#{System.unique_integer([:positive])}",
        "plain text", "voice-x", "key", use_emote_tags: false)

    assert_received {:model_used, "eleven_turbo_v2_5"}
  end
```

Both tests reference `TTSManager.fetch_or_generate/6` (sixth arg = opts). Current signature is `/5`.

- [ ] **Step 2: Run, verify fail**

```bash
cd ~/work/loremaster-proxy-elixir
mix test test/loremaster_proxy/services/tts_manager_test.exs --trace
```

Expected: FAIL with `(UndefinedFunctionError) function ... fetch_or_generate/6 is undefined` (or arity mismatch).

- [ ] **Step 3: Extend fetch_or_generate to accept opts**

Open `lib/loremaster_proxy/services/tts_manager.ex`. Update `fetch_or_generate` signature and the inner generation function:

```elixir
  def fetch_or_generate(world_id, canon_id, text, voice_id, api_key, opts \\ []) do
    use_emote_tags = Keyword.get(opts, :use_emote_tags, true)
    path = cache_path(world_id, canon_id)

    if File.exists?(path) do
      {:ok, path, :cache_hit}
    else
      LoremasterProxy.Services.TTSGenerationLock.run_once(
        {world_id, canon_id},
        fn -> generate_and_cache(text, voice_id, api_key, path, use_emote_tags) end
      )
    end
  end
```

Update `generate_and_cache/4` → `generate_and_cache/5` and the model_id selection:

```elixir
  defp generate_and_cache(text, voice_id, api_key, path, use_emote_tags) do
    cfg = Application.get_env(:loremaster_proxy, :elevenlabs, [])
    url = "#{cfg[:api_endpoint]}/#{voice_id}"
    model_id = if use_emote_tags, do: "eleven_v3", else: "eleven_turbo_v2_5"

    headers = [
      {"xi-api-key", api_key},
      {"content-type", "application/json"},
      {"accept", "audio/mpeg"}
    ]

    body = Jason.encode!(%{text: text, model_id: model_id})
    # ... rest unchanged ...
  end
```

- [ ] **Step 4: Run tests, verify pass**

```bash
mix test test/loremaster_proxy/services/tts_manager_test.exs --trace
```

Expected: ALL tests in this file pass (both new ones + the pre-existing 4 from v0.4).

- [ ] **Step 5: Commit**

```bash
git add lib/loremaster_proxy/services/tts_manager.ex test/loremaster_proxy/services/tts_manager_test.exs
git commit -m "feat(voice-v2): TTSManager selects v3 model when use_emote_tags is true

Adds a per-request opts keyword to fetch_or_generate, default
use_emote_tags: true. When true, model_id is eleven_v3 (interprets
[whispers]/[excited]/etc. audio tags in the text). When false, falls
back to eleven_turbo_v2_5 — preserves v0.4 behavior for users who
disable emote tags on their world."
```

---

### Task 2: System prompt — append audio-tag instruction

**Files:**
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/game/conversation_server.ex`
- New: `~/work/loremaster-proxy-elixir/test/loremaster_proxy/services/audio_tag_prompt_test.exs`

The system-prompt assembly entry point is `build_system_prompt/2` at line 765 of `conversation_server.ex`. We append an audio-tag instructions section when `use_emote_tags: true` is in opts.

- [ ] **Step 1: Write a failing test**

Create `test/loremaster_proxy/services/audio_tag_prompt_test.exs`:

```elixir
defmodule LoremasterProxy.Services.AudioTagPromptTest do
  use ExUnit.Case, async: true

  # We test the build_system_prompt function in isolation. Since it's a private
  # defp in ConversationServer, we go through the public path by inspecting
  # what gets sent to Claude. The simplest is to add a public wrapper for
  # testability OR test the prompt assembly via the MultiplayerPrompts module
  # which builds on top of build_system_prompt's output.
  #
  # For this phase we add a module-level helper exposed as a public function:
  #     LoremasterProxy.Services.AudioTagPrompt.append/2

  alias LoremasterProxy.Services.AudioTagPrompt

  test "append/2 adds audio-tag guidance when enabled is true" do
    base = "You are the Loremaster, a Game Master."
    result = AudioTagPrompt.append(base, true)
    assert result =~ base
    assert result =~ "[whispers]"
    assert result =~ "[excited]"
    assert result =~ "audio tag"
  end

  test "append/2 returns base prompt unchanged when enabled is false" do
    base = "You are the Loremaster, a Game Master."
    assert AudioTagPrompt.append(base, false) == base
  end
end
```

- [ ] **Step 2: Run, verify fail**

```bash
mix test test/loremaster_proxy/services/audio_tag_prompt_test.exs --trace
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the helper**

Create `lib/loremaster_proxy/services/audio_tag_prompt.ex`:

```elixir
defmodule LoremasterProxy.Services.AudioTagPrompt do
  @moduledoc """
  System-prompt section instructing Claude to use ElevenLabs v3 audio tags
  for emotional delivery cues. Appended to the base system prompt when the
  caller's world setting `useEmoteTags` is true.

  Tags are interpreted by the v3 TTS model to vary delivery within a single
  voice. Render-side hook strips them from the displayed chat content; the
  raw text on the wire and in canon storage keeps the brackets.

  Allow-list mirrors the parser's allow-list (v2-spec §4.2).
  """

  @audio_tag_section """

  ## Audio delivery cues (when speaking aloud)

  Your responses are read aloud via a text-to-speech model that interprets
  inline audio tags for emotional delivery. Use these tags **sparingly** for
  emotionally significant moments — not every line. Tags use lowercase words
  in square brackets and stay inline with the text.

  Available tags:
  `[whispers]`, `[excited]`, `[sighs]`, `[laughs]`, `[crying]`, `[shouting]`,
  `[nervously]`, `[sarcastic]`, `[pleading]`, `[tired]`, `[breathless]`,
  `[serious]`, `[surprised]`

  Example of good use:
  > [whispers] Did you hear that? [excited] I can't believe we made it!

  Example of overuse to avoid:
  > [tired] The old man [sighs] greeted them [serious] with [nervous] a wary glance.

  Tags affect only audio delivery; they are stripped from on-screen text.
  """

  @doc """
  Append the audio-tag section to a base prompt when `enabled` is true.
  Returns the base prompt unchanged when `enabled` is false.
  """
  @spec append(String.t(), boolean()) :: String.t()
  def append(base_prompt, true), do: base_prompt <> @audio_tag_section
  def append(base_prompt, false), do: base_prompt
end
```

- [ ] **Step 4: Run, verify pass**

```bash
mix test test/loremaster_proxy/services/audio_tag_prompt_test.exs --trace
```

Expected: 2 tests, 0 failures.

- [ ] **Step 5: Wire into conversation_server's build_system_prompt**

Open `lib/loremaster_proxy/game/conversation_server.ex`. Find `defp build_system_prompt(base_prompt, opts)` at line 765. Modify to:

```elixir
  defp build_system_prompt(base_prompt, opts) do
    is_batch = Keyword.get(opts, :is_batch, false)
    correction = Keyword.get(opts, :correction, nil)
    use_emote_tags = Keyword.get(opts, :use_emote_tags, true)

    base_prompt
    |> LoremasterProxy.Services.AudioTagPrompt.append(use_emote_tags)
    |> LoremasterProxy.Services.MultiplayerPrompts.build_batch_system_prompt(is_batch, correction)
  end
```

(Adjust the exact existing code shape — the pre-existing function reads `is_batch`/`correction` from opts and calls `MultiplayerPrompts.build_batch_system_prompt/3`. Insert the audio-tag append BEFORE the multiplayer prompt wrapping so the audio guidance sits in the "core" prompt rather than the multiplayer-specific section.)

- [ ] **Step 6: Run all tests**

```bash
mix test
```

Expected: all green (no regressions; previously 565 passing).

- [ ] **Step 7: Commit**

```bash
git add lib/loremaster_proxy/services/audio_tag_prompt.ex \
        lib/loremaster_proxy/game/conversation_server.ex \
        test/loremaster_proxy/services/audio_tag_prompt_test.exs
git commit -m "feat(voice-v2): AudioTagPrompt section appended to system prompt

Instructs Claude to use ElevenLabs v3 audio tags (whispers/excited/etc)
sparingly for emotionally significant beats. Tags are stripped from
chat display via render hook; raw text on the wire keeps them so the
TTS model can interpret them. Allow-list mirrors the parser allow-list
in v2-spec §4.2.

build_system_prompt in conversation_server reads use_emote_tags from
opts (default true) and conditionally appends the section."
```

---

### Task 3: WorldChannel — thread useEmoteTags through join + chat opts

**Files:**
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy_web/channels/world_channel.ex`
- Modify: `~/work/loremaster-proxy-elixir/test/loremaster_proxy_web/channels/world_channel_voice_test.exs` (extend)

- [ ] **Step 1: Write a failing channel test asserting `useEmoteTags` is captured from join**

Append a new describe block to `test/loremaster_proxy_web/channels/world_channel_voice_test.exs`:

```elixir
  describe "useEmoteTags from join params" do
    test "self-hosted join captures useEmoteTags: true and forwards to chat opts" do
      {:ok, _, socket} =
        WorldSocket
        |> socket("u-emote-t", %{})
        |> subscribe_and_join(LoremasterProxyWeb.WorldChannel, "world:emote-on", %{
          "apiKey" => "sk-ant-test",
          "userId" => "u1",
          "userName" => "T",
          "isGM" => true,
          "useEmoteTags" => true
        })

      assert socket.assigns.use_emote_tags == true
    end

    test "self-hosted join captures useEmoteTags: false" do
      {:ok, _, socket} =
        WorldSocket
        |> socket("u-emote-f", %{})
        |> subscribe_and_join(LoremasterProxyWeb.WorldChannel, "world:emote-off", %{
          "apiKey" => "sk-ant-test",
          "userId" => "u2",
          "userName" => "T",
          "isGM" => true,
          "useEmoteTags" => false
        })

      assert socket.assigns.use_emote_tags == false
    end

    test "self-hosted join defaults to true when useEmoteTags absent" do
      {:ok, _, socket} =
        WorldSocket
        |> socket("u-emote-d", %{})
        |> subscribe_and_join(LoremasterProxyWeb.WorldChannel, "world:emote-default", %{
          "apiKey" => "sk-ant-test",
          "userId" => "u3",
          "userName" => "T",
          "isGM" => true
        })

      assert socket.assigns.use_emote_tags == true
    end
  end
```

- [ ] **Step 2: Run, verify fail**

```bash
mix test test/loremaster_proxy_web/channels/world_channel_voice_test.exs --trace
```

Expected: 3 new failures (asserts on `socket.assigns.use_emote_tags` which doesn't exist yet).

- [ ] **Step 3: Capture `useEmoteTags` in both join handlers**

In `lib/loremaster_proxy_web/channels/world_channel.ex`, find `handle_self_hosted_join/6` and `handle_hosted_join/6`. After the existing voice-related extractions (where we already pulled `elevenLabsApiKey` and `voiceId` in v0.4), add the boolean extraction in both:

```elixir
    use_emote_tags = params["useEmoteTags"]
    # Treat missing as true (the default in spec §3.1)
    use_emote_tags = if is_nil(use_emote_tags), do: true, else: use_emote_tags
```

In both join handlers' socket assign chain, append:

```elixir
          |> assign(:use_emote_tags, use_emote_tags)
```

- [ ] **Step 4: Thread to chat opts**

Find the `chat` handler (around line 490 of `world_channel.ex`, the existing `handle_in("chat", ...)`). In the `opts` keyword list (currently has `user_id`, `is_private`, `api_key`, `channel_pid`, `db_user_id`, `user_tier`, `deployment_mode`), add:

```elixir
          use_emote_tags: socket.assigns[:use_emote_tags] != false
```

(Using `!= false` so nil-or-missing defaults to true, matching the spec.)

- [ ] **Step 5: Thread to request-tts handler**

The existing `handle_in("request-tts", ...)` (added in v0.4) calls `TTSManager.fetch_or_generate(world_id, canon_id, text, voice_id, key)`. Extend to pass opts:

```elixir
        case LoremasterProxy.Services.TTSManager.fetch_or_generate(
               world_id, canon_id, text, voice_id, key,
               use_emote_tags: socket.assigns[:use_emote_tags] != false
             ) do
```

- [ ] **Step 6: Run all tests, verify pass**

```bash
mix test
```

Expected: 568 passing, 1 skipped (565 prior + 3 new).

- [ ] **Step 7: Commit**

```bash
git add lib/loremaster_proxy_web/channels/world_channel.ex \
        test/loremaster_proxy_web/channels/world_channel_voice_test.exs
git commit -m "feat(voice-v2): pass useEmoteTags from join params through chat + TTS opts

Both join handlers (self-hosted, hosted) extract useEmoteTags from
phx_join params with default true. Value lands on socket.assigns and
threads into the chat handler's opts (for system-prompt assembly) and
the request-tts handler's TTSManager call (for model selection).

This is the rollback knob: setting useEmoteTags=false in a world makes
the system prompt drop the audio-tag instructions and TTSManager use
eleven_turbo_v2_5 — matching v0.4 behavior."
```

---

## Phase 2 — Client changes (Foundry module)

### Task 4: Register useEmoteTags setting + i18n

**Files:**
- Modify: `~/work/loremaster/scripts/config.mjs`
- Modify: `~/work/loremaster/lang/en.json`

- [ ] **Step 1: Add setting registration**

Open `scripts/config.mjs`. Find the existing `voiceId` / `voiceVolume` voice-related settings (registered in v0.4 in the same file). Add after them:

```javascript
  game.settings.register(MODULE_ID, 'useEmoteTags', {
    name: game.i18n.localize('LOREMASTER.Voice.EmoteTags.Label'),
    hint: game.i18n.localize('LOREMASTER.Voice.EmoteTags.Hint'),
    scope: 'world',
    config: true,
    type: Boolean,
    default: true
  });
```

- [ ] **Step 2: Add i18n strings**

Open `lang/en.json`. Locate the existing `LOREMASTER.Voice` nested namespace (added in v0.4). Add an `EmoteTags` subsection:

```json
        "EmoteTags": {
          "Label": "Use ElevenLabs v3 audio tags",
          "Hint": "When on, Loremaster uses ElevenLabs v3 (more expressive) and Claude is instructed to add tags like [whispers], [excited] for emotional delivery. When off, falls back to eleven_turbo_v2_5 with no emote variation. Per-world setting; default on."
        },
```

(Place inside `Voice` object, preserve trailing-comma rules for valid JSON.)

- [ ] **Step 3: Sanity check**

```bash
cd ~/work/loremaster
node -e 'JSON.parse(require("fs").readFileSync("lang/en.json"))' && echo "JSON OK"
node --check scripts/config.mjs && echo "JS OK"
```

Both should print OK.

- [ ] **Step 4: Commit**

```bash
git add scripts/config.mjs lang/en.json
git commit -m "feat(voice-v2): register useEmoteTags world setting + i18n strings"
```

---

### Task 5: Send useEmoteTags on phx_join

**Files:**
- Modify: `~/work/loremaster/scripts/socket-client.mjs`

The wire-frame whitelist bug from v0.4 (commit `ae163b1`) is the cautionary tale — the field must be propagated into BOTH the `authenticate()` payload builder AND `_phoenixAuthenticate`'s explicit join payload.

- [ ] **Step 1: Read the existing authenticate() payload build**

```bash
cd ~/work/loremaster
grep -n "elevenLabsApiKey\|voiceId\|authenticate\|_phoenixAuthenticate" scripts/socket-client.mjs | head -15
```

Confirm the spots that need editing: the hosted branch (line ~266 in v0.4 form) AND the self-hosted branch (line ~287), plus the wire-frame whitelist in `_phoenixAuthenticate` (~line 404).

- [ ] **Step 2: Add useEmoteTags to BOTH branches of authenticate()**

In the hosted branch, after `payload.voiceId = voiceId` (only set when truthy), add:

```javascript
      const useEmoteTags = getSetting('useEmoteTags');
      // Boolean false must be sent explicitly (default-on requires omit ≠ false on the server).
      payload.useEmoteTags = useEmoteTags !== false;
```

In the self-hosted branch (after the existing `voiceId` block), add the identical:

```javascript
      const useEmoteTags = getSetting('useEmoteTags');
      payload.useEmoteTags = useEmoteTags !== false;
```

- [ ] **Step 3: Add useEmoteTags to the explicit wire-frame in _phoenixAuthenticate**

Find the `this.ws.send(JSON.stringify({ topic, event: 'phx_join', payload: { apiKey: ..., ..., voiceId: payload.voiceId } }))` block. Add to the payload object:

```javascript
          voiceId: payload.voiceId,
          useEmoteTags: payload.useEmoteTags
```

(Append AFTER `voiceId` to keep the diff small.)

- [ ] **Step 4: Sanity check**

```bash
node --check scripts/socket-client.mjs && echo "OK"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/socket-client.mjs
git commit -m "feat(voice-v2): send useEmoteTags in phx_join wire payload

Threads the new per-world setting through authenticate() AND the
explicit wire-frame whitelist in _phoenixAuthenticate. The whitelist
was the v0.4 wire-frame bug origin (ae163b1) — touching both is the
muscle memory.

Boolean false is sent explicitly; server treats missing as true (the
spec default)."
```

---

### Task 6: Render hook — strip audio tags from displayed text

**Files:**
- Create: `~/work/loremaster/scripts/message-formatter.mjs`
- Modify: `~/work/loremaster/scripts/loremaster.mjs` (wire the hook)

- [ ] **Step 1: Create the message-formatter module**

Create `~/work/loremaster/scripts/message-formatter.mjs`:

```javascript
/**
 * message-formatter.mjs — render-time transformations for Loremaster AI
 * responses in Foundry chat. Currently strips ElevenLabs v3 audio tags
 * (e.g. [whispers], [excited]) so they show clean prose to readers while
 * the persisted message content keeps the brackets for TTS reuse.
 *
 * Hooks into renderChatMessageHTML. Idempotent: safe to call multiple
 * times on the same message; only strips text-node content, never
 * touches button/data attributes (so existing v0.4 replay icon + canon
 * data-message-id stay intact).
 */

const MODULE_ID = 'loremaster';

// Allow-list of audio tag tokens that v3 interprets. Mirrors the parser
// allow-list in the v2 spec §4.2. Add tokens here as ElevenLabs publishes
// new ones; do NOT add speaker names — those are stripped via different
// regex in Phase 2.
const AUDIO_TAG_REGEX =
  /\[(whispers|excited|sighs|laughs|crying|shouting|nervously|sarcastic|pleading|tired|breathless|serious|surprised)\]/gi;

/**
 * Strip audio tags from the rendered chat-message DOM.
 * Walks text nodes in-place; preserves all other DOM structure.
 *
 * @param {HTMLElement} element - the rendered chat message element from
 *   the renderChatMessageHTML hook.
 * @returns {void}
 */
export function stripAudioTagsFromMessage(element) {
  if (!(element instanceof HTMLElement)) return;
  const content = element.querySelector('.message-content');
  if (!content) return;

  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const toReplace = [];
  let node;
  while ((node = walker.nextNode())) {
    if (AUDIO_TAG_REGEX.test(node.nodeValue)) {
      toReplace.push(node);
    }
  }
  // Reset regex state (g flag makes test() stateful).
  AUDIO_TAG_REGEX.lastIndex = 0;

  for (const textNode of toReplace) {
    textNode.nodeValue = textNode.nodeValue.replace(AUDIO_TAG_REGEX, '');
    AUDIO_TAG_REGEX.lastIndex = 0;
  }
}
```

- [ ] **Step 2: Wire the hook in loremaster.mjs**

Open `scripts/loremaster.mjs`. Find the existing `Hooks.on('renderChatMessageHTML', ...)` block (the one that handles veto controls and replay icons). Add at the top of the handler:

```javascript
import { stripAudioTagsFromMessage } from './message-formatter.mjs';
```

Inside the existing hook handler body, add:

```javascript
      // Strip ElevenLabs v3 audio tags from displayed prose. Idempotent.
      const renderedElement = html instanceof HTMLElement ? html : html?.[0];
      if (message.flags?.[MODULE_ID]?.isAIResponse || message.flags?.[MODULE_ID]?.isCanon) {
        stripAudioTagsFromMessage(renderedElement);
      }
```

Place this BEFORE the existing veto-controls / replay-icon logic so the tags are gone by the time those features touch the DOM.

- [ ] **Step 3: Sanity check**

```bash
node --check scripts/message-formatter.mjs && node --check scripts/loremaster.mjs && echo "OK"
```

- [ ] **Step 4: Manual verification in Foundry**

Reload Foundry. Send `@lm describe a moment of dramatic tension in one sentence`. After Claude responds, inspect the chat message in browser DevTools:

```js
const msg = game.messages.contents.slice(-1)[0];
console.log('Stored content:', msg?.content);
const rendered = document.querySelector(`[data-message-id="${msg.id}"] .message-content`).textContent;
console.log('Rendered text:', rendered);
```

If Claude emitted an audio tag (note: it might not on a single one-shot prompt; the system prompt encourages sparing use), the stored `content` should contain the bracket and the rendered text should not. Both fine if there's no tag in this particular response — the regex just runs on whatever's there.

- [ ] **Step 5: Commit**

```bash
git add scripts/message-formatter.mjs scripts/loremaster.mjs
git commit -m "feat(voice-v2): strip ElevenLabs audio tags from displayed chat content

New message-formatter.mjs module with stripAudioTagsFromMessage() that
walks text nodes in the rendered chat message's .message-content and
removes any [whispers]/[excited]/etc. tokens matching the v3 audio-tag
allow-list. Tags stay in the persisted ChatMessage.content for TTS
playback to read; users see clean prose.

Hook is wired from loremaster.mjs's existing renderChatMessageHTML
listener; runs before veto-controls/replay-icon decoration so other
features see post-stripped DOM. Idempotent.

Allow-list mirrors the parser allow-list in v2-spec §4.2 + AudioTagPrompt
on the proxy side."
```

---

## Phase 3 — Smoke test, deploy, release

### Task 7: Push both branches + deploy proxy to dev + manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Push branches**

```bash
cd ~/work/loremaster && git push origin feat/voice-v2-phase1
cd ~/work/loremaster-proxy-elixir && git push origin feat/voice-v2-phase1
```

- [ ] **Step 2: Deploy proxy feat branch to greenmox dev**

```bash
ssh -A greenmox "set -e
  cd /opt/loremaster-dev
  git fetch origin
  git checkout feat/voice-v2-phase1
  git pull
  docker build -t loremaster-proxy-elixir:dev . 2>&1 | tail -3
  docker compose up -d --force-recreate proxy 2>&1 | tail -3
  until docker compose ps proxy --format '{{.Status}}' | grep -q healthy; do sleep 3; done
  echo HEALTHY
"
```

- [ ] **Step 3: Verify the dev container has the new code**

```bash
ssh greenmox "docker logs --tail=20 loremaster-proxy-elixir-dev 2>&1 | grep -iE 'started|migrate|warning' | head -10"
```

Expected: clean startup, Bandit on port 4000.

- [ ] **Step 4: Smoke test in Foundry against dev**

1. Reload Foundry (the hardlinked module picks up the client commits automatically).
2. In Loremaster Settings, verify "Use ElevenLabs v3 audio tags" is visible and defaults to ON.
3. Toggle "Hear AI voice" on (if not already). API key set, voice ID = Einstein.
4. Send `@lm! In one short paragraph, describe a tense moment between two characters in a moonlit tavern. Include dialogue.` and Publish.
5. **Verify in proxy logs that the v3 model was called**:

```bash
ssh greenmox "docker logs --tail=20 loremaster-proxy-elixir-dev 2>&1 | grep -iE 'tts|elevenlabs|model' | tail -10"
```

Look for evidence of the v3 model_id in the request. If the proxy logs the request body, the model_id should be `eleven_v3`. If not, add a Logger.debug line temporarily or grep wider.

6. Listen to the audio: does it have audible variation matching any tags Claude emitted? (May not — system prompt instructs sparing use. Try a more explicitly emotional prompt if no tags appear: `@lm! Roland whispers a secret to Adventurer about an excited discovery.`)
7. **Check chat display**: do you see clean prose or `[whispers]` brackets? If the stripping hook didn't fire, brackets will be visible.

   Browser console verification:
   ```js
   const last = game.messages.contents.slice(-1)[0];
   console.log('Stored:', last.content);
   console.log('Rendered:', document.querySelector(`[data-message-id="${last.id}"] .message-content`).textContent);
   ```

8. Toggle `useEmoteTags` OFF in settings. Reload Foundry. Send the same prompt. Verify:
   - System prompt does NOT mention audio tags (check proxy logs / Claude request body)
   - TTSManager uses `eleven_turbo_v2_5`
   - Behavior matches v0.4 exactly

- [ ] **Step 5: If smoke test passes, merge to main + push**

```bash
cd ~/work/loremaster
git checkout main && git pull
git merge --ff-only feat/voice-v2-phase1
git push origin main

cd ~/work/loremaster-proxy-elixir
git checkout main && git pull
git merge --ff-only feat/voice-v2-phase1
git push origin main
```

- [ ] **Step 6: Deploy proxy main to prod (Hetzner)**

Follow `docs/DEPLOY.md` in the proxy repo (git archive → scp → ssh build + recreate). Brief form:

```bash
cd ~/work/loremaster-proxy-elixir
git archive --format=tar origin/main -o /tmp/loremaster-proxy.tar
scp /tmp/loremaster-proxy.tar loremaster-prod:/tmp/loremaster-proxy.tar
ssh loremaster-prod "
  docker tag loremaster-proxy-elixir:latest loremaster-proxy-elixir:vPREV-\$(date +%Y%m%d)
  cd /home/jerry/loremaster-build
  find . -mindepth 1 -maxdepth 1 ! -name foundry-module -exec rm -rf {} +
  tar -xf /tmp/loremaster-proxy.tar
  docker build -t loremaster-proxy-elixir:latest .
  cd /opt/loremaster
  docker compose up -d --force-recreate proxy
  until docker compose ps proxy --format '{{.Status}}' | grep -q healthy; do sleep 3; done
  echo HEALTHY
"
```

Then `curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://api.loremastervtt.com/health` — expect 200.

- [ ] **Step 7: Bump module version + tag v0.5.0**

```bash
cd ~/work/loremaster
# Edit module.json: "version": "0.4.1" → "0.5.0"
git add module.json
git commit -m "release: bump version to 0.5.0 — voice integration v2 phase 1 (audio tags)

Switches TTS model from eleven_turbo_v2_5 to eleven_v3 (when
useEmoteTags=true, default). System prompt instructs Claude to use v3
audio tags (whispers/excited/etc.) sparingly for emotional delivery.
Render hook strips tags from displayed chat content. Per-world
useEmoteTags toggle is the rollback to v0.4 behavior."
git push origin main
git tag v0.5.0
git push origin v0.5.0

# Create GitHub Release to trigger the build workflow
gh release create v0.5.0 --title "v0.5.0 — Voice integration v2 phase 1 (audio tags)" \
  --notes "Switches TTS to ElevenLabs v3 and prompts Claude to emit audio tags ([whispers], [excited], etc.) for emotional delivery. Single voice (Einstein) still narrates everything; v3 delivers it with emotional variation. Tags are stripped from chat display; the per-world setting 'Use ElevenLabs v3 audio tags' toggles back to v0.4 behavior.

Per-NPC voices coming in v0.6.0 (Phase 2 of the voice v2 spec)."
```

- [ ] **Step 8: Confirm release workflow built + published**

```bash
until gh run list --workflow=release.yml --limit 1 --json status --jq '.[0].status' 2>&1 | grep -q completed; do sleep 5; done
gh run list --workflow=release.yml --limit 1
gh release view v0.5.0 --json assets --jq '.assets[] | {name, size}'
```

Expect `module.zip` + `module.json` attached, workflow status `success`.

---

## Self-review (already run)

**Spec coverage:**
- §1 Goal: phase split shipped — Phase 1 emote tags only ✓ (covered by Tasks 1-7)
- §3.1 Phase 1 changes: model swap (Task 1), system prompt (Task 2), render-hook stripping (Task 6), rollback knob (Tasks 3-5) all covered ✓
- §4.1 Wire format: parser allow-list seeded in Task 2's AudioTagPrompt + Task 6's message-formatter ✓
- §4.3 Render-time stripping: Task 6 implements ✓
- §6.1 Phase 1 components: all enumerated, all tasked ✓
- §7.1 Data flow Phase 1: matches actual implementation (canon publish → existing v0.4 path with v3 model swap + tag stripping at render) ✓
- §8.1 useEmoteTags setting: Task 4 ✓
- §9 Error handling Phase 1 rows: rollback knob (Task 3+5), v3 unavailable graceful (TTSManager error path unchanged), tag-stripping miss (regex on allow-list; rare additions log into "rendered as raw" — acceptable v0.5.1 followup) ✓
- §12 Pre-implementation research: Task 0a ✓
- §13.1 Acceptance criteria 1-5: validated in Task 7 smoke test ✓

**Placeholder scan:** no TBD/TODO/FIXME ✓

**Type consistency:** `use_emote_tags` (snake_case Elixir) ↔ `useEmoteTags` (camelCase JS) — names converted consistently at the wire boundary in Tasks 3 (proxy reads `params["useEmoteTags"]`) and 5 (client sends `payload.useEmoteTags`). `fetch_or_generate/6` signature consistent across Task 1 (definition) and Task 3 (call site). `stripAudioTagsFromMessage` exported in Task 6, imported with the same name.

**Scope check:** 8 tasks (0a, 0b, 1, 2, 3, 4, 5, 6, 7), all sized for 2-30 minutes of focused work. One cohesive ship. No subsystem decomposition needed.

---

## Parallelization hints for `/team` execution

Dependency graph:

```
0a (research) ─┬─► 1 (TTSManager model) ─┐
               ├─► 2 (System prompt)     ├─► 3 (WorldChannel threading) ─┐
               └─► 4 (Client setting)     │                              │
                   └─► 5 (Wire payload)   │                              ├─► 7 (smoke + release)
                       └─► 6 (Render hook)┘                              │
                                                                          │
0b (branches) ─────────────────────────────────────────────────────────► (prerequisite)
```

- Task 0a (research) blocks everything except 0b.
- 0b (branches) is independent and trivial; do first.
- Tasks 1, 2, 4 can run in parallel after 0a.
- Task 3 depends on Task 1 (calls `fetch_or_generate/6`) and Task 2 (passes `use_emote_tags` to opts).
- Task 5 depends on Task 4 (reads the setting).
- Task 6 depends on Task 4 (no — it's independent; actually only depends on Task 0a's audio-tag list).
- Task 7 depends on everything.

A 3-agent team running Tasks 1, 2, 4 in parallel after 0a, then Tasks 3, 5, 6 in parallel, then Task 7 sequentially is the natural shape.

---

*End of plan. Ready for `/team` execution.*
