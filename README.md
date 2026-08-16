# dsh-memory-tdai

**TencentDB Agent Memory for DeepSeek Harness** — a DSH adaptation of
[TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
(the OpenClaw four-layer memory plugin).

The original plugin's core (`TdaiCore`) is host-neutral; this package replaces
the OpenClaw adapter with a DSH adapter and mounts the whole memory pipeline
onto the DeepSeek Harness.

## What you get

- **`memory_search` tool** — search structured long-term memories (persona / episodic / instruction), ranked, BM25/vector hybrid.
- **`conversation_search` tool** — search raw past dialogue records.
- **Auto-recall** — before each model step, relevant memories are retrieved and injected into the system prompt via a dynamic section (`<relevant-memories>`), keeping conversation history clean.
- **Auto-capture** — at each turn close, the turn's new messages are recorded (L0) and the L1→L2→L3 pipeline (atomic memories → scene blocks → persona) is scheduled in the background.
- **Four-layer memory** — L0 raw dialogue (JSONL), L1 atomic memories (SQLite + vectors), L2 scene blocks, L3 persona profile.

## Install

```sh
# from GitHub
dsh plugin --profile web add https://github.com/<your-org>/dsh-memory-tdai/archive/refs/tags/v1.0.0.tar.gz

# from npm (once published)
dsh plugin --profile web add dsh-memory-tdai
```

then restart `dsh web` and hard-refresh the browser. The `dsh plugin` command
reconciles `dsh.profile.bundles` automatically because this package declares
`dsh.bundle`.

## Configuration

Everything works out of the box:

| Setting | Default | Override |
|---|---|---|
| Data directory | `$DSH_HOME/memory-tdai` | row config `dataDir` or `DSH_MEMORY_DATA_DIR` |
| LLM route | deployment agent default (`deepseek-official` / `deepseek-v4-flash`) | `DSH_MEMORY_PROVIDER` / `DSH_MEMORY_MODEL` |
| Capture / recall / extraction | enabled | `DSH_MEMORY_CAPTURE_ENABLED` / `DSH_MEMORY_RECALL_ENABLED` / `DSH_MEMORY_EXTRACTION_ENABLED` (`0`/`1`) |

Memory-pipeline LLM calls ride the DSH `llm` service — same credentials and
routing as the conversation, no extra API key. Embedding is optional; without
embedding configuration the store falls back to local BM25 + FTS5 retrieval.

## How the adaptation works

| OpenClaw surface | DSH surface |
|---|---|
| `api.registerTool("tdai_memory_search")` | `tools.register({ name: "memory_search", ... })` |
| `api.registerTool("tdai_conversation_search")` | `tools.register({ name: "conversation_search", ... })` |
| `api.on("before_prompt_build")` | `agent/pre-step` waterfall (refresh recall cache) + dynamic `systemPrompt.section` (inject) |
| `api.on("agent_end")` | `agent/turn-stopping` (record L0, notify pipeline) |
| `api.on("gateway_stop")` | `ctx.effect` disposer → `core.destroy()` |
| `OpenClawLLMRunner` / `StandaloneLLMRunner` | `DshLLMRunner` over `ctx.llm.stream` |
| `openclaw.plugin.json` config | row config + `DSH_MEMORY_*` env |

## Build

```sh
npm i
node build.mjs          # bundles src → lib/index.js (+ lib/smoke.js)
node test/smoke.mjs     # smoke test: mock LLM + real store, capture→recall→search
```

## License

MIT — derived from TencentDB-Agent-Memory (MIT).
