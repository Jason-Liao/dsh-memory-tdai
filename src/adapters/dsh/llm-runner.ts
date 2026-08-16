/**
 * DshLLMRunner — LLMRunner for the DeepSeek Harness host.
 *
 * Routes every memory-pipeline LLM call (L1 extraction, L1 dedup, L2 scene,
 * L3 persona) through the DSH `ctx.llm` service: same provider/model routing,
 * credentials, retries, and interception as the conversation itself. No
 * separate API key or endpoint configuration is needed.
 *
 * `enableTools: false` → single text-only call (L1 paths).
 * `enableTools: true`  → bounded tool-call loop exposing read_file /
 *   write_to_file / replace_in_file sandboxed to params.workspaceDir
 *   (L2 scene / L3 persona paths).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  LLMRunner,
  LLMRunParams,
  LLMRunnerCreateOptions,
  LLMRunnerFactory,
  Logger,
} from "../../core/types.js";

const TAG = "[memory-tdai][dsh-runner]";

// ── minimal DSH stream/message bridge (no value-import from dsh packages) ──
// The DSH llm stream protocol: block-start / text-delta / reasoning-delta /
// tool-call-delta / block-end / usage / finish. We assemble the blocks we
// need and ignore the rest, exactly like BlockAssembler for text+tool calls.

interface BridgeChunk {
  type: string;
  index?: number;
  blockType?: string;
  text?: string;
  id?: string;
  name?: string;
  argumentsDelta?: string;
  block?: { type: string; [key: string]: unknown };
  reason?: string;
}

interface AssembledBlock {
  type: string;
  [key: string]: unknown;
}

function assembleStream(chunks: AsyncIterable<unknown>): Promise<{ blocks: AssembledBlock[]; finishKind: string }> {
  return (async () => {
    const blocks = new Map<number, AssembledBlock>();
    let finishKind = "stop";
    for await (const raw of chunks) {
      const chunk = raw as BridgeChunk;
      switch (chunk.type) {
        case "block-start": {
          const block: AssembledBlock = { type: chunk.blockType ?? "text" };
          if (block.type === "tool-call") {
            block.id = "";
            block.name = "";
            block.arguments = "";
          }
          blocks.set(chunk.index as number, block);
          break;
        }
        case "text-delta": {
          const block = blocks.get(chunk.index as number);
          if (block !== undefined) block.text = String(block.text ?? "") + String(chunk.text ?? "");
          break;
        }
        case "tool-call-delta": {
          const block = blocks.get(chunk.index as number);
          if (block === undefined) break;
          if (chunk.id !== undefined) block.id = chunk.id;
          if (chunk.name !== undefined) block.name = String(block.name ?? "") + String(chunk.name);
          block.arguments = String(block.arguments ?? "") + String(chunk.argumentsDelta ?? "");
          break;
        }
        case "block-end": {
          if (chunk.block !== undefined) blocks.set(chunk.index as number, chunk.block as AssembledBlock);
          break;
        }
        case "finish": {
          finishKind = chunk.reason === undefined ? String((chunk as unknown as { kind?: string }).kind ?? "stop") : String(chunk.reason);
          break;
        }
        default:
          break;
      }
    }
    return { blocks: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), finishKind };
  })();
}

function userMessage(text: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: "dsh-memory-tdai" },
  };
}

function assistantMessage(blocks: AssembledBlock[], provider: string, model: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: "assistant",
    content: blocks,
    source: { kind: "model", provider, model },
  };
}

function toolResultMessage(callId: string, text: string, isError: boolean): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "tool-result", toolCallId: callId, content: [{ type: "text", text }], isError }],
    source: { kind: "tool", callId },
  };
}

/** File tools exposed to the model during L2/L3 tool-enabled runs. */
const FILE_TOOL_SCHEMAS = [
  {
    name: "read_file",
    description:
      "Read the full text content of a file inside the memory workspace. " +
      "Paths are resolved relative to the memory workspace root; absolute paths and `..` escapes are rejected.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_to_file",
    description:
      "Create or overwrite a file inside the memory workspace. Missing parent directories are created.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "Full text content to write." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "replace_in_file",
    description:
      "Replace the first exact occurrence of `oldText` with `newText` inside a workspace file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        oldText: { type: "string", description: "Exact literal text to find." },
        newText: { type: "string", description: "Replacement text." },
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false,
    },
  },
];

export interface DshLlmLike {
  stream(options: unknown): AsyncIterable<unknown>;
}

export interface DshLLMRunnerOptions {
  llm: DshLlmLike;
  provider: string;
  model: string;
  logger: Logger;
  enableTools?: boolean;
  maxToolIterations?: number;
}

