# Voice Integration v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v1 MVP described in `docs/VOICE_INTEGRATION_SPEC.md` — bidirectional voice with ElevenLabs TTS on canon publish (per-user opt-in, default off) and browser Web Speech API STT via push-to-talk.

**Architecture:** Lazy on-demand TTS generation through the existing Phoenix WebSocket; per-canon MP3 cache on the proxy filesystem dedups across listeners; STT runs entirely client-side through `webkitSpeechRecognition`, no proxy involvement. Same code path serves hosted (operator-keyed) and self-hosted (user-keyed) modes.

**Tech Stack:** Elixir / Phoenix / Ash / Finch / Plug.Static for the proxy. Plain ES modules + Handlebars + browser Web Speech & Audio APIs for the Foundry module. ElevenLabs `/v1/text-to-speech/{voice_id}` HTTP API.

**Branching strategy:** All work happens on `feat/voice-integration` off `main`, fast-forward merges back when Phase 5 acceptance criteria pass on the dev container. No release tag is part of this plan; that's a separate `git tag v0.4.0` after the user verifies in Foundry.

**Repository layout:** Two repos work in parallel:
- Foundry module: `~/work/loremaster` (this file lives here)
- Elixir proxy: `~/work/loremaster-proxy-elixir`

A few tasks span both (e.g. the auth payload extension); each task's "Files" block names the absolute repo path.

**DOM construction note (client tasks):** All client-side DOM construction in this plan uses `document.createElement` + `classList` + `textContent` + `appendChild` rather than `innerHTML`. Even though our injected content is static (Font Awesome icons + i18n-localized strings, no user input), the explicit pattern is safer and matches the modern Foundry V13+ style guide.

---

## Phase 0 — Branch setup

### Task 0: Create the feature branches in both repos

**Files:**
- Modify: `~/work/loremaster` (git branch only)
- Modify: `~/work/loremaster-proxy-elixir` (git branch only)

- [ ] **Step 1: Create branch in module repo**

```bash
cd ~/work/loremaster
git checkout main
git pull origin main
git checkout -b feat/voice-integration
```

Expected: switched to a new branch named `feat/voice-integration`.

- [ ] **Step 2: Create branch in proxy repo**

```bash
cd ~/work/loremaster-proxy-elixir
git checkout main
git pull origin main
git checkout -b feat/voice-integration
```

Expected: switched to a new branch named `feat/voice-integration`.

- [ ] **Step 3: Verify both branches exist**

```bash
cd ~/work/loremaster && git branch --show-current
cd ~/work/loremaster-proxy-elixir && git branch --show-current
```

Expected: both print `feat/voice-integration`.

---

## Phase 1 — Proxy backbone

Five tasks, all in `~/work/loremaster-proxy-elixir`. Phase produces a working `request-tts` handler that hits ElevenLabs, caches the MP3, and returns a signed playback URL.

### Task 1: Add `audio_chars_consumed` column to UsageLog

**Files:**
- Create: `~/work/loremaster-proxy-elixir/priv/repo/migrations/<timestamp>_add_audio_chars_to_usage_log.exs`
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/accounts/usage_log.ex`

- [ ] **Step 1: Generate the migration file**

```bash
cd ~/work/loremaster-proxy-elixir
mix ecto.gen.migration add_audio_chars_to_usage_log
```

Expected: a file appears at `priv/repo/migrations/<timestamp>_add_audio_chars_to_usage_log.exs`.

- [ ] **Step 2: Write the migration body**

Edit the generated file and replace the `change/0` body:

```elixir
defmodule LoremasterProxy.Repo.Migrations.AddAudioCharsToUsageLog do
  use Ecto.Migration

  def change do
    alter table(:usage_logs) do
      add :audio_chars_consumed, :integer, default: 0, null: false
    end
  end
end
```

- [ ] **Step 3: Add the attribute to the Ash resource**

Open `lib/loremaster_proxy/accounts/usage_log.ex`. Inside the `attributes do` block, after the existing token attributes, add:

```elixir
    attribute :audio_chars_consumed, :integer do
      default 0
      allow_nil? false
      public? true
    end
