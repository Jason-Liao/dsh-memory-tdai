/**
 * DshHostAdapter — HostAdapter for the DeepSeek Harness host.
 *
 * Translates the DSH runtime (Cordis services) into TdaiCore's unified
 * HostAdapter interface. LLM calls ride the DSH `llm` service; the runtime
 * context is keyed per DSH session.
 */

import { DshLLMRunnerFactory } from "./llm-runner.js";
import type { DshLlmLike } from "./llm-runner.js";
import type {
  HostAdapter,
  RuntimeContext,
  Logger,
  LLMRunnerFactory,
} from "../../core/types.js";

export interface DshHostAdapterOptions {
  /** DSH `llm` service instance. */
  llm: DshLlmLike;
  /** Provider route for memory-pipeline LLM calls. */
  provider: string;
  /** Model id for memory-pipeline LLM calls. */
  model: string;
  /** Plugin data directory (L0, records, scene_blocks, vectors.db ...). */
  dataDir: string;
  /** Logger instance. */
  logger: Logger;
  /** Default workspace directory for tool sandboxing. */
  workspaceDir?: string;
}

export class DshHostAdapter implements HostAdapter {
  readonly hostType = "dsh";

  private readonly dataDir: string;
  private readonly logger: Logger;
  private readonly workspaceDir: string;
  private readonly runnerFactory: DshLLMRunnerFactory;

  constructor(opts: DshHostAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.logger = opts.logger;
    this.workspaceDir = opts.workspaceDir ?? process.cwd();
    this.runnerFactory = new DshLLMRunnerFactory({
      llm: opts.llm,
      provider: opts.provider,
      model: opts.model,
      logger: opts.logger,
    });
  }

  getRuntimeContext(): RuntimeContext {
    return {
      userId: "default_user",
      sessionId: "",
      sessionKey: "",
      platform: "dsh",
      workspaceDir: this.workspaceDir,
      dataDir: this.dataDir,
    };
  }

  /**
   * Build a RuntimeContext for one DSH session (used per-hook / per-tool).
   */
  buildRuntimeContextForSession(sessionKey: string, sessionId?: string): RuntimeContext {
    return {
      ...this.getRuntimeContext(),
      sessionKey,
      sessionId: sessionId ?? "",
    };
  }

  getLogger(): Logger {
    return this.logger;
  }

  getLLMRunnerFactory(): LLMRunnerFactory {
    return this.runnerFactory;
  }
}