/** Resolve a workspace-relative path and reject escapes from the sandbox. */
function resolveSandboxed(workspaceDir: string, input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`${TAG} invalid path argument`);
  }
  const resolved = path.resolve(workspaceDir, input);
  const root = path.resolve(workspaceDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`${TAG} path escapes the memory workspace: ${input}`);
  }
  return resolved;
}

export class DshLLMRunner implements LLMRunner {
  private readonly llm: DshLlmLike;
  private readonly provider: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly enableTools: boolean;
  private readonly maxToolIterations: number;

  constructor(opts: DshLLMRunnerOptions) {
    this.llm = opts.llm;
    this.provider = opts.provider;
    this.model = opts.model;
    this.logger = opts.logger;
    this.enableTools = opts.enableTools ?? false;
    this.maxToolIterations = opts.maxToolIterations ?? 10;
  }

  async run(params: LLMRunParams): Promise<string> {
    const workspaceDir = params.workspaceDir ?? process.cwd();
    const messages: Array<Record<string, unknown>> = [userMessage(params.prompt)];
    const system = params.systemPrompt;

    const steps = this.enableTools ? this.maxToolIterations : 1;
    let lastText = "";
    for (let i = 0; i < steps; i++) {
      const options = {
        provider: this.provider,
        model: this.model,
        messages,
        ...(system === undefined ? {} : { system }),
        ...(this.enableTools ? { tools: FILE_TOOL_SCHEMAS } : {}),
        ...(params.maxTokens === undefined ? {} : { maxTokens: params.maxTokens }),
      };
      const { blocks, finishKind } = await assembleStream(this.llm.stream(options));
      if (finishKind === "error" || finishKind === "aborted") {
        throw new Error(`${TAG} LLM stream finished with ${finishKind} (task=${params.taskId})`);
      }
      const text = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      const toolCalls = blocks.filter((b) => b.type === "tool-call");
      if (toolCalls.length === 0 || !this.enableTools) {
        return text;
      }
      lastText = text;
      messages.push(assistantMessage(blocks, this.provider, this.model));
      for (const tc of toolCalls) {
        const callId = String(tc.id ?? "");
        const callName = String(tc.name ?? "");
        const callArgs = String(tc.arguments ?? "{}");
        const outcome = await this.executeFileTool({ id: callId, name: callName, arguments: callArgs }, workspaceDir);
        messages.push(toolResultMessage(callId, outcome.text, outcome.isError));
      }
    }
    this.logger.warn?.(`${TAG} tool loop exhausted ${this.maxToolIterations} iterations (task=${params.taskId})`);
    return lastText;
  }

  private async executeFileTool(
    call: { id: string; name: string; arguments: string },
    workspaceDir: string,
  ): Promise<{ text: string; isError: boolean }> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.arguments) as Record<string, unknown>;
    } catch {
      return { text: `Invalid JSON arguments: ${call.arguments}`, isError: true };
    }
    try {
      switch (call.name) {
        case "read_file": {
          const target = resolveSandboxed(workspaceDir, args.path);
          const content = await fs.readFile(target, "utf8");
          return { text: content, isError: false };
        }
        case "write_to_file": {
          const target = resolveSandboxed(workspaceDir, args.path);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, String(args.content ?? ""), "utf8");
          return { text: `Wrote ${path.relative(workspaceDir, target)}`, isError: false };
        }
        case "replace_in_file": {
          const target = resolveSandboxed(workspaceDir, args.path);
          const oldText = String(args.oldText ?? "");
          const newText = String(args.newText ?? "");
          const content = await fs.readFile(target, "utf8");
          const at = content.indexOf(oldText);
          if (at < 0) return { text: "oldText not found in file", isError: true };
          await fs.writeFile(target, content.slice(0, at) + newText + content.slice(at + oldText.length), "utf8");
          return { text: `Replaced in ${path.relative(workspaceDir, target)}`, isError: false };
        }
        default:
          return { text: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return { text: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }
}

export interface DshLLMRunnerFactoryOptions {
  llm: DshLlmLike;
  provider: string;
  model: string;
  logger: Logger;
}

export class DshLLMRunnerFactory implements LLMRunnerFactory {
  private readonly llm: DshLlmLike;
  private readonly provider: string;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(opts: DshLLMRunnerFactoryOptions) {
    this.llm = opts.llm;
    this.provider = opts.provider;
    this.model = opts.model;
    this.logger = opts.logger;
  }

  createRunner(opts?: LLMRunnerCreateOptions): LLMRunner {
    return new DshLLMRunner({
      llm: this.llm,
      provider: this.provider,
      model: this.model,
      logger: this.logger,
      enableTools: opts?.enableTools ?? false,
    });
  }
}
