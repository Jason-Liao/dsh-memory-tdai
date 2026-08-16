# dsh-memory-tdai

[English](README_EN.md) | 中文

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

## 🧠 Embedding 配置（专业用户）

> 默认零配置即可运行（关键词检索）。需要**语义级检索**（向量 + 关键词混合、RRF 融合排序）时，配置一个 OpenAI 兼容的 embedding 端点即可。DeepSeek 官方 API 没有 embedding 端点，需使用第三方 OpenAI 兼容服务。

### 完整字段

在 bundle 行 config 的 `embedding` 组下（`~/.dsh/profiles/web/cordis.patch.yml` 给 `memory-tdai` 行加 config）：

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | 否 | `true` | 总开关（provider 为 `none` 时仍视为禁用） |
| `provider` | 是 | `none` | 任意非 `none`/`local` 的值（如 `openai`、`dashscope`）都被当作 OpenAI 兼容远端；`qclaw` 走本地代理转发 |
| `baseUrl` | 是 | — | 兼容端点的 base URL，如 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `apiKey` | 是 | — | 端点密钥 |
| `model` | 是 | — | 模型名，如 `text-embedding-v4`、`text-embedding-3-small`、`BAAI/bge-m3` |
| `dimensions` | 是 | — | **向量维度，必须与模型输出一致**（见下表），不一致会导致向量表建错、查询全空 |
| `sendDimensions` | 否 | `true` | 是否在请求体里发送 `dimensions` 字段。OpenAI `text-embedding-3-*` 支持（Matryoshka 可降维）；BGE-M3 等开源模型会拒绝未知字段（HTTP 400），设 `false` |
| `maxInputChars` | 否 | `5000` | 单条文本超长截断阈值 |
| `timeoutMs` | 否 | `10000` | 单次 embedding 请求超时 |
| `recallTimeoutMs` | 否 | 同上 | 回忆路径超时（用户侧，应更短） |
| `captureTimeoutMs` | 否 | 同上 | 捕获路径超时（后台，可更长） |
| `conflictRecallTopK` | 否 | `5` | L1 去重时的候选召回数 |
| `proxyUrl` | 否 | — | 仅 `provider="qclaw"` 时使用（本地代理转发） |

### 常用端点示例

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: memory-tdai
      name: 'dsh-memory-tdai'
      config:
        embedding:
          enabled: true
          provider: dashscope
          baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
          apiKey: sk-xxxxxxxx
          model: text-embedding-v4
          dimensions: 1024
          sendDimensions: false
```

| 端点 | baseUrl | 示例模型 | dimensions | sendDimensions |
|---|---|---|---|---|
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `text-embedding-v4` | 1024 | `false` |
| 阿里云百炼 | 同上 | `qwen3-embedding-0.6b` / `qwen3-embedding-4b` | 1024（可调） | `false` |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | 1536 | `true` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `BAAI/bge-m3` | 1024 | `false` |
| vLLM/Ollama 自托管 | 你的网关地址 | 任意兼容模型 | 按模型 | `false` |

### 检索策略（`recall` 组）

`recall.strategy` 三选一（默认 `hybrid`）：

| 值 | 行为 | 适合 |
|---|---|---|
| `hybrid` | 向量 + 关键词（FTS5）双路召回，RRF 融合排序 | 默认推荐 |
| `embedding` | 仅向量召回 | 配置了 embedding 且语料语义密度高 |
| `keyword` | 仅关键词（FTS5 + jieba） | 未配置 embedding，或精确术语/代码检索 |

```yaml
config:
  recall:
    strategy: hybrid        # embedding | keyword | hybrid
    maxResults: 5           # 单次回忆最多条数
    scoreThreshold: 0.3     # 相关度阈值
    maxTotalRecallChars: 0  # 注入总字符上限（0=不限）
