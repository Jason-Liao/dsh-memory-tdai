/**
 * Smoke test — exercises TdaiCore end-to-end WITHOUT a DSH host:
 * mock LLM + real SQLite/vector store + capture → L1 pipeline → recall/search.
 * Run: node --test test/smoke.mjs  (or: node test/smoke.mjs)
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";
import { TdaiCore } from "../lib/smoke.js";
import { parseConfig } from "../lib/smoke.js";
import { DshHostAdapter } from "../lib/smoke.js";

// ── mock LLM: returns a valid L1 extraction JSON ───────────────────────────
function mockLlm() {
  return {
    async *stream(options) {
      const text = JSON.stringify([
        { scene_name: "偏好", message_ids: [], memories: [{ content: "用户喜欢喝咖啡", type: "preference", priority: 5 }] },
      ]);
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text };
      yield { type: "block-end", index: 0, block: { type: "text", text } };
      yield { type: "finish", reason: "stop" };
    },
  };
}

const logger = {
  info: (m) => console.log("[info]", m),
  warn: (m) => console.log("[warn]", m),
  error: (m) => console.log("[error]", m),
  debug: (m) => console.log("[debug]", m),
};

const dataDir = await mkdtemp(join(tmpdir(), "dsh-memory-smoke-"));
console.log("dataDir:", dataDir);

try {
  const cfg = parseConfig({ pipeline: { everyNConversations: 1 } });
  const adapter = new DshHostAdapter({
    llm: mockLlm(),
    provider: "mock",
    model: "mock",
    dataDir,
    logger,
  });
  const core = new TdaiCore({ hostAdapter: adapter, config: cfg });
  await core.initialize();
  console.log("core initialized");

  // Timestamps must postdate the core's startup cursor (taken at initialize).
  const now = Date.now();
  await core.handleTurnCommitted({
    userText: "我喜欢喝咖啡",
    assistantText: "",
    messages: [
      { role: "user", content: "我喜欢喝咖啡", timestamp: now + 1 },
      { role: "assistant", content: "好的，记住了", timestamp: now + 2 },
    ],
    sessionKey: "smoke-session",
    sessionId: "smoke-session",
    startedAt: now,
  });
  console.log("turn committed");

  // Wait for the L1 pipeline (background) to run.
  await new Promise((r) => setTimeout(r, 2500));

  const recall = await core.handleBeforeRecall("咖啡", "smoke-session");
  console.log("recall:", JSON.stringify(recall).slice(0, 300));

  const mem = await core.searchMemories({ query: "咖啡", limit: 5 });
  console.log("memory search: total=", mem.total, "strategy=", mem.strategy);
  console.log(mem.text.slice(0, 300));

  const conv = await core.searchConversations({ query: "咖啡", limit: 5 });
  console.log("conversation search: total=", conv.total);
  console.log(conv.text.slice(0, 300));

  await core.destroy();
  console.log("SMOKE TEST PASSED");
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
