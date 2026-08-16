# dsh-memory-tdai

English | [中文](README.md)

**Four-layer long-term memory for DeepSeek Harness** — a complete DSH port of
[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
from the OpenClaw runtime.

Give your DeepSeek agent a real memory: conversations are automatically
distilled into a four-layer structure — raw records → atomic memories → scene
blocks → persona profile — with cross-session retrieval, automatic recall, and
automatic archival. The model no longer needs to re-read your whole history to
know your preferences, habits, and project background.

```
L0 raw conversations ──▶ L1 atomic memories ──▶ L2 scene blocks ──▶ L3 persona profile
      (jsonl)              (SQLite + vectors)    (scene_blocks)       (persona.md)
    auto-capture            extract/dedup         scene induction        user profile
```

---

## 📖 Where this plugin comes from

This plugin is a **DSH port of TencentCloud/TencentDB-Agent-Memory** (Tencent
Cloud's official open-source project, MIT licensed).

The upstream project built a four-layer memory system for **OpenClaw**
(another agent runtime). Official benchmarks: task success up to **+51.5%**,
token usage down to **−61.4%**, persona-memory accuracy up from 48% to 76%.
Its core engine `TdaiCore` was deliberately designed to be **host-neutral**:
all storage, extraction, scene, and persona logic depends on a tiny 4-method
`HostAdapter` interface — OpenClaw was just one shell around it.

### How the port works (swap the shell, keep the engine)

| OpenClaw surface | DeepSeek Harness surface |
|---|---|
| `api.registerTool("tdai_memory_search")` | `tools.register("memory_search")` |
| `api.registerTool("tdai_conversation_search")` | `tools.register("conversation_search")` |
| `api.on("before_prompt_build")` | `agent/pre-step` waterfall + dynamic `systemPrompt` section |
| `api.on("agent_end")` | `agent/turn-stopping` |
| `api.on("gateway_stop")` | `ctx.effect` disposer → `core.destroy()` |
| `OpenClawLLMRunner` (own API key) | `DshLLMRunner` over DSH's `ctx.llm` (zero-config) |
| `openclaw.plugin.json` config | bundle row config + `DSH_MEMORY_*` env |

Three things we actually did:

1. **Kept the core, replaced the shell**: `TdaiCore` (four-layer pipeline,
   SQLite vector store, BM25/FTS5 retrieval, prompt engineering) is carried
   over untouched; a ~100-line `DshHostAdapter` implements the 4-method
   interface.
2. **Zero-config LLM reuse**: extraction/scene/persona model calls ride DSH's
   own `ctx.llm` service — the same DeepSeek route and credentials you already
   use. **No extra API key required.** This is the most practical difference
   from upstream.
3. **Event mapping**: OpenClaw's `before_prompt_build` → DSH `agent/pre-step`
   + a dynamic `systemPrompt` section, so recalled memories enter the system
   prompt **without polluting the conversation history**; `agent_end` →
   `agent/turn-stopping` persists each turn as soon as it closes.

### What was cut compared to upstream

| Item | Upstream (OpenClaw) | This DSH version |
|---|---|---|
| LLM calls | @ai-sdk/openai + separate API key | **DSH `ctx.llm` reuse, zero config** |
| Vector deps | tcvdb-text (286MB wasm dict) + sqlite-vec | sqlite-vec + FTS5 required; tcvdb-text **optional lazy-load** (auto-degrade BM25→FTS5) |
| Local embedding | node-llama-cpp (GGUF) | code kept; auto-degrades to keyword retrieval when unconfigured |
| OpenClaw-only code | CleanContextRunner / hook policy / CLI | removed |
| Memory capability | L0/L1/L2/L3 full pipeline | **full pipeline kept** |

---

## ✨ Features

### Automatic memory accumulation (zero effort)

- **Auto-capture (L0)**: every finished turn is appended to
  `conversations/YYYY-MM-DD.jsonl` — nothing the model, tools, or you said is lost.
- **Auto-extract (L1)**: a background pipeline distills conversations into
  atomic memories (e.g. `"User prefers replies in Chinese"`), stored in a
  SQLite vector store with type (persona / episodic / instruction), priority,
  and scene attribution — with **smart dedup**.
- **Auto-induce (L2)**: atomic memories cluster into scene blocks
  (`scene_blocks/`).
- **Auto-profile (L3)**: once scenes accumulate past a threshold, a
  `persona.md` user profile is generated and stays stable across sessions.

### Automatic recall (zero effort)

- Before every model step, the plugin retrieves memories relevant to the
  current topic and injects them through a dynamic system-prompt section
  (`<relevant-memories>`) — the model "just knows" your history.
- Recalled content never enters the session history (no repeated memory spam
  in context).

### Two model tools (on demand)

| Tool | Purpose | When to use |
|---|---|---|
| `memory_search` | Search **structured memories** (persona/events/rules; FTS5+BM25+vector hybrid ranking) | User preferences, historical facts, established rules |
| `conversation_search` | Search **raw conversation records** (exact messages with provenance) | Exact wording, what was said when |

### Retrieval capabilities

- **Hybrid retrieval**: with an embedding endpoint configured, "vector +
  keyword" (RRF fusion); without one, it auto-degrades to FTS5 keyword search
  with jieba Chinese tokenization.
- **Scene navigation**: L2 scene blocks can be retrieved, expanded, and
  replayed.
- **Fully traceable**: persona → scene block → atomic memory → raw
  conversation, drill down layer by layer without losing evidence.

---

## 📦 Install

Prereqs: dsh installed (any open-source build), `pnpm` on PATH (`corepack
enable` or `npm i -g pnpm`).

```sh
# Option 1: from GitHub (no npm account needed)
dsh plugin --profile web add https://github.com/Jason-Liao/dsh-memory-tdai/archive/refs/tags/v1.0.0.tar.gz

# Option 2: from npm (once published)
dsh plugin --profile web add dsh-memory-tdai

# Option 3: local tarball for development
cd dsh-memory-tdai && npm pack
dsh plugin --profile web add ./dsh-memory-tdai-1.0.0.tgz
```

Then **restart `dsh web` and hard-refresh the browser**. `dsh plugin`
automatically appends this package to `dsh.profile.bundles` (it declares
`dsh.bundle`) — no manual config edits.

Verify: in a new session ask the model "use memory_search to check my
memories" — success means the tool is in its toolset.

---

## 🚀 Usage

### Out of the box (default config)

1. **Just chat** — conversations are recorded and distilled automatically.
2. **Cross-session questions** — in a new session, ask "do you remember how I
   like to work?"; the model uses auto-recall or `memory_search`.
3. **Manual lookups** — "what did we discuss about X last week?" → the model
   calls `conversation_search` and finds the exact original message.

### Where the data lives

```
~/.dsh/memory-tdai/
├── conversations/     L0 raw conversations (daily jsonl)
├── records/           L1 atomic memories (SQLite vectors.db + index)
├── scene_blocks/      L2 scene blocks
├── persona.md         L3 persona profile
└── .metadata/         pipeline cursors
```

Deleting the whole directory wipes all memory (be careful).

---

## ⚙️ Configuration

Zero-config by default. Override via **bundle row config** (`cordis.patch.yml`
or `--patch`) or **environment variables**:

| Setting | Default | Env var |
|---|---|---|
| Data directory | `$DSH_HOME/memory-tdai` | `DSH_MEMORY_DATA_DIR` |
| LLM provider | deployment default (deepseek-official) | `DSH_MEMORY_PROVIDER` |
| LLM model | deployment default (deepseek-v4-flash) | `DSH_MEMORY_MODEL` |
| Auto-capture | on | `DSH_MEMORY_CAPTURE_ENABLED` (0/1) |
| Auto-recall | on | `DSH_MEMORY_RECALL_ENABLED` (0/1) |
| L1 extraction | on | `DSH_MEMORY_EXTRACTION_ENABLED` (0/1) |

Pipeline pacing (bundle row config, see upstream `config.ts`):
`pipeline.everyNConversations` (default: trigger L1 every 5 rounds, warmup
progressive), `persona.triggerEveryN` (default: regenerate persona every 50
memories), etc.

---

## 🔬 How it works (deep dive)

- **Event-sourced capture**: on `agent/turn-stopping`, incremental session
  messages are read (deduped by a message-count cursor) and written to L0.
- **LLM reuse**: `DshLLMRunner` calls `ctx.llm.stream()` with the same route
  as the conversation; L2/L3 "tool-enabled" runs use a sandboxed file-tool
  loop (read/write/replace confined to the memory workspace).
- **Dynamic prompt section**: recall is injected via a `systemPrompt.section`
  provider function — fresh cache read at every assembly; the model sees the
  memories, the history stays clean.
- **Graceful degradation**: if any of sqlite-vec / jieba / tcvdb-text /
  node-llama-cpp is missing, it degrades instead of crashing (vectors →
  keyword; BM25 → FTS5).

---

## 🛠️ Development & build

```sh
git clone https://github.com/Jason-Liao/dsh-memory-tdai.git
cd dsh-memory-tdai
npm i
node build.mjs          # esbuild bundles src → lib/index.js
node test/smoke.mjs     # smoke test: mock LLM + real SQLite, capture→extract→recall→search
```

Layout: `src/` (TypeScript: upstream `core/` + new `adapters/dsh/` + plugin
entry `index.ts`), `cordis.patch.yml` (bundle layer), `lib/index.js` (built
artifact for release).

---

## ⚠️ Known limitations (read first)

### 1. Without an embedding endpoint, retrieval is keyword-based, not semantic

Two retrieval engines, very different capabilities:

| Engine | How it works | Example (memory: "User likes coffee") |
|---|---|---|
| **Keyword (default)** | literal term matching (jieba tokenization + SQLite FTS5) | ask "coffee" ✅ hit; ask "what do I drink to wake up" ❌ miss (no literal "coffee") |
| **Vector (needs config)** | embeddings, semantic distance | ask "wake-up drinks" ✅ also hits "coffee" |

Why: embedding requires an embedding API (text → vector service). DeepSeek's
official API currently has **no embedding endpoint**, and the plugin won't
silently call third-party services. So the default is keyword mode — usable,
but literal.

Upgrade: provide an OpenAI-compatible embedding endpoint in the bundle row
config (OpenAI `text-embedding-3-small`, Aliyun Bailian `qwen3-embedding`,
SiliconFlow, self-hosted vLLM/Ollama, etc.). The plugin then switches to
"vector + keyword" hybrid (RRF fusion) with much stronger semantic matching.
Not configuring it doesn't break anything.

> jieba is the Chinese tokenizer — "我喜欢喝咖啡" is split into
> "我/喜欢/喝/咖啡" before indexing, which is exactly how FTS5 matches Chinese.
> Keyword mode is already usable for Chinese; it just can't do
> synonym-level semantic matching.

---

### 2. L1 extraction is background/progressive — the first few turns return no structured memory

L0 raw conversations are persisted **every turn** (plain local file writes,
zero cost). But **L1 atomic memories** (distilling conversations into
structured facts) requires **one LLM call** per extraction (token cost), so it
does not run every turn.

Pacing (warmup): by default L1 triggers every **5 turns**; to show value
quickly the threshold ramps **1 → 2 → 4 → 5** (the first run happens after
turn 1, then doubles, settling at every 5).

Impact:
- Right after install, `memory_search` (structured memories) may return empty
  for a few turns.
- **`conversation_search` always works** — L0 is persisted every turn.
- After a day of normal use, all layers accumulate naturally.

---

### 3. This plugin cannot be loaded as a "dynamic plugin" — bundle install only

| Way | Description | This plugin |
|---|---|---|
| **Bundle** (recommended)<br>`dsh plugin --profile web add ...` | loaded as an npm package by the Loader, runs in the real Node process, normal `node_modules` access | ✅ the only correct way |
| **Dynamic plugin**<br>in-session `cordis_define` / `cordis_run` | code runs in a restricted vm sandbox: `require` forbidden, native modules unavailable | ❌ unsupported |

Why: this plugin depends on two **native modules** — `sqlite-vec` (SQLite
vector extension, `.node` binary) and jieba tokenization. The vm sandbox has
neither. Use the bundle channel (install section); `dsh plugin` automatically
adds it to `dsh.profile.bundles`.

---

### 4. Other edge notes

- **Local-first data**: everything lives in `$DSH_HOME/memory-tdai/` (see
  Usage); deleting the directory wipes all memory — copy it when migrating
  machines.
- **Optional deps**: BM25 sparse encoding needs
  `@tencentdb-agent-memory/tcvdb-text` (~286MB, jieba-wasm dict) — **not
  installed by default**, auto-degrades to pure FTS5; local embedding needs
  `node-llama-cpp` (GGUF models) — also optional. Both missing still runs
  fine.
- **Session ownership**: memories are isolated by DSH session key;
  cross-session retrieval works for the same user. Subagent sessions are also
  captured in this DSH version (upstream's `excludeAgents` filter is not yet
  wired in — planned).

---

## 📄 License

MIT — derived from
[TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
(MIT). Full text in [LICENSE](./LICENSE).
