/**
 * TDAI Adapters for dsh-memory-tdai — only the DeepSeek Harness host.
 */
export { DshHostAdapter, DshLLMRunner, DshLLMRunnerFactory } from "./dsh/index.js";
export type {
  DshHostAdapterOptions,
  DshLLMRunnerOptions,
  DshLLMRunnerFactoryOptions,
  DshLlmLike,
} from "./dsh/index.js";
