# dsh-memory-tdai

**DeepSeek Harness 的四层长期记忆插件** —— 把 [TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) 从 OpenClaw 完整移植到 DSH。

让 DeepSeek 模型**记住你**：对话被自动整理成"原始记录 → 原子记忆 → 场景块 → 人设档案"四层结构，跨会话检索、自动回忆、自动归档。模型不需要把历史对话反复塞进上下文，也能知道你的偏好、习惯和项目背景。

```
L0 原始对话 ──▶ L1 原子记忆 ──▶ L2 场景块 ──▶ L3 人设档案
  (jsonl)      (SQLite+向量)   (scene_blocks)  (persona.md)
   自动捕获        抽取/去重      场景归纳         用户画像
```

---

## 📖 这个插件是怎么来的（来历与血统）

### 上游项目

本插件是 **TencentCloud/TencentDB-Agent-Memory**（腾讯云官方开源项目，MIT 协议）的 DSH 移植版。

上游项目为 **OpenClaw**（另一个 agent 运行时）开发了一套四层记忆系统，官方基准数据：接入后短时记忆任务成功率最高提升 +51.5%、token 消耗最高下降 -61.4%、人设记忆准确率从 48% 提升到 76%。它的核心引擎 `TdaiCore` 被刻意设计成 **host-neutral**（与宿主无关）：存储、抽取、场景、人设的全部逻辑都只依赖一个极小的 `HostAdapter` 接口（4 个方法），OpenClaw 只是它的一个宿主外壳。

### 移植方式（为什么可以"换一层壳"就能搬家）

```text
OpenClaw 宿主                            DeepSeek Harness 宿主
─────────────────────────                ─────────────────────────
api.registerTool("tdai_memory_search") ─▶ tools.register("memory_search")
api.registerTool("tdai_conversation_search") ─▶ tools.register("conversation_search")
api.on("before_prompt_build") ──────────▶ agent/pre-step 瀑布 + 动态 system prompt 段
api.on("agent_end") ────────────────────▶ agent/turn-stopping
api.on("gateway_stop") ─────────────────▶ ctx.effect disposer → core.destroy()
OpenClawLLMRunner ─────────────────────▶ DshLLMRunner（复用 DSH 的 ctx.llm 服务）
openclaw.plugin.json 配置 ─────────────▶ bundle 行 config + DSH_MEMORY_* 环境变量
```

具体做了三件事：

1. **保留核心，替换外壳**：原封不动搬入 `TdaiCore`（四层管线、SQLite 向量存储、BM25/FTS5 检索、提示词工程），写了一个新的 `DshHostAdapter`（约 100 行）实现那个 4 方法接口。
2. **LLM 零配置复用**：上游的记忆抽取/场景归纳/人设生成需要调用大模型。DSH 移植版直接走 **DSH 自己的 `ctx.llm` 服务**——用你在设置里选的同一个 DeepSeek 路由、同一份凭据，不需要额外配 API Key。这是移植版与上游最实用的差异之一。
3. **事件映射**：OpenClaw 的 `before_prompt_build`（提示词构建前注入记忆）映射为 DSH 的 `agent/pre-step` 瀑布 + 动态 `systemPrompt` 段——回忆内容只进 system prompt，**不污染会话历史**；`agent_end`（回合结束）映射为 `agent/turn-stopping`，回合一关就落盘。

### 与原版相比做了哪些裁减

| 项 | 上游 OpenClaw 版 | 本 DSH 版 |
|---|---|---|
| LLM 调用 | @ai-sdk/openai + 独立 API Key | **复用 DSH ctx.llm**，零配置 |
| 向量检索依赖 | tcvdb-text（286MB wasm 词典）+ sqlite-vec | sqlite-vec + FTS5 必用；tcvdb-text **可选懒加载**（缺失自动降级 BM25→FTS5） |
| 本地 embedding | node-llama-cpp（GGUF 模型） | 保留代码，未配置时自动降级为关键词检索 |
| OpenClaw 专属 | CleanContextRunner / hook 策略 / CLI | 全部移除 |
| 记忆能力 | L0/L1/L2/L3 全管线 | **全管线保留** |

---

## ✨ 功能

### 记忆自动积累（零操作）

- **自动捕获（L0）**：每个回合结束，对话自动写入 `conversations/YYYY-MM-DD.jsonl`——模型、工具、你说了什么都不遗漏。
- **自动抽取（L1）**：后台管线把对话提炼成"原子记忆"（`"用户喜欢用中文回复"` 这种颗粒度），写入 SQLite 向量库，带类型（persona / episodic / instruction）、优先级、场景归属，并做**智能去重**。
- **自动归纳（L2）**：原子记忆按主题聚类成场景块（`scene_blocks/`）。
- **自动画像（L3）**：场景积累到阈值后生成 `persona.md`——你的稳定偏好画像，跨会话恒定可用。

### 记忆自动回忆（零操作）

- 每次模型思考前，插件检索与当前话题相关的记忆，通过动态 system prompt 段注入 `<relevant-memories>`，模型"无感"地用上你的历史偏好。
- 回忆内容不写入会话历史（不会像某些实现那样把记忆一遍遍刷进上下文）。

### 两个模型工具（按需查）

| 工具 | 作用 | 何时用 |
|---|---|---|
| `memory_search` | 查**结构化记忆**（人设/事件/规则，FTS5+BM25+向量混合排序） | 想知道用户的偏好、历史事实、既定规则 |
| `conversation_search` | 查**原始对话记录**（精确到某条消息，带回放） | 需要原文、确切的措辞、当时说过什么 |