```

- [ ] **Step 4: Run the migration**

```bash
mix ecto.migrate
```

Expected: `[info] == Migrated <timestamp> in N.Ns`.

- [ ] **Step 5: Verify column exists**

```bash
mix ecto.dump
grep audio_chars priv/repo/structure.sql
```

Expected: a line containing `audio_chars_consumed integer DEFAULT 0 NOT NULL`.

- [ ] **Step 6: Commit**

```bash
git add priv/repo/migrations/*audio_chars* priv/repo/structure.sql lib/loremaster_proxy/accounts/usage_log.ex
git commit -m "feat(voice): add audio_chars_consumed to UsageLog"
```

---

### Task 2: TTSManager — cache lookup + ElevenLabs call

**Files:**
- Create: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/services/tts_manager.ex`
- Create: `~/work/loremaster-proxy-elixir/test/loremaster_proxy/services/tts_manager_test.exs`
- Modify: `~/work/loremaster-proxy-elixir/config/runtime.exs`

- [ ] **Step 1: Add operator ElevenLabs key to runtime config**

Open `config/runtime.exs` and inside the existing `:loremaster_proxy` config block, add a new keyword:

```elixir
config :loremaster_proxy, :elevenlabs,
  operator_api_key: System.get_env("OPERATOR_ELEVENLABS_API_KEY"),
  api_endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
  audio_cache_dir: System.get_env("AUDIO_CACHE_DIR") || "/data/audio"
```

Add a startup warning right next to the existing one for the Claude operator key in `lib/loremaster_proxy/application.ex`:

```elixir
    elevenlabs_key = Application.get_env(:loremaster_proxy, :elevenlabs, [])[:operator_api_key]
    if is_nil(elevenlabs_key) or elevenlabs_key == "" do
      IO.puts("[warning] [Startup] OPERATOR_ELEVENLABS_API_KEY is not set — hosted-mode voice calls will fail (self-hosted users still work).")
    end
```

- [ ] **Step 2: Write the failing test**

```elixir
# test/loremaster_proxy/services/tts_manager_test.exs
defmodule LoremasterProxy.Services.TTSManagerTest do
  use ExUnit.Case, async: false

  alias LoremasterProxy.Services.TTSManager

  setup do
    tmp = System.tmp_dir!() |> Path.join("tts-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)

    Application.put_env(:loremaster_proxy, :elevenlabs,
      operator_api_key: "fake-key",
      api_endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
      audio_cache_dir: tmp
    )

    %{cache_dir: tmp}
  end

  test "cache hit returns existing path without HTTP call", %{cache_dir: dir} do
    world_id = "world-1"
    canon_id = "abc-123"
    cached_path = Path.join([dir, world_id, "#{canon_id}.mp3"])
    File.mkdir_p!(Path.dirname(cached_path))
    File.write!(cached_path, "fake-mp3")

    assert {:ok, ^cached_path, :cache_hit} =
             TTSManager.fetch_or_generate(world_id, canon_id, "ignored", "voice-rachel", "fake-key")
  end
end
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
mix test test/loremaster_proxy/services/tts_manager_test.exs --trace
```

Expected: FAIL with `(UndefinedFunctionError) function LoremasterProxy.Services.TTSManager.fetch_or_generate/5 is undefined`.

- [ ] **Step 4: Write minimal cache-hit implementation**

```elixir
# lib/loremaster_proxy/services/tts_manager.ex
defmodule LoremasterProxy.Services.TTSManager do
  @moduledoc """
  ElevenLabs TTS HTTP client with on-disk MP3 cache keyed by canon ID.

  Cache layout: <cache_dir>/<world_id>/<canon_id>.mp3
  Concurrency: see TTSGenerationLock for serialized regeneration.
  Char accounting: each cache miss logs char count to UsageLog (Task 4).
  """

  require Logger

  @doc """
  Fetch the MP3 path for a canon entry, generating it via ElevenLabs on cache miss.

  Returns:
    - {:ok, path, :cache_hit}
    - {:ok, path, :cache_miss}
    - {:error, reason}
  """
  def fetch_or_generate(world_id, canon_id, text, voice_id, api_key) do
    path = cache_path(world_id, canon_id)

    if File.exists?(path) do
      {:ok, path, :cache_hit}
    else
      generate_and_cache(world_id, canon_id, text, voice_id, api_key, path)
    end
  end

  defp cache_path(world_id, canon_id) do
    cfg = Application.get_env(:loremaster_proxy, :elevenlabs, [])
    Path.join([cfg[:audio_cache_dir] || "/data/audio", world_id, "#{canon_id}.mp3"])
  end

  defp generate_and_cache(_world_id, _canon_id, _text, _voice_id, _api_key, _path) do
    # Will be filled in Step 8
    {:error, :not_implemented}
  end
end
```

- [ ] **Step 5: Run the cache-hit test, verify it passes**

```bash
mix test test/loremaster_proxy/services/tts_manager_test.exs --trace
```

Expected: PASS.

- [ ] **Step 6: Add cache-miss test (with Bypass HTTP mock)**

Append to the test file:

```elixir
  test "cache miss POSTs to ElevenLabs and writes MP3 to disk", %{cache_dir: dir} do
    bypass = Bypass.open()
    Application.put_env(:loremaster_proxy, :elevenlabs,
      operator_api_key: "fake-key",
      api_endpoint: "http://localhost:#{bypass.port}/v1/text-to-speech",
      audio_cache_dir: dir
    )

    Bypass.expect_once(bypass, "POST", "/v1/text-to-speech/voice-rachel", fn conn ->
      conn = Plug.Conn.fetch_query_params(conn)
      assert ["xi-api-key": "fake-key"] = Enum.filter(conn.req_headers, fn {k, _} -> k == "xi-api-key" end)
      Plug.Conn.resp(conn, 200, <<255, 251, 144, 100>>)  # fake mp3 frame magic
    end)

    world_id = "world-2"
    canon_id = "def-456"
    text = "The dragon descends from the sky."

    assert {:ok, path, :cache_miss} =
             TTSManager.fetch_or_generate(world_id, canon_id, text, "voice-rachel", "fake-key")

    assert File.exists?(path)
    assert File.read!(path) == <<255, 251, 144, 100>>
    assert path =~ "world-2/def-456.mp3"
  end
```

Add `Bypass` to `mix.exs` if not already present:

```elixir
# In mix.exs deps:
{:bypass, "~> 2.1", only: :test}
```

```bash
mix deps.get
```

- [ ] **Step 7: Run the cache-miss test, verify it fails**

```bash
mix test test/loremaster_proxy/services/tts_manager_test.exs --trace
```

Expected: FAIL with the cache-miss test getting `{:error, :not_implemented}`.

- [ ] **Step 8: Implement generate_and_cache**

Replace the stub in `tts_manager.ex`:

```elixir
  defp generate_and_cache(world_id, canon_id, text, voice_id, api_key, path) do
    cfg = Application.get_env(:loremaster_proxy, :elevenlabs, [])
    url = "#{cfg[:api_endpoint]}/#{voice_id}"
    headers = [
      {"xi-api-key", api_key},
      {"content-type", "application/json"},
      {"accept", "audio/mpeg"}
    ]
    body = Jason.encode!(%{text: text, model_id: "eleven_turbo_v2_5"})

    request = Finch.build(:post, url, headers, body)
    start = System.monotonic_time()

    case Finch.request(request, LoremasterProxy.Finch, receive_timeout: 30_000) do
      {:ok, %Finch.Response{status: 200, body: mp3}} ->
        File.mkdir_p!(Path.dirname(path))
        File.write!(path, mp3)

        :telemetry.execute(
          [:loremaster, :tts, :response],
          %{duration: System.monotonic_time() - start},
          %{chars: String.length(text), voice_id: voice_id}
        )

        {:ok, path, :cache_miss}

      {:ok, %Finch.Response{status: status, body: body}} ->
        :telemetry.execute([:loremaster, :tts, :error], %{count: 1}, %{provider: :elevenlabs, error_type: :http_status, status: status})
        Logger.warning("[TTSManager] ElevenLabs returned #{status}: #{inspect(body)}")
        {:error, {:http_status, status}}

      {:error, reason} ->
        :telemetry.execute([:loremaster, :tts, :error], %{count: 1}, %{provider: :elevenlabs, error_type: :transport})
        Logger.error("[TTSManager] ElevenLabs request failed: #{inspect(reason)}")
        {:error, {:request_failed, reason}}
    end
  end
```

- [ ] **Step 9: Run all TTSManager tests**

```bash
mix test test/loremaster_proxy/services/tts_manager_test.exs --trace
```

Expected: 2 tests, 0 failures.

- [ ] **Step 10: Commit**

```bash
git add lib/loremaster_proxy/services/tts_manager.ex test/loremaster_proxy/services/tts_manager_test.exs config/runtime.exs lib/loremaster_proxy/application.ex mix.exs mix.lock
git commit -m "feat(voice): TTSManager with ElevenLabs HTTP + filesystem cache"
```

---

### Task 3: TTSGenerationLock — serialize concurrent generations

**Files:**
- Create: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/services/tts_generation_lock.ex`
- Create: `~/work/loremaster-proxy-elixir/test/loremaster_proxy/services/tts_generation_lock_test.exs`
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/application.ex`
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy/services/tts_manager.ex`

- [ ] **Step 1: Write the failing concurrency test**

```elixir
# test/loremaster_proxy/services/tts_generation_lock_test.exs
defmodule LoremasterProxy.Services.TTSGenerationLockTest do
  use ExUnit.Case, async: false

  alias LoremasterProxy.Services.TTSGenerationLock

  setup do
    case Process.whereis(TTSGenerationLock) do
      nil -> {:ok, _pid} = TTSGenerationLock.start_link([])
      _pid -> :ok
    end
    :ok
  end

  test "two concurrent calls for the same key invoke the work fn exactly once" do
    key = {"world-x", "canon-#{System.unique_integer([:positive])}"}
    counter = :counters.new(1, [])

    work = fn ->
      :counters.add(counter, 1, 1)
      Process.sleep(50)
      {:ok, "result"}
    end

    task1 = Task.async(fn -> TTSGenerationLock.run_once(key, work) end)
    task2 = Task.async(fn -> TTSGenerationLock.run_once(key, work) end)

    assert Task.await(task1) == {:ok, "result"}
    assert Task.await(task2) == {:ok, "result"}
    assert :counters.get(counter, 1) == 1
  end
end
```

- [ ] **Step 2: Run, verify it fails**

```bash
mix test test/loremaster_proxy/services/tts_generation_lock_test.exs --trace
```

Expected: FAIL with `(UndefinedFunctionError) ... TTSGenerationLock`.

- [ ] **Step 3: Implement the GenServer**

```elixir
# lib/loremaster_proxy/services/tts_generation_lock.ex
defmodule LoremasterProxy.Services.TTSGenerationLock do
  @moduledoc """
  Serializes concurrent TTS generation requests for the same {world_id, canon_id}.

  Two opted-in clients receiving the same canon-published event will both fire
  `request-tts`. Without serialization, both would call ElevenLabs and the cache
  write would race. This lock ensures the first arrival generates while the
  second waits on the same Task.
  """

  use GenServer

  # Public API

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc """
  Run the work function exactly once across all concurrent callers with the
  same key. Subsequent callers receive the same result.
  """
  def run_once(key, work_fn) when is_function(work_fn, 0) do
    case GenServer.call(__MODULE__, {:claim, key}, 60_000) do
      {:claimed, ref} ->
        result = work_fn.()
        GenServer.cast(__MODULE__, {:complete, key, ref, result})
        result

      {:wait, task} ->
        Task.await(task, 60_000)
    end
  end

  # GenServer callbacks

  @impl true
  def init(_), do: {:ok, %{}}

  @impl true
  def handle_call({:claim, key}, _from, state) do
    case Map.get(state, key) do
      nil ->
        ref = make_ref()
        task = Task.async(fn -> receive do {:done, ^ref, result} -> result end end)
        {:reply, {:claimed, ref}, Map.put(state, key, {ref, task})}

      {_ref, task} ->
        {:reply, {:wait, task}, state}
    end
  end

  @impl true
  def handle_cast({:complete, key, ref, result}, state) do
    case Map.get(state, key) do
      {^ref, task} ->
        send(task.pid, {:done, ref, result})
        {:noreply, Map.delete(state, key)}

      _ ->
        {:noreply, state}
    end
  end
end
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
mix test test/loremaster_proxy/services/tts_generation_lock_test.exs --trace
```

Expected: PASS.

- [ ] **Step 5: Add to supervision tree**

Open `lib/loremaster_proxy/application.ex` and add `TTSGenerationLock` to the children list, ideally between `Finch` and the endpoint:

```elixir
      LoremasterProxy.Services.TTSGenerationLock,
```

- [ ] **Step 6: Wire the lock into TTSManager.fetch_or_generate**

In `lib/loremaster_proxy/services/tts_manager.ex`, replace the body of `fetch_or_generate/5`:

```elixir
  def fetch_or_generate(world_id, canon_id, text, voice_id, api_key) do
    path = cache_path(world_id, canon_id)

    if File.exists?(path) do
      {:ok, path, :cache_hit}
    else
      LoremasterProxy.Services.TTSGenerationLock.run_once(
        {world_id, canon_id},
        fn -> generate_and_cache(world_id, canon_id, text, voice_id, api_key, path) end
      )
    end
  end
```

- [ ] **Step 7: Run all proxy tests**

```bash
mix test
```

Expected: all tests pass (the existing TTSManager tests continue working through the lock).

- [ ] **Step 8: Commit**

```bash
git add lib/loremaster_proxy/services/tts_generation_lock.ex test/loremaster_proxy/services/tts_generation_lock_test.exs lib/loremaster_proxy/application.ex lib/loremaster_proxy/services/tts_manager.ex
git commit -m "feat(voice): TTSGenerationLock serializes concurrent canon TTS generations"
```

---

### Task 4: WorldChannel `request-tts` and `tts-status` handlers

**Files:**
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy_web/channels/world_channel.ex`
- Create: `~/work/loremaster-proxy-elixir/test/loremaster_proxy_web/channels/world_channel_voice_test.exs`
- Create: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy_web/audio_token.ex`

- [ ] **Step 1: Write the failing handler tests**

```elixir
# test/loremaster_proxy_web/channels/world_channel_voice_test.exs
defmodule LoremasterProxyWeb.WorldChannel.VoiceTest do
  use LoremasterProxyWeb.ChannelCase

  alias LoremasterProxyWeb.WorldSocket

  setup do
    {:ok, _, socket} =
      WorldSocket
      |> socket("user-test", %{})
      |> subscribe_and_join(LoremasterProxyWeb.WorldChannel, "world:voice-test", %{
        "apiKey" => "sk-ant-test",
        "userId" => "u1",
        "userName" => "Tester",
        "isGM" => true,
        "elevenLabsApiKey" => "el_fake"
      })

    %{socket: socket}
  end

  test "tts-status returns cached: false for unknown canon", %{socket: socket} do
    ref = push(socket, "tts-status", %{"canonId" => "never-generated-id"})
    assert_reply ref, :ok, %{cached: false}
  end
end
```

(The full request-tts integration test is harder to write at the channel layer because it depends on Bypass + a temp cache dir. We instead exercise it end-to-end in Phase 5 Task 15.)

- [ ] **Step 2: Run the test, verify it fails**

```bash
mix test test/loremaster_proxy_web/channels/world_channel_voice_test.exs --trace
```

Expected: FAIL — channel rejects the unknown event.

- [ ] **Step 3: Add the `request-tts` handler**

Open `lib/loremaster_proxy_web/channels/world_channel.ex` and append (alongside other `handle_in/3` clauses):

```elixir
  @doc """
  TTS request: caller supplies a canon ID and text. Returns a signed audio URL.

  If hosted mode, uses operator ElevenLabs key.
  If self-hosted, uses the per-world key sent at join (socket.assigns.elevenlabs_api_key).
  """
  def handle_in("request-tts", %{"canonId" => canon_id, "text" => text}, socket) do
    world_id = socket.assigns.world_id
    voice_id = Map.get(socket.assigns, :voice_id, "Rachel")
    api_key = elevenlabs_key_for(socket)

    case api_key do
      nil ->
        {:reply, {:error, %{reason: "ElevenLabs API key not configured", success: false}}, socket}

      key ->
        case LoremasterProxy.Services.TTSManager.fetch_or_generate(world_id, canon_id, text, voice_id, key) do
          {:ok, _path, status} ->
            url = LoremasterProxyWeb.AudioToken.signed_url(world_id, canon_id)

            log_audio_chars(socket, status, text)

            :telemetry.execute(
              [:loremaster, :tts, :request],
              %{count: 1},
              %{cache_hit: status == :cache_hit, world_id: world_id}
            )

            {:reply, {:ok, %{audioUrl: url, cached: status == :cache_hit}}, socket}

          {:error, reason} ->
            {:reply, {:error, %{reason: format_tts_error(reason), success: false}}, socket}
        end
    end
  end
```

- [ ] **Step 4: Add the `tts-status` handler**

```elixir
  @doc """
  Cheap status check used by the chat-log render to decide whether to show
  the replay-audio icon on a past canon entry.

  Replies `{:ok, %{cached: true | false}}`.
  """
  def handle_in("tts-status", %{"canonId" => canon_id}, socket) do
    world_id = socket.assigns.world_id
    cached? = LoremasterProxy.Services.TTSManager.cached?(world_id, canon_id)
    {:reply, {:ok, %{cached: cached?}}, socket}
  end
```

- [ ] **Step 5: Add `cached?/2` to TTSManager**

In `lib/loremaster_proxy/services/tts_manager.ex`, add:

```elixir
  @doc "Returns true if the MP3 already exists on disk."
  def cached?(world_id, canon_id) do
    File.exists?(cache_path(world_id, canon_id))
  end
```

- [ ] **Step 6: Add the `format_tts_error`, `elevenlabs_key_for`, `log_audio_chars` helpers**

Append to `world_channel.ex`:

```elixir
  defp elevenlabs_key_for(socket) do
    if socket.assigns.hosted_mode do
      Application.get_env(:loremaster_proxy, :elevenlabs, [])[:operator_api_key]
    else
      socket.assigns[:elevenlabs_api_key]
    end
  end

  defp log_audio_chars(_socket, :cache_hit, _text), do: :ok

  defp log_audio_chars(socket, :cache_miss, text) do
    if user_id = socket.assigns[:db_user_id] do
      LoremasterProxy.Accounts.UsageLog.log_audio(%{
        user_id: user_id,
        chars: String.length(text)
      })
    end

    :ok
  end

  defp format_tts_error({:request_failed, _}), do: "Voice service is unavailable. Please try again."
  defp format_tts_error({:http_status, 429}), do: "Voice service rate-limited. Please wait a minute and try again."
  defp format_tts_error({:http_status, status}), do: "Voice service returned an error (#{status})."
  defp format_tts_error(_), do: "Voice generation failed."
```

- [ ] **Step 7: Add the `log_audio` action to UsageLog**

Open `lib/loremaster_proxy/accounts/usage_log.ex` and inside `actions do`, add:

```elixir
    create :log_audio do
      accept [:user_id, :chars]

      change fn changeset, _ctx ->
        chars = Ash.Changeset.get_attribute(changeset, :chars) || 0
        Ash.Changeset.change_attribute(changeset, :audio_chars_consumed, chars)
      end
    end
```

If the resource currently uses `code_interface`, also expose:

```elixir
  code_interface do
    define :log_audio, args: [:input]
  end
```

- [ ] **Step 8: Add `LoremasterProxyWeb.AudioToken` for signed URLs**

```elixir
# lib/loremaster_proxy_web/audio_token.ex
defmodule LoremasterProxyWeb.AudioToken do
  @moduledoc """
  Signs short-lived URLs for cached MP3 playback.

  Tokens encode {world_id, canon_id} and expire in 15 minutes.
  """

  @max_age_seconds 15 * 60

  def signed_url(world_id, canon_id) do
    token = Phoenix.Token.sign(LoremasterProxyWeb.Endpoint, "audio", {world_id, canon_id})
    "/audio/#{world_id}/#{canon_id}.mp3?token=#{token}"
  end

  def verify(token) do
    Phoenix.Token.verify(LoremasterProxyWeb.Endpoint, "audio", token, max_age: @max_age_seconds)
  end
end
```

- [ ] **Step 9: Run the channel tests, verify pass**

```bash
mix test test/loremaster_proxy_web/channels/world_channel_voice_test.exs --trace
```

Expected: 1 test passes (`tts-status returns cached: false`).

- [ ] **Step 10: Run all proxy tests**

```bash
mix test
```

Expected: zero failures (no regressions).

- [ ] **Step 11: Commit**

```bash
git add lib/loremaster_proxy_web/channels/world_channel.ex lib/loremaster_proxy_web/audio_token.ex lib/loremaster_proxy/services/tts_manager.ex lib/loremaster_proxy/accounts/usage_log.ex test/loremaster_proxy_web/channels/world_channel_voice_test.exs
git commit -m "feat(voice): WorldChannel request-tts + tts-status handlers"
```

---

### Task 5: AudioController + route for /audio/

**Files:**
- Create: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy_web/controllers/audio_controller.ex`
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy_web/router.ex`

- [ ] **Step 1: Create the audio controller**

```elixir
# lib/loremaster_proxy_web/controllers/audio_controller.ex
defmodule LoremasterProxyWeb.AudioController do
  use LoremasterProxyWeb, :controller

  alias LoremasterProxyWeb.AudioToken

  def show(conn, %{"world_id" => world_id, "canon_id" => canon_id, "token" => token}) do
    expected = {world_id, canon_id}

    case AudioToken.verify(token) do
      {:ok, ^expected} ->
        cfg = Application.get_env(:loremaster_proxy, :elevenlabs, [])
        path = Path.join([cfg[:audio_cache_dir] || "/data/audio", world_id, "#{canon_id}.mp3"])

        if File.exists?(path) do
          conn
          |> put_resp_content_type("audio/mpeg")
          |> put_resp_header("cache-control", "private, max-age=900")
          |> send_file(200, path)
        else
          send_resp(conn, 404, "Audio not found")
        end

      _ ->
        send_resp(conn, 403, "Invalid or expired token")
    end
  end

  def show(conn, _), do: send_resp(conn, 400, "Missing parameters")
end
```

- [ ] **Step 2: Add the route**

Open `lib/loremaster_proxy_web/router.ex` and add a pipeline-less scope (or add the route to an existing one):

```elixir
  scope "/audio", LoremasterProxyWeb do
    get "/:world_id/:canon_id.mp3", AudioController, :show
  end
```

- [ ] **Step 3: Run all proxy tests**

```bash
mix test
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/loremaster_proxy_web/controllers/audio_controller.ex lib/loremaster_proxy_web/router.ex
git commit -m "feat(voice): AudioController serves signed-URL MP3 playback"
```

---

### Task 6: Accept `elevenLabsApiKey` and `voiceId` in phx_join

**Files:**
- Modify: `~/work/loremaster-proxy-elixir/lib/loremaster_proxy_web/channels/world_channel.ex`

- [ ] **Step 1: Read the existing self-hosted join handler**

In `world_channel.ex`, locate `defp handle_self_hosted_join(world_id, params, socket, ...)`. The current signature already extracts `apiKey` from params.

- [ ] **Step 2: Extend it to also extract `elevenLabsApiKey` and `voiceId`**

Inside `handle_self_hosted_join`, after the existing `api_key = params["apiKey"]` line:

```elixir
    elevenlabs_api_key = params["elevenLabsApiKey"]
    voice_id = params["voiceId"] || "Rachel"
```

In the `socket = socket |> assign(...)` chain, add two more lines:

```elixir
          |> assign(:elevenlabs_api_key, elevenlabs_api_key)
          |> assign(:voice_id, voice_id)
```

- [ ] **Step 3: Do the same in `handle_hosted_join`**

In `handle_hosted_join`, after the existing operator-key fetch, add:

```elixir
    voice_id = params["voiceId"] || "Rachel"
```

And in its socket assign chain:

```elixir
          |> assign(:elevenlabs_api_key, nil)  # hosted uses operator key
          |> assign(:voice_id, voice_id)
```

- [ ] **Step 4: Recompile and run all tests**

```bash
mix test
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/loremaster_proxy_web/channels/world_channel.ex
git commit -m "feat(voice): accept elevenLabsApiKey + voiceId in phx_join params"
```

---

### Task 7: Manual smoke test of the proxy backbone

**Files:** none — verification only.

- [ ] **Step 1: Set `OPERATOR_ELEVENLABS_API_KEY` in dev env**

```bash
ssh greenmox "echo 'OPERATOR_ELEVENLABS_API_KEY=el_<your_real_key>' >> /opt/loremaster-dev/.env.proxy"
```

(Replace `<your_real_key>` with a real ElevenLabs key from https://elevenlabs.io/app/api-key.)

- [ ] **Step 2: Push branch and deploy**

```bash
cd ~/work/loremaster-proxy-elixir
git push origin feat/voice-integration

ssh -A greenmox "cd /opt/loremaster-dev && git fetch origin && git checkout feat/voice-integration && git pull && docker build -t loremaster-proxy-elixir:dev . && docker compose up -d --force-recreate proxy"
```

Expected: container healthy within 60s.

- [ ] **Step 3: Hit the audio route with curl**

```bash
ssh greenmox "curl -s -o /dev/null -w '%{http_code}' http://localhost:4001/audio/test-world/test-canon.mp3"
```

Expected: `400` (missing token param).

```bash
ssh greenmox "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:4001/audio/test-world/test-canon.mp3?token=invalid'"
```

Expected: `403`.

- [ ] **Step 4: Mark Phase 1 complete**

The proxy backbone is verified. Phase 2 (client output) can begin.

---

## Phase 2 — Client output (TTS playback)

Five tasks in `~/work/loremaster`. The Foundry module has no test runner; verification is "reload Foundry, watch the console, observe behavior". Each step's "Verify" line tells the engineer exactly what to look for.

### Task 8: Register voice settings in config.mjs

**Files:**
- Modify: `~/work/loremaster/scripts/config.mjs`
- Modify: `~/work/loremaster/lang/en.json`

- [ ] **Step 1: Add `voiceEnabled` setting**

In `scripts/config.mjs`, after the existing `responseVisibility` setting (around line 145), add:

```javascript
  game.settings.register(MODULE_ID, 'voiceEnabled', {
    name: game.i18n.localize('LOREMASTER.Voice.Toggle.Label'),
    hint: game.i18n.localize('LOREMASTER.Voice.Toggle.Hint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: false
  });
```

- [ ] **Step 2: Add `elevenLabsApiKey` setting (world scope, GM only)**

```javascript
  game.settings.register(MODULE_ID, 'elevenLabsApiKey', {
    name: game.i18n.localize('LOREMASTER.Voice.Provider.ApiKey'),
    hint: game.i18n.localize('LOREMASTER.Voice.Provider.ApiKey.Hint'),
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });
```

- [ ] **Step 3: Add `voiceId`, `voiceVolume`, `pttHotkey`, `pttMode`**

```javascript
  game.settings.register(MODULE_ID, 'voiceId', {
    name: game.i18n.localize('LOREMASTER.Voice.Provider.VoiceId'),
    hint: game.i18n.localize('LOREMASTER.Voice.Provider.VoiceId.Hint'),
    scope: 'world',
    config: true,
    type: String,
    default: 'Rachel'
  });

  game.settings.register(MODULE_ID, 'voiceVolume', {
    name: game.i18n.localize('LOREMASTER.Voice.Volume'),
    scope: 'client',
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.8
  });

  game.settings.register(MODULE_ID, 'pttHotkey', {
    name: game.i18n.localize('LOREMASTER.Voice.Hotkey'),
    hint: game.i18n.localize('LOREMASTER.Voice.Hotkey.Hint'),
    scope: 'client',
    config: true,
    type: String,
    default: 'v'
  });

  game.settings.register(MODULE_ID, 'pttMode', {
    name: game.i18n.localize('LOREMASTER.Voice.Hotkey.Mode'),
    scope: 'client',
    config: true,
    type: String,
    choices: {
      'hold': 'LOREMASTER.Voice.Hotkey.Mode.Hold',
      'toggle': 'LOREMASTER.Voice.Hotkey.Mode.Toggle'
    },
    default: 'hold'
  });
```

- [ ] **Step 4: Add the i18n keys to lang/en.json**

Open `lang/en.json`. Inside the `LOREMASTER` object, add a new `Voice` namespace:

```json
    "Voice": {
      "Toggle": {
        "Label": "Hear AI voice",
        "Hint": "Play AI responses out loud when canon is published. Per-user setting; off by default."
      },
      "PTT": {
        "Label": "Push to talk",
        "NotSupported": "Voice input requires Chrome or Edge."
      },
      "PermissionDenied": {
        "Title": "Microphone access denied",
        "Body": "Loremaster needs microphone access for push-to-talk. Enable it in your browser site settings and reload."
      },
      "SettingsHeader": "Voice",
      "Provider": {
        "ApiKey": "ElevenLabs API key",
        "ApiKey.Hint": "Required for self-hosted mode. Hosted users do not need to set this.",
        "VoiceId": "Voice ID",
        "VoiceId.Hint": "ElevenLabs voice name or ID. Default: Rachel."
      },
      "Volume": "Voice volume",
      "Hotkey": "Push-to-talk key",
      "Hotkey.Hint": "Single character. Default: V.",
      "Hotkey.Mode": "Push-to-talk mode",
      "Hotkey.Mode.Hold": "Hold to talk",
      "Hotkey.Mode.Toggle": "Press to start/stop"
    }
```

- [ ] **Step 5: Verify in Foundry**

Reload Foundry. Open Configure Settings → Module Settings → Loremaster. The new fields should appear with the labels from en.json. Toggle "Hear AI voice" off and on, save, reload, verify it persists.

- [ ] **Step 6: Commit**

```bash
git add scripts/config.mjs lang/en.json
git commit -m "feat(voice): register six voice settings + i18n strings"
```

---

### Task 9: voice-output.mjs — canon listener, audio fetch, playback

**Files:**
- Create: `~/work/loremaster/scripts/voice-output.mjs`
- Modify: `~/work/loremaster/scripts/loremaster.mjs`
- Modify: `~/work/loremaster/scripts/socket-client.mjs`

- [ ] **Step 1: Add `requestTTS` and `getTTSStatus` to socket-client.mjs**

In `scripts/socket-client.mjs`, near other Phoenix request methods (after `getUsage`, around line 2400), add:

```javascript
  /**
   * Request a TTS audio URL for a canon entry.
   * @param {string} canonId - Canon message UUID.
   * @param {string} text - Canon text content (for cache-miss generation).
   * @returns {Promise<{audioUrl: string, cached: boolean}>}
   */
  async requestTTS(canonId, text) {
    return this._sendPhoenixRequest('request-tts', { canonId, text });
  }

  /**
   * Cheap check whether canon already has cached audio.
   * @param {string} canonId
   * @returns {Promise<{cached: boolean}>}
   */
  async getTTSStatus(canonId) {
    return this._sendPhoenixRequest('tts-status', { canonId });
  }
