/**
 * dsh-memory-tdai — cordis plugin entry for the DeepSeek Harness.
 *
 * Mounts the TencentDB-Agent-Memory four-layer memory pipeline (TdaiCore)
 * onto the DSH host:
 *
 * - tools:     memory_search / conversation_search (model-callable)
 * - recall:    agent/pre-step waterfall refreshes a per-session recall cache;
 *              a dynamic system-prompt section injects `<relevant-memories>`
 *              at each assembly (keeps the conversation history clean)
 * - capture:   agent/turn-stopping records the turn's new messages (L0) and
 *              notifies the L1→L2→L3 pipeline scheduler
 * - lifecycle: ctx.effect disposes TdaiCore when the plugin row stops
 *
 * LLM calls for extraction/scene/persona ride the DSH `llm` service, so no
 * separate API key is required — provider/model default to the deployment's
 * agent default and can be overridden via row config or DSH_MEMORY_* env.
 */

import os from "node:os";
import path from "node:path";
import { TdaiCore } from "./core/tdai-core.js";
import { parseConfig } from "./config.js";
import { DshHostAdapter } from "./adapters/dsh/index.js";
import type { MemoryTdaiConfig } from "./config.js";
import type { Logger } from "./core/types.js";

const TAG = "[memory-tdai]";

// ── loose DSH shapes (kept minimal; the real services satisfy these) ──────

interface DshLlmLike {
  stream(options: unknown): AsyncIterable<unknown>;
}
interface DshTextBlock {
  type: string;
  text?: string;
}
interface DshMessageLike {
  role: string;
  content: readonly DshTextBlock[];
}
interface DshSessionLike {
  id: string;
  deriveMessages?(): readonly DshMessageLike[];
}
interface DshAgentLike {
  session: DshSessionLike;
  options?: { provider?: string; model?: string };
}
interface DshAgentsLike {
  requireInitiator?(): DshAgentLike | undefined;
}

function envStr(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.length > 0 ? v : undefined;
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return v === "1" || v === "true" || v === "yes";
}

/** Merge env overrides into the plugin config object for parseConfig. */
function buildConfig(rawConfig: unknown): MemoryTdaiConfig {
  const base = (rawConfig && typeof rawConfig === "object" ? rawConfig : {}) as Record<string, unknown>;
  const overrides: Record<string, unknown> = {};
  if (envStr("DSH_MEMORY_DATA_DIR") !== undefined) overrides.dataDir = envStr("DSH_MEMORY_DATA_DIR");
  if (envBool("DSH_MEMORY_CAPTURE_ENABLED") !== undefined) overrides.capture = { enabled: envBool("DSH_MEMORY_CAPTURE_ENABLED") };
  if (envBool("DSH_MEMORY_RECALL_ENABLED") !== undefined) overrides.recall = { enabled: envBool("DSH_MEMORY_RECALL_ENABLED") };
  if (envBool("DSH_MEMORY_EXTRACTION_ENABLED") !== undefined) overrides.extraction = { enabled: envBool("DSH_MEMORY_EXTRACTION_ENABLED") };
  return parseConfig({ ...base, ...overrides });
}

function resolveDataDir(rawConfig: unknown): string {
  const rc = (rawConfig && typeof rawConfig === "object" ? rawConfig : {}) as { dataDir?: string };
  if (rc.dataDir && typeof rc.dataDir === "string" && rc.dataDir.length > 0) return rc.dataDir;
  const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
  return path.join(dshHome, "memory-tdai");
}

function resolveRoute(rawConfig: unknown, agents?: DshAgentsLike): { provider: string; model: string } {
  const rc = (rawConfig && typeof rawConfig === "object" ? rawConfig : {}) as {
    provider?: string;
    model?: string;
  };
  if (rc.provider && rc.model) return { provider: rc.provider, model: rc.model };
  const envProvider = envStr("DSH_MEMORY_PROVIDER");
  const envModel = envStr("DSH_MEMORY_MODEL");
  if (envProvider && envModel) return { provider: envProvider, model: envModel };
  try {
    const initiator = agents?.requireInitiator?.();
    if (initiator?.options?.provider && initiator.options.model) {
      return { provider: initiator.options.provider, model: initiator.options.model };
    }
  } catch {
    // no initiator — fall through to defaults
  }
  return { provider: "deepseek-official", model: "deepseek-v4-flash" };
}

