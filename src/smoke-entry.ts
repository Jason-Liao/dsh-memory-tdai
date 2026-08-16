// Test-only entry: re-exports core pieces for the smoke test.
export { TdaiCore } from "./core/tdai-core.js";
export { parseConfig } from "./config.js";
export { DshHostAdapter, DshLLMRunner, DshLLMRunnerFactory } from "./adapters/dsh/index.js";