```

If `_sendPhoenixRequest` doesn't exist by that name, locate the existing helper that wraps `phx_request` calls — likely `_sendRequest` adapted for Phoenix mode — and reuse it.

- [ ] **Step 2: Create voice-output.mjs**

```javascript
// scripts/voice-output.mjs
/**
 * Voice output: listens for canon-published events, requests TTS audio from the
 * proxy, and plays the resulting MP3 in the local browser. Per-user opt-in.
 */

import { getSetting } from './config.mjs';

const MODULE_ID = 'loremaster';

export class VoiceOutput {
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.activeAudios = new Map();
    this.subscribed = false;
  }

  initialize() {
    if (this.subscribed) return;
    this.subscribed = true;

    this.socketClient.onCanonPublished = (canonEvent) => {
      this._handleCanonPublished(canonEvent).catch((err) => {
        console.error(`${MODULE_ID} | Voice output failed:`, err);
      });
    };

    console.log(`${MODULE_ID} | Voice output subscribed to canon events`);
  }

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

    this._play(canonId, result.audioUrl);
  }

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

  stopAll() {
    for (const audio of this.activeAudios.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.activeAudios.clear();
  }

  _notifyVoiceUnavailable(err) {
    const msg = err?.message || 'Voice service unavailable';
    if (msg.includes('rate-limit')) {
      ui.notifications.warn(`Loremaster: ${msg}`);
    } else {
      console.warn(`${MODULE_ID} | TTS request failed: ${msg}`);
    }
  }
}
```

- [ ] **Step 3: Wire VoiceOutput into the ready flow**

In `scripts/loremaster.mjs`, near the top of the imports:

```javascript
import { VoiceOutput } from './voice-output.mjs';
```

After `const usageMonitor = new UsageMonitor(socketClient);`:

```javascript
    const voiceOutput = new VoiceOutput(socketClient);
    voiceOutput.initialize();