/** Extract the visible text of the messages entering one step. */
function messagesText(messages: readonly DshMessageLike[]): string {
  return messages
    .map((m) =>
      (m.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n"),
    )
    .filter((t) => t.length > 0)
    .join("\n");
}

function blocksText(blocks: readonly DshTextBlock[]): string {
  return (blocks ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Cordis logger → TdaiCore Logger adapter. */
function loggerAdapter(ctx: { logger?: { info?: unknown; warn?: unknown; error?: unknown; debug?: unknown } }): Logger {
  const l = ctx.logger as
    | { info(msg: string): void; warn(msg: string): void; error(msg: string): void; debug(msg: string): void }
    | undefined;
  return {
    info: (m) => l?.info?.(m),
    warn: (m) => l?.warn?.(m),
    error: (m) => l?.error?.(m),
    debug: (m) => l?.debug?.(m),
  };
}

// ── plugin ─────────────────────────────────────────────────────────────────

interface ToolsLike {
  register(definition: unknown): () => void;
}
interface SystemPromptLike {
  section(section: { name: string; order: number; text: () => string }): () => void;
}

export const name = "memory-tdai";
export const inject = ["llm", "tools", "systemPrompt"];

export function apply(
  ctx: {
    llm: DshLlmLike;
    tools: ToolsLike;
    systemPrompt: SystemPromptLike;
    get(name: string): unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(name: string, listener: (...args: any[]) => any): () => void;
    effect(callback: () => () => void | Promise<void>): () => void;
    logger?: { info?: unknown; warn?: unknown; error?: unknown; debug?: unknown };
  },
  config: unknown = {},
) {
  const rawConfig = (config ?? {}) as Record<string, unknown>;
  const logger = loggerAdapter(ctx);
  const cfg = buildConfig(rawConfig);
  const dataDir = resolveDataDir(rawConfig);
  const agents = ctx.get("agents") as DshAgentsLike | undefined;
  const route = resolveRoute(rawConfig, agents);

  logger.info(
    `${TAG} mounting dsh-memory-tdai: dataDir=${dataDir}, route=${route.provider}/${route.model}, ` +
      `capture=${cfg.capture.enabled}, recall=${cfg.recall.enabled}, extraction=${cfg.extraction.enabled}`,
  );

  const adapter = new DshHostAdapter({
    llm: ctx.llm,
    provider: route.provider,
    model: route.model,
    dataDir,
    logger,
  });
  const core = new TdaiCore({ hostAdapter: adapter, config: cfg });
  const coreReady = core.initialize().catch((err: unknown) => {
    logger.error(`${TAG} core init failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Per-session caches: recall injection text + this turn's prompt + last message count.
  const recallCache = new Map<string, string>();
  const turnPromptCache = new Map<string, { text: string }>();
  const sessionMessageCount = new Map<string, number>();

  // ── tools ──────────────────────────────────────────────────────────────
  const tools = ctx.tools;

      tools.register({
        name: "memory_search",
        description:
          "Search the user's long-term memories (four-layer memory store: persona, episodic events, instructions). " +
          "Use this to recall the user's preferences, past events, rules, or context from previous conversations. " +
          "Returns ranked memory records. Prefer this over conversation_search for structured facts.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What you want to recall about the user." },
            limit: { type: "number", description: "Max results (default 5, max 20)." },
            type: {
              type: "string",
              enum: ["persona", "episodic", "instruction"],
              description: "Optional memory type filter.",
            },
            scene: { type: "string", description: "Optional scene name filter." },
          },
          required: ["query"],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: "object",
            properties: {
              text: { type: "string" },
              total: { type: "number" },
              strategy: { type: "string" },
            },
            required: ["text", "total", "strategy"],
            additionalProperties: false,
          },
          render(_args: unknown, value: { text: string }) {
            return [{ type: "text", text: value.text }];
          },
        },
        async execute(args: { query: string; limit?: number; type?: string; scene?: string }) {
          await coreReady;
          const query = String(args.query ?? "");
          const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
          const typeFilter = typeof args.type === "string" ? args.type : undefined;
          const sceneFilter = typeof args.scene === "string" ? args.scene : undefined;
          try {
            return await core.searchMemories({ query, limit, type: typeFilter, scene: sceneFilter });
          } catch (err) {
            return {
              text: `Memory search failed: ${err instanceof Error ? err.message : String(err)}`,
              total: 0,
              strategy: "error",
            };
          }
        },
      });

      tools.register({
        name: "conversation_search",
        description:
          "Search past conversation history (raw dialogue records). Use when memory_search does not have the answer " +
          "or when you need exact words, dialogue context, or specific past messages. Returns ranked individual messages.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What conversation content you want to find." },
            limit: { type: "number", description: "Max messages (default 5, max 20)." },
            session_key: { type: "string", description: "Optional filter to one session." },
          },
          required: ["query"],
          additionalProperties: false,
        },
        output: {
          schema: {
            type: "object",
            properties: {
              text: { type: "string" },
              total: { type: "number" },
            },
            required: ["text", "total"],
            additionalProperties: false,
          },
          render(_args: unknown, value: { text: string }) {
            return [{ type: "text", text: value.text }];
          },
        },
        async execute(args: { query: string; limit?: number; session_key?: string }) {
          await coreReady;
          const query = String(args.query ?? "");
          const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
          const sessionKeyFilter = typeof args.session_key === "string" ? args.session_key : undefined;
          try {
            return await core.searchConversations({ query, limit, sessionKey: sessionKeyFilter });
          } catch (err) {
            return {
              text: `Conversation search failed: ${err instanceof Error ? err.message : String(err)}`,
              total: 0,
            };
          }
        },
      });
      logger.info(`${TAG} registered memory_search / conversation_search tools`);

    // ── auto-recall: refresh cache before each step ────────────────────────
    ctx.on("agent/pre-step", async (payload, next) => {
      const decision = await next();
      if (decision === undefined || decision.kind !== "enter") return decision;
      const { agent } = payload as { agent: DshAgentLike };
      try {
        const sessionKey = String(agent.session.id);
        const userText = messagesText((payload as { messages: readonly DshMessageLike[] }).messages ?? []);
        if (userText.length > 0) {
          turnPromptCache.set(sessionKey, { text: userText });
          if (cfg.recall.enabled) {
            const recall = await coreReady.then(() => core.handleBeforeRecall(userText, sessionKey));
            const parts: string[] = [];
            if (recall?.prependContext) parts.push(recall.prependContext);
            if (recall?.appendSystemContext) parts.push(recall.appendSystemContext);
            recallCache.set(sessionKey, parts.join("\n"));
          }
        }
      } catch (err) {
        logger.warn(`${TAG} auto-recall failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
      return decision;
    });

    // ── dynamic system-prompt section: synchronous cache read ──────────────
    const systemPrompt = ctx.systemPrompt;
    systemPrompt.section({
      name: "memory-tdai-recall",
      order: 50,
      text: () => {
        try {
          const initiator = agents?.requireInitiator?.();
          if (initiator === undefined) return "";
          return recallCache.get(String(initiator.session.id)) ?? "";
        } catch {
          return "";
        }
      },
    });

    // ── auto-capture at turn close ─────────────────────────────────────────
    ctx.on("agent/turn-stopping", async (payload) => {
      const { agent } = payload as { agent: DshAgentLike };
      try {
        if (!cfg.capture.enabled) return;
        const sessionKey = String(agent.session.id);
        const derived = agent.session.deriveMessages?.() ?? [];
        const lastCount = sessionMessageCount.get(sessionKey) ?? 0;
        const newMessages = derived.slice(lastCount);
        sessionMessageCount.set(sessionKey, derived.length);
        if (newMessages.length === 0) return;
        const cachedPrompt = turnPromptCache.get(sessionKey);
        turnPromptCache.delete(sessionKey);
        const ts = Date.now();
        const messages = newMessages.map((m) => ({
          role: m.role,
          content: blocksText(m.content),
          timestamp: ts,
        }));
        await coreReady;
        await core.handleTurnCommitted({
          userText: cachedPrompt?.text ?? "",
          assistantText: "",
          messages,
          sessionKey,
          sessionId: sessionKey,
          startedAt: ts - 1,
          originalUserMessageCount: lastCount,
        });
      } catch (err) {
        logger.warn(`${TAG} auto-capture failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // ── lifecycle: dispose TdaiCore with the plugin fiber ──────────────────
    ctx.effect(() => () => {
      core.destroy().catch((err: unknown) => {
        logger.warn(`${TAG} destroy failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    logger.info(`${TAG} dsh-memory-tdai mounted`);
}