```

### ⚠️ 注意事项

1. **`dimensions` 与模型不匹配 = 检索全空**：向量表按维度建，维度错了写入会失败或查询全空。改维度/模型后 store 检测到 provider 变化会自动触发**全量重向量化**（历史记忆重新 embed，耗时取决于语料量）。
2. **apiKey 明文**：当前版本密钥明文写在 `cordis.patch.yml`。介意请勿将 profile 目录提交到 git；后续版本规划接入 DSH `credentials` 服务。
3. **qclaw 特殊模式**：`provider="qclaw"` 时请求经 `proxyUrl` 本地代理转发（腾讯云向量网关场景）。
4. **验证**：改完重启后，日志应出现 `Store created: ... embedding=enabled`；用 `memory_search` 查一个与语料语义相关但不含字面词的查询（如记忆里有"咖啡"，查"提神的饮品"），命中即向量生效。

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

## ⚠️ 已知限制（重要，请先读）

### 1. 未配置 embedding 时，检索是"关键词模式"，不是"语义模式"

**这是什么意思？** 记忆检索有两种引擎，能力差别很大：

| 检索方式 | 工作方式 | 例子（记忆内容："用户喜欢喝咖啡"） |
|---|---|---|
| **关键词检索（默认）** | 按字面词匹配（jieba 中文分词 + SQLite FTS5） | 问"咖啡" ✅ 命中；问"我早上喝什么提神" ❌ 查不到（句子里没有"咖啡"二字） |
| **向量检索（需配置）** | 把文字转成向量，按语义距离匹配 | 问"提神的饮品" ✅ 也能命中"咖啡" |

**为什么会这样？** 向量化需要一个 embedding API（把文字变成数字向量的服务）。DeepSeek 官方 API 目前**没有** embedding 端点；插件也不会在未配置的情况下偷偷调用第三方服务。所以默认走关键词模式——够用，但"望文生义"。

**怎么升级？** 在插件配置（bundle 行 config）里提供一个 **OpenAI 兼容的 embedding 端点**（OpenAI `text-embedding-3-small`、阿里云百炼 `qwen3-embedding`、硅基流动、vLLM/Ollama 自托管等皆可），插件自动切换为"向量 + 关键词"混合检索（RRF 融合排序），语义匹配能力大幅增强。不配置也不影响使用，只是检索更"字面"。

> jieba 是中文分词器——"我喜欢喝咖啡"入库前会被切成"我/喜欢/喝/咖啡"再建立索引，这正是 FTS5 能匹配中文的关键。关键词模式对中文检索已经可用，只是做不到"同义替换"级别的语义理解。

---

### 2. L1 记忆抽取是"后台渐进式"，刚装好的头几轮查不到结构化记忆

**这是什么意思？** 记忆分层里，**L0 原始对话**是每轮对话结束就立刻落盘的（纯本地写文件，零成本）；但 **L1 原子记忆**（把对话提炼成"用户喜欢用中文回复"这种颗粒度的结构化记忆）需要**调用一次大模型**来完成抽取，有 token 成本，所以不是每轮都跑。

**节奏机制（warmup 预热）**：插件默认攒够 **5 轮对话**才触发一次 L1 抽取。为了让新用户尽快看到效果，触发阈值是渐进的：**1 → 2 → 4 → 5**（第 1 轮就跑一次让你立刻体验，之后每轮倍增，稳定在每 5 轮）。

**对使用的影响**：
- 刚装好、聊了没几轮时，`memory_search`（查结构化记忆）大概率返回空——L1 还没提炼完。
- 但 **`conversation_search` 始终可用**——L0 原始对话每轮都落盘，随时能查原文。
- 正常使用一两天后，L1/L2/L3 各层会自然积累起来。

---

### 3. 本插件不能用"动态插件"方式加载，必须以 bundle 方式安装

**背景**：DSH 插件有两条安装路径：

| 方式 | 说明 | 本插件 |
|---|---|---|
| **bundle 方式**（推荐）<br>`dsh plugin --profile web add ...` | 插件作为 npm 包被 Loader 加载，运行在真实 Node 进程，可正常使用 `node_modules` 依赖 | ✅ 唯一正确的安装方式 |
| **动态插件**<br>会话内 `cordis_define` / `cordis_run` | 代码运行在受限 vm 沙箱：禁止 `require`、无法加载原生模块 | ❌ 不可用 |

**为什么？** 本插件依赖两个**原生模块**：`sqlite-vec`（SQLite 向量搜索扩展，`.node` 二进制）和 jieba 中文分词。vm 沙箱没有这些能力，动态加载会直接失败。

**怎么装？** 用安装章节的命令（GitHub tarball / npm / 本地 tarball）走 bundle 通道即可，`dsh plugin` 会自动把本包加进 `dsh.profile.bundles`。

---

### 4. 其余已知边界

- **记忆数据是本地文件**：所有数据存在 `$DSH_HOME/memory-tdai/`（见"使用"章节），删除目录即清空全部记忆——迁移机器时记得一并拷贝。
- **混合检索依赖可选包**：BM25 稀疏编码依赖 `@tencentdb-agent-memory/tcvdb-text`（约 286MB，含 jieba-wasm 词典），默认**未安装**，缺失时自动降级为纯 FTS5；本地 embedding 依赖 `node-llama-cpp`（GGUF 模型），同样可选。两条都缺依然能完整运行。
- **每会话记忆归属**：记忆按 DSH 会话 key 隔离写入，同一用户的跨会话记忆可被检索到。DSH 版目前未接入上游的 `excludeAgents` 过滤，子代理（subagent）会话也会参与捕获——如需排除可按行配置加白名单（后续版本规划）。

---

## 📄 License

MIT —— 派生自 [TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)（MIT）。完整许可见 [LICENSE](./LICENSE)。