```

In the `game.loremaster = { ... }` object literal, add the field:

```javascript
      voiceOutput,
```

- [ ] **Step 4: Add `onCanonPublished` event hook in socket-client.mjs**

In the message-handling section that converts Phoenix events to Node-format events, locate where canon events are received. Add (or extend) the canon-published handler so `this.onCanonPublished?.(payload)` is called.

If no such hook exists, locate the existing canon-published handler (search for `'canon-published'` or `'canon_published'`) and add at the appropriate point:

```javascript
    if (typeof this.onCanonPublished === 'function') {
      this.onCanonPublished({
        canonId: payload.canonId || payload.id,
        text: payload.text || payload.content
      });
    }
```

- [ ] **Step 5: Sync to installed Foundry module + reload**

If your `~/work/loremaster` is hardlinked to `~/foundrydata/Data/modules/loremaster` (verify with `stat -f '%i' both/loremaster.mjs`), no copy is needed. Otherwise:

```bash
cp -r ~/work/loremaster/scripts/* ~/foundrydata/Data/modules/loremaster/scripts/
cp ~/work/loremaster/lang/en.json ~/foundrydata/Data/modules/loremaster/lang/en.json
```

Then reload Foundry (F5).

- [ ] **Step 6: Verify in Foundry**

1. Open browser console (F12).
2. Toggle "Hear AI voice" on in Loremaster settings.
3. Send a `@lm test message` and publish the response.
4. Console should log `Loremaster | Voice output subscribed to canon events` once at startup.
5. On publish, you should hear audio (or see a console warn about a missing key if not yet configured).

If you see `Audio autoplay blocked` warnings, that's a known browser quirk on first interaction — click anywhere on the page once, then re-publish.

- [ ] **Step 7: Commit**

```bash
git add scripts/voice-output.mjs scripts/loremaster.mjs scripts/socket-client.mjs
git commit -m "feat(voice): VoiceOutput module fetches and plays canon TTS audio"
```

---

### Task 10: Status-bar voice toggle

**Files:**
- Modify: `~/work/loremaster/scripts/status-bar.mjs`

- [ ] **Step 1: Locate the status-bar dropdown menu**

Open `scripts/status-bar.mjs` and find where existing menu items are added (likely a method like `_buildMenu` or `_addMenuItem`).

- [ ] **Step 2: Add a `_buildVoiceToggle` method using safe DOM construction**

Add to the status-bar class:

```javascript
  _buildVoiceToggle() {
    const enabled = game.settings.get('loremaster', 'voiceEnabled');

    const item = document.createElement('div');
    item.classList.add('lm-statusbar-menu-item', 'lm-voice-toggle');

    const icon = document.createElement('i');
    icon.classList.add('fas', enabled ? 'fa-volume-up' : 'fa-volume-mute');

    const label = document.createElement('span');
    label.textContent = game.i18n.localize('LOREMASTER.Voice.Toggle.Label');

    const state = document.createElement('span');
    state.classList.add('lm-toggle-state');
    state.textContent = enabled ? 'on' : 'off';

    item.append(icon, label, state);

    item.addEventListener('click', async () => {
      const next = !game.settings.get('loremaster', 'voiceEnabled');
      await game.settings.set('loremaster', 'voiceEnabled', next);
      if (!next) {
        game.loremaster?.voiceOutput?.stopAll();
      }
      this._rebuildMenu();
    });

    return item;
  }
```

Call `_buildVoiceToggle()` from the existing menu-building method and append the returned element alongside other menu items.

- [ ] **Step 3: Reload Foundry and verify**

Click the status bar to open the dropdown. The "Hear AI voice" item should appear with the right icon (mute icon when off, volume icon when on). Clicking it should toggle persistently across reloads.

- [ ] **Step 4: Commit**

```bash
git add scripts/status-bar.mjs
git commit -m "feat(voice): status-bar toggle for Hear AI voice"
```

---

### Task 11: Replay-audio icon on past canon

**Files:**
- Modify: `~/work/loremaster/scripts/voice-output.mjs`
- Modify: `~/work/loremaster/scripts/loremaster.mjs`
- Modify: `~/work/loremaster/styles/loremaster.css`

- [ ] **Step 1: Add `decorateChatMessage` to VoiceOutput using safe DOM construction**

In `voice-output.mjs`, add the method:

```javascript
  /**
   * Inject a "replay audio" icon on canon messages whose audio is cached.
   * Called from the renderChatMessageHTML hook in loremaster.mjs.
   */
  async decorateChatMessage(message, html) {
    if (!message.flags?.loremaster?.isCanon) return;
    const canonId = message.flags.loremaster.canonId || message.id;

    let status;
    try {
      status = await this.socketClient.getTTSStatus(canonId);
    } catch {
      return;
    }

    if (!status?.cached) return;

    const replayBtn = document.createElement('button');
    replayBtn.classList.add('lm-replay-audio');
    replayBtn.title = 'Replay audio';

    const icon = document.createElement('i');
    icon.classList.add('fas', 'fa-play-circle');
    replayBtn.appendChild(icon);

    replayBtn.addEventListener('click', async () => {
      const text = message.content || '';
      const result = await this.socketClient.requestTTS(canonId, text);
      if (result?.audioUrl) this._play(canonId, result.audioUrl);
    });

    const element = html instanceof HTMLElement ? html : html?.[0];
    element?.querySelector('.message-content')?.appendChild(replayBtn);
  }
