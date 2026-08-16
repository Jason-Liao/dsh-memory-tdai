/**
 * Local BM25 Sparse Vector Encoder.
 *
 * Pure TypeScript replacement for the Python sidecar BM25 client.
 * Uses @tencentdb-agent-memory/tcvdb-text package for tokenization (jieba-wasm) and BM25 encoding.
 *
 * The tcvdb-text package ships a ~286 MB jieba-wasm dictionary, so it is
 * loaded lazily and treated as OPTIONAL: when absent, BM25 sparse encoding
 * degrades gracefully and FTS5 + jieba tokenization still serves retrieval.
 *
 * Two operations (same contract as the old BM25Client):
 * - `encodeTexts(texts)` — encode documents for upsert (TF-based)
 * - `encodeQueries(texts)` — encode queries for search (IDF-based)
 */

import { createRequire } from "node:module";
import type { Logger } from "../types.js";

// ── lazy optional load of @tencentdb-agent-memory/tcvdb-text ───────────────

interface TcvdbTextModule {
  BM25Encoder: {
    default(language: string): {
      encodeTexts(texts: string[]): SparseVector[];
      encodeQueries(texts: string[]): SparseVector[];
    };
  };
}

const nodeRequire = createRequire(import.meta.url);
let cachedTcvdbText: TcvdbTextModule | undefined | null; // undefined = not tried, null = unavailable

function loadTcvdbText(): TcvdbTextModule {
  if (cachedTcvdbText !== undefined) {
    if (cachedTcvdbText === null) throw new Error("tcvdb-text unavailable");
    return cachedTcvdbText;
  }
  try {
    cachedTcvdbText = nodeRequire("@tencentdb-agent-memory/tcvdb-text") as TcvdbTextModule;
    return cachedTcvdbText;
  } catch {
    cachedTcvdbText = null;
    throw new Error("@tencentdb-agent-memory/tcvdb-text is not installed");
  }
}

/** Sparse vector: index/value pairs (same contract as the old BM25Client). */
export type SparseVector = Array<[number, number]>;

export interface BM25LocalConfig {
  /** Whether BM25 sparse encoding is enabled (default: true) */
  enabled: boolean;
  /** Language for BM25 pre-trained params: "zh" or "en" (default: "zh") */
  language?: "zh" | "en";
}

const TAG = "[memory-tdai][bm25-local]";

// ============================
// Implementation
// ============================

export class BM25LocalEncoder {
  private readonly encoder: {
    encodeTexts(texts: string[]): SparseVector[];
    encodeQueries(texts: string[]): SparseVector[];
  };
  private readonly logger?: Logger;

  constructor(language: "zh" | "en" = "zh", logger?: Logger) {
    this.logger = logger;
    this.encoder = loadTcvdbText().BM25Encoder.default(language);
    logger?.debug?.(`${TAG} Initialized BM25 local encoder (language=${language})`);
  }

  /**
   * Encode document texts for upsert (TF-based BM25 scoring).
   * Returns one SparseVector per input text.
   */
  encodeTexts(texts: string[]): SparseVector[] {
    if (texts.length === 0) return [];
    try {
      return this.encoder.encodeTexts(texts);
    } catch (err) {
      this.logger?.warn(
        `${TAG} encodeTexts failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Encode query texts for search (IDF-based BM25 scoring).
   * Returns one SparseVector per input text.
   */
  encodeQueries(texts: string[]): SparseVector[] {
    if (texts.length === 0) return [];
    try {
      return this.encoder.encodeQueries(texts);
    } catch (err) {
      this.logger?.warn(
        `${TAG} encodeQueries failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}

// ============================
// Factory
// ============================

/**
 * Create a BM25LocalEncoder if BM25 is enabled in config and the optional
 * tcvdb-text package is installed.
 * Returns undefined if disabled or unavailable — callers should check before using.
 */
export function createBM25Encoder(
  config: BM25LocalConfig,
  logger?: Logger,
): BM25LocalEncoder | undefined {
  if (!config.enabled) {
    logger?.debug?.(`${TAG} BM25 sparse encoding disabled`);
    return undefined;
  }
  try {
    return new BM25LocalEncoder(config.language ?? "zh", logger);
  } catch (err) {
    logger?.warn?.(
      `${TAG} BM25 sparse encoding unavailable (${err instanceof Error ? err.message : String(err)}) — falling back to FTS5-only retrieval`,
    );
    return undefined;
  }
}