### 检索能力

- **混合检索**：配置 embedding 后走"向量 + 关键词"混合（RRF 融合）；无 embedding 配置时自动降级 FTS5 关键词检索（jieba 中文分词）。
- **场景导航**：L2 场景块可被检索、展开、回放。
- **全链路可追溯**：顶层人设 → 场景块 → 原子记忆 → 原始对话，层层下钻不丢证据。

---

## 📦 安装

前置：已安装 dsh（任何开源构建均可）、`pnpm` 在 PATH（`corepack enable` 或 `npm i -g pnpm`）。

```sh
# 方式一：从 GitHub（无需 npm 账号）
dsh plugin --profile web add https://github.com/Jason-Liao/dsh-memory-tdai/archive/refs/tags/v1.0.0.tar.gz

# 方式二：从 npm（发布后）
dsh plugin --profile web add dsh-memory-tdai

# 方式三：本地 tarball 调试
cd dsh-memory-tdai && npm pack
dsh plugin --profile web add ./dsh-memory-tdai-1.0.0.tgz
```

然后 **重启 `dsh web` + 浏览器硬刷新**。`dsh plugin` 会自动把本包追加到 `dsh.profile.bundles`（因为它声明了 `dsh.bundle`），无需手动改配置。

验证：新会话里让模型说"**用 memory_search 查一下我之前的记忆**"，若工具出现在工具列表即成功。

---

## 🚀 使用

### 开箱即用（默认配置）

装好重启后什么都不用配：

1. **正常聊天**——你的对话会被自动记录和提炼。
2. **跨会话提问**——新开一个会话，问"你还记得我喜欢怎么工作吗？"，模型会通过自动回忆或 `memory_search` 用上之前的记忆。
3. **手动查**——直接让模型"查一下我上周讨论过的 X"，模型会调 `conversation_search` 找到原文。

### 数据都存哪

```
~/.dsh/memory-tdai/
├── conversations/     L0 原始对话（每日 jsonl）
├── records/           L1 原子记忆（SQLite vectors.db + 索引）
├── scene_blocks/      L2 场景块
├── persona.md         L3 人设档案
└── .metadata/         管线进度游标
```

删除整个目录 = 清空记忆（谨慎）。

---

## ⚙️ 配置

默认零配置。可用 **bundle 行 config**（`cordis.patch.yml` 或 `--patch`）或**环境变量**覆盖：

| 配置 | 默认 | 环境变量 |
|---|---|---|
| 数据目录 | `$DSH_HOME/memory-tdai` | `DSH_MEMORY_DATA_DIR` |
| LLM 路由 provider | 部署默认（deepseek-official） | `DSH_MEMORY_PROVIDER` |
| LLM 路由 model | 部署默认（deepseek-v4-flash） | `DSH_MEMORY_MODEL` |
| 自动捕获 | 开 | `DSH_MEMORY_CAPTURE_ENABLED`（0/1） |
| 自动回忆 | 开 | `DSH_MEMORY_RECALL_ENABLED`（0/1） |
| L1 抽取 | 开 | `DSH_MEMORY_EXTRACTION_ENABLED`（0/1） |

管线节奏参数（在 bundle 行 config 里，见上游 config.ts）：`pipeline.everyNConversations`（默认 5 轮触发一次 L1，warmup 渐进）、`persona.triggerEveryN`（默认 50 条记忆触发一次人设生成）等。

---

## 🔬 工作原理（深入）

- **事件溯源式捕获**：`agent/turn-stopping` 时读取会话增量消息，按消息数游标去重，写入 L0。
- **LLM 复用**：`DshLLMRunner` 用 `ctx.llm.stream()` 以与对话相同的路由发起抽取/归纳调用；L2/L3 的"工具化"运行在一个沙箱文件工具循环里（read/write/replace，限定在记忆工作区）。
- **动态提示词段**：回忆通过 `systemPrompt.section` 的 provider 函数注入——每次组装实时读缓存，模型看到记忆、历史保持干净。
- **graceful degradation**：sqlite-vec / jieba / tcvdb-text / node-llama-cpp 任一缺失，都自动降级而不是崩溃（向量 → 关键词；BM25 → FTS5）。

---

## 🛠️ 开发与构建

```sh
git clone https://github.com/Jason-Liao/dsh-memory-tdai.git
cd dsh-memory-tdai
npm i
node build.mjs          # esbuild 打包 src → lib/index.js
node test/smoke.mjs     # 冒烟测试：mock LLM + 真实 SQLite，验证 捕获→抽取→回忆→检索
```

目录结构：`src/`（TS 源码，含上游 `core/` + 新写 `adapters/dsh/` + 插件入口 `index.ts`）、`cordis.patch.yml`（bundle 组合层）、`lib/index.js`（构建产物，发布用）。

---

## ⚠️ 已知限制

- 未配置 embedding 时检索为关键词模式（FTS5 + jieba 分词），语义匹配能力有限；配置 OpenAI 兼容 embedding 端点可启用向量混合检索。
- L1 抽取节奏为后台渐进式（warmup 从 1 轮开始倍增到 5 轮），刚装好的前几轮可能查不到结构化记忆，L0 对话检索始终可用。
- 动态插件（`cordis_define`）环境无法加载本包（依赖原生模块），请以 bundle 方式安装。

---

## 📄 License

MIT —— 派生自 [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)（MIT）。完整许可见 [LICENSE](./LICENSE)。