```

- [ ] **Step 2: Hook it from loremaster.mjs**

In `loremaster.mjs`, near the existing `Hooks.on('renderChatMessageHTML', ...)` block (the one for veto controls), inside the same handler:

```javascript
      // Voice replay icon (canon only)
      if (message.flags?.[MODULE_ID]?.isCanon) {
        game.loremaster?.voiceOutput?.decorateChatMessage(message, html).catch(() => {});
      }
```

- [ ] **Step 3: Style the replay button**

Append to `styles/loremaster.css`:

```css
.lm-replay-audio {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  margin-left: 6px;
  padding: 2px 4px;
}
.lm-replay-audio:hover {
  color: #4af;
}
```

- [ ] **Step 4: Reload Foundry and verify**

After playing a canon entry once (which caches the MP3 server-side), reload Foundry. Scroll back to the canon message in chat — a small play-circle icon should appear next to it. Clicking it should play the cached audio (no second ElevenLabs call; verify by watching the dev container telemetry).

```bash
ssh greenmox "docker logs --since 2m loremaster-proxy-elixir-dev 2>&1 | grep -i 'tts.*request'"
```

Look for `cache_hit: true` on the second click.

- [ ] **Step 5: Commit**

```bash
git add scripts/voice-output.mjs scripts/loremaster.mjs styles/loremaster.css
git commit -m "feat(voice): replay-audio icon on cached past canon messages"
```

---

## Phase 3 — Client input (STT push-to-talk)

One task. In `~/work/loremaster`.

### Task 12: voice-input.mjs — PTT button + Web Speech API

**Files:**
- Create: `~/work/loremaster/scripts/voice-input.mjs`
- Modify: `~/work/loremaster/scripts/loremaster.mjs`
- Modify: `~/work/loremaster/styles/loremaster.css`

- [ ] **Step 1: Create the module**

```javascript
// scripts/voice-input.mjs
/**
 * Voice input: push-to-talk button in the chat sidebar that runs the browser's
 * SpeechRecognition API and writes the transcript into the chat input field.
 * No auto-send — the user reviews and hits Enter.
 */

import { getSetting } from './config.mjs';

const MODULE_ID = 'loremaster';

const Recognition =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

export class VoiceInput {
  constructor() {
    this.recognition = null;
    this.isRecording = false;
    this.button = null;
    this.permissionWarned = false;
  }

  initialize() {
    Hooks.on('renderChatLog', (app, html) => this._injectButton(html));
    document.addEventListener('keydown', (e) => this._onKeyDown(e));
    document.addEventListener('keyup', (e) => this._onKeyUp(e));
  }

  _injectButton(html) {
    const element = html instanceof HTMLElement ? html : html?.[0];
    const chatControls = element?.querySelector('#chat-controls');
    if (!chatControls || chatControls.querySelector('.lm-ptt-btn')) return;

    const btn = document.createElement('a');
    btn.classList.add('lm-ptt-btn');

    const icon = document.createElement('i');

    if (!Recognition) {
      btn.classList.add('lm-ptt-disabled');
      btn.title = game.i18n.localize('LOREMASTER.Voice.PTT.NotSupported');
      icon.classList.add('fas', 'fa-microphone-slash');
    } else {
      btn.title = game.i18n.localize('LOREMASTER.Voice.PTT.Label');
      icon.classList.add('fas', 'fa-microphone');
      btn.addEventListener('mousedown', () => this._start());
      btn.addEventListener('mouseup', () => this._stop());
      btn.addEventListener('mouseleave', () => this._stop());
    }

    btn.appendChild(icon);
    chatControls.prepend(btn);
    this.button = btn;
  }

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

  _stop() {
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
    }
  }

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
      console.warn(`${MODULE_ID} | SpeechRecognition error: ${event.error}`);
    }
  }

  _buildPermissionContent() {
    // Foundry's Dialog accepts a string of HTML for content. The text is from
    // i18n (developer-controlled), but we still build it as an HTML string
    // assembled from a textContent-encoded node to keep it explicit.
    const wrapper = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = game.i18n.localize('LOREMASTER.Voice.PermissionDenied.Body');
    wrapper.appendChild(p);
    return wrapper.outerHTML;
  }

  _onKeyDown(event) {
    if (this._matchesHotkey(event)) {
      const mode = getSetting('pttMode');
      if (mode === 'hold') this._start();
      else if (mode === 'toggle') {
        if (this.isRecording) this._stop();
        else this._start();
      }
    }
  }

  _onKeyUp(event) {
    if (this._matchesHotkey(event) && getSetting('pttMode') === 'hold') {
      this._stop();
    }
  }

  _matchesHotkey(event) {
    if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return false;
    const hotkey = (getSetting('pttHotkey') || 'v').toLowerCase();
    return event.key.toLowerCase() === hotkey;
  }
}
```

- [ ] **Step 2: Wire into loremaster.mjs**

```javascript
import { VoiceInput } from './voice-input.mjs';
```

After voice-output construction:

```javascript
    const voiceInput = new VoiceInput();
    voiceInput.initialize();
```

In `game.loremaster = { ... }`:

```javascript
      voiceInput,
```

- [ ] **Step 3: Add minimal CSS for the PTT button**

Append to `styles/loremaster.css`:

```css
.lm-ptt-btn {
  cursor: pointer;
  padding: 4px 6px;
  color: #888;
}
.lm-ptt-btn.lm-ptt-active {
  color: #f44;
  animation: lm-ptt-pulse 0.7s infinite;
}
.lm-ptt-btn.lm-ptt-disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
@keyframes lm-ptt-pulse {
  50% { opacity: 0.5; }
}
```

- [ ] **Step 4: Reload Foundry and verify**

1. The mic icon should appear in the chat sidebar's #chat-controls bar.
2. Hold the V key (or click-and-hold the mic button). The icon should glow red and pulse.
3. Speak a short phrase. Release.
4. The transcript should appear in the chat input. Hit Enter to send.
5. On Firefox/Safari, the icon should be the slash variant with the "requires Chrome/Edge" tooltip.

- [ ] **Step 5: Commit**

```bash
git add scripts/voice-input.mjs scripts/loremaster.mjs styles/loremaster.css
git commit -m "feat(voice): VoiceInput PTT module with Web Speech API"
```

---

## Phase 4 — Self-hosted key path

One task. Wires the client to send the user-supplied ElevenLabs key on join.

### Task 13: Send `elevenLabsApiKey` and `voiceId` on phx_join

**Files:**
- Modify: `~/work/loremaster/scripts/socket-client.mjs`

- [ ] **Step 1: Locate the auth payload assembly**

In `socket-client.mjs`, find the `authenticate()` method (around line 226). The current payload reads `apiKey` and `licenseKey` from settings.

- [ ] **Step 2: Add the two new fields**

In the `else` branch (self-hosted), after `if (apiKey) payload.apiKey = apiKey;`:

```javascript
      const elevenLabsApiKey = getSetting('elevenLabsApiKey');
      if (elevenLabsApiKey) {
        payload.elevenLabsApiKey = elevenLabsApiKey;
      }

      const voiceId = getSetting('voiceId');
      if (voiceId) {
        payload.voiceId = voiceId;
      }
```

In the hosted branch (after the `sessionToken` is set), only the `voiceId` flows up since the operator key is server-side:

```javascript
      const voiceId = getSetting('voiceId');
      if (voiceId) {
        payload.voiceId = voiceId;
      }
```

- [ ] **Step 3: Reload and verify with browser dev tools**

1. Open Foundry with browser dev tools network tab open.
2. Filter for the WebSocket connection.
3. Inspect the `phx_join` frame.
4. Self-hosted mode: payload should include `elevenLabsApiKey` (your value) and `voiceId`.
5. Hosted mode: payload should include only `voiceId`, no `elevenLabsApiKey`.

- [ ] **Step 4: Commit**

```bash
git add scripts/socket-client.mjs
git commit -m "feat(voice): client sends elevenLabsApiKey and voiceId on phx_join"
```

---

## Phase 5 — Polish, README, and end-to-end smoke test

Two tasks.

### Task 14: README and CLAUDE.md updates

**Files:**
- Modify: `~/work/loremaster/README.md`
- Modify: `~/work/loremaster/CLAUDE.md`

- [ ] **Step 1: Add a "Voice (v0.4+)" section to README under the existing usage docs**

Append after the existing Support section:

```markdown
## Voice (v0.4+)

Loremaster supports a one-way voice mode where Claude's published canon is
read aloud via ElevenLabs, plus push-to-talk speech-to-text in supported
browsers.

### Settings

- **Hear AI voice** (per-user, default off): plays canon audio on publish.
- **ElevenLabs API key** (self-hosted only): your ElevenLabs key. Hosted
  users get the operator-managed key automatically.
- **Voice ID** (per-world): ElevenLabs voice name. Default `Rachel`.
- **Push-to-talk key** (per-user): hotkey to dictate into chat. Default V.
- **Push-to-talk mode** (per-user): "hold" or "toggle". Default hold.

### Browser support

| Browser | TTS playback | STT (push-to-talk) |
|---|---|---|
| Chrome / Edge / Brave | ✅ | ✅ |
| Firefox | ✅ | ❌ (button greyed out) |
| Safari | ✅ | ❌ (button greyed out) |
```

- [ ] **Step 2: Add voice modules to CLAUDE.md component list**

In `CLAUDE.md` under "Functional groups", append to the list:

```markdown
- **Voice**: `voice-input.mjs` (PTT + Web Speech API STT), `voice-output.mjs` (canon-published listener + audio playback + replay icon)
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(voice): README support matrix + CLAUDE.md component listing"
```

---

### Task 15: End-to-end acceptance smoke test on dev

**Files:** none — verification only.

- [ ] **Step 1: Push both branches**

```bash
cd ~/work/loremaster && git push origin feat/voice-integration
cd ~/work/loremaster-proxy-elixir && git push origin feat/voice-integration
```

- [ ] **Step 2: Deploy proxy branch to greenmox**

```bash
ssh -A greenmox "cd /opt/loremaster-dev && git fetch origin && git checkout feat/voice-integration && git pull && docker build -t loremaster-proxy-elixir:dev . && docker compose up -d --force-recreate proxy"
```

Wait until container reports healthy:

```bash
ssh greenmox "cd /opt/loremaster-dev && until docker compose ps proxy --format '{{.Status}}' | grep -q healthy; do sleep 3; done && echo HEALTHY"
```

- [ ] **Step 3: Sync module to installed Foundry path (if not hardlinked)**

```bash
stat -f '%i' ~/work/loremaster/scripts/loremaster.mjs ~/foundrydata/Data/modules/loremaster/scripts/loremaster.mjs
```

If inodes match: no copy needed. Otherwise: `cp -r ~/work/loremaster/{scripts,styles,lang,templates,module.json,README.md,LICENSE.md} ~/foundrydata/Data/modules/loremaster/`.

- [ ] **Step 4: Walk through each spec acceptance criterion**

Open Foundry. For each criterion in the "Acceptance criteria" section of `docs/VOICE_INTEGRATION_SPEC.md`:

1. **PTT → chat input**: Hold V, speak "test message", release. Verify transcript appears in chat input. **Pass / Fail.**
2. **Voice on for one user**: Toggle Hear-AI-voice on. `@lm describe a tavern`. Publish. Verify audio plays. **Pass / Fail.**
3. **Cache hit on second user**: Open a second Foundry browser session as a different user, voice on. Re-trigger replay on the same canon. Verify proxy log shows `cache_hit: true` for the second request:

   ```bash
   ssh greenmox "docker logs --since 5m loremaster-proxy-elixir-dev 2>&1 | grep -i 'tts.*request'"
   ```

   **Pass / Fail.**
4. **Voice off for opted-out user**: Third browser, voice off. Verify no `request-tts` event appears in proxy logs from that client. **Pass / Fail.**
5. **Firefox / Safari greyed PTT**: Open the Foundry world in Firefox. Verify the mic button shows the slash icon and a "requires Chrome/Edge" tooltip. **Pass / Fail.**
6. **Invalid ElevenLabs key (self-hosted)**: Set `elevenLabsApiKey = "el_invalid"`. Trigger TTS. Verify a friendly notification appears, no console crash. **Pass / Fail.**
7. **Replay icon on cached canon**: Reload Foundry. Scroll back to a published canon entry. Verify play-circle icon appears. Click → audio plays. **Pass / Fail.**
8. **Telemetry**: Verify the log shows at least one of each: `tts.request` (cache_hit=true), `tts.request` (cache_hit=false), `tts.error` (forced via the invalid key step). **Pass / Fail.**

- [ ] **Step 5: If all 8 criteria pass, merge to main**

```bash
cd ~/work/loremaster
git checkout main
git pull origin main
git merge --ff-only feat/voice-integration
git push origin main

cd ~/work/loremaster-proxy-elixir
git checkout main
git pull origin main
git merge --ff-only feat/voice-integration
git push origin main
```

Deploy the merged main on greenmox:

```bash
ssh -A greenmox "cd /opt/loremaster-dev && git checkout main && git pull && docker build -t loremaster-proxy-elixir:dev . && docker compose up -d --force-recreate proxy"
```

- [ ] **Step 6: Bump module.json to 0.4.0 and tag**

```bash
cd ~/work/loremaster
# Bump 0.3.0 → 0.4.0 in module.json
git add module.json
git commit -m "release: bump version to 0.4.0 — voice integration v1"
git push origin main
git tag v0.4.0
git push origin --tags
```

The `release.yml` GitHub Action picks up the tag and builds/publishes `module.zip`.

- [ ] **Step 7: Update uber-todo and project memory**

Mark voice v1 complete in `~/notes/productivity/uber-todo.md` under the loremaster project. Note any deferred items (per-NPC voices, Whisper-via-proxy STT) for the v2 backlog.

---

## Self-review checklist (already run)

- **Spec coverage**: each spec section traces to tasks. §3 architecture → Tasks 2-4, 9, 12. §4 data flow → Tasks 4, 9, 12. §5 components → Tasks 2-4, 9, 12. §6 settings/UI → Tasks 8, 10, 11, 12. §7 error handling → Tasks 2 (telemetry, error formatting), 4 (key-missing path), 12 (Firefox/Safari fallback, mic permission denied). §8 quota/telemetry → Tasks 1, 4. §10 browser matrix → Task 12. Acceptance criteria #1–#8 → Task 15 walkthrough.
- **Placeholder scan**: no TBD/TODO/FIXME in this plan.
- **Type consistency**: `requestTTS(canonId, text)` is consistent across `socket-client.mjs` (Task 9), `voice-output.mjs` (Task 9), and the replay icon (Task 11). `getTTSStatus(canonId)` likewise. Server: `fetch_or_generate(world_id, canon_id, text, voice_id, api_key)` arity matches across Tasks 2, 3, 4. `cached?(world_id, canon_id)` introduced in Task 4 Step 5.
- **Scope check**: 15 tasks, ~80 commits at TDD granularity, ~6 working days estimated. Single feature, single plan. No subsystem decomposition needed.
- **DOM safety**: all client-side element construction uses `createElement` + `classList` + `textContent` + `appendChild`. No `innerHTML` of even static content.

---

*End of plan. Ready for execution.*
