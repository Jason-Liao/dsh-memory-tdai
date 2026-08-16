var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/record/l1-reader.ts
var l1_reader_exports = {};
__export(l1_reader_exports, {
  queryMemoryRecords: () => queryMemoryRecords,
  readAllMemoryRecords: () => readAllMemoryRecords,
  readMemoryRecords: () => readMemoryRecords
});
import fs14 from "node:fs/promises";
import path15 from "node:path";
async function queryMemoryRecords(vectorStore, filter, logger) {
  if (!vectorStore) {
    logger?.warn(`${TAG19} queryMemoryRecords: no VectorStore available, returning empty`);
    return [];
  }
  const rows = await vectorStore.queryL1Records(filter);
  return rows.map(rowToMemoryRecord);
}
function rowToMemoryRecord(row) {
  let metadata = {};
  try {
    metadata = JSON.parse(row.metadata_json);
  } catch {
  }
  const timestamps = [];
  if (row.timestamp_str) timestamps.push(row.timestamp_str);
  if (row.timestamp_start && row.timestamp_start !== row.timestamp_str) timestamps.push(row.timestamp_start);
  if (row.timestamp_end && row.timestamp_end !== row.timestamp_str && row.timestamp_end !== row.timestamp_start) {
    timestamps.push(row.timestamp_end);
  }
  return {
    id: row.record_id,
    content: row.content,
    type: row.type,
    priority: row.priority,
    scene_name: row.scene_name,
    source_message_ids: [],
    // not stored in SQLite (vector search doesn't need them)
    metadata,
    timestamps,
    createdAt: row.created_time,
    updatedAt: row.updated_time,
    sessionKey: row.session_key,
    sessionId: row.session_id
  };
}
async function readMemoryRecords(sessionKey, baseDir, logger) {
  const recordsDir = path15.join(baseDir, "records");
  const dateFilePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
  let entries;
  try {
    entries = await fs14.readdir(recordsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const targetFiles = entries.filter((entry) => entry.isFile() && dateFilePattern.test(entry.name)).map((entry) => entry.name).sort();
  if (targetFiles.length === 0) {
    return [];
  }
  const records = [];
  for (const fileName of targetFiles) {
    const filePath = path15.join(recordsDir, fileName);
    let raw;
    try {
      raw = await fs14.readFile(filePath, "utf-8");
    } catch {
      logger?.warn?.(`${TAG19} Failed to read L1 file: ${filePath}`);
      continue;
    }
    const lines = raw.split("\n").filter((line) => line.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        const parsed = JSON.parse(line);
        if (parsed.sessionKey !== sessionKey) {
          continue;
        }
        records.push(parsed);
      } catch {
        logger?.warn?.(`${TAG19} Skipping malformed JSONL line in ${filePath}:${i + 1}`);
      }
    }
  }
  records.sort((a, b) => {
    const ta = a.updatedAt || a.createdAt || "";
    const tb = b.updatedAt || b.createdAt || "";
    return ta.localeCompare(tb);
  });
  return records;
}
async function readAllMemoryRecords(baseDir, logger) {
  const recordsDir = path15.join(baseDir, "records");
  try {
    const files = await fs14.readdir(recordsDir);
    const allRecords = [];
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path15.join(recordsDir, file);
      try {
        const raw = await fs14.readFile(filePath, "utf-8");
        const lines = raw.split("\n").filter((line) => line.trim());
        for (const line of lines) {
          try {
            allRecords.push(JSON.parse(line));
          } catch {
            logger?.warn?.(`${TAG19} Skipping malformed JSONL line in ${file}`);
          }
        }
      } catch {
        logger?.warn?.(`${TAG19} Failed to read ${file}`);
      }
    }
    allRecords.sort((a, b) => {
      const ta = a.updatedAt || a.createdAt || "";
      const tb = b.updatedAt || b.createdAt || "";
      return ta.localeCompare(tb);
    });
    return allRecords;
  } catch {
    return [];
  }
}
var TAG19;
var init_l1_reader = __esm({
  "src/core/record/l1-reader.ts"() {
    "use strict";
    TAG19 = "[memory-tdai] [l1-reader]";
  }
});

// src/core/hooks/auto-recall.ts
import fs2 from "node:fs/promises";
import path3 from "node:path";

// src/utils/time.ts
var _resolvedTz = "UTC";
function formatLocalDate(d = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: _resolvedTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  return `${year}-${month}-${day}`;
}
function formatForLLM(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) {
    return String(input);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: _resolvedTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  const dateTime = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  const offset = getUtcOffset(d);
  return `${dateTime}${offset}`;
}
function describeTimeZoneForPrompt() {
  const offset = getUtcOffset(/* @__PURE__ */ new Date());
  return `All timestamps below are in ${_resolvedTz} (UTC${offset}). When reasoning about "yesterday", "last week", or time differences, use this timezone.`;
}
function getUtcOffset(d) {
  const utcParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: _resolvedTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const toMinutes = (parts) => {
    const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
    const y = get("year"), mo = get("month"), day = get("day");
    const h = get("hour"), mi = get("minute");
    return ((y * 12 + mo) * 31 + day) * 24 * 60 + h * 60 + mi;
  };
  const diffMinutes = toMinutes(localParts) - toMinutes(utcParts);
  const sign = diffMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(diffMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

// src/core/scene/scene-index.ts
import fs from "node:fs/promises";
import path from "node:path";

// src/core/scene/scene-format.ts
var META_START = "-----META-START-----";
var META_END = "-----META-END-----";
function parseSceneBlock(raw, filename) {
  const startIdx = raw.indexOf(META_START);
  const endIdx = raw.indexOf(META_END);
  if (startIdx === -1 || endIdx === -1) {
    return {
      filename,
      meta: { created: "", updated: "", summary: "", heat: 0 },
      content: raw.trim()
    };
  }
  const metaBlock = raw.slice(startIdx + META_START.length, endIdx).trim();
  const content = raw.slice(endIdx + META_END.length).trim();
  const meta = {
    created: extractMetaField(metaBlock, "created"),
    updated: extractMetaField(metaBlock, "updated"),
    summary: extractMetaField(metaBlock, "summary"),
    heat: parseInt(extractMetaField(metaBlock, "heat"), 10) || 0
  };
  return { filename, meta, content };
}
function extractMetaField(metaBlock, field) {
  const re = new RegExp(`^${field}:\\s*(.*)$`, "m");
  const m = metaBlock.match(re);
  return m ? m[1].trim() : "";
}

// src/core/scene/scene-index.ts
async function readSceneIndex(dataDir) {
  const indexPath = path.join(dataDir, ".metadata", "scene_index.json");
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const filename = typeof item.filename === "string" ? item.filename : "";
      if (!filename) continue;
      entries.push({
        filename,
        summary: typeof item.summary === "string" ? item.summary : "",
        heat: typeof item.heat === "number" ? item.heat : 0,
        created: typeof item.created === "string" ? item.created : "",
        updated: typeof item.updated === "string" ? item.updated : ""
      });
    }
    return entries;
  } catch {
    return [];
  }
}
async function writeSceneIndex(dataDir, entries) {
  const indexPath = path.join(dataDir, ".metadata", "scene_index.json");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), "utf-8");
}
async function syncSceneIndex(dataDir) {
  const blocksDir = path.join(dataDir, "scene_blocks");
  let files;
  try {
    files = (await fs.readdir(blocksDir)).filter((f) => f.endsWith(".md"));
  } catch {
    files = [];
  }
  const entries = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(blocksDir, file), "utf-8");
      const block = parseSceneBlock(raw, file);
      entries.push({
        filename: file,
        summary: block.meta.summary,
        heat: block.meta.heat,
        created: block.meta.created,
        updated: block.meta.updated
      });
    } catch {
      continue;
    }
  }
  await writeSceneIndex(dataDir, entries);
  return entries;
}

// src/core/scene/scene-navigation.ts
import path2 from "node:path";
var NAV_HEADER = "---\n## \u{1F5FA}\uFE0F Scene Navigation (Scene Index)";
var NAV_FOOTER = `\u{1F4CC} \u4F7F\u7528\u8BF4\u660E\uFF1A
- Path \u662F scene block \u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u53EF\u76F4\u63A5\u4F7F\u7528 read_file \u8BFB\u53D6\u5B8C\u6574\u5185\u5BB9
- \u70ED\u5EA6\uFF1A\u8BE5\u573A\u666F\u88AB\u8BB0\u5FC6\u547D\u4E2D\u7684\u7D2F\u8BA1\u6B21\u6570\uFF0C\u8D8A\u9AD8\u8D8A\u91CD\u8981
- Summary\uFF1A\u573A\u666F\u7684\u6838\u5FC3\u8981\u70B9\u6458\u8981`;
function heatEmoji(heat) {
  if (heat >= 1e3) return " \u{1F525}\u{1F525}\u{1F525}\u{1F525}\u{1F525}";
  if (heat >= 500) return " \u{1F525}\u{1F525}\u{1F525}\u{1F525}";
  if (heat >= 200) return " \u{1F525}\u{1F525}\u{1F525}";
  if (heat >= 100) return " \u{1F525}\u{1F525}";
  if (heat >= 50) return " \u{1F525}";
  return "";
}
function generateSceneNavigation(entries, dataDir) {
  if (entries.length === 0) return "";
  const sorted = [...entries].sort((a, b) => b.heat - a.heat);
  const blocks = sorted.map((e) => {
    const scenePath = dataDir ? path2.join(dataDir, "scene_blocks", e.filename) : `scene_blocks/${e.filename}`;
    const pathLine = `### Path: ${scenePath}`;
    const heatLine = `**\u70ED\u5EA6**: ${e.heat}${heatEmoji(e.heat)}${e.updated ? ` | **\u66F4\u65B0**: ${e.updated}` : ""}`;
    const summaryLine = `Summary: ${e.summary}`;
    return `${pathLine}
${heatLine}
${summaryLine}`;
  });
  return `${NAV_HEADER}
*\u4EE5\u4E0B\u662F\u5F53\u524D\u573A\u666F\u8BB0\u5FC6\u7684\u7D22\u5F15\uFF0C\u53EF\u6839\u636E\u9700\u8981 read_file \u8BFB\u53D6\u8BE6\u7EC6\u5185\u5BB9\u3002*

${blocks.join("\n\n")}

${NAV_FOOTER}`;
}
function stripSceneNavigation(personaContent) {
  const idx = personaContent.indexOf(NAV_HEADER);
  if (idx === -1) return personaContent;
  return personaContent.slice(0, idx).trimEnd();
}

// src/core/store/sqlite.ts
import { createRequire } from "node:module";
var TAG = "[memory-tdai][sqlite]";
var require2 = createRequire(import.meta.url);
function requireNodeSqlite() {
  return require2("node:sqlite");
}
var _jieba;
function getJieba() {
  if (_jieba !== void 0) return _jieba;
  try {
    const { Jieba } = require2("@node-rs/jieba");
    const { dict } = require2("@node-rs/jieba/dict");
    _jieba = Jieba.withDict(dict);
  } catch {
    _jieba = null;
  }
  return _jieba;
}
var ZH_STOP_WORDS = /* @__PURE__ */ new Set([
  "\u7684",
  "\u4E86",
  "\u5728",
  "\u662F",
  "\u6211",
  "\u6709",
  "\u548C",
  "\u5C31",
  "\u4E0D",
  "\u4EBA",
  "\u90FD",
  "\u4E00",
  "\u4E00\u4E2A",
  "\u4E0A",
  "\u4E5F",
  "\u5F88",
  "\u5230",
  "\u8BF4",
  "\u8981",
  "\u53BB",
  "\u4F60",
  "\u4F1A",
  "\u7740",
  "\u6CA1\u6709",
  "\u770B",
  "\u597D",
  "\u81EA\u5DF1",
  "\u8FD9",
  "\u4ED6",
  "\u5979",
  "\u5B83",
  "\u4EEC",
  "\u90A3",
  "\u5417",
  "\u5427",
  "\u5462",
  "\u554A",
  "\u5440",
  "\u54E6",
  "\u55EF"
]);
function buildFtsQuery(raw) {
  const jieba = getJieba();
  let tokens;
  if (jieba) {
    tokens = jieba.cutForSearch(raw, true).map((t) => t.trim()).filter((t) => {
      if (!t) return false;
      if (!/[\p{L}\p{N}]/u.test(t)) return false;
      if (ZH_STOP_WORDS.has(t)) return false;
      return true;
    });
    tokens = [...new Set(tokens)];
  } else {
    tokens = raw.match(/[\p{L}\p{N}_]+/gu)?.map((t) => t.trim()).filter(Boolean) ?? [];
  }
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" OR ");
}
function tokenizeForFts(raw) {
  const jieba = getJieba();
  if (!jieba) return raw;
  const tokens = jieba.cutForSearch(raw, true);
  return tokens.join(" ");
}
function bm25RankToScore(rank) {
  if (!Number.isFinite(rank)) return 1 / (1 + 999);
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}
var VectorStore = class _VectorStore {
  db;
  dimensions;
  logger;
  /** @see IMemoryStore.supportsDeferredEmbedding */
  supportsDeferredEmbedding = true;
  /**
   * When `true`, the store is in a degraded state (e.g. sqlite-vec failed to
   * load, or init() encountered an unrecoverable error).  All public methods
   * become safe no-ops so the plugin never blocks the main OpenClaw flow.
   */
  degraded = false;
  /** Tracks whether close() has been called to prevent double-close errors. */
  closed = false;
  /**
   * `true` when vec0 virtual tables (l1_vec / l0_vec) have been created and
   * their prepared statements are ready.  When `dimensions === 0` (i.e.
   * provider="none"), vec0 tables are deferred and this stays `false`.
   */
  vecTablesReady = false;
  // Prepared statements — L1 (initialized in init())
  stmtUpsertMeta;
  stmtDeleteVec;
  // optional — only set when vecTablesReady
  stmtInsertVec;
  // optional — only set when vecTablesReady
  stmtDeleteMeta;
  stmtGetMeta;
  stmtSearchVec;
  // optional — only set when vecTablesReady
  stmtQueryBySessionId;
  stmtQueryBySessionIdSince;
  stmtQueryBySessionKey;
  stmtQueryBySessionKeySince;
  stmtQueryAll;
  stmtQueryAllSince;
  // Prepared statements — L0 (initialized in init())
  stmtL0UpsertMeta;
  stmtL0DeleteVec;
  // optional — only set when vecTablesReady
  stmtL0InsertVec;
  // optional — only set when vecTablesReady
  stmtL0DeleteMeta;
  stmtL0GetMeta;
  stmtL0SearchVec;
  // optional — only set when vecTablesReady
  /** L0 query for L1 runner: all messages for a session key */
  stmtL0QueryAll;
  /** L0 query for L1 runner: messages after a timestamp cursor */
  stmtL0QueryAfter;
  /** L1 cursor-based pagination for migration (by PK) */
  stmtL1QueryMigrationCursor;
  /** L0 cursor-based pagination for migration (by PK) */
  stmtL0QueryMigrationCursor;
  // FTS5 tables availability flag (created best-effort — may be false if fts5 is not compiled in)
  ftsAvailable = false;
  // Prepared statements — FTS5 L1 (initialized in init())
  stmtL1FtsInsert;
  stmtL1FtsDelete;
  stmtL1FtsSearch;
  // Prepared statements — FTS5 L0 (initialized in init())
  stmtL0FtsInsert;
  stmtL0FtsDelete;
  stmtL0FtsSearch;
  /**
   * Create a VectorStore instance.
   *
   * Note: After construction, you MUST call `init()` to load the sqlite-vec
   * extension and create the schema.
   */
  constructor(dbPath, dimensions, logger) {
    this.dimensions = dimensions;
    this.logger = logger;
    const { DatabaseSync: DbSync } = requireNodeSqlite();
    this.db = new DbSync(dbPath, { allowExtension: true });
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA cache_size = -65536");
    this.db.exec("PRAGMA mmap_size = 134217728");
    this.db.exec("PRAGMA wal_autocheckpoint = 1000");
  }
  /**
   * Whether the store is in degraded mode (e.g. sqlite-vec failed to load).
   * When degraded, all write/search operations become safe no-ops.
   */
  isDegraded() {
    return this.degraded;
  }
  /**
   * Load sqlite-vec extension and initialize database schema.
   * Must be called once after construction.
   *
   * @param providerInfo  Current embedding provider info. When provided,
   *   the store compares it against the persisted metadata. If the provider,
   *   model, or dimensions changed, the vector tables are dropped and
   *   re-created with the new dimensions, and `needsReindex: true` is returned
   *   so the caller can schedule a full re-embed.
   */
  init(providerInfo) {
    try {
      const sqliteVec = require2("sqlite-vec");
      this.db.enableLoadExtension(true);
      sqliteVec.load(this.db);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(
        `${TAG} Failed to load sqlite-vec extension: ${message}. VectorStore entering degraded mode \u2014 all operations will be no-ops.`
      );
      this.degraded = true;
      return { needsReindex: false, reason: `sqlite-vec load failed: ${message}` };
    }
    try {
      return this.initSchema(providerInfo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error(
        `${TAG} Schema initialization failed: ${message}. VectorStore entering degraded mode.`
      );
      this.degraded = true;
      return { needsReindex: false, reason: `schema init failed: ${message}` };
    }
  }
  /**
   * Internal schema initialization — separated from init() so we can
   * catch errors at the top level and degrade gracefully.
   */
  initSchema(providerInfo) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    let needsReindex = false;
    let reindexReason;
    const savedMeta = this.readEmbeddingMeta();
    if (providerInfo) {
      if (savedMeta) {
        const providerChanged = savedMeta.provider !== providerInfo.provider;
        const modelChanged = savedMeta.model !== providerInfo.model;
        const dimsChanged = savedMeta.dimensions !== this.dimensions;
        if (providerChanged || modelChanged || dimsChanged) {
          const reasons = [];
          if (providerChanged) reasons.push(`provider: ${savedMeta.provider} \u2192 ${providerInfo.provider}`);
          if (modelChanged) reasons.push(`model: ${savedMeta.model} \u2192 ${providerInfo.model}`);
          if (dimsChanged) reasons.push(`dimensions: ${savedMeta.dimensions} \u2192 ${this.dimensions}`);
          reindexReason = reasons.join(", ");
          this.logger?.info(
            `${TAG} Embedding config changed (${reindexReason}). Dropping vector tables for rebuild...`
          );
          this.dropVectorTables();
          needsReindex = true;
        }
      } else {
        const l1Count = this.tableRowCount("l1_records");
        const l0Count = this.tableRowCount("l0_conversations");
        const existingVecDims = this.getVecTableDimensions();
        if (l1Count > 0 || l0Count > 0) {
          this.logger?.info(
            `${TAG} No embedding_meta found but existing data exists (L1=${l1Count}, L0=${l0Count}). Dropping vector tables for safety...`
          );
          this.dropVectorTables();
          needsReindex = true;
          reindexReason = "legacy DB without embedding_meta \u2014 cannot verify vector compatibility";
        } else if (existingVecDims !== null && existingVecDims !== this.dimensions) {
          this.logger?.info(
            `${TAG} vec0 table dimension mismatch (existing=${existingVecDims}, required=${this.dimensions}). Dropping vector tables for rebuild...`
          );
          this.dropVectorTables();
        }
      }
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS l1_records (
        record_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT DEFAULT '',
        priority INTEGER DEFAULT 50,
        scene_name TEXT DEFAULT '',
        session_key TEXT DEFAULT '',
        session_id TEXT DEFAULT '',
        timestamp_str TEXT DEFAULT '',
        timestamp_start TEXT DEFAULT '',
        timestamp_end TEXT DEFAULT '',
        created_time TEXT DEFAULT '',
        updated_time TEXT DEFAULT '',
        metadata_json TEXT DEFAULT '{}'
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_type ON l1_records(type)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_session_key ON l1_records(session_key)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_session_id ON l1_records(session_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_scene ON l1_records(scene_name)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_ts_start ON l1_records(timestamp_start)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_ts_end ON l1_records(timestamp_end)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_session_updated ON l1_records(session_id, updated_time)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l1_sessionkey_updated ON l1_records(session_key, updated_time)");
    if (this.dimensions > 0) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS l1_vec USING vec0(
          record_id TEXT PRIMARY KEY,
          embedding float[${this.dimensions}] distance_metric=cosine,
          updated_time TEXT DEFAULT ''
        )
      `);
    }
    this.stmtUpsertMeta = this.db.prepare(`
      INSERT INTO l1_records (
        record_id, content, type, priority, scene_name, session_key, session_id,
        timestamp_str, timestamp_start, timestamp_end,
        created_time, updated_time, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        content=excluded.content,
        type=excluded.type,
        priority=excluded.priority,
        scene_name=excluded.scene_name,
        timestamp_str=excluded.timestamp_str,
        timestamp_start=excluded.timestamp_start,
        timestamp_end=excluded.timestamp_end,
        updated_time=excluded.updated_time,
        metadata_json=excluded.metadata_json
    `);
    if (this.dimensions > 0) {
      this.stmtDeleteVec = this.db.prepare("DELETE FROM l1_vec WHERE record_id = ?");
      this.stmtInsertVec = this.db.prepare("INSERT INTO l1_vec (record_id, embedding, updated_time) VALUES (?, ?, ?)");
    }
    this.stmtDeleteMeta = this.db.prepare("DELETE FROM l1_records WHERE record_id = ?");
    this.stmtGetMeta = this.db.prepare(`
      SELECT content, type, priority, scene_name, session_key, session_id,
             timestamp_str, timestamp_start, timestamp_end, metadata_json
      FROM l1_records WHERE record_id = ?
    `);
    if (this.dimensions > 0) {
      this.stmtSearchVec = this.db.prepare(`
        SELECT record_id, distance
        FROM l1_vec
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      `);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS l0_conversations (
        record_id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        session_id TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        message_text TEXT NOT NULL,
        recorded_at TEXT DEFAULT '',
        timestamp INTEGER DEFAULT 0
      )
    `);
    try {
      this.db.exec("ALTER TABLE l0_conversations ADD COLUMN timestamp INTEGER DEFAULT 0");
      this.logger?.debug?.(`${TAG} Migrated l0_conversations: added timestamp column`);
    } catch {
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l0_session ON l0_conversations(session_key)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l0_session_id ON l0_conversations(session_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l0_recorded ON l0_conversations(recorded_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_l0_timestamp ON l0_conversations(timestamp)");
    if (this.dimensions > 0) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS l0_vec USING vec0(
          record_id TEXT PRIMARY KEY,
          embedding float[${this.dimensions}] distance_metric=cosine,
          recorded_at TEXT DEFAULT ''
        )
      `);
    }
    this.stmtL0UpsertMeta = this.db.prepare(`
      INSERT INTO l0_conversations (
        record_id, session_key, session_id, role, message_text, recorded_at, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        message_text=excluded.message_text,
        recorded_at=excluded.recorded_at,
        timestamp=excluded.timestamp
    `);
    if (this.dimensions > 0) {
      this.stmtL0DeleteVec = this.db.prepare("DELETE FROM l0_vec WHERE record_id = ?");
      this.stmtL0InsertVec = this.db.prepare("INSERT INTO l0_vec (record_id, embedding, recorded_at) VALUES (?, ?, ?)");
    }
    this.stmtL0DeleteMeta = this.db.prepare("DELETE FROM l0_conversations WHERE record_id = ?");
    this.stmtL0GetMeta = this.db.prepare(`
      SELECT session_key, session_id, role, message_text, recorded_at, timestamp
      FROM l0_conversations WHERE record_id = ?
    `);
    if (this.dimensions > 0) {
      this.stmtL0SearchVec = this.db.prepare(`
        SELECT record_id, distance
        FROM l0_vec
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      `);
    }
    this.stmtL0QueryAll = this.db.prepare(`
      SELECT record_id, session_key, session_id, role, message_text, recorded_at, timestamp
      FROM l0_conversations
      WHERE session_key = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `);
    this.stmtL0QueryAfter = this.db.prepare(`
      SELECT record_id, session_key, session_id, role, message_text, recorded_at, timestamp
      FROM l0_conversations
      WHERE session_key = ? AND recorded_at > ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `);
    this.stmtL0QueryMigrationCursor = this.db.prepare(`
      SELECT record_id, session_key, session_id, role, message_text, recorded_at, timestamp
      FROM l0_conversations
      WHERE record_id > ?
      ORDER BY record_id ASC
      LIMIT ?
    `);
    try {
      const needsFtsRebuild = this.migrateFtsTablesIfNeeded();
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS l1_fts USING fts5(
          content,
          content_original UNINDEXED,
          record_id UNINDEXED,
          type UNINDEXED,
          priority UNINDEXED,
          scene_name UNINDEXED,
          session_key UNINDEXED,
          session_id UNINDEXED,
          timestamp_str UNINDEXED,
          timestamp_start UNINDEXED,
          timestamp_end UNINDEXED,
          metadata_json UNINDEXED
        )
      `);
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS l0_fts USING fts5(
          message_text,
          message_text_original UNINDEXED,
          record_id UNINDEXED,
          session_key UNINDEXED,
          session_id UNINDEXED,
          role UNINDEXED,
          recorded_at UNINDEXED,
          timestamp UNINDEXED
        )
      `);
      this.stmtL1FtsInsert = this.db.prepare(`
        INSERT INTO l1_fts (content, content_original, record_id, type, priority, scene_name,
          session_key, session_id, timestamp_str, timestamp_start, timestamp_end, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.stmtL1FtsDelete = this.db.prepare("DELETE FROM l1_fts WHERE record_id = ?");
      this.stmtL1FtsSearch = this.db.prepare(`
        SELECT record_id, content_original AS content, type, priority, scene_name,
               session_key, session_id, timestamp_str, timestamp_start, timestamp_end,
               metadata_json,
               bm25(l1_fts) AS rank
        FROM l1_fts
        WHERE l1_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ?
      `);
      this.stmtL0FtsInsert = this.db.prepare(`
        INSERT INTO l0_fts (message_text, message_text_original, record_id, session_key, session_id, role, recorded_at, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.stmtL0FtsDelete = this.db.prepare("DELETE FROM l0_fts WHERE record_id = ?");
      this.stmtL0FtsSearch = this.db.prepare(`
        SELECT record_id, message_text_original AS message_text, session_key, session_id, role, recorded_at, timestamp,
               bm25(l0_fts) AS rank
        FROM l0_fts
        WHERE l0_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ?
      `);
      this.ftsAvailable = true;
      this.logger?.debug?.(`${TAG} FTS5 tables initialized (l1_fts, l0_fts) [schema v2 \u2014 jieba segmented]`);
      if (needsFtsRebuild) {
        this.rebuildFtsIndex();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ftsAvailable = false;
      this.logger?.warn(
        `${TAG} FTS5 tables NOT available (fts5 may not be compiled in): ${message}. FTS-based keyword search will be unavailable; recall will use in-memory scoring if needed.`
      );
    }
    if (providerInfo) {
      this.writeEmbeddingMeta({
        provider: providerInfo.provider,
        model: providerInfo.model,
        dimensions: this.dimensions
      });
    }
    this.vecTablesReady = this.dimensions > 0;
    const l1QueryCols = `record_id, content, type, priority, scene_name, session_key, session_id,
      timestamp_str, timestamp_start, timestamp_end,
      created_time, updated_time, metadata_json`;
    this.stmtQueryBySessionId = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      WHERE session_id = ?
      ORDER BY updated_time ASC
    `);
    this.stmtQueryBySessionIdSince = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      WHERE session_id = ? AND updated_time > ?
      ORDER BY updated_time ASC
    `);
    this.stmtQueryBySessionKey = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      WHERE session_key = ?
      ORDER BY updated_time ASC
    `);
    this.stmtQueryBySessionKeySince = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      WHERE session_key = ? AND updated_time > ?
      ORDER BY updated_time ASC
    `);
    this.stmtQueryAll = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      ORDER BY updated_time ASC
    `);
    this.stmtQueryAllSince = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      WHERE updated_time > ?
      ORDER BY updated_time ASC
    `);
    this.stmtL1QueryMigrationCursor = this.db.prepare(`
      SELECT ${l1QueryCols} FROM l1_records
      WHERE record_id > ?
      ORDER BY record_id ASC
      LIMIT ?
    `);
    this.logger?.debug?.(`${TAG} Initialized (dimensions=${this.dimensions})`);
    return { needsReindex, reason: reindexReason };
  }
  // ── Embedding meta helpers ──────────────────────────────
  readEmbeddingMeta() {
    try {
      const row = this.db.prepare("SELECT value FROM embedding_meta WHERE key = ?").get("embedding_provider_info");
      if (!row) return null;
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }
  writeEmbeddingMeta(meta) {
    this.db.prepare(
      "INSERT INTO embedding_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).run("embedding_provider_info", JSON.stringify(meta));
  }
  /** Allowed table names for row counting (whitelist to prevent SQL injection). */
  static COUNTABLE_TABLES = /* @__PURE__ */ new Set(["l1_records", "l0_conversations"]);
  /**
   * Extra rows to retrieve from vec0 KNN search to compensate for legacy
   * zero-vector placeholders that may still linger from older data.
   */
  static ZERO_VEC_BUFFER = 10;
  /** Default result limit for FTS5 keyword searches. */
  static FTS_DEFAULT_LIMIT = 20;
  tableRowCount(table) {
    if (!_VectorStore.COUNTABLE_TABLES.has(table)) {
      this.logger?.warn(`${TAG} tableRowCount: rejected unknown table name "${table}"`);
      return 0;
    }
    try {
      const row = this.db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get();
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }
  /**
   * Detect the embedding dimension of an existing vec0 table by inspecting
   * the DDL stored in sqlite_master.  Returns `null` if the table doesn't
   * exist or the dimension cannot be determined.
   *
   * The vec0 DDL looks like:
   *   CREATE VIRTUAL TABLE l1_vec USING vec0(... embedding float[768] ...)
   * We parse the number inside `float[N]`.
   */
  getVecTableDimensions() {
    try {
      const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get("l1_vec");
      if (!row?.sql) return null;
      const match = row.sql.match(/float\[(\d+)\]/);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }
  /**
   * Drop both L1 and L0 vector virtual tables.
   * Metadata tables (l1_records, l0_conversations) are preserved — only
   * the vec0 tables need to be rebuilt with the new dimensions.
   */
  dropVectorTables() {
    this.db.exec("DROP TABLE IF EXISTS l1_vec");
    this.db.exec("DROP TABLE IF EXISTS l0_vec");
    this.logger?.info(`${TAG} Dropped vector tables (l1_vec, l0_vec)`);
  }
  /**
   * Write or update a memory record (metadata + vector).
   * Uses a manual transaction for atomicity.
   *
   * If `embedding` is `undefined` or a zero vector (all elements are 0), only
   * the metadata row is written — the vec0 table is left untouched.  This
   * allows callers without an EmbeddingService to still persist metadata + FTS
   * without constructing a throwaway zero-vector, and prevents placeholder
   * zero vectors (from embedding-service failures) from polluting KNN search
   * results with null / NaN distances.
   *
   * **Fault-tolerant**: catches all errors internally so that a vector store
   * failure never propagates to the caller / main OpenClaw flow.
   * Returns `true` on success, `false` on failure (logged as warning).
   */
  upsertL1(record, embedding) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [L1-upsert] SKIPPED (degraded mode) id=${record.id}`);
      return false;
    }
    try {
      const { id: recordId, timestamps } = record;
      const tsStr = timestamps[0] ?? "";
      const tsStart = timestamps.length > 0 ? timestamps.reduce((a, b) => a < b ? a : b) : tsStr;
      const tsEnd = timestamps.length > 0 ? timestamps.reduce((a, b) => a > b ? a : b) : tsStr;
      const skipVec = !embedding || embedding.every((v) => v === 0) || !this.vecTablesReady;
      this.logger?.debug?.(
        `${TAG} [L1-upsert] START id=${recordId}, type=${record.type}, content="${record.content.slice(0, 60)}..."` + (embedding ? `, embeddingDims=${embedding.length}, embeddingNorm=${Math.sqrt(Array.from(embedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}${skipVec ? " (ZERO VECTOR or vec tables not ready \u2014 vec write will be skipped)" : ""}` : " (no embedding \u2014 metadata-only write)")
      );
      this.db.exec("BEGIN");
      try {
        this.stmtUpsertMeta.run(
          recordId,
          record.content,
          record.type,
          record.priority,
          record.scene_name,
          record.sessionKey,
          record.sessionId,
          tsStr,
          tsStart,
          tsEnd,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record.metadata)
        );
        if (!skipVec) {
          this.stmtDeleteVec.run(recordId);
          this.stmtInsertVec.run(recordId, Buffer.from(embedding.buffer), record.updatedAt);
        } else {
          this.logger?.debug?.(
            `${TAG} [L1-upsert] Skipping vec write (${embedding ? "zero vector" : "no embedding"}) id=${recordId}`
          );
        }
        if (this.ftsAvailable) {
          try {
            this.stmtL1FtsDelete.run(recordId);
            this.stmtL1FtsInsert.run(
              tokenizeForFts(record.content),
              // content — segmented for indexing
              record.content,
              // content_original — raw for display
              recordId,
              record.type,
              record.priority,
              record.scene_name,
              record.sessionKey,
              record.sessionId,
              tsStr,
              tsStart,
              tsEnd,
              JSON.stringify(record.metadata)
            );
          } catch (ftsErr) {
            this.logger?.warn(
              `${TAG} [L1-upsert] FTS write failed (non-fatal) id=${recordId}: ${ftsErr instanceof Error ? ftsErr.message : String(ftsErr)}`
            );
          }
        }
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
      this.logger?.debug?.(`${TAG} [L1-upsert] OK id=${recordId}${skipVec ? " (meta-only)" : ""}`);
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L1-upsert] FAILED (non-fatal) id=${record.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * Vector similarity search (cosine distance).
   * Returns top-k results sorted by similarity (highest first).
   *
   * **Fault-tolerant**: returns an empty array on any error (e.g. dimension
   * mismatch, corrupted DB) so callers can fall back to keyword search.
   */
  searchL1Vector(queryEmbedding, topK = 5) {
    if (this.degraded || !this.vecTablesReady) {
      if (this.degraded) this.logger?.warn(`${TAG} [L1-search] SKIPPED (degraded mode)`);
      return [];
    }
    try {
      const ZERO_VEC_BUFFER = 10;
      const retrieveCount = topK + ZERO_VEC_BUFFER;
      this.logger?.debug?.(
        `${TAG} [L1-search] START topK=${topK}, retrieveCount=${retrieveCount}, queryEmbeddingDims=${queryEmbedding.length}, queryNorm=${Math.sqrt(Array.from(queryEmbedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}`
      );
      const rows = this.stmtSearchVec.all(
        Buffer.from(queryEmbedding.buffer),
        retrieveCount
      );
      this.logger?.debug?.(`${TAG} [L1-search] vec0 returned ${rows.length} candidate(s)`);
      if (rows.length === 0) return [];
      const results = [];
      for (const { record_id, distance } of rows) {
        if (distance == null || Number.isNaN(distance)) {
          this.logger?.warn(
            `${TAG} [L1-search] record_id=${record_id} has null/NaN distance (likely zero vector) \u2014 skipping`
          );
          continue;
        }
        const meta = this.stmtGetMeta.get(record_id);
        if (!meta) {
          this.logger?.warn(`${TAG} [L1-search] record_id=${record_id} has vector but NO metadata (orphan)`);
          continue;
        }
        const score = 1 - distance;
        this.logger?.debug?.(
          `${TAG} [L1-search] HIT id=${record_id}, distance=${distance.toFixed(4)}, score=${score.toFixed(4)}, type=${meta.type}, content="${meta.content.slice(0, 60)}..."`
        );
        results.push({
          record_id,
          content: meta.content,
          type: meta.type,
          priority: meta.priority,
          scene_name: meta.scene_name,
          score,
          timestamp_str: meta.timestamp_str,
          timestamp_start: meta.timestamp_start,
          timestamp_end: meta.timestamp_end,
          session_key: meta.session_key,
          session_id: meta.session_id,
          metadata_json: meta.metadata_json
        });
      }
      const trimmed = results.slice(0, topK);
      this.logger?.info(
        `${TAG} [L1-search] DONE returning ${trimmed.length} result(s) (from ${results.length} valid, ${rows.length} raw)`
      );
      return trimmed;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L1-search] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Delete a single record (metadata + vector).
   *
   * **Fault-tolerant**: logs a warning on failure, never throws.
   */
  deleteL1(recordId) {
    if (this.degraded) return false;
    try {
      this.db.exec("BEGIN");
      try {
        this.stmtDeleteMeta.run(recordId);
        if (this.vecTablesReady) this.stmtDeleteVec.run(recordId);
        if (this.ftsAvailable) {
          try {
            this.stmtL1FtsDelete.run(recordId);
          } catch {
          }
        }
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} delete failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * Delete multiple records (metadata + vector).
   *
   * **Fault-tolerant**: logs a warning on failure, never throws.
   */
  deleteL1Batch(recordIds) {
    if (this.degraded) return false;
    if (recordIds.length === 0) return true;
    try {
      this.db.exec("BEGIN");
      try {
        for (const id of recordIds) {
          this.stmtDeleteMeta.run(id);
          if (this.vecTablesReady) this.stmtDeleteVec.run(id);
          if (this.ftsAvailable) {
            try {
              this.stmtL1FtsDelete.run(id);
            } catch {
            }
          }
        }
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} deleteBatch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * Get the total number of L1 records in the store.
   *
   * **Fault-tolerant**: returns 0 on failure.
   * TTL cleanup by updated_time.
   *
   * Deletes expired rows from l1_records and matching vectors from l1_vec
   * in a single transaction to guarantee consistency.
   */
  deleteL1Expired(cutoffIso) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [deleteExpired] SKIPPED (degraded mode)`);
      return 0;
    }
    try {
      const row = this.db.prepare(
        "SELECT COUNT(*) AS cnt FROM l1_records WHERE updated_time != '' AND updated_time < ?"
      ).get(cutoffIso);
      const expiredCount = row?.cnt ?? 0;
      if (expiredCount <= 0) return 0;
      const totalRow = this.db.prepare(
        "SELECT COUNT(*) AS cnt FROM l1_records"
      ).get();
      const total = totalRow.cnt;
      const ratio = total > 0 ? expiredCount / total : 0;
      if (ratio > 0.8) {
        this.logger?.warn(
          `${TAG} [L1-deleteExpired] BLOCKED: would delete ${expiredCount}/${total} (${(ratio * 100).toFixed(1)}%) \u2014 exceeds 80% safety threshold, cutoff=${cutoffIso}`
        );
        return 0;
      }
      this.db.exec("BEGIN");
      try {
        if (this.vecTablesReady) {
          this.db.prepare(
            "DELETE FROM l1_vec WHERE updated_time != '' AND updated_time < ?"
          ).run(cutoffIso);
        }
        this.db.prepare(
          "DELETE FROM l1_records WHERE updated_time != '' AND updated_time < ?"
        ).run(cutoffIso);
        this.db.exec("COMMIT");
        this.logger?.info?.(
          `${TAG} [L1-deleteExpired] Deleted ${expiredCount}/${total} records (cutoff=${cutoffIso})`
        );
        return expiredCount;
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
    } catch (err) {
      this.logger?.warn(
        `${TAG} deleteL1ExpiredByUpdatedTime failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }
  /**
   * Get the total number of records in the store.
   */
  countL1() {
    if (this.degraded) return 0;
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM l1_records").get();
      this.logger?.debug?.(`${TAG} [L1-count] total=${row.cnt}`);
      return row.cnt;
    } catch (err) {
      this.logger?.warn(
        `${TAG} count failed (non-fatal, returning 0): ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }
  /**
   * Query L1 records with optional session and time filters.
   *
   * Uses the composite index `idx_l1_session_updated(session_id, updated_time)`
   * for efficient filtering. All timestamps are compared as UTC ISO 8601 strings.
   *
   * **Fault-tolerant**: returns an empty array on any error (degraded mode, DB issues).
   */
  queryL1Records(filter) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [L1-query] SKIPPED (degraded mode)`);
      return [];
    }
    try {
      const { sessionKey, sessionId, updatedAfter } = filter ?? {};
      let raw;
      if (sessionId && updatedAfter) {
        raw = this.stmtQueryBySessionIdSince.all(sessionId, updatedAfter);
      } else if (sessionId) {
        raw = this.stmtQueryBySessionId.all(sessionId);
      } else if (sessionKey && updatedAfter) {
        raw = this.stmtQueryBySessionKeySince.all(sessionKey, updatedAfter);
      } else if (sessionKey) {
        raw = this.stmtQueryBySessionKey.all(sessionKey);
      } else if (updatedAfter) {
        raw = this.stmtQueryAllSince.all(updatedAfter);
      } else {
        raw = this.stmtQueryAll.all();
      }
      if (raw.length > 0 && !("record_id" in raw[0] && "content" in raw[0])) {
        this.logger?.warn(
          `${TAG} [L1-query] Schema mismatch: first row missing expected columns. Got keys: [${Object.keys(raw[0]).join(", ")}]`
        );
        return [];
      }
      const rows = raw;
      this.logger?.info(
        `${TAG} [L1-query] filter={sessionKey=${sessionKey ?? "(all)"}, sessionId=${sessionId ?? "(all)"}, updatedAfter=${updatedAfter ?? "(none)"}}, returned ${rows.length} record(s)`
      );
      return rows;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L1-query] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  // ── L0 operations ──────────────────────────────────
  /**
   * Write or update an L0 single-message record (metadata + vector).
   * Uses a manual transaction for atomicity.
   *
   * If `embedding` is `undefined` or a zero vector (all elements are 0), only
   * the metadata row (`l0_conversations`) is written — the vec0 table
   * (`l0_vec`) is left untouched.  This allows callers without an
   * EmbeddingService to still persist metadata + FTS without constructing a
   * throwaway zero-vector, and prevents placeholder zero vectors (from
   * embedding-service failures) from polluting KNN search results.
   *
   * **Fault-tolerant**: catches all errors internally, never throws.
   * Returns `true` on success, `false` on failure (logged as warning).
   */
  upsertL0(record, embedding) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [L0-upsert] SKIPPED (degraded mode) id=${record.id}`);
      return false;
    }
    try {
      const skipVec = !embedding || embedding.every((v) => v === 0) || !this.vecTablesReady;
      this.logger?.debug?.(
        `${TAG} [L0-upsert] START id=${record.id}, session=${record.sessionKey}, role=${record.role}, text="${record.messageText.slice(0, 60)}..."` + (embedding ? `, embeddingDims=${embedding.length}, embeddingNorm=${Math.sqrt(Array.from(embedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}${skipVec ? " (ZERO VECTOR or vec tables not ready \u2014 vec write will be skipped)" : ""}` : " (no embedding \u2014 metadata-only write)")
      );
      this.db.exec("BEGIN");
      try {
        this.stmtL0UpsertMeta.run(
          record.id,
          record.sessionKey,
          record.sessionId,
          record.role,
          record.messageText,
          record.recordedAt,
          record.timestamp
        );
        if (!skipVec) {
          this.stmtL0DeleteVec.run(record.id);
          this.stmtL0InsertVec.run(record.id, Buffer.from(embedding.buffer), record.recordedAt);
        } else {
          this.logger?.debug?.(
            `${TAG} [L0-upsert] Skipping vec write (${embedding ? "zero vector" : "no embedding"}) id=${record.id}`
          );
        }
        if (this.ftsAvailable) {
          try {
            this.stmtL0FtsDelete.run(record.id);
            this.stmtL0FtsInsert.run(
              tokenizeForFts(record.messageText),
              // message_text — segmented for indexing
              record.messageText,
              // message_text_original — raw for display
              record.id,
              record.sessionKey,
              record.sessionId,
              record.role,
              record.recordedAt,
              record.timestamp
            );
          } catch (ftsErr) {
            this.logger?.warn(
              `${TAG} [L0-upsert] FTS write failed (non-fatal) id=${record.id}: ${ftsErr instanceof Error ? ftsErr.message : String(ftsErr)}`
            );
          }
        }
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
      this.logger?.debug?.(`${TAG} [L0-upsert] OK id=${record.id}${skipVec ? " (meta-only)" : ""}`);
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-upsert] FAILED (non-fatal) id=${record.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * Update ONLY the vector embedding for an existing L0 record.
   * The metadata row must already exist in l0_conversations (written by upsertL0).
   *
   * This is used by the background embedding task in auto-capture:
   *   1. upsertL0() writes metadata + FTS synchronously (no embedding)
   *   2. Background task calls embedBatch() then updateL0Embedding() for each record
   *
   * **Fault-tolerant**: catches all errors internally, never throws.
   * Returns `true` on success, `false` on failure.
   */
  updateL0Embedding(recordId, embedding) {
    if (this.degraded || !this.vecTablesReady) {
      return false;
    }
    if (!embedding || embedding.every((v) => v === 0)) {
      this.logger?.debug?.(`${TAG} [L0-update-embedding] Skipping zero vector for ${recordId}`);
      return false;
    }
    try {
      const meta = this.stmtL0GetMeta.get(recordId);
      if (!meta) {
        this.logger?.warn(`${TAG} [L0-update-embedding] No metadata found for ${recordId}, skipping`);
        return false;
      }
      this.db.exec("BEGIN");
      try {
        this.stmtL0DeleteVec.run(recordId);
        this.stmtL0InsertVec.run(recordId, Buffer.from(embedding.buffer), meta.recorded_at);
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-update-embedding] FAILED (non-fatal) id=${recordId}: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * Vector similarity search on L0 individual messages (cosine distance).
   * Returns top-k results sorted by similarity (highest first).
   *
   * **Fault-tolerant**: returns an empty array on any error.
   */
  searchL0Vector(queryEmbedding, topK = 5) {
    if (this.degraded || !this.vecTablesReady) {
      if (this.degraded) this.logger?.warn(`${TAG} [L0-search] SKIPPED (degraded mode)`);
      return [];
    }
    try {
      const retrieveCount = topK + _VectorStore.ZERO_VEC_BUFFER;
      this.logger?.debug?.(
        `${TAG} [L0-search] START topK=${topK}, retrieveCount=${retrieveCount}, queryEmbeddingDims=${queryEmbedding.length}, queryNorm=${Math.sqrt(Array.from(queryEmbedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}`
      );
      const rows = this.stmtL0SearchVec.all(
        Buffer.from(queryEmbedding.buffer),
        retrieveCount
      );
      this.logger?.debug?.(`${TAG} [L0-search] vec0 returned ${rows.length} candidate(s)`);
      if (rows.length === 0) return [];
      const results = [];
      for (const { record_id, distance } of rows) {
        if (distance == null || Number.isNaN(distance)) {
          this.logger?.warn(
            `${TAG} [L0-search] record_id=${record_id} has null/NaN distance (likely zero vector) \u2014 skipping`
          );
          continue;
        }
        const meta = this.stmtL0GetMeta.get(record_id);
        if (!meta) {
          this.logger?.warn(`${TAG} [L0-search] record_id=${record_id} has vector but NO metadata (orphan)`);
          continue;
        }
        const score = 1 - distance;
        this.logger?.debug?.(
          `${TAG} [L0-search] HIT id=${record_id}, distance=${distance.toFixed(4)}, score=${score.toFixed(4)}, role=${meta.role}, session=${meta.session_key}, text="${meta.message_text.slice(0, 60)}..."`
        );
        results.push({
          record_id,
          session_key: meta.session_key,
          session_id: meta.session_id,
          role: meta.role,
          message_text: meta.message_text,
          score,
          recorded_at: meta.recorded_at,
          timestamp: meta.timestamp ?? 0
        });
      }
      const trimmed = results.slice(0, topK);
      this.logger?.info(
        `${TAG} [L0-search] DONE returning ${trimmed.length} result(s) (from ${results.length} valid, ${rows.length} raw)`
      );
      return trimmed;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-search] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Delete a single L0 record (metadata + vector).
   *
   * **Fault-tolerant**: logs a warning on failure, never throws.
   */
  deleteL0(recordId) {
    if (this.degraded) return false;
    try {
      this.db.exec("BEGIN");
      try {
        this.stmtL0DeleteMeta.run(recordId);
        if (this.vecTablesReady) this.stmtL0DeleteVec.run(recordId);
        if (this.ftsAvailable) {
          try {
            this.stmtL0FtsDelete.run(recordId);
          } catch {
          }
        }
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} deleteL0 failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * TTL cleanup by recorded_at (ISO string) for L0 records.
   *
   * Deletes expired rows from l0_conversations and matching vectors from l0_vec
   * in a single transaction to guarantee consistency.
   */
  deleteL0Expired(cutoffIso) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [deleteExpiredL0] SKIPPED (degraded mode)`);
      return 0;
    }
    try {
      const row = this.db.prepare(
        "SELECT COUNT(*) AS cnt FROM l0_conversations WHERE recorded_at != '' AND recorded_at < ?"
      ).get(cutoffIso);
      const expiredCount = row?.cnt ?? 0;
      if (expiredCount <= 0) return 0;
      const totalRow = this.db.prepare(
        "SELECT COUNT(*) AS cnt FROM l0_conversations"
      ).get();
      const total = totalRow.cnt;
      const ratio = total > 0 ? expiredCount / total : 0;
      if (ratio > 0.8) {
        this.logger?.warn(
          `${TAG} [L0-deleteExpired] BLOCKED: would delete ${expiredCount}/${total} (${(ratio * 100).toFixed(1)}%) \u2014 exceeds 80% safety threshold, cutoff=${cutoffIso}`
        );
        return 0;
      }
      this.db.exec("BEGIN");
      try {
        if (this.vecTablesReady) {
          this.db.prepare(
            "DELETE FROM l0_vec WHERE recorded_at != '' AND recorded_at < ?"
          ).run(cutoffIso);
        }
        this.db.prepare(
          "DELETE FROM l0_conversations WHERE recorded_at != '' AND recorded_at < ?"
        ).run(cutoffIso);
        this.db.exec("COMMIT");
        this.logger?.info?.(
          `${TAG} [L0-deleteExpired] Deleted ${expiredCount}/${total} records (cutoff=${cutoffIso})`
        );
        return expiredCount;
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
        }
        throw err;
      }
    } catch (err) {
      this.logger?.warn(
        `${TAG} deleteL0ExpiredByRecordedAt failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }
  /**
   * Get the total number of L0 message records in the store.
   *
   * **Fault-tolerant**: returns 0 on failure.
   */
  countL0() {
    if (this.degraded) return 0;
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM l0_conversations").get();
      this.logger?.debug?.(`${TAG} [L0-count] total=${row.cnt}`);
      return row.cnt;
    } catch (err) {
      this.logger?.warn(
        `${TAG} countL0 failed (non-fatal, returning 0): ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }
  // ── Re-index operations ──────────────────────────────────
  /**
   * Get all L1 record texts for re-embedding.
   * Returns record_id → content pairs.
   */
  getAllL1Texts() {
    if (this.degraded) return [];
    try {
      return this.db.prepare("SELECT record_id, content, updated_time FROM l1_records").all();
    } catch (err) {
      this.logger?.warn(
        `${TAG} getAllL1Texts failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Get all L0 message texts for re-embedding.
   * Returns record_id → message_text/recorded_at tuples.
   */
  getAllL0Texts() {
    if (this.degraded) return [];
    try {
      return this.db.prepare("SELECT record_id, message_text, recorded_at FROM l0_conversations").all();
    } catch (err) {
      this.logger?.warn(
        `${TAG} getAllL0Texts failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Re-embed all existing L1 and L0 texts with a new embedding function.
   *
   * This is called after `init()` returns `needsReindex: true` — the vector
   * tables have already been dropped and re-created with the correct dimensions.
   * This method reads every text from the metadata tables and writes fresh
   * embeddings into the new vector tables.
   *
   * @param embedFn  A function that converts text → Float32Array embedding.
   * @param onProgress  Optional callback for progress reporting.
   */
  async reindexAll(embedFn, onProgress) {
    if (this.degraded || !this.vecTablesReady) {
      if (this.degraded) this.logger?.warn(`${TAG} reindexAll skipped: VectorStore is in degraded mode`);
      return { l1Count: 0, l0Count: 0 };
    }
    try {
      const l1Rows = this.getAllL1Texts();
      let l1Done = 0;
      for (const { record_id, content, updated_time } of l1Rows) {
        try {
          const embedding = await embedFn(content);
          this.db.exec("BEGIN");
          try {
            this.stmtDeleteVec.run(record_id);
            this.stmtInsertVec.run(record_id, Buffer.from(embedding.buffer), updated_time);
            this.db.exec("COMMIT");
          } catch (txErr) {
            try {
              this.db.exec("ROLLBACK");
            } catch {
            }
            throw txErr;
          }
        } catch (err) {
          this.logger?.warn?.(
            `${TAG} reindex L1 skip ${record_id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        l1Done++;
        onProgress?.(l1Done, l1Rows.length, "L1");
      }
      const l0Rows = this.getAllL0Texts();
      let l0Done = 0;
      for (const { record_id, message_text, recorded_at } of l0Rows) {
        try {
          const embedding = await embedFn(message_text);
          this.db.exec("BEGIN");
          try {
            this.stmtL0DeleteVec.run(record_id);
            this.stmtL0InsertVec.run(record_id, Buffer.from(embedding.buffer), recorded_at);
            this.db.exec("COMMIT");
          } catch (txErr) {
            try {
              this.db.exec("ROLLBACK");
            } catch {
            }
            throw txErr;
          }
        } catch (err) {
          this.logger?.warn?.(
            `${TAG} reindex L0 skip ${record_id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        l0Done++;
        onProgress?.(l0Done, l0Rows.length, "L0");
      }
      this.logger?.info(
        `${TAG} Reindex complete: L1=${l1Done}/${l1Rows.length}, L0=${l0Done}/${l0Rows.length}`
      );
      return { l1Count: l1Done, l0Count: l0Done };
    } catch (err) {
      this.logger?.error(
        `${TAG} reindexAll failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return { l1Count: 0, l0Count: 0 };
    }
  }
  // ── L0 query operations (for L1 runner) ──────────────────────────────────
  /**
   * Query L0 messages for a given session key, optionally filtered by recorded_at cursor.
   * Returns messages ordered by recorded_at ASC (chronological write order).
   *
   * Used by L1 runner to read L0 data from DB instead of JSONL files.
   */
  queryL0ForL1(sessionKey, afterRecordedAtMs, limit = 50) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [L0-query] SKIPPED (degraded mode)`);
      return [];
    }
    try {
      let rows;
      if (afterRecordedAtMs && afterRecordedAtMs > 0) {
        const afterRecordedAtIso = new Date(afterRecordedAtMs).toISOString();
        rows = this.stmtL0QueryAfter.all(sessionKey, afterRecordedAtIso, limit);
      } else {
        rows = this.stmtL0QueryAll.all(sessionKey, limit);
      }
      this.logger?.info(
        `${TAG} [L0-query] session=${sessionKey}, afterRecordedAtMs=${afterRecordedAtMs ?? "(all)"}, limit=${limit}, returned ${rows.length} row(s)`
      );
      return rows.map((r) => ({
        record_id: r.record_id,
        session_key: r.session_key,
        session_id: r.session_id || "",
        role: r.role,
        message_text: r.message_text,
        recorded_at: r.recorded_at || "",
        timestamp: r.timestamp || 0
      })).reverse();
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-query] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Query L0 messages for a given session key, grouped by session_id.
   * Each group's messages are in chronological order (recorded_at ASC).
   * Groups are sorted by earliest message timestamp.
   *
   * Used by L1 runner to replace readConversationMessagesGroupedBySessionId().
   */
  queryL0GroupedBySessionId(sessionKey, afterRecordedAtMs, limit = 50) {
    if (this.degraded) {
      this.logger?.warn(`${TAG} [L0-query-grouped] SKIPPED (degraded mode)`);
      return [];
    }
    try {
      const rows = this.queryL0ForL1(sessionKey, afterRecordedAtMs, limit);
      const groupMap = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const sid = row.session_id || "";
        let group = groupMap.get(sid);
        if (!group) {
          group = [];
          groupMap.set(sid, group);
        }
        group.push({
          id: row.record_id,
          role: row.role,
          content: row.message_text,
          timestamp: row.timestamp,
          recordedAtMs: row.recorded_at ? Date.parse(row.recorded_at) || 0 : 0
        });
      }
      const groups = [];
      for (const [sessionId, messages] of groupMap) {
        if (messages.length > 0) {
          groups.push({ sessionId, messages });
        }
      }
      groups.sort((a, b) => a.messages[0].timestamp - b.messages[0].timestamp);
      this.logger?.info(
        `${TAG} [L0-query-grouped] session=${sessionKey}, afterRecordedAtMs=${afterRecordedAtMs ?? "(all)"}, ${rows.length} messages across ${groups.length} group(s)`
      );
      return groups;
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-query-grouped] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  // ── Cursor-based pagination for migration ──────────────────
  /**
   * Read a page of L1 records using primary key cursor.
   * Returns rows with `record_id > afterId`, ordered by PK, limited to `pageSize`.
   * Pass `""` as `afterId` for the first page.
   */
  queryL1RecordsCursor(afterId, pageSize) {
    if (this.degraded) return [];
    try {
      return this.stmtL1QueryMigrationCursor.all(afterId, pageSize);
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L1-query-cursor] FAILED (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Read a page of L0 records using primary key cursor.
   * Returns rows with `record_id > afterId`, ordered by PK, limited to `pageSize`.
   * Pass `""` as `afterId` for the first page.
   */
  queryL0RecordsCursor(afterId, pageSize) {
    if (this.degraded) return [];
    try {
      return this.stmtL0QueryMigrationCursor.all(afterId, pageSize);
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-query-cursor] FAILED (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  // ── FTS5 search operations ──────────────────────────────────
  /**
   * Whether FTS5 full-text search is available.
   * When `false`, callers should skip keyword-based recall entirely.
   */
  isFtsAvailable() {
    return this.ftsAvailable;
  }
  /**
   * FTS5 keyword search on L1 records.
   * Returns top-`limit` results sorted by BM25 relevance (highest first).
   *
   * @param ftsQuery  A pre-built FTS5 MATCH expression (from `buildFtsQuery()`).
   * @param limit     Maximum number of results to return.
   *
   * **Fault-tolerant**: returns an empty array on any error.
   */
  searchL1Fts(ftsQuery, limit = 20) {
    if (this.degraded || !this.ftsAvailable) return [];
    try {
      const rows = this.stmtL1FtsSearch.all(ftsQuery, limit);
      return rows.map((r) => ({
        record_id: r.record_id,
        content: r.content,
        type: r.type,
        priority: r.priority,
        scene_name: r.scene_name,
        score: bm25RankToScore(r.rank),
        timestamp_str: r.timestamp_str,
        timestamp_start: r.timestamp_start,
        timestamp_end: r.timestamp_end,
        session_key: r.session_key,
        session_id: r.session_id,
        metadata_json: r.metadata_json
      }));
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L1-fts-search] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * FTS5 keyword search on L0 conversation messages.
   * Returns top-`limit` results sorted by BM25 relevance (highest first).
   *
   * @param ftsQuery  A pre-built FTS5 MATCH expression (from `buildFtsQuery()`).
   * @param limit     Maximum number of results to return.
   *
   * **Fault-tolerant**: returns an empty array on any error.
   */
  searchL0Fts(ftsQuery, limit = _VectorStore.FTS_DEFAULT_LIMIT) {
    if (this.degraded || !this.ftsAvailable) return [];
    try {
      const rows = this.stmtL0FtsSearch.all(ftsQuery, limit);
      return rows.map((r) => ({
        record_id: r.record_id,
        session_key: r.session_key,
        session_id: r.session_id,
        role: r.role,
        message_text: r.message_text,
        score: bm25RankToScore(r.rank),
        recorded_at: r.recorded_at,
        timestamp: r.timestamp ?? 0
      }));
    } catch (err) {
      this.logger?.warn(
        `${TAG} [L0-fts-search] FAILED (non-fatal, returning empty): ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  // ── FTS5 migration & rebuild ──────────────────────────────────────────────
  /**
   * Detect old FTS5 v1 schema (no `content_original` column) and drop the
   * tables so they can be recreated with the v2 schema.
   *
   * FTS5 virtual tables do NOT support `ALTER TABLE ADD COLUMN`, so the only
   * migration path is DROP + recreate + repopulate.
   *
   * @returns `true` if migration was performed (= FTS index needs rebuilding).
   * @internal
   */
  migrateFtsTablesIfNeeded() {
    try {
      const l1Exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='l1_fts'").get();
      if (!l1Exists) {
        const hasData = this.db.prepare("SELECT 1 FROM l1_records LIMIT 1").get();
        return !!hasData;
      }
      const cols = this.db.prepare("SELECT name FROM pragma_table_info('l1_fts')").all();
      const hasV2Col = cols.some((c) => c.name === "content_original");
      if (hasV2Col) {
        return false;
      }
      this.logger?.info(`${TAG} Migrating FTS5 tables from v1 to v2 (jieba segmented)`);
      this.db.exec("DROP TABLE IF EXISTS l1_fts");
      this.db.exec("DROP TABLE IF EXISTS l0_fts");
      return true;
    } catch (err) {
      this.logger?.warn(
        `${TAG} FTS migration check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  /**
   * Rebuild the FTS5 index from scratch by reading all records from the
   * metadata tables and re-inserting them with jieba-segmented text.
   *
   * Called automatically after:
   *  - Schema migration from v1 to v2
   *  - Fresh table creation when existing data exists
   *
   * Safe to call multiple times (idempotent — clears FTS tables first).
   */
  rebuildFtsIndex() {
    if (!this.ftsAvailable) return;
    try {
      this.logger?.info(`${TAG} Rebuilding FTS5 index with jieba segmentation\u2026`);
      this.db.exec("DELETE FROM l1_fts");
      const l1Rows = this.db.prepare(`
          SELECT record_id, content, type, priority, scene_name,
                 session_key, session_id, timestamp_str, timestamp_start, timestamp_end, metadata_json
          FROM l1_records
        `).all();
      let l1Count = 0;
      for (const r of l1Rows) {
        try {
          this.stmtL1FtsInsert.run(
            tokenizeForFts(r.content),
            // content — segmented
            r.content,
            // content_original — raw
            r.record_id,
            r.type,
            r.priority,
            r.scene_name,
            r.session_key,
            r.session_id,
            r.timestamp_str,
            r.timestamp_start,
            r.timestamp_end,
            r.metadata_json
          );
          l1Count++;
        } catch (err) {
          this.logger?.warn?.(
            `${TAG} FTS rebuild skip L1 ${r.record_id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      this.db.exec("DELETE FROM l0_fts");
      const l0Rows = this.db.prepare(`
          SELECT record_id, message_text, session_key, session_id, role, recorded_at, timestamp
          FROM l0_conversations
        `).all();
      let l0Count = 0;
      for (const r of l0Rows) {
        try {
          this.stmtL0FtsInsert.run(
            tokenizeForFts(r.message_text),
            // message_text — segmented
            r.message_text,
            // message_text_original — raw
            r.record_id,
            r.session_key,
            r.session_id,
            r.role,
            r.recorded_at,
            r.timestamp
          );
          l0Count++;
        } catch (err) {
          this.logger?.warn?.(
            `${TAG} FTS rebuild skip L0 ${r.record_id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      this.logger?.info(
        `${TAG} FTS5 rebuild complete: L1=${l1Count}/${l1Rows.length}, L0=${l0Count}/${l0Rows.length}`
      );
    } catch (err) {
      this.logger?.warn(
        `${TAG} FTS5 rebuild failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  // ============================
  // IMemoryStore interface implementation
  // ============================
  /** Query the store's search capabilities. */
  getCapabilities() {
    return {
      vectorSearch: this.vecTablesReady,
      ftsSearch: this.ftsAvailable,
      nativeHybridSearch: false,
      sparseVectors: false
    };
  }
  /**
   * Close the database connection.
   * Should be called on shutdown. Idempotent — safe to call multiple times.
   */
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (err) {
      this.logger?.warn?.(
        `${TAG} Error closing database: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
};

// src/utils/sanitize.ts
function sanitizeText(text) {
  let cleaned = text;
  cleaned = cleaned.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>/g, "");
  cleaned = cleaned.replace(/<user-persona>[\s\S]*?<\/user-persona>/g, "");
  cleaned = cleaned.replace(/<relevant-scenes>[\s\S]*?<\/relevant-scenes>/g, "");
  cleaned = cleaned.replace(/<scene-navigation>[\s\S]*?<\/scene-navigation>/g, "");
  cleaned = cleaned.replace(/<current_task_context>[\s\S]*?<\/current_task_context>/g, "");
  cleaned = cleaned.replace(/<history_task_context[\s\S]*?<\/history_task_context>/g, "");
  cleaned = cleaned.replace(
    /(?:Conversation info|Sender|Thread starter|Replied message|Forwarded message context|Chat history since last reply)\s*\(untrusted[\s\S]*?\):\s*```json\s*[\s\S]*?```/g,
    ""
  );
  cleaned = cleaned.replace(/```json\s*\{[\s\S]*?"session[\s\S]*?\}\s*```/g, "");
  cleaned = cleaned.replace(/\[\[reply_to[^\]]*\]\]\s*/g, "");
  cleaned = cleaned.replace(/¥¥\[[\s\S]*?\]¥¥/g, "");
  cleaned = cleaned.replace(/^\[[\w\d\-:+ ]+\]\s*/gm, "");
  cleaned = cleaned.replace(/\[media attached:[^\]]*\]\s*/g, "");
  cleaned = cleaned.replace(
    /To send an image back,[\s\S]*?(?:Keep caption in the text body\.)\s*/g,
    ""
  );
  cleaned = cleaned.replace(/^System:\s*\[[\s\S]*?$/gm, "");
  cleaned = cleaned.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, "");
  cleaned = cleaned.replace(/\0/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}
function stripCodeBlocks(text) {
  return text.replace(/```[^\n]*\n[\s\S]*?```/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function shouldCaptureL0(text) {
  if (!text || !text.trim()) return false;
  if (isFrameworkNoise(text)) return false;
  if (text.startsWith("/")) return false;
  return true;
}
function shouldExtractL1(text) {
  if (!shouldCaptureL0(text)) return false;
  if (/^[^\w\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]{1,5}$/.test(text)) return false;
  if (/^[?？]+$/.test(text)) return false;
  if (looksLikePromptInjection(text)) return false;
  return true;
}
var PROMPT_INJECTION_PATTERNS = [
  // ── Instruction override ──
  /ignore\b.{0,30}\b(instructions|rules|guidelines)/i,
  /disregard\b.{0,30}\b(instructions|rules|guidelines)/i,
  /forget\b.{0,30}\b(instructions|rules|context)/i,
  /override\b.{0,30}\b(instructions|rules|guidelines|safety)/i,
  // ── Role hijack ──
  /you are now (?!going|about|ready)/i,
  // "you are now DAN" but not "you are now going to..."
  /act as (?:if you are |if you were )?(?:a |an )?(?:root|admin|unrestricted|unfiltered|jailbroken)/i,
  /enter (?:DAN|jailbreak|god|sudo|developer|dev|debug|unrestricted|unfiltered) mode/i,
  /switch to (?:DAN|jailbreak|god|sudo|developer|dev|debug|unrestricted|unfiltered) mode/i,
  // ── System boundary probing ──
  /(?:show|reveal|print|output|display|repeat|leak|dump|give)\b.{0,20}\bsystem prompt/i,
  /reveal (?:your |the )?(system|hidden|secret|internal) (?:prompt|instructions|rules)/i,
  /what (?:are|is) your (?:system|hidden|original|initial) (?:prompt|instructions|rules)/i,
  // ── XML/tag injection (our context boundaries) ──
  /<\s*(system|assistant|developer|tool|function|relevant-memories)\b/i,
  // ── Tool/command invocation tricks ──
  /\b(run|execute|call|invoke)\b.{0,40}\b(tool|command|function|shell)\b/i,
  // ── Chinese variants ──
  /忽略(?:所有|之前|以上|先前)?(?:的)?(?:指令|规则|指示|说明)/,
  /无视(?:所有|之前|以上)?(?:的)?(?:指令|规则|限制)/,
  /(?:显示|输出|告诉我|给我看)(?:你的)?(?:系统|初始|隐藏)?(?:提示词|指令|规则|prompt)/,
  /你(?:现在|从现在开始)是/
  // "你现在是 DAN"
];
function looksLikePromptInjection(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
function isFrameworkNoise(text) {
  const t = text.trim();
  if (t === "(session bootstrap)") return true;
  if (t.startsWith("A new session was started via")) return true;
  if (/^✅\s*New session started/.test(t)) return true;
  if (t.startsWith("Pre-compaction memory flush")) return true;
  if (/^NO_REPLY\s*$/.test(t)) return true;
  return false;
}
function escapeXmlTags(text) {
  return text.replace(
    /<\/?(?:user-persona|relevant-memories|scene-navigation|relevant-scenes|memory-tools-guide|system|assistant)>/gi,
    (match) => match.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  );
}
function sanitizeJsonForParse(raw) {
  const escaped = escapeControlCharsInJsonStrings(raw);
  try {
    JSON.parse(escaped);
    return escaped;
  } catch {
  }
  const stripped = escaped.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  return stripped;
}
function escapeControlCharsInJsonStrings(text) {
  const SHORT_ESCAPES = {
    8: "\\b",
    // backspace
    9: "\\t",
    // tab
    10: "\\n",
    // line feed
    12: "\\f",
    // form feed
    13: "\\r"
    // carriage return
  };
  const out = [];
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        out.push(ch, text[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') {
        out.push(ch);
        inString = false;
        i++;
        continue;
      }
      if (code <= 31) {
        const short = SHORT_ESCAPES[code];
        if (short) {
          out.push(short);
        } else {
          out.push("\\u" + code.toString(16).padStart(4, "0"));
        }
        i++;
        continue;
      }
      out.push(ch);
      i++;
    } else {
      if (ch === '"') {
        out.push(ch);
        inString = true;
        i++;
        continue;
      }
      out.push(ch);
      i++;
    }
  }
  return out.join("");
}

// src/core/hooks/auto-recall.ts
var TAG2 = "[memory-tdai] [recall]";
var RECALL_TRUNCATION_SUFFIX = "\u2026\uFF08\u5DF2\u622A\u65AD\uFF1B\u53EF\u7528 tdai_memory_search \u6216 tdai_conversation_search \u67E5\u770B\u8BE6\u60C5\uFF09";
var MIN_TRUNCATED_RECALL_LINE_CHARS = 40;
var RECALL_LINE_SEPARATOR = "\n";
var MEMORY_TOOLS_GUIDE = `<memory-tools-guide>
## \u8BB0\u5FC6\u5DE5\u5177\u8C03\u7528\u6307\u5357

\u5F53\u4E0A\u65B9\u6CE8\u5165\u7684\u8BB0\u5FC6\u7247\u6BB5\u4E0D\u8DB3\u4EE5\u56DE\u7B54\u7528\u6237\u95EE\u9898\u65F6\uFF0C\u53EF\u4E3B\u52A8\u8C03\u7528\u4EE5\u4E0B\u5DE5\u5177\u83B7\u53D6\u66F4\u591A\u4FE1\u606F\uFF1A

- **tdai_memory_search**\uFF1A\u641C\u7D22\u7ED3\u6784\u5316\u8BB0\u5FC6\uFF08L1\uFF09\uFF0C\u9002\u7528\u4E8E\u56DE\u5FC6\u7528\u6237\u504F\u597D\u3001\u5386\u53F2\u4E8B\u4EF6\u8282\u70B9\u3001\u89C4\u5219\u7B49\u5173\u952E\u4FE1\u606F\u3002
- **tdai_conversation_search**\uFF1A\u641C\u7D22\u539F\u59CB\u5BF9\u8BDD\uFF08L0\uFF09\uFF0C\u9002\u7528\u4E8E\u67E5\u627E\u5177\u4F53\u6D88\u606F\u539F\u6587\u3001\u65F6\u95F4\u7EBF\u3001\u4E0A\u4E0B\u6587\u7EC6\u8282\uFF1B\u4E5F\u53EF\u7528\u4E8E\u8865\u5145\u6216\u6821\u9A8C memory_search \u7684\u7ED3\u679C\u3002
- **read_file**\uFF08Scene Navigation \u4E2D\u7684\u8DEF\u5F84\uFF09\uFF1A\u5F53\u5DF2\u5B9A\u4F4D\u5230\u76F8\u5173\u60C5\u5883\uFF0C\u4E14\u9700\u8981\u8BE5\u573A\u666F\u7684\u5B8C\u6574\u753B\u50CF\u3001\u4E8B\u4EF6\u7ECF\u8FC7\u6216\u9636\u6BB5\u7ED3\u8BBA\u65F6\u4F7F\u7528\u3002

### \u26A0\uFE0F \u8C03\u7528\u6B21\u6570\u9650\u5236
\u6BCF\u8F6E\u5BF9\u8BDD\u4E2D\uFF0Ctdai_memory_search \u548C tdai_conversation_search **\u5408\u8BA1\u6700\u591A\u8C03\u7528 3 \u6B21**\u3002
- \u9996\u6B21\u641C\u7D22\u65E0\u7ED3\u679C\u65F6\uFF0C\u53EF\u6362\u5173\u952E\u8BCD\u6216\u6362\u5DE5\u5177\u91CD\u8BD5\uFF0C\u4F46\u603B\u8C03\u7528\u6B21\u6570\u4E0D\u8981\u8D85\u8FC7 3 \u6B21\u3002
- \u82E5 3 \u6B21\u641C\u7D22\u540E\u4ECD\u65E0\u7ED3\u679C\uFF0C\u8BF4\u660E\u8BE5\u4FE1\u606F\u4E0D\u5728\u8BB0\u5FC6\u4E2D\uFF0C\u8BF7\u76F4\u63A5\u6839\u636E\u5DF2\u6709\u4FE1\u606F\u56DE\u590D\u7528\u6237\uFF0C\u4E0D\u8981\u7EE7\u7EED\u641C\u7D22\u3002
</memory-tools-guide>`;
async function performAutoRecall(params) {
  const { cfg, logger } = params;
  const timeoutMs = cfg.recall.timeoutMs ?? 5e3;
  let timer;
  return Promise.race([
    performAutoRecallInner(params).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        logger?.warn?.(
          `${TAG2} \u26A0\uFE0F Recall timed out after ${timeoutMs}ms \u2014 skipping memory injection to avoid blocking the user`
        );
        resolve(void 0);
      }, timeoutMs);
    })
  ]);
}
async function performAutoRecallInner(params) {
  const { userText, cfg, pluginDataDir, logger, vectorStore, embeddingService } = params;
  const tRecallStart = performance.now();
  const tSearchStart = performance.now();
  let memoryLines = [];
  let effectiveStrategy = "skipped";
  let recalledL1Memories = [];
  let searchTiming = { ftsMs: 0, embeddingMs: 0, ftsHits: 0, embeddingHits: 0 };
  if (!userText || userText.length === 0) {
    logger?.debug?.(`${TAG2} User text empty/undefined, skipping memory search (persona/scene still injected)`);
  } else {
    effectiveStrategy = cfg.recall.strategy ?? "hybrid";
    const searchResult = await searchMemories(userText, pluginDataDir, cfg, logger, effectiveStrategy, vectorStore, embeddingService);
    memoryLines = searchResult.lines;
    searchTiming = searchResult.timing;
    memoryLines = applyRecallBudget(memoryLines, cfg.recall, logger);
    recalledL1Memories = memoryLines.map((line) => {
      const match = line.match(/^-\s+\[([^\]]+)\]\s+(.+?)(?:\s*\(活动时间:.*\))?$/);
      if (match) {
        const tag = match[1];
        const content = match[2].trim();
        const typePart = tag.includes("|") ? tag.split("|")[0] : tag;
        return { content, score: 0, type: typePart };
      }
      return { content: line, score: 0, type: "unknown" };
    });
  }
  const tSearchEnd = performance.now();
  const tPersonaStart = performance.now();
  let personaContent;
  try {
    const personaPath = path3.join(pluginDataDir, "persona.md");
    const raw = await fs2.readFile(personaPath, "utf-8");
    personaContent = stripSceneNavigation(raw).trim();
    if (!personaContent) personaContent = void 0;
    logger?.debug?.(`${TAG2} Persona loaded: ${personaContent ? `${personaContent.length} chars` : "empty"}`);
  } catch {
    logger?.debug?.(`${TAG2} No persona file found (expected for new users)`);
  }
  const tPersonaEnd = performance.now();
  const tSceneStart = performance.now();
  let sceneNavigation;
  try {
    const sceneIndex = await readSceneIndex(pluginDataDir);
    if (sceneIndex.length > 0) {
      sceneNavigation = generateSceneNavigation(sceneIndex, pluginDataDir);
      logger?.debug?.(`${TAG2} Scene navigation generated: ${sceneIndex.length} scenes`);
    }
  } catch {
    logger?.debug?.(`${TAG2} No scene index found`);
  }
  const tSceneEnd = performance.now();
  if (memoryLines.length === 0 && !personaContent && !sceneNavigation) {
    const totalMs2 = performance.now() - tRecallStart;
    logger?.info(
      `${TAG2} \u23F1 Recall timing: total=${totalMs2.toFixed(0)}ms, search=${(tSearchEnd - tSearchStart).toFixed(0)}ms(strategy=${effectiveStrategy},hits=${memoryLines.length},fts=${searchTiming.ftsMs.toFixed(0)}ms/${searchTiming.ftsHits}hits,vec=${searchTiming.embeddingMs.toFixed(0)}ms/${searchTiming.embeddingHits}hits), persona=${(tPersonaEnd - tPersonaStart).toFixed(0)}ms, scene=${(tSceneEnd - tSceneStart).toFixed(0)}ms \u2014 no context to inject`
    );
    logger?.debug?.(`${TAG2} No memories/persona/scenes to inject`);
    return void 0;
  }
  const stableParts = [];
  if (personaContent) {
    stableParts.push(`<user-persona>
${personaContent}
</user-persona>`);
  }
  if (sceneNavigation) {
    stableParts.push(`<scene-navigation>
${sceneNavigation}
</scene-navigation>`);
  }
  let prependContext;
  if (memoryLines.length > 0) {
    prependContext = `<relevant-memories>
\u4EE5\u4E0B\u662F\u5F53\u524D\u5BF9\u8BDD\u53EC\u56DE\u7684\u76F8\u5173\u8BB0\u5FC6\uFF0C\u4E0D\u4EE3\u8868\u5F53\u524D\u4EFB\u52A1\u8FDB\u7A0B\uFF0C\u4EC5\u4F5C\u4E3A\u53C2\u8003\uFF1A

${memoryLines.join(RECALL_LINE_SEPARATOR)}
</relevant-memories>`;
  }
  if (stableParts.length > 0 || prependContext) {
    stableParts.push(MEMORY_TOOLS_GUIDE);
  }
  const appendSystemContext = stableParts.length > 0 ? stableParts.join("\n\n") : void 0;
  const totalMs = performance.now() - tRecallStart;
  logger?.info(
    `${TAG2} \u23F1 Recall timing: total=${totalMs.toFixed(0)}ms, search=${(tSearchEnd - tSearchStart).toFixed(0)}ms(strategy=${effectiveStrategy},hits=${memoryLines.length},fts=${searchTiming.ftsMs.toFixed(0)}ms/${searchTiming.ftsHits}hits,vec=${searchTiming.embeddingMs.toFixed(0)}ms/${searchTiming.embeddingHits}hits), persona=${(tPersonaEnd - tPersonaStart).toFixed(0)}ms(${personaContent ? `${personaContent.length}chars` : "none"}), scene=${(tSceneEnd - tSceneStart).toFixed(0)}ms(${sceneNavigation ? "loaded" : "none"})`
  );
  if (!appendSystemContext && !prependContext) {
    return void 0;
  }
  return {
    prependContext,
    appendSystemContext,
    recalledL1Memories,
    recalledL3Persona: personaContent ?? null,
    recallStrategy: effectiveStrategy
  };
}
async function searchMemories(userText, pluginDataDir, cfg, logger, strategy, vectorStore, embeddingService) {
  const emptyResult = { lines: [], timing: { ftsMs: 0, embeddingMs: 0, ftsHits: 0, embeddingHits: 0 } };
  const cleanText = sanitizeText(userText);
  if (cleanText.length < 2) {
    logger?.debug?.(`${TAG2} Query too short for memory search (raw=${userText.length}, clean=${cleanText.length})`);
    return emptyResult;
  }
  if (cleanText.length !== userText.length) {
    logger?.debug?.(
      `${TAG2} userText sanitized: ${userText.length} \u2192 ${cleanText.length} chars`
    );
  }
  const maxResults = cfg.recall.maxResults ?? 5;
  const threshold = cfg.recall.scoreThreshold ?? 0.3;
  const embeddingAvailable = !!vectorStore && !!embeddingService;
  logger?.debug?.(
    `${TAG2} [searchMemories] strategy=${strategy}, embeddingAvailable=${embeddingAvailable}, vectorStore=${vectorStore ? "available" : "UNAVAILABLE"}, embeddingService=${embeddingService ? "available" : "UNAVAILABLE"}, maxResults=${maxResults}, threshold=${threshold}`
  );
  let effectiveStrategy = strategy;
  if ((strategy === "embedding" || strategy === "hybrid") && !embeddingAvailable) {
    logger?.warn?.(
      `${TAG2} Strategy "${strategy}" requested but EmbeddingService not available, falling back to keyword`
    );
    effectiveStrategy = "keyword";
  }
  logger?.debug?.(`${TAG2} Search strategy: ${effectiveStrategy} (configured: ${strategy})`);
  const recallEmbeddingTimeoutMs = cfg.embedding?.recallTimeoutMs ?? cfg.embedding?.timeoutMs;
  const embeddingCallOpts = { timeoutMs: recallEmbeddingTimeoutMs };
  try {
    if (effectiveStrategy === "keyword") {
      const tFts = performance.now();
      const lines = await searchByKeyword(cleanText, pluginDataDir, maxResults, threshold, logger, vectorStore);
      return { lines, timing: { ftsMs: performance.now() - tFts, embeddingMs: 0, ftsHits: lines.length, embeddingHits: 0 } };
    }
    if (effectiveStrategy === "embedding") {
      const tEmb = performance.now();
      const lines = await searchByEmbedding(cleanText, maxResults, threshold, vectorStore, embeddingService, logger, embeddingCallOpts);
      return { lines, timing: { ftsMs: 0, embeddingMs: performance.now() - tEmb, ftsHits: 0, embeddingHits: lines.length } };
    }
    if (vectorStore !== void 0 && vectorStore.getCapabilities().nativeHybridSearch) {
      const tNative = performance.now();
      const results = await vectorStore.searchL1Hybrid({ query: cleanText, topK: maxResults });
      const nativeMs = performance.now() - tNative;
      logger?.debug?.(`${TAG2} [hybrid-native] Single-call hybrid: ${results.length} results in ${nativeMs.toFixed(0)}ms`);
      const lines = results.map((r) => formatMemoryLine(vectorResultToFormatable(r)));
      return { lines, timing: { ftsMs: 0, embeddingMs: nativeMs, ftsHits: 0, embeddingHits: results.length } };
    }
    return await searchHybrid(cleanText, pluginDataDir, maxResults, threshold, vectorStore, embeddingService, logger, embeddingCallOpts);
  } catch (err) {
    logger?.warn?.(`${TAG2} Memory search failed (strategy=${effectiveStrategy}): ${err instanceof Error ? err.message : String(err)}`);
    return emptyResult;
  }
}
async function searchByKeyword(userText, _pluginDataDir, maxResults, threshold, logger, vectorStore) {
  if (vectorStore?.isFtsAvailable()) {
    const ftsQuery = buildFtsQuery(userText);
    if (ftsQuery) {
      logger?.debug?.(`${TAG2} [keyword-fts] Using FTS5 BM25 search: query="${ftsQuery}"`);
      const ftsResults = await vectorStore.searchL1Fts(ftsQuery, maxResults * 2);
      if (ftsResults.length > 0) {
        logger?.debug?.(
          `${TAG2} [keyword-fts] FTS5 raw results (${ftsResults.length}): ` + ftsResults.map((r) => `id=${r.record_id} score=${r.score.toFixed(6)}`).join(", ")
        );
        const filtered = ftsResults.filter((r) => r.score >= threshold).slice(0, maxResults);
        if (filtered.length > 0) {
          logger?.debug?.(`${TAG2} [keyword-fts] FTS5 found ${filtered.length} results (from ${ftsResults.length} raw, threshold=${threshold})`);
          return filtered.map((r) => formatMemoryLine(ftsResultToFormatable(r)));
        }
        if (ftsResults.length <= maxResults) {
          logger?.debug?.(
            `${TAG2} [keyword-fts] All ${ftsResults.length} results below threshold=${threshold} but document set is small \u2014 returning all matched results`
          );
          return ftsResults.slice(0, maxResults).map((r) => formatMemoryLine(ftsResultToFormatable(r)));
        }
        logger?.debug?.(`${TAG2} [keyword-fts] FTS5 returned 0 results above threshold (from ${ftsResults.length} raw)`);
      }
    }
  }
  logger?.debug?.(`${TAG2} [keyword] FTS5 unavailable or no results, skipping keyword search`);
  return [];
}
async function searchByEmbedding(userText, maxResults, threshold, vectorStore, embeddingService, logger, embeddingCallOpts) {
  logger?.debug?.(
    `${TAG2} [embedding-search] START query="${userText.slice(0, 80)}...", maxResults=${maxResults}, threshold=${threshold}`
  );
  const queryEmbedding = await embeddingService.embed(userText, embeddingCallOpts);
  logger?.debug?.(
    `${TAG2} [embedding-search] Query embedding OK: dims=${queryEmbedding.length}, norm=${Math.sqrt(Array.from(queryEmbedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}, searching top-${maxResults * 2}...`
  );
  const vecResults = await vectorStore.searchL1Vector(queryEmbedding, maxResults * 2);
  if (vecResults.length === 0) {
    logger?.debug?.(`${TAG2} [embedding-search] Returned 0 results`);
    return [];
  }
  logger?.debug?.(`${TAG2} [embedding-search] Got ${vecResults.length} candidates, filtering by threshold=${threshold}`);
  for (const r of vecResults) {
    logger?.debug?.(
      `${TAG2} [embedding-search] candidate id=${r.record_id}, score=${r.score.toFixed(4)}, type=${r.type}, content="${r.content.slice(0, 60)}..."`
    );
  }
  const filtered = vecResults.filter((r) => r.score >= threshold).slice(0, maxResults);
  if (filtered.length > 0) {
    logger?.debug?.(`${TAG2} [embedding-search] Found ${filtered.length} relevant memories above threshold (from ${vecResults.length} candidates)`);
    return filtered.map((r) => formatMemoryLine(vectorResultToFormatable(r)));
  }
  logger?.debug?.(`${TAG2} [embedding-search] No results above threshold ${threshold}`);
  return [];
}
async function searchHybrid(userText, _pluginDataDir, maxResults, _threshold, vectorStore, embeddingService, logger, embeddingCallOpts) {
  const candidateK = maxResults * 3;
  const [keywordResult, embeddingResult] = await Promise.all([
    // Keyword search: FTS5 only (no in-memory fallback)
    (async () => {
      const tStart = performance.now();
      try {
        if (vectorStore.isFtsAvailable()) {
          const ftsQuery = buildFtsQuery(userText);
          if (ftsQuery) {
            const ftsResults = await vectorStore.searchL1Fts(ftsQuery, candidateK);
            if (ftsResults.length > 0) {
              logger?.debug?.(`${TAG2} [hybrid-keyword-fts] FTS5 found ${ftsResults.length} candidates`);
              const records = ftsResults.map((r) => ({
                record: {
                  id: r.record_id,
                  content: r.content,
                  type: r.type,
                  priority: r.priority,
                  scene_name: r.scene_name,
                  source_message_ids: [],
                  metadata: r.metadata_json ? (() => {
                    try {
                      return JSON.parse(r.metadata_json);
                    } catch {
                      return {};
                    }
                  })() : {},
                  timestamps: [r.timestamp_str].filter(Boolean),
                  createdAt: "",
                  updatedAt: "",
                  sessionKey: r.session_key,
                  sessionId: r.session_id
                },
                score: r.score
              }));
              return { records, ms: performance.now() - tStart };
            }
          }
        }
        logger?.debug?.(`${TAG2} [hybrid-keyword] FTS5 unavailable or no results, skipping keyword part`);
        return { records: [], ms: performance.now() - tStart };
      } catch (err) {
        logger?.warn?.(`${TAG2} Hybrid: keyword part failed: ${err instanceof Error ? err.message : String(err)}`);
        return { records: [], ms: performance.now() - tStart };
      }
    })(),
    // Embedding search
    (async () => {
      const tStart = performance.now();
      try {
        logger?.debug?.(`${TAG2} [hybrid-embedding] Generating query embedding...`);
        const queryEmbedding = await embeddingService.embed(userText, embeddingCallOpts);
        logger?.debug?.(
          `${TAG2} [hybrid-embedding] Embedding OK, dims=${queryEmbedding.length}, searching top-${candidateK}...`
        );
        const results = await vectorStore.searchL1Vector(queryEmbedding, candidateK, userText);
        logger?.debug?.(`${TAG2} [hybrid-embedding] Got ${results.length} candidates`);
        return { results, ms: performance.now() - tStart };
      } catch (err) {
        logger?.warn?.(`${TAG2} Hybrid: embedding part failed: ${err instanceof Error ? err.message : String(err)}`);
        return { results: [], ms: performance.now() - tStart };
      }
    })()
  ]);
  const keywordResults = keywordResult.records;
  const embeddingResults = embeddingResult.results;
  const timing = {
    ftsMs: keywordResult.ms,
    embeddingMs: embeddingResult.ms,
    ftsHits: keywordResults.length,
    embeddingHits: embeddingResults.length
  };
  if (keywordResults.length === 0 && embeddingResults.length === 0) {
    logger?.debug?.(`${TAG2} Hybrid search: both strategies returned 0 results`);
    return { lines: [], timing };
  }
  const RRF_K3 = 60;
  const mergedMap = /* @__PURE__ */ new Map();
  for (let rank = 0; rank < keywordResults.length; rank++) {
    const r = keywordResults[rank];
    const id = r.record.id;
    const rrfScore = 1 / (RRF_K3 + rank + 1);
    const existing = mergedMap.get(id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      mergedMap.set(id, { rrfScore, formatable: recordToFormatable(r.record) });
    }
  }
  for (let rank = 0; rank < embeddingResults.length; rank++) {
    const r = embeddingResults[rank];
    const id = r.record_id;
    const rrfScore = 1 / (RRF_K3 + rank + 1);
    const existing = mergedMap.get(id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      mergedMap.set(id, { rrfScore, formatable: vectorResultToFormatable(r) });
    }
  }
  const sorted = [...mergedMap.entries()].sort((a, b) => b[1].rrfScore - a[1].rrfScore).slice(0, maxResults);
  if (sorted.length > 0) {
    logger?.debug?.(
      `${TAG2} Hybrid search found ${sorted.length} results (keyword=${keywordResults.length}, embedding=${embeddingResults.length})`
    );
    return { lines: sorted.map(([, { formatable }]) => formatMemoryLine(formatable)), timing };
  }
  logger?.debug?.(`${TAG2} Hybrid search: no results after merge`);
  return { lines: [], timing };
}
function formatMemoryLine(m) {
  const tag = m.scene_name ? `${m.type}|${m.scene_name}` : m.type;
  let line = `- [${tag}] ${m.content}`;
  const start = formatTimestamp(m.activity_start_time);
  const end = formatTimestamp(m.activity_end_time);
  const point = formatTimestamp(m.timestamp);
  if (start && end) {
    line += ` (\u6D3B\u52A8\u65F6\u95F4: ${start} ~ ${end})`;
  } else if (start) {
    line += ` (\u6D3B\u52A8\u65F6\u95F4: ${start}\u8D77)`;
  } else if (end) {
    line += ` (\u6D3B\u52A8\u65F6\u95F4: \u81F3${end})`;
  } else if (point) {
    line += ` (\u6D3B\u52A8\u65F6\u95F4: ${point})`;
  }
  return line;
}
function applyRecallBudget(lines, recall, logger) {
  const maxCharsPerMemory = normalizeBudgetLimit(recall.maxCharsPerMemory);
  const maxTotalRecallChars = normalizeBudgetLimit(recall.maxTotalRecallChars);
  if (!maxCharsPerMemory && !maxTotalRecallChars) {
    return lines;
  }
  const budgeted = [];
  let usedChars = 0;
  let truncatedCount = 0;
  let droppedCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const perMemoryBounded = maxCharsPerMemory ? truncateRecallLine(line, maxCharsPerMemory) : line;
    let wasTruncated = perMemoryBounded !== line;
    if (!maxTotalRecallChars) {
      budgeted.push(perMemoryBounded);
      if (wasTruncated) truncatedCount++;
      continue;
    }
    const separatorChars = budgeted.length > 0 ? RECALL_LINE_SEPARATOR.length : 0;
    const remainingChars = maxTotalRecallChars - usedChars - separatorChars;
    if (remainingChars <= 0) {
      droppedCount += lines.length - i;
      break;
    }
    if (perMemoryBounded.length > remainingChars) {
      const canFit = remainingChars >= MIN_TRUNCATED_RECALL_LINE_CHARS;
      if (canFit) {
        const totalBounded = truncateRecallLine(perMemoryBounded, remainingChars);
        budgeted.push(totalBounded);
        usedChars += separatorChars + totalBounded.length;
        wasTruncated ||= totalBounded !== perMemoryBounded;
        if (wasTruncated) truncatedCount++;
      }
      droppedCount += lines.length - i - (canFit ? 1 : 0);
      break;
    }
    budgeted.push(perMemoryBounded);
    usedChars += separatorChars + perMemoryBounded.length;
    if (wasTruncated) truncatedCount++;
  }
  if (truncatedCount > 0 || droppedCount > 0) {
    logger?.debug?.(
      `${TAG2} Recall budget applied: input=${lines.length}, output=${budgeted.length}, truncated=${truncatedCount}, dropped=${droppedCount}, maxCharsPerMemory=${recall.maxCharsPerMemory}, maxTotalRecallChars=${recall.maxTotalRecallChars}`
    );
  }
  return budgeted;
}
function normalizeBudgetLimit(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) return void 0;
  return Math.floor(value);
}
function truncateRecallLine(line, maxChars) {
  const cps = Array.from(line);
  if (cps.length <= maxChars) return line;
  if (maxChars <= RECALL_TRUNCATION_SUFFIX.length) {
    return cps.slice(0, maxChars).join("");
  }
  return `${cps.slice(0, maxChars - RECALL_TRUNCATION_SUFFIX.length).join("").trimEnd()}${RECALL_TRUNCATION_SUFFIX}`;
}
function formatTimestamp(ts) {
  if (!ts) return void 0;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return void 0;
  const match = ts.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?)?/);
  if (match) {
    const timePart = match[2];
    if (!timePart || timePart === "00:00") {
      return match[1];
    }
  }
  return formatForLLM(ts);
}
function recordToFormatable(record) {
  const meta = record.metadata;
  return {
    type: record.type,
    content: record.content,
    scene_name: record.scene_name || void 0,
    activity_start_time: meta?.activity_start_time || void 0,
    activity_end_time: meta?.activity_end_time || void 0,
    timestamp: record.timestamps && record.timestamps.length > 0 ? record.timestamps[0] : void 0
  };
}
function vectorResultToFormatable(r) {
  let activityStart;
  let activityEnd;
  if (r.metadata_json && r.metadata_json !== "{}") {
    try {
      const meta = typeof r.metadata_json === "string" ? JSON.parse(r.metadata_json) : r.metadata_json;
      activityStart = meta?.activity_start_time || void 0;
      activityEnd = meta?.activity_end_time || void 0;
    } catch {
    }
  }
  return {
    type: r.type,
    content: r.content,
    scene_name: r.scene_name || void 0,
    activity_start_time: activityStart,
    activity_end_time: activityEnd,
    timestamp: r.timestamp_str || void 0
  };
}
function ftsResultToFormatable(r) {
  let activityStart;
  let activityEnd;
  if (r.metadata_json && r.metadata_json !== "{}") {
    try {
      const meta = typeof r.metadata_json === "string" ? JSON.parse(r.metadata_json) : r.metadata_json;
      activityStart = meta?.activity_start_time || void 0;
      activityEnd = meta?.activity_end_time || void 0;
    } catch {
    }
  }
  return {
    type: r.type,
    content: r.content,
    scene_name: r.scene_name || void 0,
    activity_start_time: activityStart,
    activity_end_time: activityEnd,
    timestamp: r.timestamp_str || void 0
  };
}

// src/core/hooks/auto-capture.ts
import crypto2 from "node:crypto";

// src/utils/checkpoint.ts
import fs3 from "node:fs/promises";
import path4 from "node:path";
import { randomBytes } from "node:crypto";
var DEFAULT_RUNNER_STATE = {
  last_captured_timestamp: 0,
  last_l1_cursor: 0,
  last_scene_name: ""
};
var DEFAULT_PIPELINE_STATE = {
  conversation_count: 0,
  last_extraction_time: "",
  last_extraction_updated_time: "",
  last_active_time: 0,
  l2_pending_l1_count: 0,
  warmup_threshold: 0,
  // 0 = graduated (safe default for old sessions missing this field)
  l2_last_extraction_time: ""
};
var DEFAULT_CHECKPOINT = {
  last_captured_timestamp: 0,
  total_processed: 0,
  last_persona_at: 0,
  last_persona_time: "",
  request_persona_update: false,
  persona_update_reason: "",
  memories_since_last_persona: 0,
  scenes_processed: 0,
  runner_states: {},
  pipeline_states: {},
  l0_conversations_count: 0,
  total_memories_extracted: 0
};
var noopLogger = { info() {
} };
var fileLocks = /* @__PURE__ */ new Map();
async function withFileLock(filePath, fn) {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  fileLocks.set(filePath, gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileLocks.get(filePath) === gate) {
      fileLocks.delete(filePath);
    }
  }
}
var CheckpointManager = class {
  filePath;
  logger;
  constructor(dataDir, logger) {
    this.filePath = path4.join(dataDir, ".metadata", "recall_checkpoint.json");
    this.logger = logger ?? noopLogger;
  }
  // ============================
  // Low-level I/O (internal)
  // ============================
  async readRaw() {
    try {
      const raw = await fs3.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const cp = { ...structuredClone(DEFAULT_CHECKPOINT), ...parsed };
      const oldStates = parsed.session_states;
      if (oldStates && !parsed.runner_states && !parsed.pipeline_states) {
        cp.runner_states = {};
        cp.pipeline_states = {};
        for (const [key, state] of Object.entries(oldStates)) {
          cp.runner_states[key] = {
            ...DEFAULT_RUNNER_STATE,
            last_captured_timestamp: state.last_captured_timestamp ?? 0,
            last_l1_cursor: state.last_l1_cursor ?? 0,
            last_scene_name: state.last_scene_name ?? ""
          };
          cp.pipeline_states[key] = {
            ...DEFAULT_PIPELINE_STATE,
            conversation_count: state.conversation_count ?? 0,
            last_extraction_time: state.last_extraction_time ?? "",
            last_extraction_updated_time: state.last_extraction_updated_time ?? "",
            last_active_time: state.last_active_time ?? 0,
            l2_pending_l1_count: state.l2_pending_l1_count ?? 0,
            l2_last_extraction_time: state.l2_last_extraction_time ?? ""
          };
        }
      } else {
        if (cp.runner_states) {
          for (const [key, state] of Object.entries(cp.runner_states)) {
            cp.runner_states[key] = { ...DEFAULT_RUNNER_STATE, ...state };
          }
        }
        if (cp.pipeline_states) {
          for (const [key, state] of Object.entries(cp.pipeline_states)) {
            cp.pipeline_states[key] = { ...DEFAULT_PIPELINE_STATE, ...state };
          }
        }
      }
      return cp;
    } catch {
      return structuredClone(DEFAULT_CHECKPOINT);
    }
  }
  /** Atomic write: write to tmp file, then rename into place. */
  async writeRaw(checkpoint) {
    const dir = path4.dirname(this.filePath);
    await fs3.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp.${randomBytes(4).toString("hex")}`;
    await fs3.writeFile(tmp, JSON.stringify(checkpoint, null, 2), "utf-8");
    await fs3.rename(tmp, this.filePath);
  }
  // ============================
  // Locked read-modify-write helper
  // ============================
  /**
   * Execute a mutating operation under the per-file lock.
   * `fn` receives the current checkpoint and may modify it in place;
   * the updated checkpoint is atomically written back.
   */
  async mutate(fn) {
    return withFileLock(this.filePath, async () => {
      const cp = await this.readRaw();
      await fn(cp);
      await this.writeRaw(cp);
      return cp;
    });
  }
  // ============================
  // Public API — read-only
  // ============================
  /**
   * Read the current checkpoint (unlocked snapshot).
   *
   * NOTE: This does NOT acquire the file lock. The returned snapshot may be
   * stale if a concurrent `mutate()` is in progress. This is acceptable for
   * read-only uses (status display, deciding whether to run a pipeline step).
   *
   * For read-then-write patterns, always use `mutate()` instead — it acquires
   * the lock and re-reads from disk inside the critical section, ensuring the
   * update is based on the latest state.
   */
  async read() {
    return this.readRaw();
  }
  /** Write a full checkpoint (acquires lock + atomic write). */
  async write(checkpoint) {
    return withFileLock(this.filePath, () => this.writeRaw(checkpoint));
  }
  // ============================
  // Public API — mutating (all serialized via file lock)
  // ============================
  // ============================
  // Persona methods (L3)
  // ============================
  async markPersonaGenerated(totalProcessed) {
    await this.mutate((cp) => {
      cp.last_persona_at = totalProcessed;
      cp.last_persona_time = (/* @__PURE__ */ new Date()).toISOString();
      cp.memories_since_last_persona = 0;
      cp.request_persona_update = false;
      cp.persona_update_reason = "";
    });
  }
  async clearPersonaRequest() {
    await this.mutate((cp) => {
      cp.request_persona_update = false;
      cp.persona_update_reason = "";
    });
  }
  async setPersonaUpdateRequest(reason) {
    await this.mutate((cp) => {
      cp.request_persona_update = true;
      cp.persona_update_reason = reason;
    });
  }
  async incrementScenesProcessed() {
    const cp = await this.mutate((cp2) => {
      cp2.scenes_processed += 1;
    });
    this.logger.info(`[checkpoint] incrementScenesProcessed: scenes_processed=${cp.scenes_processed}`);
  }
  // ============================
  // Per-session helpers — runner state (L0/L1 owned)
  // ============================
  /**
   * Get or create runner session state for a session.
   */
  getRunnerState(cp, sessionKey) {
    if (!cp.runner_states) {
      cp.runner_states = {};
    }
    let state = cp.runner_states[sessionKey];
    if (!state) {
      state = { ...DEFAULT_RUNNER_STATE };
      cp.runner_states[sessionKey] = state;
    }
    return state;
  }
  // ============================
  // Per-session helpers — pipeline state (PipelineManager owned)
  // ============================
  /**
   * Get or create pipeline session state for a session.
   */
  getPipelineState(cp, sessionKey) {
    if (!cp.pipeline_states) {
      cp.pipeline_states = {};
    }
    let state = cp.pipeline_states[sessionKey];
    if (!state) {
      state = { ...DEFAULT_PIPELINE_STATE, last_active_time: Date.now() };
      cp.pipeline_states[sessionKey] = state;
    }
    return state;
  }
  /**
   * Get all pipeline states from checkpoint.
   */
  getAllPipelineStates(cp) {
    return cp.pipeline_states ?? {};
  }
  /**
   * Merge pipeline session states into the checkpoint (used by pipeline persister).
   * Acquires the file lock so this is safe against concurrent mutations.
   *
   * This writes ONLY to `pipeline_states`, never touching `runner_states`.
   * This is the core guarantee that eliminates the split-brain overwrite bug.
   */
  async mergePipelineStates(states) {
    await this.mutate((cp) => {
      if (!cp.pipeline_states) cp.pipeline_states = {};
      for (const [key, pState] of Object.entries(states)) {
        cp.pipeline_states[key] = {
          ...cp.pipeline_states[key],
          ...pState
        };
      }
    });
  }
  // ============================
  // L1-specific methods
  // ============================
  /**
   * Mark L1 extraction completed: reset sinceL1 counter, advance L1 cursor,
   * and optionally save the last scene name for cross-batch continuity.
   *
   * @param cursorRecordedAtMs - The max recorded_at epoch ms of processed L0 messages.
   *   This becomes the new `last_l1_cursor` value (recorded_at semantics, not conversation timestamp).
   */
  async markL1ExtractionComplete(sessionKey, memoriesExtracted, cursorRecordedAtMs, lastSceneName) {
    await this.mutate((cp) => {
      const state = this.getRunnerState(cp, sessionKey);
      if (cursorRecordedAtMs) {
        state.last_l1_cursor = cursorRecordedAtMs;
      }
      if (lastSceneName !== void 0) {
        state.last_scene_name = lastSceneName;
      }
      cp.total_memories_extracted += memoriesExtracted;
      cp.memories_since_last_persona += memoriesExtracted;
    });
    this.logger.info(
      `[checkpoint] markL1ExtractionComplete session=${sessionKey}: extracted=${memoriesExtracted}, cursor=${cursorRecordedAtMs ?? "(unchanged)"}, lastScene="${lastSceneName ?? "(unchanged)"}"`
    );
  }
  // ============================
  // Atomic capture (race-condition fix)
  // ============================
  /**
   * Atomically read the per-session cursor, execute the capture callback,
   * and advance the cursor — all within a single file-lock critical section.
   *
   * This eliminates the race window that existed when `read()` (unlocked) and
   * `advanceSessionCapturedTimestamp()` (locked) were separate calls:
   * two concurrent `agent_end` events could both read the same stale cursor
   * and record duplicate messages.
   *
   * The callback receives `afterTimestamp` (the current per-session cursor)
   * and must return either:
   *   - `{ maxTimestamp, messageCount }` to advance the cursor, or
   *   - `null` to leave the cursor unchanged (nothing captured).
   *
   * L0 conversation count is also incremented inside the lock when messages
   * are captured, removing the need for a separate `incrementL0ConversationCount()` call.
   *
   * @param sessionKey   Per-session identifier
   * @param pluginStartTimestamp  Cold-start floor (used when no cursor exists yet)
   * @param fn  Async callback that performs the actual capture (recordConversation, etc.)
   */
  async captureAtomically(sessionKey, pluginStartTimestamp, fn) {
    await this.mutate(async (cp) => {
      const state = this.getRunnerState(cp, sessionKey);
      let afterTimestamp = state.last_captured_timestamp || 0;
      if (afterTimestamp === 0 && pluginStartTimestamp && pluginStartTimestamp > 0) {
        afterTimestamp = pluginStartTimestamp;
      }
      const result = await fn(afterTimestamp);
      if (result) {
        state.last_captured_timestamp = result.maxTimestamp;
        cp.last_captured_timestamp = Math.max(cp.last_captured_timestamp, result.maxTimestamp);
        cp.total_processed += result.messageCount;
        cp.l0_conversations_count += 1;
      }
    });
  }
};

// src/core/conversation/l0-recorder.ts
import fs4 from "node:fs/promises";
import path5 from "node:path";
import crypto from "node:crypto";
function generateMessageId() {
  return `msg_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}
var TAG3 = "[memory-tdai][l0]";
async function recordConversation(params) {
  const { sessionKey, sessionId, rawMessages, baseDir, logger, originalUserText, afterTimestamp, originalUserMessageCount } = params;
  const usePositionSlice = originalUserMessageCount != null && originalUserMessageCount > 0 && originalUserMessageCount <= rawMessages.length;
  const slicedMessages = usePositionSlice ? rawMessages.slice(originalUserMessageCount) : rawMessages;
  const allExtracted = extractUserAssistantMessages(slicedMessages);
  if (usePositionSlice) {
    logger?.debug?.(
      `${TAG3} Position slice: ${rawMessages.length} raw \u2192 ${slicedMessages.length} new (sliceStart=${originalUserMessageCount})`
    );
  }
  if (slicedMessages.length > 0) {
    const firstRaw = slicedMessages[0];
    const rawTs = firstRaw?.timestamp;
    const hasRawTs = typeof rawTs === "number";
    logger?.debug?.(
      `${TAG3} Raw message[0] timestamp probe: ${hasRawTs ? `present (${rawTs})` : `missing (type=${typeof rawTs}, value=${String(rawTs)})`}`
    );
  }
  logger?.debug?.(`${TAG3} Extracted ${allExtracted.length} user/assistant messages from ${slicedMessages.length} total`);
  const cursor = afterTimestamp ?? 0;
  const extracted = cursor !== 0 ? allExtracted.filter((m) => m.timestamp > cursor) : allExtracted;
  if (extracted.length > 0) {
    const first = extracted[0];
    logger?.debug?.(
      `${TAG3} First captured message: role=${first.role}, ts=${first.timestamp}, date=${new Date(first.timestamp).toISOString()}, content=${first.content.slice(0, 80)}${first.content.length > 80 ? "\u2026" : ""}`
    );
  }
  if (cursor > 0) {
    logger?.debug?.(
      `${TAG3} Incremental filter: ${allExtracted.length} total \u2192 ${extracted.length} new (cursor=${cursor})`
    );
    if (!usePositionSlice && extracted.length === allExtracted.length && allExtracted.length > 8) {
      logger?.warn?.(
        `${TAG3} \u26A0 Safety valve: all ${allExtracted.length} messages passed timestamp filter (cursor=${cursor}) \u2014 possible timestamp drift after gateway restart. Position slice was not available (no cached messageCount).`
      );
    }
  }
  if (extracted.length === 0) {
    logger?.debug?.(`${TAG3} No new user/assistant messages to record`);
    return [];
  }
  if (originalUserText) {
    const targetRaw = usePositionSlice ? slicedMessages[0] : originalUserMessageCount != null && originalUserMessageCount >= 0 && originalUserMessageCount < rawMessages.length ? rawMessages[originalUserMessageCount] : void 0;
    const targetTs = targetRaw && typeof targetRaw.timestamp === "number" ? targetRaw.timestamp : void 0;
    if (targetTs != null) {
      let replaced = false;
      for (let i = 0; i < extracted.length; i++) {
        if (extracted[i].role === "user" && extracted[i].timestamp === targetTs) {
          logger?.debug?.(
            `${TAG3} Replacing user message at timestamp=${targetTs} with cached original prompt (${originalUserText.length} chars, was ${extracted[i].content.length} chars) [positionSlice=${usePositionSlice}]`
          );
          extracted[i] = { ...extracted[i], content: originalUserText };
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        logger?.warn?.(
          `${TAG3} Target user message (ts=${targetTs}) not found in extracted batch \u2014 possibly filtered by cursor. Skipping replacement, will rely on sanitizeText().`
        );
      }
    } else if (targetRaw) {
      logger?.warn?.(
        `${TAG3} Target raw message has no valid timestamp \u2014 skipping replacement, will rely on sanitizeText().`
      );
    } else {
      logger?.warn?.(
        `${TAG3} Have originalUserText but cannot locate target raw message \u2014 skipping replacement, will rely on sanitizeText().`
      );
    }
  }
  const filtered = extracted.map((m) => {
    let content = sanitizeText(m.content);
    if (m.role === "assistant") {
      content = stripCodeBlocks(content);
    }
    return { id: m.id, role: m.role, content, timestamp: m.timestamp };
  }).filter((m) => shouldCaptureL0(m.content));
  logger?.debug?.(`${TAG3} After sanitize+filter: ${filtered.length} messages (from ${extracted.length})`);
  if (filtered.length === 0) {
    logger?.debug?.(`${TAG3} All messages filtered out, skipping L0 write`);
    return [];
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const lines = [];
  for (const msg of filtered) {
    const record = {
      sessionKey,
      sessionId: sessionId || "",
      recordedAt: now,
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp
    };
    lines.push(JSON.stringify(record));
  }
  const shardDate = formatLocalDate(/* @__PURE__ */ new Date());
  const outDir = path5.join(baseDir, "conversations");
  const outPath = path5.join(outDir, `${shardDate}.jsonl`);
  try {
    await fs4.mkdir(outDir, { recursive: true });
    await fs4.appendFile(outPath, lines.join("\n") + "\n", "utf-8");
    logger?.debug?.(`${TAG3} Recorded ${filtered.length} messages to ${outPath}`);
  } catch (err) {
    logger?.error(`${TAG3} Failed to write L0 file: ${err instanceof Error ? err.message : String(err)}`);
  }
  return filtered;
}
async function readConversationRecords(sessionKey, baseDir, logger) {
  const conversationsDir = path5.join(baseDir, "conversations");
  const dateFilePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
  let entries;
  try {
    const dirEntries = await fs4.readdir(conversationsDir, { withFileTypes: true });
    entries = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
  const targetFiles = entries.filter((name) => dateFilePattern.test(name)).sort();
  if (targetFiles.length === 0) {
    return [];
  }
  const records = [];
  for (const fileName of targetFiles) {
    const filePath = path5.join(conversationsDir, fileName);
    let raw;
    try {
      raw = await fs4.readFile(filePath, "utf-8");
    } catch {
      logger?.warn?.(`${TAG3} Failed to read L0 file: ${filePath}`);
      continue;
    }
    const lines = raw.split("\n").filter((line) => line.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        const parsed = JSON.parse(line);
        const lineSessionKey = parsed.sessionKey;
        if (lineSessionKey !== sessionKey) continue;
        if (typeof parsed.role === "string" && typeof parsed.content === "string") {
          const msg = {
            id: typeof parsed.id === "string" && parsed.id ? parsed.id : generateMessageId(),
            role: parsed.role,
            content: parsed.content,
            timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now()
          };
          records.push({
            sessionKey: parsed.sessionKey || sessionKey,
            sessionId: parsed.sessionId || "",
            recordedAt: parsed.recordedAt || (/* @__PURE__ */ new Date()).toISOString(),
            messageCount: 1,
            messages: [msg]
          });
        } else {
          logger?.warn?.(`${TAG3} Unrecognized JSONL line format in ${filePath}:${i + 1}`);
        }
      } catch {
        logger?.warn?.(`${TAG3} Skipping malformed JSONL line in ${filePath}:${i + 1}`);
      }
    }
  }
  records.sort((a, b) => {
    const ta = Date.parse(a.recordedAt);
    const tb = Date.parse(b.recordedAt);
    const na = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY;
    const nb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
    return na - nb;
  });
  return records;
}
async function readConversationMessagesGroupedBySessionId(sessionKey, baseDir, afterRecordedAtMs, logger, limit) {
  const records = await readConversationRecords(sessionKey, baseDir, logger);
  const allMessages = [];
  for (const record of records) {
    const sid = record.sessionId || "";
    const recMs = Date.parse(record.recordedAt) || 0;
    if (afterRecordedAtMs && recMs <= afterRecordedAtMs) continue;
    for (const msg of record.messages) {
      allMessages.push({ sessionId: sid, msg: { ...msg, recordedAtMs: recMs } });
    }
  }
  allMessages.sort((a, b) => a.msg.timestamp - b.msg.timestamp);
  let selected = allMessages;
  if (limit != null && limit > 0 && allMessages.length > limit) {
    logger?.debug?.(
      `${TAG3} readConversationMessagesGroupedBySessionId: truncating ${allMessages.length} \u2192 ${limit} (newest)`
    );
    selected = allMessages.slice(-limit);
  }
  const groupMap = /* @__PURE__ */ new Map();
  for (const { sessionId, msg } of selected) {
    let group = groupMap.get(sessionId);
    if (!group) {
      group = [];
      groupMap.set(sessionId, group);
    }
    group.push(msg);
  }
  const groups = [];
  for (const [sessionId, messages] of groupMap) {
    if (messages.length > 0) {
      groups.push({ sessionId, messages });
    }
  }
  groups.sort((a, b) => a.messages[0].timestamp - b.messages[0].timestamp);
  return groups;
}
function extractUserAssistantMessages(messages) {
  const result = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg;
    const role = m.role;
    if (role !== "user" && role !== "assistant") continue;
    let content;
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      const textParts = [];
      for (const part of m.content) {
        if (part && typeof part === "object" && part.type === "text") {
          const text = part.text;
          if (typeof text === "string") textParts.push(text);
        }
      }
      content = textParts.join("\n");
    }
    if (content && /data:image\/[a-z+]+;base64,/i.test(content)) {
      content = content.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, "[image]");
    }
    if (content && content.trim()) {
      const ts = typeof m.timestamp === "number" ? m.timestamp : Date.now();
      result.push({
        id: typeof m.id === "string" && m.id ? m.id : generateMessageId(),
        role,
        content: content.trim(),
        timestamp: ts
      });
    }
  }
  return result;
}

// src/core/hooks/auto-capture.ts
var TAG4 = "[memory-tdai] [capture]";
function generateL0RecordId(sessionKey, index) {
  return `l0_${sessionKey}_${Date.now()}_${index}_${crypto2.randomBytes(3).toString("hex")}`;
}
async function performAutoCapture(params) {
  const {
    messages,
    sessionKey,
    sessionId,
    cfg,
    pluginDataDir,
    logger,
    scheduler,
    originalUserText,
    originalUserMessageCount,
    pluginStartTimestamp,
    vectorStore,
    embeddingService,
    bgTaskRegistry
  } = params;
  const tCaptureStart = performance.now();
  const checkpoint = new CheckpointManager(pluginDataDir, logger);
  const tL0RecordStart = performance.now();
  let filteredMessages = [];
  try {
    await checkpoint.captureAtomically(
      sessionKey,
      pluginStartTimestamp,
      async (afterTimestamp) => {
        logger?.debug?.(`${TAG4} L0 capture cursor (per-session, atomic): afterTimestamp=${afterTimestamp} session=${sessionKey}`);
        if (afterTimestamp === pluginStartTimestamp && pluginStartTimestamp && pluginStartTimestamp > 0) {
          logger?.debug?.(
            `${TAG4} No per-session checkpoint cursor found for session=${sessionKey} \u2014 using pluginStartTimestamp as floor: ${afterTimestamp} (${new Date(afterTimestamp).toISOString()})`
          );
        }
        filteredMessages = await recordConversation({
          sessionKey,
          sessionId,
          rawMessages: messages,
          baseDir: pluginDataDir,
          logger,
          originalUserText,
          afterTimestamp,
          originalUserMessageCount
        });
        if (filteredMessages.length === 0) {
          return null;
        }
        logger?.debug?.(`${TAG4} L0 recorded: ${filteredMessages.length} messages for session ${sessionKey}`);
        const maxTs = Math.max(...filteredMessages.map((m) => m.timestamp));
        return { maxTimestamp: maxTs, messageCount: filteredMessages.length };
      }
    );
  } catch (err) {
    logger?.error(`${TAG4} L0 recording failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const tL0RecordEnd = performance.now();
  const tL0VecStart = performance.now();
  let l0VectorsWritten = 0;
  let l0EmbedTotalMs = 0;
  let l0UpsertTotalMs = 0;
  logger?.debug?.(
    `${TAG4} [L0-vec-index] Check: filteredMessages=${filteredMessages.length}, vectorStore=${vectorStore ? "available" : "UNAVAILABLE"}, embeddingService=${embeddingService ? "available" : "UNAVAILABLE"}`
  );
  const supportsBgEmbed = vectorStore?.supportsDeferredEmbedding === true;
  if (filteredMessages.length > 0 && vectorStore) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const bgRecords = [];
    logger?.debug?.(
      `${TAG4} [L0-vec-index] START indexing ${filteredMessages.length} message(s) for session ${sessionKey} (mode=${supportsBgEmbed ? "async-bg" : "sync"})`
    );
    for (let i = 0; i < filteredMessages.length; i++) {
      const msg = filteredMessages[i];
      try {
        const l0Record = {
          id: generateL0RecordId(sessionKey, i),
          sessionKey,
          sessionId: sessionId || "",
          role: msg.role,
          messageText: msg.content,
          recordedAt: now,
          timestamp: msg.timestamp
        };
        let embedding;
        if (!supportsBgEmbed && embeddingService) {
          if (embeddingService.getDimensions() === 0) {
            logger?.debug?.(
              `${TAG4} [L0-vec-index] Server-side embedding (dims=0), skipping local embed for message ${i}`
            );
          } else {
            const tEmbedStart = performance.now();
            try {
              embedding = await embeddingService.embed(msg.content);
              l0EmbedTotalMs += performance.now() - tEmbedStart;
              logger?.debug?.(
                `${TAG4} [L0-vec-index] Embedding OK: dims=${embedding.length}, norm=${Math.sqrt(Array.from(embedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}`
              );
            } catch (embedErr) {
              l0EmbedTotalMs += performance.now() - tEmbedStart;
              logger?.warn(
                `${TAG4} [L0-vec-index] Embedding FAILED for message ${i}, will write metadata only: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`
              );
            }
          }
        }
        const tUpsertStart = performance.now();
        const upsertOk = await vectorStore.upsertL0(l0Record, supportsBgEmbed ? void 0 : embedding);
        l0UpsertTotalMs += performance.now() - tUpsertStart;
        if (upsertOk) {
          l0VectorsWritten++;
          if (supportsBgEmbed) {
            bgRecords.push({ recordId: l0Record.id, content: msg.content });
          }
        } else {
          logger?.warn(`${TAG4} [L0-vec-index] upsertL0 returned false for message ${i}`);
        }
      } catch (err) {
        logger?.warn?.(`${TAG4} [L0-vec-index] FAILED for message ${i} (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const modeLabel = supportsBgEmbed ? "metadata-only, embed=background" : `embed=${l0EmbedTotalMs.toFixed(0)}ms, upsert=${l0UpsertTotalMs.toFixed(0)}ms`;
    logger?.debug?.(`${TAG4} [L0-vec-index] DONE: ${l0VectorsWritten}/${filteredMessages.length} records written (${modeLabel})`);
    if (supportsBgEmbed && bgRecords.length > 0 && embeddingService) {
      const bgVectorStore = vectorStore;
      const bgEmbeddingService = embeddingService;
      const bgSnapshot = [...bgRecords];
      const bgLogger = logger;
      const bgPromise = (async () => {
        const tBgStart = performance.now();
        try {
          const texts = bgSnapshot.map((r) => r.content);
          const embeddings = await bgEmbeddingService.embedBatch(texts);
          let bgUpdated = 0;
          for (let i = 0; i < bgSnapshot.length; i++) {
            try {
              const ok = await bgVectorStore.updateL0Embedding(bgSnapshot[i].recordId, embeddings[i]);
              if (ok) bgUpdated++;
            } catch (err) {
              bgLogger?.warn?.(
                `${TAG4} [L0-vec-index-bg] Failed to update embedding for ${bgSnapshot[i].recordId}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
          const bgMs = performance.now() - tBgStart;
          bgLogger?.debug?.(
            `${TAG4} [L0-vec-index-bg] Background embedding complete: ${bgUpdated}/${bgSnapshot.length} vectors updated (${bgMs.toFixed(0)}ms)`
          );
        } catch (err) {
          const bgMs = performance.now() - tBgStart;
          bgLogger?.warn?.(
            `${TAG4} [L0-vec-index-bg] Background embedding failed (${bgMs.toFixed(0)}ms, non-fatal): ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();
      if (bgTaskRegistry) {
        bgTaskRegistry.add(bgPromise);
        void bgPromise.finally(() => {
          bgTaskRegistry.delete(bgPromise);
        });
      }
    }
  } else if (filteredMessages.length > 0) {
    logger?.warn(`${TAG4} [L0-vec-index] SKIPPED: vectorStore not available`);
  }
  const tL0VecEnd = performance.now();
  const tNotifyStart = performance.now();
  if (scheduler) {
    await scheduler.notifyConversation(sessionKey, []);
    logger?.debug?.(`${TAG4} Scheduler notified of conversation round (sessionKey=${sessionKey})`);
    const totalMs2 = performance.now() - tCaptureStart;
    const vecDetail2 = supportsBgEmbed ? `metadata-only, embed=background, msgs=${filteredMessages.length}` : `embed=${l0EmbedTotalMs.toFixed(0)}ms, upsert=${l0UpsertTotalMs.toFixed(0)}ms, msgs=${filteredMessages.length}`;
    logger?.info(
      `${TAG4} \u23F1 Capture timing: total=${totalMs2.toFixed(0)}ms, l0Record+checkpoint=${(tL0RecordEnd - tL0RecordStart).toFixed(0)}ms, l0VecIndex=${(tL0VecEnd - tL0VecStart).toFixed(0)}ms (${vecDetail2}), notify=${(performance.now() - tNotifyStart).toFixed(0)}ms`
    );
    return {
      schedulerNotified: true,
      l0RecordedCount: filteredMessages.length,
      l0VectorsWritten,
      filteredMessages
    };
  }
  const totalMs = performance.now() - tCaptureStart;
  const vecDetail = supportsBgEmbed ? `metadata-only, embed=background, msgs=${filteredMessages.length}` : `embed=${l0EmbedTotalMs.toFixed(0)}ms, upsert=${l0UpsertTotalMs.toFixed(0)}ms, msgs=${filteredMessages.length}`;
  logger?.info(
    `${TAG4} \u23F1 Capture timing: total=${totalMs.toFixed(0)}ms, l0Record+checkpoint=${(tL0RecordEnd - tL0RecordStart).toFixed(0)}ms, l0VecIndex=${(tL0VecEnd - tL0VecStart).toFixed(0)}ms (${vecDetail}), notify=${(performance.now() - tNotifyStart).toFixed(0)}ms`
  );
  logger?.debug?.(`${TAG4} No scheduler provided, skipping notification`);
  return {
    schedulerNotified: false,
    l0RecordedCount: filteredMessages.length,
    l0VectorsWritten,
    filteredMessages
  };
}

// src/core/tools/memory-search.ts
var TAG5 = "[memory-tdai][tdai_memory_search]";
var RRF_K = 60;
function rrfMergeL1(...lists) {
  const map = /* @__PURE__ */ new Map();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const score = 1 / (RRF_K + rank + 1);
      const existing = map.get(item.id);
      if (existing) {
        existing.rrfScore += score;
      } else {
        map.set(item.id, { item, rrfScore: score });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.rrfScore - a.rrfScore).map(({ item, rrfScore }) => ({ ...item, score: rrfScore }));
}
async function executeMemorySearch(params) {
  const {
    query,
    limit,
    type: typeFilter,
    scene: sceneFilter,
    vectorStore,
    embeddingService,
    logger
  } = params;
  logger?.debug?.(
    `${TAG5} CALLED: query="${query.slice(0, 100)}", limit=${limit}, typeFilter=${typeFilter ?? "(none)"}, sceneFilter=${sceneFilter ?? "(none)"}, vectorStore=${vectorStore ? "available" : "UNAVAILABLE"}, embeddingService=${embeddingService ? "available" : "UNAVAILABLE"}`
  );
  if (!query || query.trim().length === 0) {
    logger?.debug?.(`${TAG5} Empty query, returning empty`);
    return { results: [], total: 0, strategy: "none" };
  }
  if (!vectorStore) {
    logger?.warn?.(`${TAG5} VectorStore not available`);
    return { results: [], total: 0, strategy: "none" };
  }
  const hasEmbedding = !!embeddingService;
  const hasFts = vectorStore.isFtsAvailable();
  if (!hasEmbedding && !hasFts) {
    logger?.warn?.(`${TAG5} Neither EmbeddingService nor FTS5 available \u2014 cannot search`);
    return {
      results: [],
      total: 0,
      strategy: "none",
      message: "Embedding service is not configured and FTS is not available. Memory search requires an embedding provider or FTS5 support. Please configure an embedding provider in the embedding.provider setting (e.g. openai_compatible)."
    };
  }
  const candidateK = limit * 3;
  const [ftsItems, vecItems] = await Promise.all([
    // FTS5 keyword search
    (async () => {
      if (!hasFts) return [];
      try {
        const ftsQuery = buildFtsQuery(query);
        if (!ftsQuery) {
          logger?.debug?.(`${TAG5} [hybrid-fts] No usable FTS tokens from query`);
          return [];
        }
        logger?.debug?.(`${TAG5} [hybrid-fts] FTS5 query: "${ftsQuery}"`);
        const ftsResults = await vectorStore.searchL1Fts(ftsQuery, candidateK);
        logger?.debug?.(`${TAG5} [hybrid-fts] FTS5 returned ${ftsResults.length} candidates`);
        return ftsResults.map((r) => ({
          id: r.record_id,
          content: r.content,
          type: r.type,
          priority: r.priority,
          scene_name: r.scene_name,
          score: r.score,
          created_at: r.timestamp_start,
          updated_at: r.timestamp_end
        }));
      } catch (err) {
        logger?.warn?.(
          `${TAG5} [hybrid-fts] FTS5 search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
    })(),
    // Vector embedding search
    (async () => {
      if (!hasEmbedding) return [];
      try {
        logger?.debug?.(`${TAG5} [hybrid-vec] Generating query embedding...`);
        const queryEmbedding = await embeddingService.embed(query);
        logger?.debug?.(
          `${TAG5} [hybrid-vec] Embedding OK, dims=${queryEmbedding.length}, searching top-${candidateK}...`
        );
        const vecResults = await vectorStore.searchL1Vector(queryEmbedding, candidateK, query);
        logger?.debug?.(`${TAG5} [hybrid-vec] Vector search returned ${vecResults.length} candidates`);
        return vecResults.map((r) => ({
          id: r.record_id,
          content: r.content,
          type: r.type,
          priority: r.priority,
          scene_name: r.scene_name,
          score: r.score,
          created_at: r.timestamp_start,
          updated_at: r.timestamp_end
        }));
      } catch (err) {
        logger?.warn?.(
          `${TAG5} [hybrid-vec] Embedding search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
    })()
  ]);
  const ftsOk = ftsItems.length > 0;
  const vecOk = vecItems.length > 0;
  let strategy;
  if (ftsOk && vecOk) {
    strategy = "hybrid";
  } else if (vecOk) {
    strategy = "embedding";
  } else if (ftsOk) {
    strategy = "fts";
  } else {
    logger?.debug?.(`${TAG5} Both search paths returned 0 results`);
    return { results: [], total: 0, strategy: hasEmbedding ? "embedding" : "fts" };
  }
  let results;
  if (strategy === "hybrid") {
    results = rrfMergeL1(ftsItems, vecItems);
    logger?.debug?.(
      `${TAG5} [hybrid] RRF merged: fts=${ftsItems.length}, vec=${vecItems.length} \u2192 ${results.length} unique`
    );
  } else {
    results = ftsOk ? ftsItems : vecItems;
  }
  const preFilterCount = results.length;
  if (typeFilter) {
    results = results.filter((r) => r.type === typeFilter);
    logger?.debug?.(`${TAG5} After type filter "${typeFilter}": ${results.length}/${preFilterCount}`);
  }
  if (sceneFilter) {
    const normalizedScene = sceneFilter.toLowerCase();
    results = results.filter(
      (r) => r.scene_name.toLowerCase().includes(normalizedScene)
    );
    logger?.debug?.(`${TAG5} After scene filter "${sceneFilter}": ${results.length}/${preFilterCount}`);
  }
  const trimmed = results.slice(0, limit);
  logger?.debug?.(
    `${TAG5} RESULT (strategy=${strategy}): returning ${trimmed.length} memories (scores: [${trimmed.map((r) => r.score.toFixed(3)).join(", ")}])`
  );
  return {
    results: trimmed,
    total: trimmed.length,
    strategy
  };
}
function formatSearchResponse(result) {
  if (result.message) {
    return result.message;
  }
  if (result.results.length === 0) {
    return "No matching memories found.";
  }
  const lines = [
    `Found ${result.total} matching memories:`,
    ""
  ];
  for (const item of result.results) {
    const scoreStr = typeof item.score === "number" ? ` (score: ${item.score.toFixed(3)})` : "";
    const sceneStr = item.scene_name ? ` [scene: ${item.scene_name}]` : "";
    const priorityStr = item.priority >= 0 ? ` (priority: ${item.priority})` : " (global instruction)";
    lines.push(`- **[${item.type}]**${priorityStr}${sceneStr}${scoreStr}`);
    lines.push(`  ${item.content}`);
    lines.push("");
  }
  return lines.join("\n");
}

// src/core/tools/conversation-search.ts
var TAG6 = "[memory-tdai][tdai_conversation_search]";
var RRF_K2 = 60;
function rrfMergeL0(...lists) {
  const map = /* @__PURE__ */ new Map();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const score = 1 / (RRF_K2 + rank + 1);
      const existing = map.get(item.id);
      if (existing) {
        existing.rrfScore += score;
      } else {
        map.set(item.id, { item, rrfScore: score });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.rrfScore - a.rrfScore).map(({ item, rrfScore }) => ({ ...item, score: rrfScore }));
}
async function executeConversationSearch(params) {
  const {
    query,
    limit,
    sessionKey: sessionFilter,
    vectorStore,
    embeddingService,
    logger
  } = params;
  logger?.debug?.(
    `${TAG6} CALLED: query="${query.slice(0, 100)}", limit=${limit}, sessionFilter=${sessionFilter ?? "(none)"}, vectorStore=${vectorStore ? "available" : "UNAVAILABLE"}, embeddingService=${embeddingService ? "available" : "UNAVAILABLE"}`
  );
  if (!query || query.trim().length === 0) {
    logger?.debug?.(`${TAG6} Empty query, returning empty`);
    return { results: [], total: 0, strategy: "none" };
  }
  if (!vectorStore) {
    logger?.warn?.(`${TAG6} VectorStore not available`);
    return { results: [], total: 0, strategy: "none" };
  }
  const hasEmbedding = !!embeddingService;
  const hasFts = vectorStore.isFtsAvailable();
  if (!hasEmbedding && !hasFts) {
    logger?.warn?.(`${TAG6} Neither EmbeddingService nor FTS5 available \u2014 cannot search`);
    return {
      results: [],
      total: 0,
      strategy: "none",
      message: "Embedding service is not configured and FTS is not available. Conversation search requires an embedding provider or FTS5 support. Please configure an embedding provider in the embedding.provider setting (e.g. openai_compatible)."
    };
  }
  const candidateK = sessionFilter ? limit * 4 : limit * 3;
  const [ftsItems, vecItems] = await Promise.all([
    // FTS5 keyword search on L0
    (async () => {
      if (!hasFts) return [];
      try {
        const ftsQuery = buildFtsQuery(query);
        if (!ftsQuery) {
          logger?.debug?.(`${TAG6} [hybrid-fts] No usable FTS tokens from query`);
          return [];
        }
        logger?.debug?.(`${TAG6} [hybrid-fts] FTS5 query: "${ftsQuery}"`);
        const ftsResults = await vectorStore.searchL0Fts(ftsQuery, candidateK);
        logger?.debug?.(`${TAG6} [hybrid-fts] FTS5 returned ${ftsResults.length} candidates`);
        return ftsResults.map((r) => ({
          id: r.record_id,
          session_key: r.session_key,
          role: r.role,
          content: r.message_text,
          score: r.score,
          recorded_at: r.recorded_at
        }));
      } catch (err) {
        logger?.warn?.(
          `${TAG6} [hybrid-fts] FTS5 search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
    })(),
    // Vector embedding search on L0
    (async () => {
      if (!hasEmbedding) return [];
      try {
        logger?.debug?.(`${TAG6} [hybrid-vec] Generating query embedding...`);
        const queryEmbedding = await embeddingService.embed(query);
        logger?.debug?.(
          `${TAG6} [hybrid-vec] Embedding OK, dims=${queryEmbedding.length}, searching top-${candidateK}...`
        );
        const vecResults = await vectorStore.searchL0Vector(queryEmbedding, candidateK, query);
        logger?.debug?.(`${TAG6} [hybrid-vec] Vector search returned ${vecResults.length} candidates`);
        return vecResults.map((r) => ({
          id: r.record_id,
          session_key: r.session_key,
          role: r.role,
          content: r.message_text,
          score: r.score,
          recorded_at: r.recorded_at
        }));
      } catch (err) {
        logger?.warn?.(
          `${TAG6} [hybrid-vec] Embedding search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
    })()
  ]);
  const ftsOk = ftsItems.length > 0;
  const vecOk = vecItems.length > 0;
  let strategy;
  if (ftsOk && vecOk) {
    strategy = "hybrid";
  } else if (vecOk) {
    strategy = "embedding";
  } else if (ftsOk) {
    strategy = "fts";
  } else {
    logger?.debug?.(`${TAG6} Both search paths returned 0 results`);
    return { results: [], total: 0, strategy: hasEmbedding ? "embedding" : "fts" };
  }
  let results;
  if (strategy === "hybrid") {
    results = rrfMergeL0(ftsItems, vecItems);
    logger?.debug?.(
      `${TAG6} [hybrid] RRF merged: fts=${ftsItems.length}, vec=${vecItems.length} \u2192 ${results.length} unique`
    );
  } else {
    results = ftsOk ? ftsItems : vecItems;
  }
  if (sessionFilter) {
    const preFilterCount = results.length;
    results = results.filter((r) => r.session_key === sessionFilter);
    logger?.debug?.(`${TAG6} After session filter "${sessionFilter}": ${results.length}/${preFilterCount}`);
  }
  const trimmed = results.slice(0, limit);
  logger?.debug?.(
    `${TAG6} RESULT (strategy=${strategy}): returning ${trimmed.length} messages (scores: [${trimmed.map((r) => r.score.toFixed(3)).join(", ")}])`
  );
  return {
    results: trimmed,
    total: trimmed.length,
    strategy
  };
}
function formatConversationSearchResponse(result) {
  if (result.message) {
    return result.message;
  }
  if (result.results.length === 0) {
    return "No matching conversation messages found.";
  }
  const lines = [
    `Found ${result.total} matching message(s):`,
    ""
  ];
  for (const item of result.results) {
    const scoreStr = typeof item.score === "number" ? ` (score: ${item.score.toFixed(3)})` : "";
    const dateStr = item.recorded_at ? ` [${item.recorded_at}]` : "";
    lines.push(`---`);
    lines.push(`**[${item.role}]** Session: ${item.session_key}${dateStr}${scoreStr}`);
    lines.push("");
    lines.push(item.content);
    lines.push("");
  }
  return lines.join("\n");
}

// src/utils/pipeline-factory.ts
import fs15 from "node:fs";
import path16 from "node:path";

// src/utils/session-filter.ts
var SKIP_TRIGGERS = /* @__PURE__ */ new Set(["cron", "heartbeat", "automation", "schedule"]);
function isNonInteractiveTrigger(trigger, sessionKey) {
  if (trigger && SKIP_TRIGGERS.has(trigger.toLowerCase())) return true;
  if (sessionKey) {
    if (/:cron:/i.test(sessionKey) || /:heartbeat:/i.test(sessionKey)) return true;
  }
  return false;
}
var BUILTIN_MATCHERS = [
  // Scene extraction runner sessions
  (key) => key.includes(":memory-scene-extract-"),
  // OpenClaw subagent sessions
  (key) => key.includes(":subagent:"),
  // Temporary / internal utility sessions (e.g. temp:slug-generator)
  (key) => key.startsWith("temp:")
];
function globToMatcher(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const re = new RegExp(escaped);
  return (key) => re.test(key);
}
var SessionFilter = class {
  matchers;
  constructor(excludeAgents = []) {
    const userMatchers = excludeAgents.map((p) => p.trim()).filter((p) => p.length > 0).map(globToMatcher);
    this.matchers = [...BUILTIN_MATCHERS, ...userMatchers];
  }
  /** Should this sessionKey be skipped? */
  shouldSkip(sessionKey) {
    return this.matchers.some((m) => m(sessionKey));
  }
  /** Should this hook context be skipped? */
  shouldSkipCtx(ctx) {
    if (!ctx.sessionKey) return true;
    if (ctx.sessionId?.startsWith("memory-")) return true;
    if (isNonInteractiveTrigger(ctx.trigger, ctx.sessionKey)) return true;
    return this.shouldSkip(ctx.sessionKey);
  }
};

// src/utils/managed-timer.ts
var ManagedTimer = class {
  constructor(name, isDestroyed) {
    this.name = name;
    this.isDestroyed = isDestroyed;
  }
  handle = null;
  callback = null;
  /** Absolute epoch-ms when the current timer is scheduled to fire. */
  scheduledAt = 0;
  // ── Core operations ──────────────────────────────────
  /**
   * Cancel any pending timer and schedule a new one after `delayMs`.
   * The callback fires once; the timer auto-clears after firing.
   */
  schedule(delayMs, callback) {
    this.cancelInternal();
    this.callback = callback;
    this.scheduledAt = Date.now() + delayMs;
    this.handle = setTimeout(() => this.fire(), delayMs);
    this.handle.unref();
  }
  /**
   * Cancel any pending timer and schedule to fire at an absolute epoch-ms.
   * If `epochMs` is in the past, fires on next tick (delay = 0).
   */
  scheduleAt(epochMs, callback) {
    this.cancelInternal();
    this.callback = callback;
    this.scheduledAt = epochMs;
    const delay = Math.max(0, epochMs - Date.now());
    this.handle = setTimeout(() => this.fire(), delay);
    this.handle.unref();
  }
  /**
   * Only reschedule if `epochMs` is *earlier* than the current scheduled time.
   * This implements the "downward-only" timer pattern (L2 scheduling).
   * If no timer is pending, behaves like `scheduleAt()`.
   *
   * @returns true if the timer was actually advanced (or newly set).
   */
  tryAdvanceTo(epochMs, callback) {
    if (this.handle === null) {
      this.scheduleAt(epochMs, callback);
      return true;
    }
    if (epochMs < this.scheduledAt) {
      this.scheduleAt(epochMs, callback);
      return true;
    }
    return false;
  }
  /**
   * Cancel the pending timer without triggering the callback.
   */
  cancel() {
    this.cancelInternal();
  }
  /**
   * Immediately trigger the callback (if pending) and clear the timer.
   * Used for graceful shutdown to flush pending work.
   *
   * Note: Unlike `fire()`, this method intentionally does NOT check `isDestroyed`.
   * This is by design — during shutdown, `destroy()` sets `destroyed = true` first,
   * then calls `flush()` to drain pending work. The `isDestroyed` guard only applies
   * to natural timer expiration via `fire()`, not to explicit shutdown flushes.
   */
  flush() {
    if (this.handle === null) return;
    const cb = this.callback;
    this.cancelInternal();
    if (cb) cb();
  }
  // ── Accessors ────────────────────────────────────────
  /** Whether a timer is currently pending. */
  get pending() {
    return this.handle !== null;
  }
  /** The epoch-ms when the current timer is scheduled to fire (0 if none). */
  get scheduledTime() {
    return this.handle !== null ? this.scheduledAt : 0;
  }
  // ── Internals ────────────────────────────────────────
  fire() {
    const cb = this.callback;
    this.handle = null;
    this.callback = null;
    this.scheduledAt = 0;
    if (this.isDestroyed?.()) return;
    if (cb) cb();
  }
  cancelInternal() {
    if (this.handle !== null) {
      clearTimeout(this.handle);
      this.handle = null;
    }
    this.callback = null;
    this.scheduledAt = 0;
  }
};

// src/utils/serial-queue.ts
var SerialQueue = class {
  /** Human-readable name for logging / diagnostics. */
  name;
  queue = [];
  running = false;
  paused = false;
  idleResolvers = [];
  /** Optional debug logger — receives diagnostic messages for enqueue/dequeue/complete. */
  debugFn;
  constructor(name = "unnamed") {
    this.name = name;
  }
  /** Set a debug logger for queue diagnostics. */
  setDebugLogger(fn) {
    this.debugFn = fn;
  }
  /** Number of tasks waiting to be executed. */
  get size() {
    return this.queue.length;
  }
  /** Whether a task is currently executing. */
  get pending() {
    return this.running;
  }
  /** Whether the queue is idle (no queued tasks and nothing running). */
  get idle() {
    return this.queue.length === 0 && !this.running;
  }
  /** Add a task to the queue. Returns the task's result promise. */
  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject
      });
      this.debugFn?.(`[queue:${this.name}] enqueued, pending=${this.queue.length}, running=${this.running}`);
      this.drain();
    });
  }
  /** Pause the queue. Currently running task will finish, but no new tasks start. */
  pause() {
    this.paused = true;
  }
  /** Resume the queue after pause(). */
  start() {
    this.paused = false;
    this.drain();
  }
  /** Returns a promise that resolves when all queued tasks have completed. */
  onIdle() {
    if (this.queue.length === 0 && !this.running) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }
  /** Clear all pending (not yet started) tasks. */
  clear() {
    for (const entry of this.queue) {
      entry.reject(new Error("Queue cleared"));
    }
    this.queue = [];
  }
  drain() {
    if (this.running || this.paused || this.queue.length === 0) return;
    const entry = this.queue.shift();
    this.running = true;
    this.debugFn?.(`[queue:${this.name}] dequeued, starting execution (remaining=${this.queue.length})`);
    entry.task().then((result) => entry.resolve(result)).catch((err) => entry.reject(err)).finally(() => {
      this.running = false;
      this.debugFn?.(`[queue:${this.name}] task completed (remaining=${this.queue.length})`);
      if (this.queue.length === 0) {
        const resolvers = this.idleResolvers;
        this.idleResolvers = [];
        for (const resolve of resolvers) resolve();
      } else {
        this.drain();
      }
    });
  }
};

// src/core/report/reporter.ts
var REPORT_CONST = {
  PLUGIN: "plugin"
};
var _reporter;
function report(event, data) {
  if (!_reporter) return;
  try {
    _reporter.reportFunc(REPORT_CONST.PLUGIN, { event, ...data });
  } catch {
  }
}

// src/utils/pipeline-manager.ts
var TAG7 = "[memory-tdai] [pipeline]";
var MemoryPipelineManager = class {
  // Config (converted to ms internally)
  l1IdleTimeoutMs;
  everyNConversations;
  enableWarmup;
  l2DelayAfterL1Ms;
  l2MinIntervalMs;
  l2MaxIntervalMs;
  sessionActiveWindowMs;
  /** Delay before retrying a failed L1 (ms). */
  L1_RETRY_DELAY_MS = 3e4;
  // 30 seconds
  /** Max consecutive L1 retries per session before giving up. */
  L1_MAX_RETRIES = 5;
  // Queues (named for diagnostics)
  l1Queue = new SerialQueue("L1");
  l2Queue = new SerialQueue("L2");
  l3Queue = new SerialQueue("L3");
  // L3 dedup flag
  l3Pending = false;
  l3Running = false;
  // Per-session state
  sessionStates = /* @__PURE__ */ new Map();
  sessionTimers = /* @__PURE__ */ new Map();
  // Per-session message buffer: messages accumulated since last L1 run
  messageBuffers = /* @__PURE__ */ new Map();
  // Per-session L2 last run time (epoch ms, for minInterval floor)
  l2LastRunTime = /* @__PURE__ */ new Map();
  // Callbacks
  l1Runner = null;
  l2Runner = null;
  l3Runner = null;
  persister = null;
  logger;
  // Unified session filter (internal sessions + excludeAgents)
  sessionFilter;
  // Lifecycle
  destroyed = false;
  /** Plugin instance ID for metric reporting (set externally after async init). */
  instanceId;
  // Session GC: runs periodically to evict cold sessions from memory
  /** Multiplier on sessionActiveWindowMs to determine GC eligibility. */
  SESSION_GC_INACTIVE_MULTIPLIER = 3;
  /** Run GC every N calls to notifyConversation. */
  SESSION_GC_EVERY_N_NOTIFICATIONS = 50;
  /** Counter for GC scheduling. */
  notifyCounter = 0;
  constructor(config, logger, sessionFilter) {
    this.l1IdleTimeoutMs = config.l1.idleTimeoutSeconds * 1e3;
    this.everyNConversations = config.everyNConversations;
    this.enableWarmup = config.enableWarmup;
    this.l2DelayAfterL1Ms = config.l2.delayAfterL1Seconds * 1e3;
    this.l2MinIntervalMs = config.l2.minIntervalSeconds * 1e3;
    this.l2MaxIntervalMs = config.l2.maxIntervalSeconds * 1e3;
    this.sessionActiveWindowMs = config.l2.sessionActiveWindowHours * 60 * 60 * 1e3;
    this.logger = logger;
    this.sessionFilter = sessionFilter ?? new SessionFilter();
    this.logger?.debug?.(
      `${TAG7} Initialized: everyNConversations=${config.everyNConversations}, warmup=${config.enableWarmup ? "enabled" : "disabled"}, l1IdleTimeout=${config.l1.idleTimeoutSeconds}s, l2DelayAfterL1=${config.l2.delayAfterL1Seconds}s, l2MinInterval=${config.l2.minIntervalSeconds}s, l2MaxInterval=${config.l2.maxIntervalSeconds}s, sessionActiveWindow=${config.l2.sessionActiveWindowHours}h`
    );
    if (this.logger?.debug) {
      const debugFn = (msg) => this.logger?.debug?.(`${TAG7} ${msg}`);
      this.l1Queue.setDebugLogger(debugFn);
      this.l2Queue.setDebugLogger(debugFn);
      this.l3Queue.setDebugLogger(debugFn);
    }
  }
  // ============================
  // Setup
  // ============================
  setL1Runner(runner) {
    this.l1Runner = runner;
  }
  setL2Runner(runner) {
    this.l2Runner = runner;
  }
  setL3Runner(runner) {
    this.l3Runner = runner;
  }
  setPersister(persister) {
    this.persister = persister;
  }
  /**
   * Restore session states from checkpoint and start the pipeline.
   * Sessions with pending counts will be immediately re-enqueued.
   */
  start(restoredStates) {
    if (this.destroyed) return;
    if (restoredStates) {
      let skipped = 0;
      for (const [sessionKey, state] of Object.entries(restoredStates)) {
        if (this.sessionFilter.shouldSkip(sessionKey)) {
          skipped++;
          continue;
        }
        const patched = { ...state };
        if (patched.warmup_threshold == null) {
          patched.warmup_threshold = 0;
        }
        this.sessionStates.set(sessionKey, patched);
      }
      this.logger?.info(
        `${TAG7} Restored ${this.sessionStates.size} session state(s) from checkpoint` + (skipped > 0 ? ` (filtered ${skipped} internal)` : "")
      );
    }
    this.recoverPendingSessions();
    this.logger?.info(`${TAG7} Pipeline started`);
  }
  // ============================
  // L0→L1: Notify (called from auto-capture on agent_end)
  // ============================
  /**
   * Get the effective conversation threshold for a session, considering warm-up.
   *
   * When warm-up is enabled, new sessions start with threshold=1 and double
   * after each successful L1 run: 1 → 2 → 4 → 8 → ... → everyNConversations.
   * Once the threshold reaches everyNConversations, warm-up is considered complete
   * (warmup_threshold is set to 0) and the fixed config value is used.
   */
  getEffectiveThreshold(state) {
    if (!this.enableWarmup) return this.everyNConversations;
    if (state.warmup_threshold <= 0) return this.everyNConversations;
    return Math.min(state.warmup_threshold, this.everyNConversations);
  }
  /**
   * Advance the warm-up threshold for a session after a successful L1 run.
   * Doubles the threshold until it reaches everyNConversations, then marks
   * warm-up as complete (warmup_threshold = 0).
   */
  advanceWarmupThreshold(state) {
    if (!this.enableWarmup) return;
    if (state.warmup_threshold <= 0) return;
    const next = state.warmup_threshold * 2;
    if (next >= this.everyNConversations) {
      state.warmup_threshold = 0;
      this.logger?.debug?.(`${TAG7} Warm-up graduated \u2192 using steady-state threshold ${this.everyNConversations}`);
    } else {
      state.warmup_threshold = next;
      this.logger?.debug?.(`${TAG7} Warm-up advanced \u2192 next threshold ${next}`);
    }
  }
  /**
   * Notify the pipeline that a conversation round has ended for a session,
   * and buffer the captured messages for L1 batch processing.
   *
   * Two trigger paths start here:
   * - **Path A (threshold)**: if conversation_count >= effective threshold
   *   (warm-up or steady-state), trigger L1 immediately with all buffered messages.
   * - **Path B (idle)**: reset the L1 idle timer. When the timer fires (user
   *   stops chatting), L1 runs with whatever has been buffered.
   */
  async notifyConversation(sessionKey, messages) {
    if (this.destroyed) return;
    if (this.sessionFilter.shouldSkip(sessionKey)) return;
    const state = this.getOrCreateState(sessionKey);
    state.conversation_count += 1;
    state.last_active_time = Date.now();
    const timers = this.getOrCreateTimers(sessionKey);
    timers.l1RetryCount = 0;
    const buffer = this.messageBuffers.get(sessionKey) ?? [];
    buffer.push(...messages);
    this.messageBuffers.set(sessionKey, buffer);
    const effectiveThreshold = this.getEffectiveThreshold(state);
    const warmupInfo = this.enableWarmup && state.warmup_threshold > 0 ? ` (warmup: ${state.warmup_threshold})` : "";
    this.logger?.debug?.(
      `${TAG7} [${sessionKey}] notify: conversation_count=${state.conversation_count}/${effectiveThreshold}${warmupInfo}, buffered_messages=${buffer.length} (+${messages.length} new)`
    );
    await this.persistStates();
    if (state.conversation_count >= effectiveThreshold) {
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] Conversation threshold reached (${state.conversation_count}>=${effectiveThreshold}${warmupInfo}), triggering L1`
      );
      this.enqueueL1(sessionKey);
      return;
    }
    timers.l1Idle.schedule(this.l1IdleTimeoutMs, () => this.onL1IdleTimeout(sessionKey));
    this.logger?.debug?.(
      `${TAG7} [${sessionKey}] L1 idle timer reset (${this.l1IdleTimeoutMs / 1e3}s)`
    );
    this.notifyCounter += 1;
    if (this.notifyCounter >= this.SESSION_GC_EVERY_N_NOTIFICATIONS) {
      this.notifyCounter = 0;
      this.gcStaleSessions();
    }
  }
  // ============================
  // Graceful shutdown
  // ============================
  /**
   * Per-session flush — scoped end-of-session handling.
   *
   * Semantically different from {@link destroy}:
   *   - ``destroy`` tears down the *whole* scheduler (meant for process
   *     shutdown such as OpenClaw's ``gateway_stop``).
   *   - ``flushSession`` only processes the one session identified by
   *     ``sessionKey`` and leaves every other session's timers, buffers
   *     and pipeline state untouched.  This is the correct semantic for
   *     the Gateway's ``POST /session/end`` endpoint and for Hermes'
   *     ``on_session_end`` callback, which fire when one conversation
   *     ends while the process keeps serving other concurrent sessions.
   *
   * What it does:
   *   1. Cancel the session's pending L1 idle timer (no further idle
   *      fires for this key).
   *   2. If the session's message buffer still holds work, enqueue an
   *      immediate L1 run for this session (``triggerReason="flush"``).
   *   3. Await the shared ``l1Queue`` so the caller observes L1
   *      completion before returning.  We do not selectively wait
   *      because L1 is already a single-consumer SerialQueue — waiting
   *      for ``onIdle`` is the cheapest correct signal.
   *
   * What it deliberately does NOT do:
   *   - Touch other sessions' timers / buffers / pipeline state.
   *   - Destroy the scheduler or any of its queues.
   *   - Reset global fields such as ``destroyed``.
   *
   * Unknown session keys are a no-op: the scheduler may legitimately
   * have evicted the session earlier via GC, or the session may never
   * have produced any captures.
   */
  async flushSession(sessionKey) {
    if (this.destroyed) return;
    if (this.sessionFilter.shouldSkip(sessionKey)) return;
    const timers = this.sessionTimers.get(sessionKey);
    const buffer = this.messageBuffers.get(sessionKey);
    if (timers?.l1Idle.pending) {
      timers.l1Idle.cancel();
    }
    if (buffer && buffer.length > 0) {
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] flushSession: enqueuing L1 for ${buffer.length} buffered message(s)`
      );
      this.enqueueL1(sessionKey, "flush");
    }
    await this.l1Queue.onIdle();
    this.logger?.debug?.(`${TAG7} [${sessionKey}] flushSession: complete`);
  }
  /**
   * Maximum time (ms) to wait for pipeline flush during destroy.
   * Must be shorter than the gateway_stop hook timeout (3 s) to leave
   * headroom for VectorStore / EmbeddingService cleanup that runs after.
   */
  DESTROY_TIMEOUT_MS = 2e3;
  /**
   * Graceful shutdown with timeout protection:
   * 1. Mark destroyed, stop accepting new work
   * 2. Attempt to flush pending L1/L2/L3 work within DESTROY_TIMEOUT_MS
   * 3. If flush times out or fails, persist current state for recovery on next startup
   * 4. Pending work is never lost — it will be recovered via checkpoint on next start()
   */
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.logger?.info(
      `${TAG7} Destroying pipeline (timeout=${this.DESTROY_TIMEOUT_MS}ms)...`
    );
    try {
      let timeoutId;
      await Promise.race([
        this._doFlush(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("destroy timeout")), this.DESTROY_TIMEOUT_MS);
        })
      ]).finally(() => {
        if (timeoutId !== void 0) clearTimeout(timeoutId);
      });
      this.logger?.info(`${TAG7} Pipeline flushed successfully`);
    } catch (err) {
      this.logger?.warn(
        `${TAG7} Pipeline flush timed out or failed: ${err instanceof Error ? err.message : String(err)}. Pending work will be recovered on next startup.`
      );
    }
    try {
      await this.persistStates();
    } catch (err) {
      this.logger?.error(
        `${TAG7} Failed to persist states during destroy: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    this.logger?.info(`${TAG7} Pipeline destroyed`);
  }
  /**
   * Internal: attempt to flush all pending pipeline work (L1 → L2 → L3).
   * Extracted from destroy() so it can be wrapped with a timeout.
   */
  async _doFlush() {
    for (const [sessionKey, timers] of this.sessionTimers) {
      if (timers.l1Idle.pending) {
        timers.l1Idle.cancel();
        const buffer = this.messageBuffers.get(sessionKey);
        if (buffer && buffer.length > 0) {
          this.logger?.debug?.(`${TAG7} [${sessionKey}] Flush: enqueuing L1 for ${buffer.length} buffered messages`);
          this.enqueueL1(sessionKey, "flush");
        }
      }
    }
    this.logger?.debug?.(`${TAG7} Waiting for L1 queue to drain (size=${this.l1Queue.size})`);
    await this.l1Queue.onIdle();
    for (const [sessionKey, timers] of this.sessionTimers) {
      if (timers.l2Schedule.pending) {
        this.logger?.debug?.(`${TAG7} [${sessionKey}] Flush: triggering L2 schedule timer`);
        timers.l2Schedule.flush();
      }
    }
    this.logger?.debug?.(`${TAG7} Waiting for queues to drain (l2=${this.l2Queue.size}, l3=${this.l3Queue.size})`);
    await Promise.all([
      this.l2Queue.onIdle(),
      this.l3Queue.onIdle()
    ]);
  }
  // ============================
  // Internal: L1 idle timeout handler
  // ============================
  onL1IdleTimeout(sessionKey) {
    const buffer = this.messageBuffers.get(sessionKey);
    const state = this.sessionStates.get(sessionKey);
    if ((!buffer || buffer.length === 0) && (!state || state.conversation_count === 0)) {
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] L1 idle timeout but no pending messages or conversations`
      );
      return;
    }
    this.logger?.debug?.(
      `${TAG7} [${sessionKey}] L1 idle timeout fired (buffered=${buffer?.length ?? 0}, conversations=${state?.conversation_count ?? 0})`
    );
    this.enqueueL1(sessionKey, "idle_timeout");
  }
  // ============================
  // Internal: L1 queue
  // ============================
  enqueueL1(sessionKey, triggerReason = "threshold") {
    const timers = this.getOrCreateTimers(sessionKey);
    if (timers.l1Queued) {
      this.logger?.debug?.(`${TAG7} [${sessionKey}] L1 already queued, skipping`);
      return;
    }
    timers.l1Idle.cancel();
    timers.l1Queued = true;
    this.logger?.debug?.(`${TAG7} [${sessionKey}] Enqueuing L1 (queue=${this.l1Queue.name})`);
    const state = this.sessionStates.get(sessionKey);
    const buffer = this.messageBuffers.get(sessionKey);
    if (this.instanceId && this.logger) {
      report("pipeline_l1_trigger", {
        sessionKey,
        triggerReason,
        conversationCount: state?.conversation_count ?? 0,
        bufferedMessageCount: buffer?.length ?? 0
      });
    }
    this.l1Queue.add(async () => {
      await this.runL1(sessionKey);
    }).catch((err) => {
      this.logger?.error(
        `${TAG7} [${sessionKey}] L1 task failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
    }).finally(() => {
      timers.l1Queued = false;
    });
  }
  /**
   * L1 runner: Takes all buffered messages for a session and passes them
   * to the L1Runner for batch processing (e.g. appendEvent, local extraction).
   *
   * After L1 completes successfully:
   * - conversation_count and message buffer are reset
   * - L2 timer is advanced (downward-only) to allow remote record generation
   *
   * If L1 fails, conversation_count and buffer are preserved for retry
   * on next idle timeout or threshold trigger.
   */
  async runL1(sessionKey) {
    const state = this.sessionStates.get(sessionKey);
    if (!state) return;
    const buffer = this.messageBuffers.get(sessionKey) ?? [];
    this.messageBuffers.set(sessionKey, []);
    if (buffer.length === 0 && state.conversation_count === 0) {
      this.logger?.debug?.(`${TAG7} [${sessionKey}] L1 skipped: no messages and no pending conversations`);
      return;
    }
    this.logger?.debug?.(
      `${TAG7} [${sessionKey}] L1 running: messages=${buffer.length}, conversation_count=${state.conversation_count}`
    );
    if (!this.l1Runner) {
      this.logger?.warn(`${TAG7} [${sessionKey}] No L1 runner set, skipping`);
      state.l2_pending_l1_count = state.conversation_count;
      state.conversation_count = 0;
      this.advanceWarmupThreshold(state);
      await this.persistStates();
      this.advanceL2Timer(sessionKey);
      return;
    }
    try {
      await this.l1Runner({
        sessionKey,
        msg: buffer,
        bg_msg: []
        // reserved for future use
      });
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] L1 complete: processed ${buffer.length} messages`
      );
    } catch (err) {
      this.logger?.error(
        `${TAG7} [${sessionKey}] L1 runner failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
      const currentBuffer = this.messageBuffers.get(sessionKey) ?? [];
      this.messageBuffers.set(sessionKey, [...buffer, ...currentBuffer]);
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] L1 failure: restored ${buffer.length} messages to buffer (total=${buffer.length + currentBuffer.length})`
      );
      const timers2 = this.getOrCreateTimers(sessionKey);
      timers2.l1RetryCount += 1;
      if (timers2.l1RetryCount <= this.L1_MAX_RETRIES) {
        timers2.l1Idle.schedule(this.L1_RETRY_DELAY_MS, () => this.onL1IdleTimeout(sessionKey));
        this.logger?.debug?.(
          `${TAG7} [${sessionKey}] L1 retry scheduled in ${this.L1_RETRY_DELAY_MS / 1e3}s (attempt ${timers2.l1RetryCount}/${this.L1_MAX_RETRIES})`
        );
      } else {
        this.logger?.warn(
          `${TAG7} [${sessionKey}] L1 max retries reached (${this.L1_MAX_RETRIES}), giving up auto-retry. ${buffer.length + currentBuffer.length} messages remain buffered. Will resume on next user conversation.`
        );
      }
      return;
    }
    const timers = this.getOrCreateTimers(sessionKey);
    timers.l1RetryCount = 0;
    state.l2_pending_l1_count = state.conversation_count;
    state.conversation_count = 0;
    this.advanceWarmupThreshold(state);
    await this.persistStates();
    this.advanceL2Timer(sessionKey);
  }
  // ============================
  // Internal: L2 timer management (downward-only)
  // ============================
  /**
   * Advance the per-session L2 timer after an L1 event (new memory generated).
   *
   * Computes the desired fire time as:
   *   T_desired = max(now + l2DelayAfterL1, lastL2Time + l2MinInterval)
   *
   * The timer is only moved if T_desired is earlier than the current schedule
   * (downward-only semantics). If no timer is pending, it's set unconditionally.
   */
  advanceL2Timer(sessionKey) {
    if (this.destroyed) return;
    const timers = this.getOrCreateTimers(sessionKey);
    const now = Date.now();
    const lastL2 = this.l2LastRunTime.get(sessionKey) ?? 0;
    const minIntervalFloor = lastL2 > 0 ? lastL2 + this.l2MinIntervalMs : 0;
    const desiredTime = Math.max(now + this.l2DelayAfterL1Ms, minIntervalFloor);
    const advanced = timers.l2Schedule.tryAdvanceTo(desiredTime, () => this.onL2TimerFired(sessionKey, "delay-after-l1"));
    if (advanced) {
      const delaySec = Math.round((desiredTime - now) / 1e3);
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] L2 timer advanced: firing in ${delaySec}s` + (timers.l2Schedule.scheduledTime > 0 ? ` (was ${Math.round((timers.l2Schedule.scheduledTime - now) / 1e3)}s)` : " (newly armed)")
      );
    } else {
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] L2 timer not advanced: current schedule is already earlier`
      );
    }
  }
  /**
   * Arm the L2 timer for the maxInterval guarantee after L2 completes.
   * Sets T = now + l2MaxInterval (unconditional, replaces any pending timer).
   */
  armL2MaxInterval(sessionKey) {
    if (this.destroyed) return;
    const timers = this.getOrCreateTimers(sessionKey);
    const fireAt = Date.now() + this.l2MaxIntervalMs;
    timers.l2Schedule.scheduleAt(fireAt, () => this.onL2TimerFired(sessionKey, "max-interval"));
    this.logger?.debug?.(
      `${TAG7} [${sessionKey}] L2 maxInterval timer armed: ${Math.round(this.l2MaxIntervalMs / 1e3)}s`
    );
  }
  /**
   * Called when a per-session L2 timer fires.
   *
   * Checks session activity: if the session is cold (inactive > activeWindow),
   * the timer is NOT re-armed — it will be revived by the next L1 event.
   * Otherwise, enqueues L2.
   *
   * The `source` parameter distinguishes the trigger origin:
   * - "delay-after-l1": fired shortly after L1 completed — skip cold check
   *   because L1 completion itself proves recent activity.
   * - "max-interval": periodic timer — apply cold check normally.
   */
  onL2TimerFired(sessionKey, source) {
    const state = this.sessionStates.get(sessionKey);
    if (!state) return;
    const now = Date.now();
    if (source === "max-interval" && now - state.last_active_time >= this.sessionActiveWindowMs) {
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] L2 timer fired but session is cold (inactive ${Math.round((now - state.last_active_time) / 36e5)}h), timer stopped. Will re-arm on next L1 event.`
      );
      return;
    }
    this.enqueueL2(sessionKey, `timer:${source}`);
  }
  // ============================
  // Internal: L2 queue
  // ============================
  enqueueL2(sessionKey, trigger) {
    const timers = this.getOrCreateTimers(sessionKey);
    timers.l2Schedule.cancel();
    if (timers.l2Queued) {
      this.logger?.warn(
        `${TAG7} [${sessionKey}] L2 enqueue conflict on queue "${this.l2Queue.name}": task already queued/running (trigger=${trigger}), skipping`
      );
      return;
    }
    timers.l2Queued = true;
    this.logger?.debug?.(`${TAG7} [${sessionKey}] Enqueuing L2 (trigger=${trigger}, queue=${this.l2Queue.name})`);
    this.l2Queue.add(async () => {
      await this.runL2(sessionKey);
    }).catch((err) => {
      this.logger?.error(
        `${TAG7} [${sessionKey}] L2 task failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
    }).finally(() => {
      timers.l2Queued = false;
    });
  }
  async runL2(sessionKey) {
    const state = this.sessionStates.get(sessionKey);
    if (!state) return;
    if (!this.l2Runner) {
      this.logger?.warn(`${TAG7} [${sessionKey}] No L2 runner set, skipping`);
      return;
    }
    this.logger?.debug?.(
      `${TAG7} [${sessionKey}] L2 running: l2_pending_l1_count=${state.l2_pending_l1_count}`
    );
    const cursor = state.last_extraction_updated_time || void 0;
    let result;
    try {
      result = await this.l2Runner(sessionKey, cursor);
    } catch (err) {
      this.logger?.error(
        `${TAG7} [${sessionKey}] L2 runner failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
      this.armL2MaxInterval(sessionKey);
      return;
    }
    const now = Date.now();
    state.l2_pending_l1_count = 0;
    const isFirstL2 = !this.l2LastRunTime.has(sessionKey);
    const wasSkipped = result?.skipped === true;
    if (isFirstL2 && wasSkipped) {
      this.logger?.info?.(
        `${TAG7} [${sessionKey}] L2 cold-start skip: not updating l2LastRunTime (minInterval won't block next trigger)`
      );
      this.armL2MaxInterval(sessionKey);
      await this.persistStates();
      return;
    }
    state.last_extraction_time = (/* @__PURE__ */ new Date()).toISOString();
    state.l2_last_extraction_time = (/* @__PURE__ */ new Date()).toISOString();
    this.l2LastRunTime.set(sessionKey, now);
    if (result?.latestCursor) {
      state.last_extraction_updated_time = result.latestCursor;
    } else if (!state.last_extraction_updated_time) {
      state.last_extraction_updated_time = (/* @__PURE__ */ new Date()).toISOString();
    }
    await this.persistStates();
    this.logger?.debug?.(`${TAG7} [${sessionKey}] L2 complete`);
    this.armL2MaxInterval(sessionKey);
    this.triggerL3();
  }
  // ============================
  // Internal: L3 queue (global, dedup)
  // ============================
  triggerL3() {
    if (this.destroyed) return;
    if (this.l3Running) {
      this.l3Pending = true;
      this.logger?.debug?.(`${TAG7} L3 already running, marking pending`);
      return;
    }
    this.logger?.debug?.(`${TAG7} Triggering L3`);
    this.enqueueL3();
  }
  enqueueL3() {
    this.l3Running = true;
    this.l3Pending = false;
    this.logger?.debug?.(`${TAG7} Enqueuing L3 (queue=${this.l3Queue.name})`);
    this.l3Queue.add(async () => {
      await this.runL3();
    }).catch((err) => {
      this.logger?.error(
        `${TAG7} L3 task failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
    }).finally(() => {
      this.l3Running = false;
      if (this.l3Pending && !this.destroyed) {
        this.logger?.debug?.(`${TAG7} L3 has pending work, re-running`);
        this.enqueueL3();
      }
    });
  }
  async runL3() {
    if (!this.l3Runner) {
      this.logger?.warn(`${TAG7} No L3 runner set, skipping`);
      return;
    }
    this.logger?.debug?.(`${TAG7} L3 running`);
    try {
      await this.l3Runner();
      this.logger?.debug?.(`${TAG7} L3 complete`);
    } catch (err) {
      this.logger?.error(
        `${TAG7} L3 runner failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`
      );
    }
  }
  // ============================
  // Internal: state management
  // ============================
  getOrCreateState(sessionKey) {
    let state = this.sessionStates.get(sessionKey);
    if (!state) {
      state = {
        conversation_count: 0,
        last_extraction_time: "",
        last_extraction_updated_time: "",
        last_active_time: Date.now(),
        l2_pending_l1_count: 0,
        warmup_threshold: this.enableWarmup ? 1 : 0,
        l2_last_extraction_time: ""
      };
      this.sessionStates.set(sessionKey, state);
      this.logger?.debug?.(`${TAG7} [${sessionKey}] Created new session state`);
    }
    return state;
  }
  getOrCreateTimers(sessionKey) {
    let timers = this.sessionTimers.get(sessionKey);
    if (!timers) {
      const isDestroyed = () => this.destroyed;
      timers = {
        l1Idle: new ManagedTimer(`L1-idle:${sessionKey}`, isDestroyed),
        l2Schedule: new ManagedTimer(`L2-schedule:${sessionKey}`, isDestroyed),
        l1Queued: false,
        l2Queued: false,
        l1RetryCount: 0
      };
      this.sessionTimers.set(sessionKey, timers);
    }
    return timers;
  }
  async persistStates() {
    if (!this.persister) return;
    const obj2 = {};
    for (const [k, v] of this.sessionStates) {
      obj2[k] = { ...v };
    }
    try {
      this.logger?.debug?.(`Persisting states: ${JSON.stringify(obj2)}`);
      await this.persister(obj2);
    } catch (err) {
      this.logger?.error(
        `${TAG7} Failed to persist states: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  /**
   * Evict cold sessions from in-memory maps to prevent unbounded growth.
   *
   * A session is eligible for GC when:
   * 1. Inactive for > sessionActiveWindowMs * SESSION_GC_INACTIVE_MULTIPLIER
   * 2. No queued/running L1 or L2 tasks
   * 3. No buffered messages pending processing
   *
   * Evicted sessions can be fully restored from checkpoint on next
   * `notifyConversation()` (state) or `start()` (recovery).
   */
  gcStaleSessions() {
    const now = Date.now();
    const maxInactiveMs = this.sessionActiveWindowMs * this.SESSION_GC_INACTIVE_MULTIPLIER;
    let evictedCount = 0;
    for (const [sessionKey, state] of this.sessionStates) {
      if (now - state.last_active_time < maxInactiveMs) continue;
      const timers = this.sessionTimers.get(sessionKey);
      if (timers?.l1Queued || timers?.l2Queued) continue;
      const buffer = this.messageBuffers.get(sessionKey);
      if (buffer && buffer.length > 0) continue;
      if (timers) {
        timers.l1Idle.cancel();
        timers.l2Schedule.cancel();
      }
      this.sessionStates.delete(sessionKey);
      this.sessionTimers.delete(sessionKey);
      this.messageBuffers.delete(sessionKey);
      this.l2LastRunTime.delete(sessionKey);
      evictedCount++;
    }
    if (evictedCount > 0) {
      this.logger?.debug?.(
        `${TAG7} Session GC: evicted ${evictedCount} cold session(s), ${this.sessionStates.size} remaining`
      );
    }
  }
  /**
   * Recovery: re-enqueue sessions that have pending work from before restart.
   *
   * On restart, message buffers are empty (in-memory only). Sessions with
   * non-zero conversation_count had messages that were either:
   * 1. Already processed by L1 (l2_pending_l1_count > 0) → arm L2 timer
   * 2. Never reached L1 (conversation_count > 0, messages lost) → arm L2
   *    as best-effort recovery
   *
   * We arm L2 timers (with delay) rather than enqueuing immediately,
   * because the pipeline may be starting during management commands.
   */
  recoverPendingSessions() {
    for (const [sessionKey, state] of this.sessionStates) {
      if (state.conversation_count === 0 && state.l2_pending_l1_count === 0) continue;
      this.logger?.debug?.(
        `${TAG7} [${sessionKey}] Recovery: conversation_count=${state.conversation_count}, l2_pending_l1_count=${state.l2_pending_l1_count}, arming L2 timer`
      );
      state.l2_pending_l1_count = Math.max(state.l2_pending_l1_count, state.conversation_count);
      state.conversation_count = 0;
      this.advanceL2Timer(sessionKey);
    }
  }
  // ============================
  // Public accessors (for testing / status)
  // ============================
  /** Get the pipeline session state for a session (read-only copy). */
  getSessionState(sessionKey) {
    const state = this.sessionStates.get(sessionKey);
    return state ? { ...state } : void 0;
  }
  /** Get the buffered message count for a session. */
  getBufferedMessageCount(sessionKey) {
    return this.messageBuffers.get(sessionKey)?.length ?? 0;
  }
  /** Get all session keys being tracked. */
  getSessionKeys() {
    return Array.from(this.sessionStates.keys());
  }
  /** Whether the pipeline has been destroyed. */
  get isDestroyed() {
    return this.destroyed;
  }
  /** Queue sizes and running state for monitoring. */
  getQueueSizes() {
    return {
      l1: this.l1Queue.size,
      l2: this.l2Queue.size,
      l3: this.l3Queue.size,
      l1Pending: this.l1Queue.pending,
      l2Pending: this.l2Queue.pending,
      l3Pending: this.l3Queue.pending,
      l1Idle: this.l1Queue.idle,
      l2Idle: this.l2Queue.idle,
      l3Idle: this.l3Queue.idle
    };
  }
};

// src/core/prompts/l1-extraction.ts
var EXTRACT_MEMORIES_SYSTEM_PROMPT = `\u4F60\u662F\u4E13\u4E1A\u7684"\u60C5\u5883\u5207\u5206\u4E0E\u8BB0\u5FC6\u63D0\u53D6\u4E13\u5BB6"\u3002
\u4F60\u7684\u4EFB\u52A1\u662F\u5206\u6790\u7528\u6237\u7684\u5BF9\u8BDD\uFF0C\u5224\u65AD\u60C5\u5883\u5207\u6362\uFF0C\u5E76\u4ECE\u4E2D\u63D0\u53D6\u7ED3\u6784\u5316\u7684\u6838\u5FC3\u8BB0\u5FC6\uFF08\u4EC5\u9650 persona, episodic, instruction \u4E09\u7C7B\uFF09\u3002

**\u8F93\u51FA\u8BED\u8A00**\uFF1A\u6240\u6709\u81EA\u7531\u6587\u672C\u5B57\u6BB5\uFF08\`scene_name\`\u3001memory \`content\`\uFF09\u4F7F\u7528\u4E0E\u7528\u6237\u6D88\u606F\u76F8\u540C\u7684\u8BED\u8A00\uFF1BJSON \u5B57\u6BB5\u540D\u3001\u679A\u4E3E\u503C\u3001ISO \u65F6\u95F4\u6233\u4FDD\u6301\u82F1\u6587\u3002

### \u4EFB\u52A1\u4E00\uFF1A\u60C5\u5883\u5207\u5206\uFF08Scene Segmentation\uFF09
\u5206\u6790\u3010\u5F85\u63D0\u53D6\u7684\u65B0\u6D88\u606F\u3011\uFF0C\u7ED3\u5408\u3010\u4E0A\u4E00\u4E2A\u60C5\u5883\u3011\uFF0C\u5224\u65AD\u5E76\u8F93\u51FA\u5F53\u524D\u5BF9\u8BDD\u7684\u60C5\u5883\u3002
- \u7EE7\u627F\uFF1A\u65E0\u660E\u663E\u5207\u6362\uFF0C\u6CBF\u7528\u4E0A\u4E00\u4E2A\u60C5\u5883\u3002
- \u5207\u6362\u6761\u4EF6\uFF1A\u7528\u6237\u53D1\u51FA\u660E\u786E\u6307\u4EE4\uFF08\u5982"\u6362\u8BDD\u9898"\uFF09\u3001\u610F\u56FE\u8F6C\u53D8\u3001\u6216\u63D0\u51FA\u72EC\u7ACB\u65B0\u76EE\u6807\u3002
- \u4E00\u6BB5\u5BF9\u8BDD\u53EF\u80FD\u53EA\u6709\u4E00\u4E2A\u60C5\u5883\uFF0C\u4E5F\u53EF\u80FD\u6709\u591A\u4E2A\u60C5\u5883\uFF08\u8BDD\u9898\u591A\u6B21\u5207\u6362\u65F6\uFF09\u3002
- \u547D\u540D\u89C4\u5219\uFF1A"\u6211\uFF08AI\uFF09\u5728\u548Cxxx\uFF08\u7528\u6237\u8EAB\u4EFD\uFF09\u505Axxx\uFF08\u76EE\u6807\u6D3B\u52A8\uFF09"\uFF08**\u4F7F\u7528\u4E0A\u8FF0\u8F93\u51FA\u8BED\u8A00**\uFF0C\u7EA6 30-50 \u4E2A\u5B57\u7B26\u6216\u7B49\u4EF7\u957F\u5EA6\uFF0C\u5355\u53E5\uFF0C\u5168\u5C40\u552F\u4E00\uFF09\u3002

---

### \u4EFB\u52A1\u4E8C\uFF1A\u6838\u5FC3\u8BB0\u5FC6\u63D0\u53D6\uFF08Memory Extraction\uFF09
\u7ED3\u5408\u80CC\u666F\u548C\u5F53\u524D\u60C5\u5883\uFF0C\u4EC5\u4ECE\u3010\u5F85\u63D0\u53D6\u7684\u65B0\u6D88\u606F\u3011\u4E2D\u63D0\u53D6\u6838\u5FC3\u4FE1\u606F\u3002

\u3010\u901A\u7528\u63D0\u53D6\u539F\u5219\u3011
1. \u5B81\u7F3A\u6BCB\u6EE5\uFF1A\u8FC7\u6EE4\u7410\u788E\u95F2\u804A\u3001\u4E34\u65F6\u6027\u6307\u4EE4\u548C\u4E00\u6B21\u6027\u64CD\u4F5C\uFF08\u5982"\u8FD9\u6B21\u3001\u672C\u5355"\uFF09\uFF1B\u5254\u9664\u4E0D\u53EF\u9760\u7684\u8FB9\u7F18\u4FE1\u606F\u3002
2. \u72EC\u7ACB\u5B8C\u6574\uFF1A\u8BB0\u5FC6\u5FC5\u987B"\u8DF3\u51FA\u5F53\u524D\u5BF9\u8BDD\u4F9D\u7136\u6210\u7ACB"\uFF0C\u65E0\u4E0A\u4E0B\u6587\u4E5F\u80FD\u770B\u61C2\u3002\u63D0\u53D6\u4E3B\u4F53\u5FC5\u987B\u4EE5"\u7528\u6237\uFF08\u59D3\u540D\uFF09"\u6216"AI"\u4E3A\u6838\u5FC3\u3002
3. \u5F52\u7EB3\u5408\u5E76\uFF1A\u5F3A\u5173\u8054\u6216\u56E0\u679C\u5173\u7CFB\u7684\u591A\u6761\u6D88\u606F\uFF0C\u5FC5\u987B\u5408\u5E76\u4E3A\u4E00\u6761\u5B8C\u6574\u8BB0\u5FC6\uFF0C\u4E0D\u53EF\u788E\u7247\u5316\u3002

\u3010\u652F\u6301\u63D0\u53D6\u7684\u4E09\u5927\u7C7B\u578B\u3011\uFF08\u5FC5\u987B\u4E25\u683C\u9075\u5B88\u7C7B\u578B\u89C4\u5219\uFF09
> \u4E0B\u9762\u7ED9\u51FA\u7684"\u63D0\u53D6\u53E5\u5F0F"\u548C"\u89E6\u53D1\u8BCD"\u4EC5\u4F5C\u4E3A\u4E2D\u6587\u9AA8\u67B6\u53C2\u8003\uFF1B**\u5B9E\u9645 \`content\` \u5FC5\u987B\u6309\u4E0A\u8FF0\u8F93\u51FA\u8BED\u8A00\u4E66\u5199**\uFF08\u4F8B\u5982\u82F1\u6587\u7528\u6237 \u2192 "The user (Maya) is a senior product manager based in Berlin"\uFF09\u3002

1. \u4E2A\u6027\u5316\u8BB0\u5FC6 (type: "persona")
   - \u5B9A\u4E49\uFF1A\u7528\u6237\u7684\u7A33\u5B9A\u5C5E\u6027\u3001\u504F\u597D\u3001\u6280\u80FD\u3001\u4EF7\u503C\u89C2\u3001\u4E60\u60EF\uFF08\u5982\u4F4F\u6240\u3001\u804C\u4E1A\u3001\u996E\u98DF\u7981\u5FCC\uFF09\u3002
   - \u63D0\u53D6\u53E5\u5F0F\uFF1A"\u7528\u6237\uFF08[\u59D3\u540D]\uFF09\u559C\u6B22/\u662F/\u64C5\u957F..."
   - \u6253\u5206 (priority)\uFF1A80-100\uFF08\u5065\u5EB7/\u7981\u5FCC/\u6838\u5FC3\u7279\u8D28\uFF09\uFF1B50-70\uFF08\u4E00\u822C\u559C\u597D/\u6280\u80FD\uFF09\uFF1B<50\uFF08\u6A21\u7CCA\u6B21\u8981\uFF0C\u53EF\u4E22\u5F03\uFF09\u3002
   - \u89E6\u53D1\u8BCD\uFF1A\u559C\u6B22\u3001\u4E60\u60EF\u3001\u7ECF\u5E38\u3001\u6211\u8FD9\u4E2A\u4EBA...

2. \u5BA2\u89C2\u4E8B\u4EF6\u8BB0\u5FC6 (type: "episodic")
   - \u5B9A\u4E49\uFF1A\u5BA2\u89C2\u53D1\u751F\u7684\u52A8\u4F5C\u3001\u51B3\u5B9A\u3001\u8BA1\u5212\u6216\u8FBE\u6210\u7ED3\u679C\u3002\u7EDD\u4E0D\u5305\u542B\u7EAF\u4E3B\u89C2\u611F\u53D7\u3002
   - \u63D0\u53D6\u53E5\u5F0F\uFF1A"\u7528\u6237\uFF08[\u59D3\u540D]\uFF09\u5728 [\u6700\u597D\u662F\u7CBE\u786E\u7EDD\u5BF9\u65F6\u95F4] \u4E8E [\u5730\u70B9] [\u505A\u4E86\u67D0\u4E8B\uFF08\u53EF\u4EE5\u5305\u542B\u8D77\u56E0\u3001\u7ECF\u8FC7\u3001\u7ED3\u679C\uFF09]"\u3002
   - \u65F6\u95F4\u7EA6\u675F\uFF1A\u5C3D\u91CF\u57FA\u4E8E\u6D88\u606F\u7684 timestamp \u63A8\u7B97\u7EDD\u5BF9\u65F6\u95F4\uFF0C\u5982\u80FD\u786E\u5B9A\u5219\u5728 metadata \u4E2D\u8F93\u51FA activity_start_time \u548C activity_end_time\uFF08ISO 8601\u683C\u5F0F\uFF09\u3002\u65E0\u6CD5\u786E\u5B9A\u65F6\u53EF\u7701\u7565\u3002
   - \u6253\u5206 (priority)\uFF1A80-100\uFF08\u91CD\u8981\u4E8B\u4EF6/\u8BA1\u5212\uFF09\uFF1B60-70\uFF08\u4E00\u822C\u5B8C\u6574\u6D3B\u52A8\uFF09\uFF1B<60\uFF08\u7410\u788E\u4E8B\u9879\uFF0C\u76F4\u63A5\u4E22\u5F03\uFF09\u3002

3. \u5168\u5C40\u6307\u4EE4\u8BB0\u5FC6 (type: "instruction")
   - \u5B9A\u4E49\uFF1A\u7528\u6237\u5BF9 AI \u63D0\u51FA\u7684\u957F\u671F\u884C\u4E3A\u89C4\u5219\u3001\u683C\u5F0F\u504F\u597D\u3001\u8BED\u6C14\u63A7\u5236\u3002
   - \u63D0\u53D6\u53E5\u5F0F\uFF1A"\u7528\u6237\u8981\u6C42/\u5E0C\u671B AI \u4EE5\u540E\u56DE\u7B54\u65F6..."
   - \u89E6\u53D1\u8BCD\uFF1A\u4EE5\u540E\u90FD\u3001\u4ECE\u73B0\u5728\u5F00\u59CB\u3001\u8BB0\u4F4F\u3001\u5FC5\u987B\u3002
   - \u6253\u5206 (priority)\uFF1A-1\uFF08\u6781\u5176\u4E25\u683C\u7684\u5168\u5C40\u6B7B\u547D\u4EE4\uFF09\uFF1B90-100\uFF08\u6838\u5FC3\u884C\u4E3A\u89C4\u5219\uFF09\uFF1B70-80\uFF08\u91CD\u8981\u8981\u6C42\uFF09\uFF1B<70\uFF08\u4E34\u65F6\u8981\u6C42\uFF0C\u76F4\u63A5\u4E22\u5F03\uFF09\u3002

---

### \u4E0D\u5E94\u8BE5\u63D0\u53D6\u7684\u5185\u5BB9
- \u7410\u788E\u95F2\u804A\u3001\u95EE\u5019\uFF1B\u4E34\u65F6\u6027\u7684\u7EAF\u5DE5\u5177\u6027\u8BF7\u6C42\uFF08\u5982"\u8FD9\u6B21\u5E2E\u6211\u7FFB\u8BD1\u4E00\u4E0B"\uFF09
- \u4E00\u6B21\u6027\u64CD\u4F5C\u6307\u4EE4\uFF08\u5982"\u8FD9\u6B21\u3001\u672C\u5355"\u76F8\u5173\uFF09
- \u91CD\u590D\u7684\u5185\u5BB9\uFF1BAI\u52A9\u624B\u81EA\u8EAB\u7684\u884C\u4E3A\u6216\u8F93\u51FA
- \u4E0D\u5C5E\u4E8E\u4EE5\u4E0A3\u7C7B\u7684\u4FE1\u606F
- \u7EAF\u4E3B\u89C2\u611F\u53D7\uFF08\u4E0D\u5E26\u5BA2\u89C2\u4E8B\u4EF6\u7684\u60C5\u7EEA\u8868\u8FBE\uFF09

---

### \u4EFB\u52A1\u4E09\uFF1A\u8F93\u51FA\u683C\u5F0F\u89C4\u8303\uFF08JSON\uFF09
\u8FD4\u56DE\u4E14\u4EC5\u8FD4\u56DE\u4E00\u4E2A\u5408\u6CD5\u7684 JSON \u6570\u7EC4\u3002\u6570\u7EC4\u7684\u6BCF\u4E00\u9879\u662F\u4E00\u4E2A\u60C5\u5883\uFF0C\u5305\u542B\u8BE5\u60C5\u5883\u7684\u6D88\u606F\u8303\u56F4\u548C\u62BD\u53D6\u5230\u7684\u8BB0\u5FC6\uFF1A

[
  {
    "scene_name": "\u5F53\u524D\u751F\u6210\u6216\u7EE7\u627F\u7684\u60C5\u5883\u540D\u79F0",
    "message_ids": ["\u5C5E\u4E8E\u8BE5\u60C5\u5883\u7684\u6D88\u606FID\u5217\u8868"],
    "memories": [
      {
        "content": "\u5B8C\u6574\u3001\u72EC\u7ACB\u7684\u8BB0\u5FC6\u9648\u8FF0\uFF08\u6309\u5BF9\u5E94\u7C7B\u578B\u7684\u53E5\u5F0F\u8981\u6C42\uFF09",
        "type": "persona|episodic|instruction",
        "priority": 80,
        "source_message_ids": ["\u6D88\u606FID_1", "\u6D88\u606FID_2"],
        "metadata": {}
      }
    ]
  }
]

metadata \u5B57\u6BB5\u8BF4\u660E\uFF1A
- episodic \u7C7B\u578B\uFF1A\u5982\u80FD\u786E\u5B9A\u6D3B\u52A8\u65F6\u95F4\uFF0C\u586B\u5165 {"activity_start_time": "ISO8601", "activity_end_time": "ISO8601"}
- \u5176\u4ED6\u7C7B\u578B\u6216\u65E0\u6CD5\u786E\u5B9A\u65F6\u95F4\uFF1A\u8F93\u51FA\u7A7A\u5BF9\u8C61 {}

\u5982\u679C\u6574\u6BB5\u5BF9\u8BDD\u65E0\u6709\u610F\u4E49\u7684\u8BB0\u5FC6\uFF0C\u4E5F\u8981\u8F93\u51FA\u60C5\u5883\u5206\u5272\u7ED3\u679C\uFF0Cmemories \u4E3A\u7A7A\u6570\u7EC4\uFF1A
[
  {
    "scene_name": "\u60C5\u5883\u540D\u79F0",
    "message_ids": ["id1", "id2"],
    "memories": []
  }
]

\u8BF7\u4E25\u683C\u6309\u4E0A\u8FF0 JSON \u6570\u7EC4\u683C\u5F0F\u8F93\u51FA\uFF0C\u4E0D\u8981\u8F93\u51FA\u4EFB\u4F55\u989D\u5916\u7684 Markdown \u4EE3\u7801\u5757\u4FEE\u9970\u7B26\uFF08\u5982 \`\`\`json\uFF09\u6216\u89E3\u91CA\u6587\u672C\u3002`;
function formatExtractionPrompt(params) {
  const { newMessages, backgroundMessages = [], previousSceneName = "\u65E0" } = params;
  const bgText = backgroundMessages.length > 0 ? backgroundMessages.map((m) => `[${m.id}] [${m.role}] [${formatForLLM(m.timestamp)}]: ${m.content}`).join("\n\n") : "\u65E0";
  const newText = newMessages.map((m) => `[${m.id}] [${m.role}] [${formatForLLM(m.timestamp)}]: ${m.content}`).join("\n\n");
  return `**${describeTimeZoneForPrompt()}**

**\u8F93\u51FA\u8BED\u8A00**\uFF1A\u6839\u636E\u4E0B\u65B9"\u5F85\u63D0\u53D6\u7684\u65B0\u6D88\u606F"\u4E2D user \u53D1\u8A00\u7684\u4E3B\u5BFC\u8BED\u8A00\u4E66\u5199 \`scene_name\` \u548C memory \`content\`\u3002

\u3010\u4E0A\u4E00\u4E2A\u60C5\u5883\u3011\uFF1A${previousSceneName}

\u3010\u80CC\u666F\u5BF9\u8BDD\u3011\uFF08\u4EC5\u4F9B\u7406\u89E3\u4E0A\u4E0B\u6587\u63A8\u65AD\u5173\u7CFB/\u65F6\u95F4\uFF0C\u4E25\u7981\u4ECE\u4E2D\u63D0\u53D6\u8BB0\u5FC6\uFF09\uFF1A
${bgText}

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

\u3010\u5F85\u63D0\u53D6\u7684\u65B0\u6D88\u606F\u3011\uFF08\u52A1\u5FC5\u7ED3\u5408 timestamp \u63A8\u7B97\u65F6\u95F4\uFF0C\u53EA\u4ECE\u8FD9\u91CC\u63D0\u53D6\u8BB0\u5FC6\uFF01\uFF09\uFF1A
${newText}`;
}

// src/core/prompts/l1-dedup.ts
var CONFLICT_DETECTION_SYSTEM_PROMPT = `\u4F60\u662F\u8BB0\u5FC6\u51B2\u7A81\u68C0\u6D4B\u5668\u3002\u6279\u91CF\u6BD4\u8F83\u591A\u6761\u3010\u65B0\u8BB0\u5FC6\u3011\u4E0E\u3010\u7EDF\u4E00\u5019\u9009\u8BB0\u5FC6\u6C60\u3011\u4E2D\u7684\u5DF2\u6709\u8BB0\u5FC6\uFF0C\u9010\u6761\u51B3\u5B9A\u5982\u4F55\u5904\u7406\u3002

**\u8F93\u51FA\u8BED\u8A00**\uFF1A\`merged_content\` \u4F7F\u7528\u4E0E\u5019\u9009\u6C60\u4E2D\u5DF2\u6709\u8BB0\u5FC6\u76F8\u540C\u7684\u8BED\u8A00\uFF1BJSON \u5B57\u6BB5\u540D\u3001\u679A\u4E3E\u503C\u3001record_id\u3001ISO \u65F6\u95F4\u6233\u4FDD\u6301\u82F1\u6587\u3002

## \u6838\u5FC3\u89C4\u5219

- **\u8DE8 type \u5408\u5E76**\uFF1A\u4E0D\u540C type\uFF08persona / episodic / instruction\uFF09\u7684\u8BB0\u5FC6\u5982\u679C\u8BED\u4E49\u4E0A\u63CF\u8FF0\u540C\u4E00\u4E8B\u5B9E/\u4E8B\u4EF6\uFF0C**\u53EF\u4EE5\u5408\u5E76**\u3002
- **\u591A\u5BF9\u591A\u5408\u5E76**\uFF1A\u4E00\u6761\u65B0\u8BB0\u5FC6\u53EF\u4EE5\u540C\u65F6\u66FF\u6362/\u5408\u5E76\u5019\u9009\u6C60\u4E2D\u7684**\u591A\u6761**\u5DF2\u6709\u8BB0\u5FC6\uFF08\u901A\u8FC7 target_ids \u6570\u7EC4\u6307\u5B9A\uFF09\u3002
- \u5408\u5E76\u540E\u4F60\u5FC5\u987B\u5224\u65AD\u65B0\u8BB0\u5FC6\u7684\u6700\u4F73 type\uFF08merged_type\uFF09\u3002

## \u5224\u65AD\u903B\u8F91

1. **\u5206\u8FA8\u8BB0\u5FC6\u6027\u8D28**\uFF1A
   - **\u72B6\u6001\u7C7B**\uFF08persona/instruction\uFF09\uFF1A\u504F\u597D\u3001\u7279\u8D28\u3001\u957F\u671F\u8BBE\u5B9A\u3001\u76F8\u5BF9\u7A33\u5B9A\u7684\u4E8B\u5B9E\u3001\u884C\u4E3A\u89C4\u5219
   - **\u4E8B\u4EF6\u7C7B**\uFF08episodic\uFF09\uFF1A\u4E00\u6B21\u6027\u7ECF\u5386\u3001\u5E26\u65F6\u95F4\u70B9\u7684\u5BA2\u89C2\u8BB0\u5F55\uFF0C\u5EFA\u8BAE\u5408\u5E76\u540C\u4E00\u4EF6\u4E8B\u7684\u524D\u56E0\u540E\u679C

2. **\u5224\u65AD\u662F\u5426\u540C\u4E00\u4E8B\u5B9E/\u4E8B\u4EF6**\uFF1A\u4E3B\u4F53\u76F8\u540C\u3001\u4E3B\u9898\u4E00\u81F4\u3001\u65F6\u95F4\u63A5\u8FD1\u3001scene_name \u76F8\u4F3C

3. **\u9009\u62E9\u52A8\u4F5C**\uFF1A
   - "store"\uFF1A\u89C6\u4E3A\u65B0\u4FE1\u606F\uFF0C\u65B0\u589E\u5F53\u524D\u8BB0\u5FC6\u3002
   - "skip"\uFF1A\u5DF2\u6709\u8BB0\u5FC6\u66F4\u597D\uFF0C\u65B0\u8BB0\u5FC6\u65E0\u589E\u91CF\u6216\u66F4\u6A21\u7CCA\uFF0C\u5FFD\u7565\u5F53\u524D\u8BB0\u5FC6\u3002
   - "update"\uFF1A\u540C\u4E00\u4E8B\u5B9E/\u4E8B\u4EF6\uFF0C\u65B0\u8BB0\u5FC6\u5728\u5185\u5BB9\u6216\u65F6\u95F4\u4E0A\u66F4\u4F18\uFF08\u66F4\u5177\u4F53\u3001\u66F4\u665A\u6216\u7EA0\u9519\uFF09\uFF0C\u4EE5\u65B0\u8BB0\u5FC6\u4E3A\u4E3B\u8986\u76D6\u65E7\u8BB0\u5FC6\uFF0C\u53EF\u4FDD\u7559\u65E7\u8BB0\u5FC6\u4E2D\u4ECD\u6B63\u786E\u7684\u7EC6\u8282\u3002
   - "merge"\uFF1A\u540C\u4E00\u4E8B\u5B9E\u6216\u540C\u4E00\u6F14\u5316\u8FC7\u7A0B\uFF0C\u591A\u6761\u8BB0\u5FC6\u4FE1\u606F\u4E92\u8865\u4E14\u4E0D\u77DB\u76FE\uFF0C\u5408\u5E76\u6210\u4E00\u6761\u66F4\u5B8C\u6574\u8BB0\u5FC6\uFF0C\u4FE1\u606F\u5C3D\u91CF\u4E0D\u5197\u4F59\u3002

4. **\u7B56\u7565\u503E\u5411**\uFF1A
   - \u72B6\u6001\u7C7B\uFF1A\u591A\u6761\u63CF\u8FF0\u540C\u4E00\u504F\u597D/\u7279\u8D28 \u2192 \u503E\u5411 merge\uFF1B\u65E0\u589E\u91CF \u2192 skip\uFF1B\u660E\u786E\u66F4\u65B0 \u2192 update
   - \u4E8B\u4EF6\u7C7B\uFF1A\u540C\u4E00\u4E8B\u4EF6\u7684\u524D\u56E0\u540E\u679C\u3001\u4E0D\u540C\u9636\u6BB5 \u2192 \u503E\u5411 merge \u4E3A\u4E00\u6761\u5B8C\u6574\u53D9\u8FF0\uFF1B\u5B8C\u5168\u76F8\u540C \u2192 skip
   - \u8DE8\u7C7B\u578B\u793A\u4F8B\uFF1A\u4E00\u6761 episodic "\u7528\u6237\u5728 2018 \u5E74\u5F00\u59CB\u505A\u64AD\u5BA2" + \u4E00\u6761 persona "\u7528\u6237\u6709\u64AD\u5BA2\u5236\u4F5C\u7ECF\u9A8C" \u2192 \u53EF merge \u4E3A\u4E00\u6761 persona \u6216 episodic\uFF08\u53D6\u51B3\u4E8E\u4FE1\u606F\u4FA7\u91CD\uFF09

5. **timestamp \u5904\u7406**\uFF1A
   - merge / update \u65F6\uFF0Cmerged_timestamps \u5E94\u5305\u542B**\u6240\u6709\u76F8\u5173\u8BB0\u5FC6\u7684\u65F6\u95F4\u6233\u5E76\u96C6**\uFF08\u53BB\u91CD\u6392\u5E8F\uFF09
   - \u8FD9\u6837\u53EF\u4EE5\u4FDD\u7559\u4E8B\u4EF6\u53D1\u751F\u7684\u5B8C\u6574\u65F6\u95F4\u7EBF

## \u8F93\u51FA\u683C\u5F0F

\u4E25\u683C\u8F93\u51FA JSON \u6570\u7EC4\uFF0C\u6BCF\u4E2A\u5143\u7D20\u5BF9\u5E94\u4E00\u6761\u65B0\u8BB0\u5FC6\u7684\u51B3\u7B56\u3002\u4E0D\u8F93\u51FA\u4EFB\u4F55\u5176\u4ED6\u5185\u5BB9\uFF1A

[
  {
    "record_id": "\u65B0\u8BB0\u5FC6\u7684 record_id",
    "action": "store|update|skip|merge",
    "target_ids": ["\u8981\u5220\u9664\u7684\u5019\u9009\u8BB0\u5FC6 record_id 1", "record_id 2"],
    "merged_content": "\u5408\u5E76/\u66F4\u65B0\u540E\u7684\u8BB0\u5FC6\u5185\u5BB9\uFF08merge/update \u65F6\u5FC5\u586B\uFF09",
    "merged_type": "\u5408\u5E76\u540E\u7684\u6700\u4F73 type\uFF1Apersona|episodic|instruction\uFF08merge/update \u65F6\u5FC5\u586B\uFF09",
    "merged_priority": 85,
    "merged_timestamps": ["\u5408\u5E76\u540E\u7684\u65F6\u95F4\u6233\u6570\u7EC4\uFF0C\u5305\u542B\u6240\u6709\u65B0\u65E7\u8BB0\u5FC6\u65F6\u95F4\u6233\u7684\u5E76\u96C6\uFF08merge/update \u65F6\u5FC5\u586B\uFF09"]
  }
]

\u5B57\u6BB5\u8BF4\u660E\uFF1A
- target_ids\uFF1A\u8981\u5220\u9664\u66FF\u6362\u7684\u65E7\u8BB0\u5FC6 ID **\u6570\u7EC4**\uFF08\u53EF\u4EE5 1 \u6761\u6216\u591A\u6761\uFF09\u3002store/skip \u65F6\u7701\u7565\u6216\u4E3A\u7A7A\u3002
- merged_content\uFF1Amerge/update \u65F6\u7684\u6700\u7EC8\u8BB0\u5FC6\u6587\u672C\u3002store/skip \u65F6\u7701\u7565\u3002
- merged_type\uFF1Amerge/update \u540E\u8BB0\u5FC6\u5E94\u5F52\u5C5E\u7684 type\u3002\u6839\u636E\u5408\u5E76\u540E\u5185\u5BB9\u672C\u8D28\u5224\u65AD\u3002
- merged_priority\uFF1Amerge/update \u540E\u7684\u65B0\u4F18\u5148\u7EA7\uFF080-100 \u6574\u6570\uFF0Cmerge/update \u65F6\u5FC5\u586B\uFF09\u3002\u5408\u5E76\u540E\u4FE1\u606F\u66F4\u5B8C\u6574\u3001\u66F4\u786E\u5B9A\uFF0C\u901A\u5E38\u5E94**\u914C\u60C5\u63D0\u5347** priority\uFF08\u4F8B\u5982\u4E24\u6761 priority 70 \u7684\u8BB0\u5FC6\u5408\u5E76\u540E\u53EF\u63D0\u5347\u5230 80\uFF09\u3002\u53C2\u8003\u6807\u51C6\uFF1A80-100\uFF08\u6838\u5FC3\u7279\u8D28/\u91CD\u8981\u4E8B\u4EF6\uFF09\uFF0C60-79\uFF08\u4E00\u822C\u504F\u597D/\u666E\u901A\u6D3B\u52A8\uFF09\uFF0C<60\uFF08\u6B21\u8981\u4FE1\u606F\uFF09\u3002
- merged_timestamps\uFF1A\u5408\u5E76\u540E\u7684\u65F6\u95F4\u6233\u6570\u7EC4\u3002\u6536\u96C6\u65B0\u8BB0\u5FC6 + \u6240\u6709\u88AB\u5408\u5E76\u65E7\u8BB0\u5FC6\u7684\u65F6\u95F4\u6233\uFF0C\u53BB\u91CD\u6392\u5E8F\u3002`;
function formatBatchConflictPrompt(matches) {
  const unifiedPool = /* @__PURE__ */ new Map();
  const perMemoryCandidateIds = /* @__PURE__ */ new Map();
  for (const m of matches) {
    const candidateIds = [];
    for (const c of m.candidates) {
      if (!unifiedPool.has(c.id)) {
        unifiedPool.set(c.id, c);
      }
      candidateIds.push(c.id);
    }
    perMemoryCandidateIds.set(m.newMemory.record_id, candidateIds);
  }
  const poolList = Array.from(unifiedPool.values()).map((c) => ({
    record_id: c.id,
    content: c.content,
    type: c.type,
    priority: c.priority,
    scene_name: c.scene_name,
    timestamps: c.timestamps
  }));
  let poolSection;
  if (poolList.length === 0) {
    poolSection = "## \u7EDF\u4E00\u5019\u9009\u8BB0\u5FC6\u6C60\n\n\uFF08\u7A7A\uFF0C\u6CA1\u6709\u5DF2\u6709\u8BB0\u5FC6\uFF0C\u6240\u6709\u65B0\u8BB0\u5FC6\u76F4\u63A5 store\uFF09";
  } else {
    const poolStr = JSON.stringify(poolList, null, 2);
    poolSection = `## \u7EDF\u4E00\u5019\u9009\u8BB0\u5FC6\u6C60\uFF08\u5171 ${poolList.length} \u6761\u5DF2\u6709\u8BB0\u5FC6\uFF09

${poolStr}`;
  }
  const memoryParts = matches.map((m, idx) => {
    const relatedIds = perMemoryCandidateIds.get(m.newMemory.record_id) ?? [];
    const relatedNote = relatedIds.length > 0 ? JSON.stringify(relatedIds) : "[]\uFF08\u65E0\u76F8\u4F3C\u5019\u9009\uFF0C\u76F4\u63A5 store\uFF09";
    const memStr = JSON.stringify(
      {
        record_id: m.newMemory.record_id,
        content: m.newMemory.content,
        type: m.newMemory.type,
        priority: m.newMemory.priority,
        scene_name: m.newMemory.scene_name
      },
      null,
      2
    );
    return `### \u7B2C ${idx + 1} \u6761\u65B0\u8BB0\u5FC6 (record_id: ${m.newMemory.record_id})
${memStr}

\u3010\u5173\u8054\u5019\u9009 ID\u3011${relatedNote}`;
  });
  const newMemoriesText = memoryParts.join(
    "\n\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n"
  );
  return `**\u8F93\u51FA\u8BED\u8A00**\uFF1A\`merged_content\` \u4F7F\u7528\u4E0E\u5019\u9009\u6C60\u4E2D\u5DF2\u6709\u8BB0\u5FC6\u76F8\u540C\u7684\u8BED\u8A00\u3002

${poolSection}

${"\u2550".repeat(50)}

## \u5F85\u5224\u65AD\u7684\u65B0\u8BB0\u5FC6\uFF08\u5171 ${matches.length} \u6761\uFF09

${newMemoriesText}

\u8BF7\u9010\u6761\u5224\u65AD\u5E76\u8F93\u51FA\u51B3\u7B56 JSON \u6570\u7EC4\u3002\u5F53\u67D0\u6761\u65B0\u8BB0\u5FC6\u7684\u5019\u9009\u5217\u8868\u4E3A\u7A7A\u65F6\uFF0C\u8BE5\u6761\u76F4\u63A5\u8F93\u51FA action=store\u3002`;
}

// src/core/record/l1-dedup.ts
var TAG8 = "[memory-tdai][l1-dedup]";
async function batchDedup(params) {
  const { memories, config, logger, model, vectorStore, embeddingService, llmRunner } = params;
  const topK = params.conflictRecallTopK ?? 5;
  if (memories.length === 0) {
    return [];
  }
  const storeAll = () => memories.map((m) => ({
    record_id: m.record_id,
    action: "store",
    target_ids: []
  }));
  const hasVectorData = vectorStore && await vectorStore.countL1() > 0;
  const hasFts = vectorStore?.isFtsAvailable() ?? false;
  if (!hasVectorData && !hasFts) {
    logger?.debug?.(`${TAG8} No vector data and no FTS available, skipping conflict detection for ${memories.length} memories`);
    return storeAll();
  }
  let matches;
  if (hasVectorData && embeddingService) {
    logger?.debug?.(`${TAG8} Using vector recall mode (topK=${topK})`);
    try {
      matches = await findCandidatesByVector(memories, vectorStore, embeddingService, topK, logger, params.embeddingTimeoutMs);
    } catch (err) {
      logger?.warn?.(
        `${TAG8} Vector recall failed, falling back to FTS keyword: ${err instanceof Error ? err.message : String(err)}`
      );
      if (hasFts) {
        matches = await findCandidatesByFts(memories, vectorStore, logger);
      } else {
        logger?.debug?.(`${TAG8} FTS not available either, skipping conflict detection`);
        return storeAll();
      }
    }
  } else if (hasFts) {
    logger?.debug?.(`${TAG8} Using FTS keyword recall mode (no embedding service or no vector data)`);
    matches = await findCandidatesByFts(memories, vectorStore, logger);
  } else {
    logger?.debug?.(`${TAG8} No usable recall path, skipping conflict detection`);
    return storeAll();
  }
  const hasAnyCandidates = matches.some((m) => m.candidates.length > 0);
  if (!hasAnyCandidates) {
    logger?.debug?.(`${TAG8} No similar records found for any memory, all will be stored`);
    return storeAll();
  }
  return runLlmJudgment(matches, memories, config, logger, model, llmRunner);
}
async function runLlmJudgment(matches, memories, config, logger, model, llmRunner) {
  logger?.debug?.(`${TAG8} Running batch conflict detection for ${memories.length} memories`);
  try {
    const userPrompt = formatBatchConflictPrompt(matches);
    let result;
    if (llmRunner) {
      result = await llmRunner.run({
        prompt: userPrompt,
        systemPrompt: CONFLICT_DETECTION_SYSTEM_PROMPT,
        taskId: "l1-conflict-detection",
        timeoutMs: 18e4
      });
    } else {
      throw new Error(`${TAG8} No LLM runner available for L1 dedup (host must inject one)`);
    }
    const decisions = parseBatchResult(result, memories, logger);
    return decisions;
  } catch (err) {
    logger?.warn?.(
      `${TAG8} Batch conflict detection failed, defaulting all to store: ${err instanceof Error ? err.message : String(err)}`
    );
    return memories.map((m) => ({
      record_id: m.record_id,
      action: "store",
      target_ids: []
    }));
  }
}
async function findCandidatesByVector(memories, vectorStore, embeddingService, topK, logger, embeddingTimeoutMs) {
  const newRecordIds = new Set(memories.map((m) => m.record_id));
  const texts = memories.map((m) => m.content);
  const embeddings = await embeddingService.embedBatch(texts, embeddingTimeoutMs ? { timeoutMs: embeddingTimeoutMs } : void 0);
  const matches = [];
  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    const queryVec = embeddings[i];
    const searchResults = await vectorStore.searchL1Vector(queryVec, topK + memories.length, mem.content);
    const candidates = searchResults.filter((r) => !newRecordIds.has(r.record_id)).slice(0, topK).map((r) => ({
      id: r.record_id,
      content: r.content,
      type: r.type,
      priority: r.priority,
      scene_name: r.scene_name,
      source_message_ids: [],
      metadata: {},
      timestamps: [r.timestamp_str].filter(Boolean),
      createdAt: "",
      updatedAt: "",
      sessionKey: r.session_key,
      sessionId: r.session_id
    }));
    matches.push({ newMemory: mem, candidates });
  }
  logger?.debug?.(
    `${TAG8} Vector recall: ${matches.map((m) => `${m.newMemory.record_id}\u2192${m.candidates.length}`).join(", ")}`
  );
  return matches;
}
async function findCandidatesByFts(memories, vectorStore, _logger) {
  const newRecordIds = new Set(memories.map((m) => m.record_id));
  const matches = [];
  for (const mem of memories) {
    const ftsQuery = buildFtsQuery(mem.content);
    if (ftsQuery) {
      const ftsResults = await vectorStore.searchL1Fts(ftsQuery, 10);
      const candidates = ftsResults.filter((r) => !newRecordIds.has(r.record_id)).slice(0, 5).map((r) => ({
        id: r.record_id,
        content: r.content,
        type: r.type,
        priority: r.priority,
        scene_name: r.scene_name,
        source_message_ids: [],
        metadata: r.metadata_json ? (() => {
          try {
            return JSON.parse(r.metadata_json);
          } catch {
            return {};
          }
        })() : {},
        timestamps: [r.timestamp_str].filter(Boolean),
        createdAt: "",
        updatedAt: "",
        sessionKey: r.session_key,
        sessionId: r.session_id
      }));
      matches.push({ newMemory: mem, candidates });
    } else {
      matches.push({ newMemory: mem, candidates: [] });
    }
  }
  _logger?.debug?.(`${TAG8} FTS keyword recall: ${matches.map((m) => `${m.newMemory.record_id}\u2192${m.candidates.length}`).join(", ")}`);
  return matches;
}
var VALID_TYPES = ["persona", "episodic", "instruction"];
function parseBatchResult(raw, memories, logger) {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      logger?.warn?.(`${TAG8} No JSON array found in conflict detection response`);
      return fallbackStoreAll(memories);
    }
    const sanitized = sanitizeJsonForParse(arrayMatch[0]);
    const parsed = JSON.parse(sanitized);
    if (!Array.isArray(parsed)) {
      logger?.warn?.(`${TAG8} Conflict detection response is not an array`);
      return fallbackStoreAll(memories);
    }
    const decisions = [];
    const validActions = ["store", "update", "merge", "skip"];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const d = item;
      const recordId = String(d.record_id ?? "");
      if (!recordId) {
        logger?.debug?.(`${TAG8} Skipping decision with empty record_id`);
        continue;
      }
      const action = String(d.action ?? "store");
      if (!validActions.includes(action)) {
        logger?.warn?.(`${TAG8} Invalid action "${action}" for record ${recordId}, defaulting to store`);
      }
      decisions.push({
        record_id: recordId,
        action: validActions.includes(action) ? action : "store",
        target_ids: Array.isArray(d.target_ids) ? d.target_ids.map(String) : [],
        merged_content: typeof d.merged_content === "string" ? d.merged_content : void 0,
        merged_type: VALID_TYPES.includes(d.merged_type) ? d.merged_type : void 0,
        merged_priority: typeof d.merged_priority === "number" ? d.merged_priority : void 0,
        merged_timestamps: Array.isArray(d.merged_timestamps) ? d.merged_timestamps.map(String) : void 0
      });
    }
    const decidedIds = new Set(decisions.map((d) => d.record_id));
    for (const mem of memories) {
      if (!decidedIds.has(mem.record_id)) {
        logger?.debug?.(`${TAG8} No decision for record ${mem.record_id}, defaulting to store`);
        decisions.push({
          record_id: mem.record_id,
          action: "store",
          target_ids: []
        });
      }
    }
    return decisions;
  } catch (err) {
    logger?.warn?.(`${TAG8} Failed to parse conflict detection result: ${err instanceof Error ? err.message : String(err)}`);
    return fallbackStoreAll(memories);
  }
}
function fallbackStoreAll(memories) {
  return memories.map((m) => ({
    record_id: m.record_id,
    action: "store",
    target_ids: []
  }));
}

// src/core/record/l1-writer.ts
import fs5 from "node:fs/promises";
import path6 from "node:path";
import crypto3 from "node:crypto";
var TAG9 = "[memory-tdai][l1-writer]";
function generateMemoryId() {
  return `m_${Date.now()}_${crypto3.randomBytes(4).toString("hex")}`;
}
async function writeMemory(params) {
  const { memory, decision, baseDir, sessionKey, sessionId, logger, vectorStore, embeddingService } = params;
  if (decision.action === "skip") {
    logger?.debug?.(`${TAG9} Skipping memory: ${memory.content.slice(0, 50)}...`);
    return null;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let finalContent;
  let finalType;
  let finalPriority;
  let finalTimestamps;
  if (decision.action === "merge" || decision.action === "update") {
    finalContent = decision.merged_content ?? memory.content;
    finalType = decision.merged_type ?? memory.type;
    finalPriority = decision.merged_priority ?? memory.priority;
    finalTimestamps = decision.merged_timestamps ?? [now];
  } else {
    finalContent = memory.content;
    finalType = memory.type;
    finalPriority = memory.priority;
    finalTimestamps = [now];
  }
  const record = {
    id: decision.record_id || generateMemoryId(),
    content: finalContent,
    type: finalType,
    priority: finalPriority,
    scene_name: memory.scene_name,
    source_message_ids: memory.source_message_ids,
    metadata: memory.metadata,
    timestamps: finalTimestamps,
    createdAt: now,
    updatedAt: now,
    sessionKey,
    sessionId: sessionId || ""
  };
  const recordsDir = path6.join(baseDir, "records");
  await fs5.mkdir(recordsDir, { recursive: true });
  const shardDate = formatLocalDate(/* @__PURE__ */ new Date());
  const filePath = path6.join(recordsDir, `${shardDate}.jsonl`);
  if ((decision.action === "update" || decision.action === "merge") && decision.target_ids.length > 0) {
    if (vectorStore) {
      try {
        await vectorStore.deleteL1Batch(decision.target_ids);
        logger?.debug?.(`${TAG9} VectorStore: deleted ${decision.target_ids.length} target record(s) for ${decision.action}`);
      } catch (err) {
        logger?.warn?.(
          `${TAG9} VectorStore delete failed for ${decision.action}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    await fs5.appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
    logger?.debug?.(`${TAG9} ${decision.action} memory: removed [${decision.target_ids.join(",")}] from VectorStore \u2192 ${record.id}: ${finalContent.slice(0, 80)}...`);
  } else {
    await fs5.appendFile(filePath, JSON.stringify(record) + "\n", "utf-8");
    logger?.debug?.(`${TAG9} Stored memory ${record.id}: ${finalContent.slice(0, 80)}...`);
  }
  if (vectorStore) {
    try {
      logger?.debug?.(
        `${TAG9} [vec-dual-write] START id=${record.id}, contentLen=${record.content.length}, content="${record.content.slice(0, 80)}..."`
      );
      let embedding;
      if (embeddingService) {
        try {
          embedding = await embeddingService.embed(record.content);
          logger?.debug?.(
            `${TAG9} [vec-dual-write] Embedding OK: dims=${embedding.length}, norm=${Math.sqrt(Array.from(embedding).reduce((s, v) => s + v * v, 0)).toFixed(4)}`
          );
        } catch (embedErr) {
          logger?.warn(
            `${TAG9} [vec-dual-write] Embedding FAILED for id=${record.id}, will write metadata only: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`
          );
        }
      }
      const upsertOk = await vectorStore.upsertL1(record, embedding);
      logger?.debug?.(`${TAG9} [vec-dual-write] upsert result=${upsertOk} id=${record.id}`);
    } catch (err) {
      logger?.warn?.(
        `${TAG9} [vec-dual-write] FAILED (JSONL already written) id=${record.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    logger?.debug?.(
      `${TAG9} [vec-dual-write] SKIPPED id=${record.id}: vectorStore=${!!vectorStore}`
    );
  }
  return record;
}

// src/core/record/l1-extractor.ts
var TAG10 = "[memory-tdai][l1-extractor]";
async function extractL1Memories(params) {
  const { messages, sessionKey, sessionId, baseDir, config, logger, instanceId: metricInstanceId } = params;
  const options = params.options ?? {};
  const maxNewMessages = options.maxMessagesPerExtraction ?? 10;
  const maxBgMessages = options.maxBackgroundMessages ?? 5;
  const enableDedup = options.enableDedup ?? true;
  const maxMemoriesPerSession = options.maxMemoriesPerSession ?? 10;
  if (messages.length === 0) {
    logger?.debug?.(`${TAG10} No messages to extract from`);
    return { success: true, extractedCount: 0, storedCount: 0, records: [], sceneNames: [] };
  }
  const l1StartMs = Date.now();
  const qualifiedMessages = messages.filter((m) => shouldExtractL1(m.content));
  if (qualifiedMessages.length < messages.length) {
    logger?.debug?.(
      `${TAG10} L1 quality filter: ${messages.length} \u2192 ${qualifiedMessages.length} messages (${messages.length - qualifiedMessages.length} filtered out)`
    );
  }
  if (qualifiedMessages.length === 0) {
    logger?.debug?.(`${TAG10} All messages filtered out by L1 quality gate`);
    return { success: true, extractedCount: 0, storedCount: 0, records: [], sceneNames: [] };
  }
  const newMessages = qualifiedMessages.slice(-maxNewMessages);
  const bgEndIdx = qualifiedMessages.length - newMessages.length;
  const backgroundMessages = bgEndIdx > 0 ? qualifiedMessages.slice(Math.max(0, bgEndIdx - maxBgMessages), bgEndIdx) : [];
  logger?.debug?.(`${TAG10} Extracting from ${newMessages.length} new messages (+ ${backgroundMessages.length} background) [${qualifiedMessages.length} qualified from ${messages.length} input]`);
  let scenes;
  try {
    scenes = await callLlmExtraction({
      newMessages,
      backgroundMessages,
      previousSceneName: options.previousSceneName,
      config,
      logger,
      model: options.model,
      llmRunner: options.llmRunner
    });
    logger?.debug?.(`${TAG10} LLM detected ${scenes.length} scene(s)`);
  } catch (err) {
    logger?.error(`${TAG10} LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, extractedCount: 0, storedCount: 0, records: [], sceneNames: [] };
  }
  const allExtracted = [];
  const sceneNames = [];
  for (const scene of scenes) {
    sceneNames.push(scene.scene_name);
    for (const mem of scene.memories) {
      const memType = normalizeType(mem.type);
      if (!memType) {
        logger?.warn?.(`${TAG10} Skipping memory with invalid type "${mem.type}"`);
        continue;
      }
      allExtracted.push({
        content: mem.content,
        type: memType,
        priority: typeof mem.priority === "number" ? mem.priority : 50,
        source_message_ids: Array.isArray(mem.source_message_ids) ? mem.source_message_ids : [],
        metadata: mem.metadata ?? {},
        scene_name: scene.scene_name
      });
    }
  }
  logger?.debug?.(`${TAG10} Total extracted memories: ${allExtracted.length} across ${scenes.length} scene(s)`);
  if (allExtracted.length === 0) {
    return {
      success: true,
      extractedCount: 0,
      storedCount: 0,
      records: [],
      sceneNames,
      lastSceneName: sceneNames[sceneNames.length - 1]
    };
  }
  let extracted = allExtracted;
  if (extracted.length > maxMemoriesPerSession) {
    logger?.debug?.(`${TAG10} Limiting from ${extracted.length} to ${maxMemoriesPerSession} memories per session`);
    extracted = extracted.slice(0, maxMemoriesPerSession);
  }
  const memoriesWithIds = extracted.map((m) => ({
    ...m,
    record_id: generateMemoryId()
  }));
  let storedRecords;
  if (enableDedup) {
    try {
      const decisions = await batchDedup({
        memories: memoriesWithIds,
        config,
        logger,
        model: options.model,
        vectorStore: options.vectorStore,
        embeddingService: options.embeddingService,
        conflictRecallTopK: options.conflictRecallTopK,
        embeddingTimeoutMs: options.embeddingTimeoutMs,
        llmRunner: options.llmRunner
      });
      storedRecords = await applyDecisions({
        memoriesWithIds,
        decisions,
        baseDir,
        sessionKey,
        sessionId,
        logger,
        vectorStore: options.vectorStore,
        embeddingService: options.embeddingService
      });
    } catch (err) {
      logger?.warn?.(`${TAG10} Batch dedup failed, storing all as new: ${err instanceof Error ? err.message : String(err)}`);
      storedRecords = await storeAllDirectly(memoriesWithIds, baseDir, sessionKey, sessionId, logger, options.vectorStore, options.embeddingService);
    }
  } else {
    storedRecords = await storeAllDirectly(memoriesWithIds, baseDir, sessionKey, sessionId, logger, options.vectorStore, options.embeddingService);
  }
  logger?.info(`${TAG10} Extraction complete: extracted=${extracted.length}, stored=${storedRecords.length}`);
  if (metricInstanceId && logger) {
    const memoriesByType = {};
    for (const r of storedRecords) {
      memoriesByType[r.type] = (memoriesByType[r.type] ?? 0) + 1;
    }
    report("l1_extraction", {
      sessionKey,
      inputMessageCount: messages.length,
      memoriesExtracted: extracted.length,
      memoriesStored: storedRecords.length,
      memoriesStoredContent: storedRecords.map((r) => ({
        content: r.content,
        type: r.type,
        scene: r.scene_name ?? null
      })),
      memoriesByType,
      totalDurationMs: Date.now() - l1StartMs,
      success: true,
      error: null
    });
  }
  return {
    success: true,
    extractedCount: extracted.length,
    storedCount: storedRecords.length,
    records: storedRecords,
    sceneNames,
    lastSceneName: sceneNames[sceneNames.length - 1]
  };
}
async function callLlmExtraction(params) {
  const { newMessages, backgroundMessages, previousSceneName, config, logger, model, llmRunner } = params;
  const userPrompt = formatExtractionPrompt({
    newMessages,
    backgroundMessages,
    previousSceneName
  });
  logger?.debug?.(
    `${TAG10} [l1-debug] ENTRY taskId=l1-extraction, newMsgs=${newMessages.length}, bgMsgs=${backgroundMessages.length}, userPromptLen=${userPrompt.length}, sysPromptLen=${EXTRACT_MEMORIES_SYSTEM_PROMPT.length}, model=${model ?? "(default)"}, previousSceneName=${previousSceneName ? JSON.stringify(previousSceneName) : "(none)"}, runnerKind=${llmRunner ? "llmRunner" : "CleanContextRunner"}`
  );
  let result;
  if (llmRunner) {
    result = await llmRunner.run({
      prompt: userPrompt,
      systemPrompt: EXTRACT_MEMORIES_SYSTEM_PROMPT,
      taskId: "l1-extraction",
      timeoutMs: 18e4
    });
  } else {
    throw new Error(`${TAG10} No LLM runner available for L1 extraction (host must inject one)`);
  }
  return parseExtractionResult(result, logger);
}
function parseExtractionResult(raw, logger) {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      logger?.warn?.(`${TAG10} No JSON array found in extraction response`);
      const rawPreview = raw.slice(0, 2048);
      logger?.warn?.(
        `${TAG10} [l1-debug] NO_JSON taskId=l1-extraction, rawLen=${raw.length}, cleanedLen=${cleaned.length}, rawFull=${JSON.stringify(rawPreview)}${raw.length > 2048 ? `\u2026(+${raw.length - 2048})` : ""}`
      );
      return [];
    }
    const sanitized = sanitizeJsonForParse(arrayMatch[0]);
    const parsed = JSON.parse(sanitized);
    if (!Array.isArray(parsed)) {
      logger?.warn?.(`${TAG10} Extraction response is not an array`);
      return [];
    }
    const scenes = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const s = item;
      scenes.push({
        scene_name: typeof s.scene_name === "string" ? s.scene_name : "\u672A\u77E5\u60C5\u5883",
        message_ids: Array.isArray(s.message_ids) ? s.message_ids.map(String) : [],
        memories: Array.isArray(s.memories) ? s.memories.filter((m) => m && typeof m === "object" && typeof m.content === "string" && m.content.length > 0).map((m) => ({
          content: String(m.content),
          type: String(m.type ?? "episodic"),
          priority: typeof m.priority === "number" ? m.priority : 50,
          source_message_ids: Array.isArray(m.source_message_ids) ? m.source_message_ids.map(String) : [],
          metadata: m.metadata && typeof m.metadata === "object" ? m.metadata : {}
        })) : []
      });
    }
    return scenes;
  } catch (err) {
    logger?.warn?.(`${TAG10} Failed to parse extraction result: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
async function applyDecisions(params) {
  const { memoriesWithIds, decisions, baseDir, sessionKey, sessionId, logger, vectorStore, embeddingService } = params;
  const storedRecords = [];
  const decisionMap = /* @__PURE__ */ new Map();
  for (const d of decisions) {
    decisionMap.set(d.record_id, d);
  }
  for (const memoryWithId of memoriesWithIds) {
    const decision = decisionMap.get(memoryWithId.record_id) ?? {
      record_id: memoryWithId.record_id,
      action: "store",
      target_ids: []
    };
    try {
      const record = await writeMemory({
        memory: memoryWithId,
        decision,
        baseDir,
        sessionKey,
        sessionId,
        logger,
        vectorStore,
        embeddingService
      });
      if (record) {
        storedRecords.push(record);
      }
    } catch (err) {
      logger?.warn?.(
        `${TAG10} Write failed for memory "${memoryWithId.content.slice(0, 50)}...": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return storedRecords;
}
async function storeAllDirectly(memoriesWithIds, baseDir, sessionKey, sessionId, logger, vectorStore, embeddingService) {
  const storedRecords = [];
  for (const memoryWithId of memoriesWithIds) {
    try {
      const record = await writeMemory({
        memory: memoryWithId,
        decision: {
          record_id: memoryWithId.record_id,
          action: "store",
          target_ids: []
        },
        baseDir,
        sessionKey,
        sessionId,
        logger,
        vectorStore,
        embeddingService
      });
      if (record) {
        storedRecords.push(record);
      }
    } catch (err) {
      logger?.warn?.(
        `${TAG10} Write failed for memory "${memoryWithId.content.slice(0, 50)}...": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return storedRecords;
}
var VALID_TYPES2 = ["persona", "episodic", "instruction"];
function normalizeType(raw) {
  const lower = raw.toLowerCase().trim();
  if (VALID_TYPES2.includes(lower)) {
    return lower;
  }
  if (lower === "episode") return "episodic";
  if (lower === "instruct") return "instruction";
  if (lower === "preference") return "persona";
  return null;
}

// src/core/store/factory.ts
import path7 from "node:path";

// src/core/store/tcvdb-client.ts
import fs6 from "node:fs";
import { request as undiciRequest, Agent as UndiciAgent } from "undici";
var TcvdbApiError = class extends Error {
  apiCode;
  constructor(path18, code, msg) {
    super(`VectorDB ${path18}: code=${code}, msg=${msg}`);
    this.name = "TcvdbApiError";
    this.apiCode = code;
  }
};
var TAG11 = "[memory-tdai][tcvdb-client]";
var MAX_RETRIES = 2;
var TcvdbClient = class {
  baseUrl;
  authHeader;
  database;
  timeout;
  logger;
  /** undici dispatcher for HTTPS + custom CA. */
  dispatcher;
  constructor(config, logger) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.authHeader = `Bearer account=${config.username}&api_key=${config.apiKey}`;
    this.database = config.database;
    this.timeout = config.timeout;
    this.logger = logger;
    this.logger?.debug?.(`${TAG11} url=${this.baseUrl} db=${this.database} timeout=${this.timeout}${this.baseUrl.startsWith("https://") ? ` https=true caPemPath=${config.caPemPath ?? "(none)"}` : ""}`);
    if (this.baseUrl.startsWith("https://") && config.caPemPath) {
      try {
        const ca = fs6.readFileSync(config.caPemPath, "utf-8");
        this.dispatcher = new UndiciAgent({ connect: { ca } });
        this.logger?.debug?.(`${TAG11} HTTPS enabled with CA from ${config.caPemPath}`);
      } catch (err) {
        this.logger?.error(`${TAG11} Failed to load CA PEM from ${config.caPemPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  // ── Generic request ─────────────────────────────────────
  /**
   * Send a POST request to VectorDB API.
   * Handles auth, timeout, retries (5xx/timeout), and error unwrapping.
   */
  async request(path18, body) {
    let lastError;
    const t0 = performance.now();
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const tAttempt = performance.now();
      try {
        this.logger?.debug?.(`${TAG11} \u2192 ${path18} attempt=${attempt} body=${JSON.stringify(body).slice(0, 500)}`);
        const { statusCode, body: respBody } = await undiciRequest(`${this.baseUrl}${path18}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": this.authHeader
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeout),
          ...this.dispatcher ? { dispatcher: this.dispatcher } : {}
        });
        const text = await respBody.text();
        const json = JSON.parse(text);
        const attemptMs = Math.round(performance.now() - tAttempt);
        this.logger?.debug?.(`${TAG11} \u2190 ${path18} status=${statusCode} code=${json.code} attemptMs=${attemptMs} attempt=${attempt}`);
        if (json.code !== 0) {
          const err = new TcvdbApiError(path18, json.code, json.msg);
          if (statusCode !== void 0 && statusCode >= 400 && statusCode < 500) throw err;
          lastError = err;
          continue;
        }
        const totalMs2 = Math.round(performance.now() - t0);
        this.logger?.info(`${TAG11} ${path18} ${totalMs2}ms${attempt > 0 ? ` (${attempt + 1} attempts)` : ""}`);
        return json;
      } catch (err) {
        const attemptMs = Math.round(performance.now() - tAttempt);
        if (err instanceof TcvdbApiError && err.apiCode !== 0) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = 500 * (attempt + 1);
          this.logger?.debug?.(`${TAG11} ${path18} retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms (lastAttemptMs=${attemptMs}, error=${lastError.message})`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    const totalMs = Math.round(performance.now() - t0);
    this.logger?.debug?.(`${TAG11} \u2717 ${path18} totalMs=${totalMs} attempts=${MAX_RETRIES + 1} error=${lastError?.message}`);
    throw lastError ?? new Error(`${TAG11} ${path18} failed after retries`);
  }
  // ── Database operations ─────────────────────────────────
  async createDatabase(dbName) {
    const name = dbName ?? this.database;
    const listResp = await this.request("/database/list", {});
    const exists = (listResp.databases ?? []).includes(name);
    if (exists) {
      this.logger?.debug?.(`${TAG11} Database already exists: ${name}`);
      return false;
    }
    await this.request("/database/create", { database: name });
    this.logger?.info(`${TAG11} Database created: ${name}`);
    return true;
  }
  // ── Collection operations ───────────────────────────────
  async createCollection(params) {
    const name = String(params.collection ?? "");
    try {
      await this.describeCollection(name);
      this.logger?.debug?.(`${TAG11} Collection already exists: ${name}`);
      return;
    } catch (err) {
      if (!(err instanceof TcvdbApiError && err.apiCode === 15302)) {
        throw err;
      }
    }
    try {
      await this.request("/collection/create", {
        database: this.database,
        ...params
      });
      this.logger?.info(`${TAG11} Collection created: ${name}`);
    } catch (err) {
      if (err instanceof TcvdbApiError && err.apiCode === 15202) {
        this.logger?.debug?.(`${TAG11} Collection already exists (race): ${name}`);
        return;
      }
      throw err;
    }
  }
  async describeCollection(collection) {
    const resp = await this.request("/collection/describe", {
      database: this.database,
      collection
    });
    return resp.collection;
  }
  // ── Document operations ─────────────────────────────────
  async upsert(collection, documents) {
    await this.request("/document/upsert", {
      database: this.database,
      collection,
      buildIndex: true,
      documents
    });
  }
  async search(collection, searchParams) {
    return this.request("/document/search", {
      database: this.database,
      collection,
      readConsistency: "strongConsistency",
      search: searchParams
    });
  }
  async hybridSearch(collection, searchParams) {
    return this.request("/document/hybridSearch", {
      database: this.database,
      collection,
      readConsistency: "strongConsistency",
      search: searchParams
    });
  }
  async query(collection, queryParams) {
    return this.request("/document/query", {
      database: this.database,
      collection,
      readConsistency: "strongConsistency",
      query: queryParams
    });
  }
  async deleteDoc(collection, params) {
    await this.request("/document/delete", {
      database: this.database,
      collection,
      ...params
    });
  }
  /**
   * Count documents matching an optional filter.
   * Uses the dedicated /document/count endpoint.
   */
  async count(collection, filter) {
    const query = {};
    if (filter) query.filter = filter;
    const resp = await this.request("/document/count", {
      database: this.database,
      collection,
      readConsistency: "strongConsistency",
      query
    });
    return resp.count ?? 0;
  }
  // ── Convenience getters ─────────────────────────────────
  getDatabase() {
    return this.database;
  }
};

// src/core/store/tcvdb.ts
var TAG12 = "[memory-tdai][tcvdb]";
var L1_COLLECTION_SUFFIX = "l1_memories";
var L0_COLLECTION_SUFFIX = "l0_conversations";
var PROFILES_COLLECTION_SUFFIX = "profiles";
var QUERY_PAGE_SIZE = 100;
var L1_OUTPUT_FIELDS = [
  "id",
  "text",
  "type",
  "priority",
  "scene_name",
  "session_key",
  "session_id",
  "timestamp_str",
  "timestamp_start",
  "timestamp_end",
  "metadata_json",
  "created_time_ms",
  "updated_time_ms"
];
var L0_OUTPUT_FIELDS = [
  "id",
  "message_text",
  "agent_id",
  "session_key",
  "session_id",
  "role",
  "recorded_at_ms",
  "timestamp"
];
var PROFILE_OUTPUT_FIELDS = [
  "id",
  "type",
  "filename",
  "content",
  "content_md5",
  "agent_id",
  "version",
  "created_at_ms",
  "updated_at_ms"
];
var PROFILE_METADATA_OUTPUT_FIELDS = [
  "id",
  "type",
  "filename",
  "content_md5",
  "agent_id",
  "version",
  "created_at_ms",
  "updated_at_ms"
];
function isoToEpochMs(iso) {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}
function epochMsToIso(ms) {
  if (!ms || ms <= 0) return "";
  return new Date(ms).toISOString();
}
function extractAgentId(sessionKey) {
  if (!sessionKey) return "";
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1];
  }
  return "";
}
var TcvdbMemoryStore = class _TcvdbMemoryStore {
  client;
  embeddingModel;
  logger;
  bm25Encoder;
  l1Collection;
  l0Collection;
  profilesCollection;
  degraded = false;
  /** Promise that resolves when async init completes. */
  _initPromise;
  constructor(config) {
    this.client = new TcvdbClient({
      url: config.url,
      username: config.username,
      apiKey: config.apiKey,
      database: config.database,
      timeout: config.timeout,
      caPemPath: config.caPemPath
    }, config.logger);
    this.embeddingModel = config.embeddingModel;
    this.logger = config.logger;
    this.bm25Encoder = config.bm25Encoder;
    this.l1Collection = `${config.database}_${L1_COLLECTION_SUFFIX}`;
    this.l0Collection = `${config.database}_${L0_COLLECTION_SUFFIX}`;
    this.profilesCollection = `${config.database}_${PROFILES_COLLECTION_SUFFIX}`;
  }
  // ── Lifecycle ────────────────────────────────────────────
  async init(_providerInfo) {
    this._initPromise = this._initAsync();
    try {
      await this._initPromise;
    } catch (err) {
      this.logger?.error(`${TAG12} Async init failed: ${err instanceof Error ? err.message : String(err)}`);
      this.degraded = true;
    }
    return { needsReindex: false };
  }
  /**
   * Await async initialization. Call at the start of every async method.
   * If init already completed (or failed → degraded), returns immediately.
   */
  async _ensureInit() {
    if (this._initPromise) {
      await this._initPromise;
    }
  }
  // ── Vector index definitions ─────────────────────────────
  //
  // Preferred: DISK_FLAT (lower memory, suitable for large-scale recall).
  // Fallback:  HNSW (for instances whose storage engine doesn't support DISK_FLAT).
  static VECTOR_INDEX_DISK_FLAT = {
    fieldName: "vector",
    fieldType: "vector",
    indexType: "DISK_FLAT",
    dimension: 1024,
    metricType: "COSINE"
  };
  static VECTOR_INDEX_HNSW = {
    fieldName: "vector",
    fieldType: "vector",
    indexType: "HNSW",
    dimension: 1024,
    metricType: "COSINE",
    params: { M: 16, efConstruction: 200 }
  };
  /**
   * Detect whether a createCollection error indicates DISK_FLAT is unsupported.
   * Matches on apiCode 15113 OR message containing "DISK_FLAT" + "not support".
   */
  static isDiskFlatUnsupported(err) {
    if (!(err instanceof TcvdbApiError)) return false;
    if (err.apiCode === 15113) return true;
    const msg = err.message.toLowerCase();
    return msg.includes("disk_flat") && (msg.includes("not support") || msg.includes("unsupported"));
  }
  /**
   * Create a collection with DISK_FLAT vector index, falling back to HNSW
   * if the storage engine doesn't support DISK_FLAT.
   */
  async _createCollectionWithVectorFallback(params, filterIndexes) {
    const buildIndexes = (vectorIndex) => [
      { fieldName: "id", fieldType: "string", indexType: "primaryKey" },
      vectorIndex,
      { fieldName: "sparse_vector", fieldType: "sparseVector", indexType: "inverted", metricType: "IP" },
      ...filterIndexes
    ];
    try {
      await this.client.createCollection({ ...params, indexes: buildIndexes(_TcvdbMemoryStore.VECTOR_INDEX_DISK_FLAT) });
    } catch (err) {
      if (_TcvdbMemoryStore.isDiskFlatUnsupported(err)) {
        this.logger?.debug?.(`${TAG12} DISK_FLAT not supported for ${String(params.collection)}, falling back to HNSW`);
        await this.client.createCollection({ ...params, indexes: buildIndexes(_TcvdbMemoryStore.VECTOR_INDEX_HNSW) });
      } else {
        throw err;
      }
    }
  }
  async _initAsync() {
    try {
      const dbCreated = await this.client.createDatabase();
      if (dbCreated) {
        this.logger?.debug?.(`${TAG12} Waiting 5s for database to become ready...`);
        await new Promise((r) => setTimeout(r, 5e3));
      }
      await this._createCollectionWithVectorFallback(
        {
          collection: this.l1Collection,
          shardNum: 1,
          replicaNum: 2,
          description: "L1 \u7ED3\u6784\u5316\u8BB0\u5FC6",
          embedding: {
            status: "enabled",
            field: "text",
            vectorField: "vector",
            model: this.embeddingModel
          }
        },
        [
          { fieldName: "type", fieldType: "string", indexType: "filter" },
          { fieldName: "priority", fieldType: "uint64", indexType: "filter" },
          { fieldName: "scene_name", fieldType: "string", indexType: "filter" },
          { fieldName: "agent_id", fieldType: "string", indexType: "filter" },
          { fieldName: "session_key", fieldType: "string", indexType: "filter" },
          { fieldName: "session_id", fieldType: "string", indexType: "filter" },
          { fieldName: "timestamp_start", fieldType: "string", indexType: "filter" },
          { fieldName: "timestamp_end", fieldType: "string", indexType: "filter" },
          { fieldName: "created_time_ms", fieldType: "uint64", indexType: "filter" },
          { fieldName: "updated_time_ms", fieldType: "uint64", indexType: "filter" }
        ]
      );
      await this._createCollectionWithVectorFallback(
        {
          collection: this.l0Collection,
          shardNum: 1,
          replicaNum: 2,
          description: "L0 \u539F\u59CB\u5BF9\u8BDD\u6D88\u606F",
          embedding: {
            status: "enabled",
            field: "message_text",
            vectorField: "vector",
            model: this.embeddingModel
          }
        },
        [
          { fieldName: "agent_id", fieldType: "string", indexType: "filter" },
          { fieldName: "session_key", fieldType: "string", indexType: "filter" },
          { fieldName: "session_id", fieldType: "string", indexType: "filter" },
          { fieldName: "role", fieldType: "string", indexType: "filter" },
          { fieldName: "recorded_at_ms", fieldType: "uint64", indexType: "filter" },
          { fieldName: "timestamp", fieldType: "int64", indexType: "filter" }
        ]
      );
      await this.client.createCollection({
        collection: this.profilesCollection,
        shardNum: 1,
        replicaNum: 2,
        description: "L2 \u573A\u666F\u5757 + L3 \u7528\u6237\u753B\u50CF",
        embedding: { status: "disabled" },
        indexes: [
          { fieldName: "id", fieldType: "string", indexType: "primaryKey" },
          {
            fieldName: "vector",
            fieldType: "vector",
            indexType: "FLAT",
            dimension: 1,
            metricType: "COSINE"
          },
          { fieldName: "type", fieldType: "string", indexType: "filter" },
          { fieldName: "filename", fieldType: "string", indexType: "filter" },
          { fieldName: "content_md5", fieldType: "string", indexType: "filter" },
          { fieldName: "agent_id", fieldType: "string", indexType: "filter" },
          { fieldName: "created_at_ms", fieldType: "uint64", indexType: "filter" },
          { fieldName: "updated_at_ms", fieldType: "uint64", indexType: "filter" },
          { fieldName: "version", fieldType: "uint64", indexType: "filter" }
        ]
      });
      this.logger?.debug?.(`${TAG12} Initialized: db=${this.client.getDatabase()}, model=${this.embeddingModel}`);
    } catch (err) {
      if (err instanceof TcvdbApiError && err.apiCode === 15201) {
        this.logger?.debug?.(`${TAG12} Init (benign): ${err.message}`);
        return;
      }
      this.logger?.error(`${TAG12} Init failed: ${err instanceof Error ? err.message : String(err)}`);
      this.degraded = true;
    }
  }
  isDegraded() {
    return this.degraded;
  }
  getCapabilities() {
    const hasBm25 = !!this.bm25Encoder;
    return {
      vectorSearch: true,
      ftsSearch: hasBm25,
      nativeHybridSearch: hasBm25,
      sparseVectors: hasBm25
    };
  }
  close() {
  }
  // ── Internal: paginated query helper ────────────────────
  /**
   * Paginated /document/query that fetches all matching docs.
   * TCVDB query API returns at most `limit` docs per call.
   * We loop with offset until fewer docs than page size are returned.
   */
  async _queryAllDocs(collection, filter, outputFields, limit, sort) {
    const allDocs = [];
    let offset = 0;
    const pageSize = limit && limit < QUERY_PAGE_SIZE ? limit : QUERY_PAGE_SIZE;
    while (true) {
      const queryParams = {
        retrieveVector: false,
        limit: pageSize,
        offset
      };
      if (filter) queryParams.filter = filter;
      if (outputFields) queryParams.outputFields = outputFields;
      if (sort) queryParams.sort = sort;
      const resp = await this.client.query(collection, queryParams);
      const docs = resp.documents ?? [];
      allDocs.push(...docs);
      if (docs.length < pageSize) break;
      if (limit && allDocs.length >= limit) break;
      offset += docs.length;
    }
    return limit ? allDocs.slice(0, limit) : allDocs;
  }
  // ── L1 Write Operations ──────────────────────────────────
  async upsertL1(record, _embedding) {
    try {
      await this._upsertL1Async(record);
      return true;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-upsert] FAILED id=${record.id}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  async _upsertL1Async(record) {
    await this._ensureInit();
    if (this.degraded) return;
    const tsStr = record.timestamps[0] ?? "";
    const tsStart = record.timestamps.length > 0 ? record.timestamps.reduce((a, b) => a < b ? a : b) : tsStr;
    const tsEnd = record.timestamps.length > 0 ? record.timestamps.reduce((a, b) => a > b ? a : b) : tsStr;
    const doc = {
      id: record.id,
      text: record.content,
      type: record.type,
      priority: record.priority,
      scene_name: record.scene_name,
      agent_id: extractAgentId(record.sessionKey),
      session_key: record.sessionKey,
      session_id: record.sessionId,
      timestamp_str: tsStr,
      timestamp_start: tsStart,
      timestamp_end: tsEnd,
      created_time_ms: isoToEpochMs(record.createdAt),
      updated_time_ms: isoToEpochMs(record.updatedAt),
      metadata_json: JSON.stringify(record.metadata)
    };
    if (this.bm25Encoder) {
      const sparse = this.bm25Encoder.encodeTexts([record.content]);
      if (sparse.length > 0 && sparse[0].length > 0) {
        doc.sparse_vector = sparse[0];
      }
    }
    await this.client.upsert(this.l1Collection, [doc]);
  }
  /**
   * Batch upsert multiple L1 records in a single API call.
   * Used by migration scripts to reduce request count.
   */
  async upsertL1Batch(records) {
    if (records.length === 0) return 0;
    try {
      await this._ensureInit();
      if (this.degraded) return 0;
      const docs = records.map((record) => {
        const tsStr = record.timestamps[0] ?? "";
        const tsStart = record.timestamps.length > 0 ? record.timestamps.reduce((a, b) => a < b ? a : b) : tsStr;
        const tsEnd = record.timestamps.length > 0 ? record.timestamps.reduce((a, b) => a > b ? a : b) : tsStr;
        const doc = {
          id: record.id,
          text: record.content,
          type: record.type,
          priority: record.priority,
          scene_name: record.scene_name,
          agent_id: extractAgentId(record.sessionKey),
          session_key: record.sessionKey,
          session_id: record.sessionId,
          timestamp_str: tsStr,
          timestamp_start: tsStart,
          timestamp_end: tsEnd,
          created_time_ms: isoToEpochMs(record.createdAt),
          updated_time_ms: isoToEpochMs(record.updatedAt),
          metadata_json: JSON.stringify(record.metadata)
        };
        if (this.bm25Encoder) {
          const sparse = this.bm25Encoder.encodeTexts([record.content]);
          if (sparse.length > 0 && sparse[0].length > 0) {
            doc.sparse_vector = sparse[0];
          }
        }
        return doc;
      });
      await this.client.upsert(this.l1Collection, docs);
      return records.length;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-upsertBatch] FAILED (${records.length} records): ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
  async deleteL1(recordId) {
    try {
      await this._ensureInit();
      if (this.degraded) return false;
      await this.client.deleteDoc(this.l1Collection, {
        query: { documentIds: [recordId] }
      });
      return true;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-delete] FAILED id=${recordId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  async deleteL1Batch(recordIds) {
    if (recordIds.length === 0) return true;
    try {
      await this._ensureInit();
      if (this.degraded) return false;
      await this.client.deleteDoc(this.l1Collection, {
        query: { documentIds: recordIds }
      });
      return true;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-deleteBatch] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  async deleteL1Expired(cutoffIso) {
    const cutoffMs = isoToEpochMs(cutoffIso);
    if (cutoffMs <= 0) return 0;
    try {
      await this._ensureInit();
      if (this.degraded) return 0;
      const filter = `updated_time_ms < ${cutoffMs}`;
      const toDelete = await this.client.count(this.l1Collection, filter);
      if (toDelete === 0) return 0;
      const total = await this.client.count(this.l1Collection);
      const ratio = total > 0 ? toDelete / total : 0;
      if (ratio > 0.8) {
        this.logger?.warn(
          `${TAG12} [L1-deleteExpired] BLOCKED: would delete ${toDelete}/${total} (${(ratio * 100).toFixed(1)}%) \u2014 exceeds 80% safety threshold, cutoff=${cutoffIso}`
        );
        return 0;
      }
      await this.client.deleteDoc(this.l1Collection, {
        query: { filter }
      });
      this.logger?.info?.(
        `${TAG12} [L1-deleteExpired] Deleted ~${toDelete}/${total} records (cutoff=${cutoffIso})`
      );
      return toDelete;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-deleteExpired] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
  // ── L1 Read Operations ───────────────────────────────────
  async countL1() {
    try {
      await this._ensureInit();
      if (this.degraded) return 0;
      return await this.client.count(this.l1Collection);
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-count] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
  async queryL1Records(filter) {
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const conditions = [];
      if (filter?.sessionKey) conditions.push(`session_key = "${filter.sessionKey}"`);
      if (filter?.sessionId) conditions.push(`session_id = "${filter.sessionId}"`);
      if (filter?.updatedAfter) {
        const afterMs = isoToEpochMs(filter.updatedAfter);
        if (afterMs > 0) conditions.push(`updated_time_ms > ${afterMs}`);
      }
      const filterExpr = conditions.length > 0 ? conditions.join(" and ") : void 0;
      const docs = await this._queryAllDocs(
        this.l1Collection,
        filterExpr,
        L1_OUTPUT_FIELDS,
        void 0,
        // no limit — fetch all matching
        [{ fieldName: "updated_time_ms", direction: "asc" }]
      );
      return docs.map((doc) => ({
        record_id: String(doc.id ?? ""),
        content: String(doc.text ?? ""),
        type: String(doc.type ?? ""),
        priority: Number(doc.priority ?? 0),
        scene_name: String(doc.scene_name ?? ""),
        session_key: String(doc.session_key ?? ""),
        session_id: String(doc.session_id ?? ""),
        timestamp_str: String(doc.timestamp_str ?? ""),
        timestamp_start: String(doc.timestamp_start ?? ""),
        timestamp_end: String(doc.timestamp_end ?? ""),
        created_time: epochMsToIso(Number(doc.created_time_ms ?? 0)),
        updated_time: epochMsToIso(Number(doc.updated_time_ms ?? 0)),
        metadata_json: String(doc.metadata_json ?? "{}")
      }));
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-query] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  async getAllL1Texts() {
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const docs = await this._queryAllDocs(
        this.l1Collection,
        void 0,
        ["id", "text", "updated_time_ms"]
      );
      return docs.map((doc) => ({
        record_id: String(doc.id ?? ""),
        content: String(doc.text ?? ""),
        updated_time: epochMsToIso(Number(doc.updated_time_ms ?? 0))
      }));
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-getAllTexts] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  // ── L1 Search Operations ─────────────────────────────────
  async searchL1Vector(_queryEmbedding, topK, queryText) {
    if (queryText) {
      return this.searchL1HybridAsync({ queryText, topK });
    }
    return [];
  }
  async searchL1Fts(ftsQuery, limit) {
    if (!ftsQuery) return [];
    const results = await this.searchL1HybridAsync({ queryText: ftsQuery, topK: limit });
    return results;
  }
  async searchL1Hybrid(params) {
    const queryText = params.query;
    if (!queryText) return [];
    return this.searchL1HybridAsync({ queryText, topK: params.topK });
  }
  /**
   * Async L1 hybrid search — the real implementation.
   * Call this directly from async contexts (hooks, tools).
   */
  async searchL1HybridAsync(params) {
    const { queryText, topK = 10 } = params;
    if (!queryText) return [];
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const searchParams = {
        limit: topK,
        outputFields: L1_OUTPUT_FIELDS
      };
      const ann = [{
        fieldName: "text",
        data: [queryText],
        // embeddingItems — server-side embedding
        limit: topK
      }];
      let match;
      if (this.bm25Encoder) {
        const sparse = this.bm25Encoder.encodeQueries([queryText]);
        if (sparse.length > 0 && sparse[0].length > 0) {
          match = [{
            fieldName: "sparse_vector",
            data: [sparse[0]],
            // SDK wraps single sparse vector in array
            limit: topK
          }];
        }
      }
      if (match) {
        searchParams.ann = ann;
        searchParams.match = match;
        searchParams.rerank = { method: "rrf", k: 60 };
        const resp = await this.client.hybridSearch(this.l1Collection, searchParams);
        return this._parseL1SearchResults(resp.documents);
      } else {
        const denseSearch = {
          embeddingItems: [queryText],
          limit: topK,
          retrieveVector: false,
          outputFields: L1_OUTPUT_FIELDS
        };
        const resp = await this.client.search(this.l1Collection, denseSearch);
        return this._parseL1SearchResults(resp.documents);
      }
    } catch (err) {
      this.logger?.warn(`${TAG12} [L1-hybridSearch] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  // ── L0 Write Operations ──────────────────────────────────
  async upsertL0(record, _embedding) {
    try {
      await this._upsertL0Async(record);
      return true;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-upsert] FAILED id=${record.id}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  async _upsertL0Async(record) {
    await this._ensureInit();
    if (this.degraded) return;
    const doc = {
      id: record.id,
      message_text: record.messageText,
      agent_id: extractAgentId(record.sessionKey),
      session_key: record.sessionKey,
      session_id: record.sessionId,
      role: record.role,
      recorded_at_ms: isoToEpochMs(record.recordedAt),
      timestamp: record.timestamp
    };
    if (this.bm25Encoder) {
      const sparse = this.bm25Encoder.encodeTexts([record.messageText]);
      if (sparse.length > 0 && sparse[0].length > 0) {
        doc.sparse_vector = sparse[0];
      }
    }
    await this.client.upsert(this.l0Collection, [doc]);
  }
  /**
   * Batch upsert multiple L0 records in a single API call.
   * Used by migration scripts to reduce request count.
   */
  async upsertL0Batch(records) {
    if (records.length === 0) return 0;
    try {
      await this._ensureInit();
      if (this.degraded) return 0;
      const docs = records.map((record) => {
        const doc = {
          id: record.id,
          message_text: record.messageText,
          agent_id: extractAgentId(record.sessionKey),
          session_key: record.sessionKey,
          session_id: record.sessionId,
          role: record.role,
          recorded_at_ms: isoToEpochMs(record.recordedAt),
          timestamp: record.timestamp
        };
        if (this.bm25Encoder) {
          const sparse = this.bm25Encoder.encodeTexts([record.messageText]);
          if (sparse.length > 0 && sparse[0].length > 0) {
            doc.sparse_vector = sparse[0];
          }
        }
        return doc;
      });
      await this.client.upsert(this.l0Collection, docs);
      return records.length;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-upsertBatch] FAILED (${records.length} records): ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
  async deleteL0(recordId) {
    try {
      await this._ensureInit();
      if (this.degraded) return false;
      await this.client.deleteDoc(this.l0Collection, {
        query: { documentIds: [recordId] }
      });
      return true;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-delete] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  async deleteL0Expired(cutoffIso) {
    const cutoffMs = isoToEpochMs(cutoffIso);
    if (cutoffMs <= 0) return 0;
    try {
      await this._ensureInit();
      if (this.degraded) return 0;
      const filter = `recorded_at_ms < ${cutoffMs}`;
      const toDelete = await this.client.count(this.l0Collection, filter);
      if (toDelete === 0) return 0;
      const total = await this.client.count(this.l0Collection);
      const ratio = total > 0 ? toDelete / total : 0;
      if (ratio > 0.8) {
        this.logger?.warn(
          `${TAG12} [L0-deleteExpired] BLOCKED: would delete ${toDelete}/${total} (${(ratio * 100).toFixed(1)}%) \u2014 exceeds 80% safety threshold, cutoff=${cutoffIso}`
        );
        return 0;
      }
      await this.client.deleteDoc(this.l0Collection, {
        query: { filter }
      });
      this.logger?.info?.(
        `${TAG12} [L0-deleteExpired] Deleted ~${toDelete}/${total} records (cutoff=${cutoffIso})`
      );
      return toDelete;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-deleteExpired] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
  // ── L0 Read Operations ───────────────────────────────────
  async countL0() {
    try {
      await this._ensureInit();
      if (this.degraded) return 0;
      return await this.client.count(this.l0Collection);
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-count] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
  async queryL0ForL1(sessionKey, afterRecordedAtMs, limit = 50) {
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const conditions = [`session_key = "${sessionKey}"`];
      if (afterRecordedAtMs && afterRecordedAtMs > 0) {
        conditions.push(`recorded_at_ms > ${afterRecordedAtMs}`);
      }
      const filterExpr = conditions.join(" and ");
      const docs = await this._queryAllDocs(
        this.l0Collection,
        filterExpr,
        L0_OUTPUT_FIELDS,
        limit,
        [{ fieldName: "recorded_at_ms", direction: "desc" }]
      );
      const rows = docs.map((doc) => ({
        record_id: String(doc.id ?? ""),
        session_key: String(doc.session_key ?? ""),
        session_id: String(doc.session_id ?? ""),
        role: String(doc.role ?? ""),
        message_text: String(doc.message_text ?? ""),
        recorded_at: epochMsToIso(Number(doc.recorded_at_ms ?? 0)),
        timestamp: Number(doc.timestamp ?? 0)
      }));
      return rows.reverse();
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-queryForL1] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  async queryL0GroupedBySessionId(sessionKey, afterRecordedAtMs, limit = 50) {
    try {
      const rows = await this.queryL0ForL1(sessionKey, afterRecordedAtMs, limit);
      const groupMap = /* @__PURE__ */ new Map();
      for (const row of rows) {
        const sid = row.session_id || "";
        let group = groupMap.get(sid);
        if (!group) {
          group = [];
          groupMap.set(sid, group);
        }
        group.push({
          id: row.record_id,
          role: row.role,
          content: row.message_text,
          timestamp: row.timestamp,
          recordedAtMs: row.recorded_at ? Date.parse(row.recorded_at) || 0 : 0
        });
      }
      const groups = [];
      for (const [sessionId, messages] of groupMap) {
        if (messages.length > 0) {
          groups.push({ sessionId, messages });
        }
      }
      groups.sort((a, b) => a.messages[0].timestamp - b.messages[0].timestamp);
      return groups;
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-queryGrouped] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  async getAllL0Texts() {
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const docs = await this._queryAllDocs(
        this.l0Collection,
        void 0,
        ["id", "message_text", "recorded_at_ms"]
      );
      return docs.map((doc) => ({
        record_id: String(doc.id ?? ""),
        message_text: String(doc.message_text ?? ""),
        recorded_at: epochMsToIso(Number(doc.recorded_at_ms ?? 0))
      }));
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-getAllTexts] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  // ── L0 Search Operations ─────────────────────────────────
  async searchL0Vector(_queryEmbedding, topK, queryText) {
    if (queryText) {
      return this.searchL0HybridAsync({ queryText, topK });
    }
    return [];
  }
  async searchL0Fts(ftsQuery, limit) {
    if (!ftsQuery) return [];
    return this.searchL0HybridAsync({ queryText: ftsQuery, topK: limit });
  }
  /**
   * Async L0 hybrid search.
   */
  async searchL0HybridAsync(params) {
    const { queryText, topK = 10 } = params;
    if (!queryText) return [];
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const searchParams = {
        limit: topK,
        outputFields: L0_OUTPUT_FIELDS
      };
      const ann = [{
        fieldName: "message_text",
        data: [queryText],
        limit: topK
      }];
      let match;
      if (this.bm25Encoder) {
        const sparse = this.bm25Encoder.encodeQueries([queryText]);
        if (sparse.length > 0 && sparse[0].length > 0) {
          match = [{
            fieldName: "sparse_vector",
            data: [sparse[0]],
            limit: topK
          }];
        }
      }
      if (match) {
        searchParams.ann = ann;
        searchParams.match = match;
        searchParams.rerank = { method: "rrf", k: 60 };
        const resp = await this.client.hybridSearch(this.l0Collection, searchParams);
        return this._parseL0SearchResults(resp.documents);
      } else {
        const denseSearch = {
          embeddingItems: [queryText],
          limit: topK,
          retrieveVector: false,
          outputFields: L0_OUTPUT_FIELDS
        };
        const resp = await this.client.search(this.l0Collection, denseSearch);
        return this._parseL0SearchResults(resp.documents);
      }
    } catch (err) {
      this.logger?.warn(`${TAG12} [L0-hybridSearch] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  async pullProfiles() {
    try {
      await this._ensureInit();
      if (this.degraded) return [];
      const docs = await this._queryAllDocs(
        this.profilesCollection,
        void 0,
        PROFILE_OUTPUT_FIELDS
      );
      return docs.map((doc) => ({
        id: String(doc.id ?? ""),
        type: doc.type === "l3" ? "l3" : "l2",
        filename: String(doc.filename ?? ""),
        content: String(doc.content ?? ""),
        contentMd5: String(doc.content_md5 ?? ""),
        agentId: String(doc.agent_id ?? "") || void 0,
        version: Number(doc.version ?? 0),
        createdAtMs: Number(doc.created_at_ms ?? 0),
        updatedAtMs: Number(doc.updated_at_ms ?? 0)
      }));
    } catch (err) {
      this.logger?.warn(`${TAG12} [profiles-pull] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
  async syncProfiles(records) {
    if (records.length === 0) return;
    try {
      await this._ensureInit();
      if (this.degraded) return;
      const remoteDocs = await this._queryAllDocs(
        this.profilesCollection,
        void 0,
        PROFILE_METADATA_OUTPUT_FIELDS
      );
      const remoteMap = new Map(
        remoteDocs.map((doc) => [String(doc.id ?? ""), doc])
      );
      const now = Date.now();
      const upserts = [];
      for (const record of records) {
        const current = remoteMap.get(record.id);
        if (!current) {
          const createdAtMs = record.createdAtMs > 0 ? record.createdAtMs : now;
          upserts.push({
            id: record.id,
            vector: [0],
            type: record.type,
            filename: record.filename,
            content: record.content,
            content_md5: record.contentMd5,
            agent_id: record.agentId ?? "",
            version: 1,
            created_at_ms: createdAtMs,
            updated_at_ms: now
          });
          continue;
        }
        const currentMd5 = String(current.content_md5 ?? "");
        const currentVersion = Number(current.version ?? 0);
        const currentCreatedAtMs = Number(current.created_at_ms ?? 0) || now;
        if (currentMd5 === record.contentMd5) {
          continue;
        }
        if ((record.baselineVersion ?? 0) !== currentVersion) {
          this.logger?.warn(
            `${TAG12} [profiles-sync] Conflict for ${record.filename}: remote version advanced from ${record.baselineVersion ?? 0} to ${currentVersion}, skipping sync`
          );
          continue;
        }
        upserts.push({
          id: record.id,
          vector: [0],
          type: record.type,
          filename: record.filename,
          content: record.content,
          content_md5: record.contentMd5,
          agent_id: record.agentId ?? "",
          version: currentVersion + 1,
          created_at_ms: currentCreatedAtMs,
          updated_at_ms: now
        });
      }
      if (upserts.length > 0) {
        await this.client.upsert(this.profilesCollection, upserts);
      }
    } catch (err) {
      this.logger?.warn(`${TAG12} [profiles-sync] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async deleteProfiles(recordIds) {
    if (recordIds.length === 0) return;
    try {
      await this._ensureInit();
      if (this.degraded) return;
      await this.client.deleteDoc(this.profilesCollection, {
        query: { documentIds: recordIds }
      });
    } catch (err) {
      this.logger?.warn(`${TAG12} [profiles-delete] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // ── Re-index ─────────────────────────────────────────────
  async reindexAll(_embedFn, _onProgress) {
    this.logger?.info(`${TAG12} reindexAll: TCVDB uses server-side embedding, skipping`);
    return { l1Count: 0, l0Count: 0 };
  }
  isFtsAvailable() {
    return !!this.bm25Encoder;
  }
  // ── Internal: parse search results ───────────────────────
  _parseL1SearchResults(docArrays) {
    const results = [];
    const docs = docArrays?.[0] ?? [];
    for (const doc of docs) {
      results.push({
        record_id: String(doc.id ?? ""),
        content: String(doc.text ?? ""),
        type: String(doc.type ?? ""),
        priority: Number(doc.priority ?? 0),
        scene_name: String(doc.scene_name ?? ""),
        score: Number(doc.score ?? 0),
        timestamp_str: String(doc.timestamp_str ?? ""),
        timestamp_start: String(doc.timestamp_start ?? ""),
        timestamp_end: String(doc.timestamp_end ?? ""),
        session_key: String(doc.session_key ?? ""),
        session_id: String(doc.session_id ?? ""),
        metadata_json: String(doc.metadata_json ?? "{}")
      });
    }
    return results;
  }
  _parseL0SearchResults(docArrays) {
    const results = [];
    const docs = docArrays?.[0] ?? [];
    for (const doc of docs) {
      results.push({
        record_id: String(doc.id ?? ""),
        session_key: String(doc.session_key ?? ""),
        session_id: String(doc.session_id ?? ""),
        role: String(doc.role ?? ""),
        message_text: String(doc.message_text ?? ""),
        score: Number(doc.score ?? 0),
        recorded_at: epochMsToIso(Number(doc.recorded_at_ms ?? 0)),
        timestamp: Number(doc.timestamp ?? 0)
      });
    }
    return results;
  }
};

// src/core/store/embedding.ts
var EmbeddingNotReadyError = class extends Error {
  constructor(message) {
    super(message ?? "Local embedding model is not ready yet (still downloading or loading)");
    this.name = "EmbeddingNotReadyError";
  }
};
var TAG13 = "[memory-tdai][embedding]";
var DEFAULT_LOCAL_MODEL = "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";
var LOCAL_DIMENSIONS = 768;
var LOCAL_MAX_INPUT_CHARS = 512;
function sanitizeAndNormalize(vec) {
  const arr = Array.from(vec).map((v) => Number.isFinite(v) ? v : 0);
  const magnitude = Math.sqrt(arr.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) {
    return new Float32Array(arr);
  }
  return new Float32Array(arr.map((v) => v / magnitude));
}
var defaultImportLlama = () => import("node-llama-cpp");
var LocalEmbeddingService = class {
  modelPath;
  modelCacheDir;
  logger;
  importLlama;
  // Initialization state machine
  initState = "idle";
  initPromise = null;
  initError = null;
  embeddingContext = null;
  constructor(config, logger, importLlama) {
    this.modelPath = config?.modelPath?.trim() || DEFAULT_LOCAL_MODEL;
    this.modelCacheDir = config?.modelCacheDir?.trim();
    this.logger = logger;
    this.importLlama = importLlama ?? defaultImportLlama;
  }
  getDimensions() {
    return LOCAL_DIMENSIONS;
  }
  getProviderInfo() {
    return { provider: "local", model: this.modelPath };
  }
  /**
   * Whether the local model is fully loaded and ready to serve requests.
   */
  isReady() {
    return this.initState === "ready" && this.embeddingContext !== null;
  }
  /**
   * Start background warmup: download model (if needed) and load into memory.
   * Does NOT block the caller — returns immediately.
   * Safe to call multiple times (idempotent); re-triggers on "failed" state.
   */
  startWarmup() {
    if (this.initState === "initializing" || this.initState === "ready") {
      return;
    }
    this.logger?.info(`${TAG13} Starting background warmup for local embedding model...`);
    this.initState = "initializing";
    this.initError = null;
    this.initPromise = this._doInitialize().then(() => {
      this.initState = "ready";
      this.logger?.info(`${TAG13} Background warmup complete \u2014 local embedding ready`);
    }).catch((err) => {
      this.initState = "failed";
      this.initError = err instanceof Error ? err : new Error(String(err));
      this.logger?.error(
        `${TAG13} Background warmup failed: ${this.initError.message}. embed() calls will throw EmbeddingNotReadyError until retried.`
      );
    });
  }
  /**
   * Get embedding for a single text.
   * @throws {EmbeddingNotReadyError} if model is not yet ready.
   */
  async embed(text, _options) {
    this.assertReady();
    const truncated = this.truncateInput(text);
    const embedding = await this.embeddingContext.getEmbeddingFor(truncated);
    return sanitizeAndNormalize(embedding.vector);
  }
  /**
   * Get embeddings for multiple texts.
   * @throws {EmbeddingNotReadyError} if model is not yet ready.
   */
  async embedBatch(texts, _options) {
    if (texts.length === 0) return [];
    this.assertReady();
    const results = [];
    for (const text of texts) {
      const truncated = this.truncateInput(text);
      const embedding = await this.embeddingContext.getEmbeddingFor(truncated);
      results.push(sanitizeAndNormalize(embedding.vector));
    }
    return results;
  }
  /**
   * Release the node-llama-cpp embedding context and model resources.
   * Safe to call multiple times (idempotent).
   */
  close() {
    if (this.embeddingContext) {
      try {
        const ctx = this.embeddingContext;
        ctx.dispose?.();
      } catch {
      }
      this.embeddingContext = null;
      this.initPromise = null;
      this.initState = "idle";
      this.initError = null;
      this.logger?.info(`${TAG13} Local embedding resources released`);
    }
  }
  /**
   * Assert the model is ready. Throws EmbeddingNotReadyError if not.
   */
  assertReady() {
    if (this.initState === "ready" && this.embeddingContext) {
      return;
    }
    if (this.initState === "failed") {
      throw new EmbeddingNotReadyError(
        `Local embedding model initialization failed: ${this.initError?.message ?? "unknown error"}. Call startWarmup() to retry.`
      );
    }
    if (this.initState === "initializing") {
      throw new EmbeddingNotReadyError(
        "Local embedding model is still loading (download/initialization in progress). Please try again later."
      );
    }
    throw new EmbeddingNotReadyError(
      "Local embedding model warmup has not been started. Call startWarmup() first."
    );
  }
  /**
   * Truncate input text to stay within the model's context window.
   * embeddinggemma-300m has a 256-token limit; we use a character-based
   * heuristic (LOCAL_MAX_INPUT_CHARS) as a safe proxy.
   */
  truncateInput(text) {
    if (text.length <= LOCAL_MAX_INPUT_CHARS) return text;
    this.logger?.debug?.(
      `${TAG13} Input truncated from ${text.length} to ${LOCAL_MAX_INPUT_CHARS} chars (model context limit)`
    );
    return text.slice(0, LOCAL_MAX_INPUT_CHARS);
  }
  /**
   * Internal: perform the actual model download + load.
   * Called by startWarmup(), runs in background.
   */
  async _doInitialize() {
    let model;
    try {
      this.logger?.debug?.(`${TAG13} Loading node-llama-cpp for local embedding...`);
      const { getLlama, resolveModelFile, LlamaLogLevel } = await this.importLlama();
      const llama = await getLlama({ logLevel: LlamaLogLevel.error });
      this.logger?.debug?.(`${TAG13} Llama instance created`);
      const resolvedPath = await resolveModelFile(
        this.modelPath,
        this.modelCacheDir || void 0
      );
      this.logger?.debug?.(`${TAG13} Model resolved: ${resolvedPath}`);
      model = await llama.loadModel({ modelPath: resolvedPath });
      this.logger?.debug?.(`${TAG13} Model loaded, creating embedding context...`);
      this.embeddingContext = await model.createEmbeddingContext();
      this.logger?.info(`${TAG13} Local embedding ready (model=${this.modelPath}, dims=${LOCAL_DIMENSIONS})`);
    } catch (err) {
      if (model?.dispose) {
        try {
          model.dispose();
        } catch {
        }
      }
      this.embeddingContext = null;
      throw err;
    }
  }
  /**
   * Wait for ongoing warmup to complete (used internally by tests).
   * Returns immediately if already ready or idle.
   */
  async waitForReady() {
    if (this.initPromise) {
      await this.initPromise;
    }
  }
};
var MAX_BATCH_SIZE = 256;
var MAX_RETRIES2 = 3;
var DEFAULT_API_TIMEOUT_MS = 1e4;
var EmbeddingApiError = class extends Error {
  httpStatus;
  constructor(message, httpStatus) {
    super(message);
    this.name = "EmbeddingApiError";
    this.httpStatus = httpStatus;
  }
  /** Returns true for 4xx errors that should NOT be retried (excluding 429). */
  isClientError() {
    return this.httpStatus >= 400 && this.httpStatus < 500 && this.httpStatus !== 429;
  }
};
function truncateEmbeddingInputs(texts, maxInputChars, logger) {
  if (!maxInputChars) return texts;
  return texts.map((text) => {
    if (text.length <= maxInputChars) return text;
    logger?.warn?.(
      `${TAG13} Input truncated from ${text.length} to ${maxInputChars} chars (maxInputChars limit)`
    );
    return text.slice(0, maxInputChars);
  });
}
async function postEmbeddingRequest(params) {
  const { fetchUrl, headers, body, timeoutMs } = params;
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES2; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(fetchUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "(unable to read body)");
          const err = new EmbeddingApiError(
            `Embedding API error: HTTP ${resp.status} ${resp.statusText} \u2014 ${errBody.slice(0, 500)}`,
            resp.status
          );
          if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
            throw err;
          }
          lastError = err;
          continue;
        }
        return await resp.json();
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      if (err instanceof EmbeddingApiError && err.isClientError()) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES2) {
        const delay = 500 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error("Embedding API call failed after retries");
}
var OpenAIEmbeddingService = class {
  baseUrl;
  apiKey;
  model;
  dims;
  sendDimensions;
  providerName;
  proxyUrl;
  maxInputChars;
  timeoutMs;
  logger;
  constructor(config, logger) {
    if (!config.apiKey) {
      throw new Error("EmbeddingService: apiKey is required for remote provider");
    }
    if (!config.baseUrl) {
      throw new Error("EmbeddingService: baseUrl is required for remote provider");
    }
    if (!config.model) {
      throw new Error("EmbeddingService: model is required for remote provider");
    }
    if (!config.dimensions || config.dimensions <= 0) {
      throw new Error("EmbeddingService: dimensions is required for remote provider (must be a positive integer)");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dims = config.dimensions;
    this.sendDimensions = config.sendDimensions ?? true;
    this.providerName = config.provider || "openai";
    this.proxyUrl = config.proxyUrl?.trim() || void 0;
    this.maxInputChars = config.maxInputChars && config.maxInputChars > 0 ? config.maxInputChars : void 0;
    this.timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_API_TIMEOUT_MS;
    this.logger = logger;
  }
  getDimensions() {
    return this.dims;
  }
  getProviderInfo() {
    return { provider: this.providerName, model: this.model };
  }
  /** Remote embedding is always ready (stateless HTTP). */
  isReady() {
    return true;
  }
  /** No-op for remote embedding (no local model to warm up). */
  startWarmup() {
  }
  async embed(text, options) {
    const [result] = await this.embedBatch([text], options);
    return result;
  }
  async embedBatch(texts, options) {
    if (texts.length === 0) return [];
    const processedTexts = this.maxInputChars ? texts.map((t) => this.truncateInput(t)) : texts;
    if (processedTexts.length > MAX_BATCH_SIZE) {
      const results = [];
      for (let i = 0; i < processedTexts.length; i += MAX_BATCH_SIZE) {
        const chunk = processedTexts.slice(i, i + MAX_BATCH_SIZE);
        const chunkResults = await this._callApi(chunk, options?.timeoutMs);
        results.push(...chunkResults);
      }
      return results;
    }
    return this._callApi(processedTexts, options?.timeoutMs);
  }
  /**
   * Truncate input text to stay within the configured maxInputChars limit.
   * Logs a warning when truncation occurs.
   */
  truncateInput(text) {
    if (!this.maxInputChars || text.length <= this.maxInputChars) return text;
    this.logger?.warn?.(
      `${TAG13} Input truncated from ${text.length} to ${this.maxInputChars} chars (maxInputChars limit)`
    );
    return text.slice(0, this.maxInputChars);
  }
  async _callApi(texts, timeoutOverride) {
    const body = {
      input: texts,
      model: this.model
    };
    if (this.sendDimensions) {
      body.dimensions = this.dims;
    }
    const useProxy = this.providerName === "qclaw" && !!this.proxyUrl;
    const fetchUrl = useProxy ? this.proxyUrl : `${this.baseUrl}/embeddings`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`
    };
    if (useProxy) {
      headers["Remote-URL"] = `${this.baseUrl}/embeddings`;
      this.logger?.debug?.(
        `${TAG13} [qclaw-proxy] Forwarding embedding request via proxy: ${fetchUrl}, Remote-URL: ${headers["Remote-URL"]}`
      );
    }
    const json = await postEmbeddingRequest({
      fetchUrl,
      headers,
      body,
      timeoutMs: timeoutOverride ?? this.timeoutMs
    });
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error("Embedding API returned unexpected format: missing 'data' array");
    }
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => sanitizeAndNormalize(d.embedding));
  }
};
var ZeroEntropyEmbeddingService = class {
  baseUrl;
  apiKey;
  model;
  dims;
  sendDimensions;
  maxInputChars;
  timeoutMs;
  logger;
  constructor(config, logger) {
    if (!config.apiKey) {
      throw new Error("ZeroEntropyEmbeddingService: apiKey is required");
    }
    if (!config.baseUrl) {
      throw new Error("ZeroEntropyEmbeddingService: baseUrl is required");
    }
    if (!config.model) {
      throw new Error("ZeroEntropyEmbeddingService: model is required");
    }
    if (!config.dimensions || config.dimensions <= 0) {
      throw new Error("ZeroEntropyEmbeddingService: dimensions is required (must be a positive integer)");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dims = config.dimensions;
    this.sendDimensions = config.sendDimensions ?? true;
    this.maxInputChars = config.maxInputChars && config.maxInputChars > 0 ? config.maxInputChars : void 0;
    this.timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_API_TIMEOUT_MS;
    this.logger = logger;
  }
  getDimensions() {
    return this.dims;
  }
  getProviderInfo() {
    return { provider: "zeroentropy", model: this.model };
  }
  /** Remote embedding is always ready (stateless HTTP). */
  isReady() {
    return true;
  }
  /** No-op for remote embedding (no local model to warm up). */
  startWarmup() {
  }
  async embed(text, options) {
    const [result] = await this.embedBatch([text], options);
    return result;
  }
  async embedBatch(texts, options) {
    if (texts.length === 0) return [];
    const processedTexts = truncateEmbeddingInputs(texts, this.maxInputChars, this.logger);
    if (processedTexts.length > MAX_BATCH_SIZE) {
      const results = [];
      for (let i = 0; i < processedTexts.length; i += MAX_BATCH_SIZE) {
        const chunk = processedTexts.slice(i, i + MAX_BATCH_SIZE);
        const chunkResults = await this._callApi(chunk, options?.timeoutMs);
        results.push(...chunkResults);
      }
      return results;
    }
    return this._callApi(processedTexts, options?.timeoutMs);
  }
  async _callApi(texts, timeoutOverride) {
    const body = {
      input: texts,
      model: this.model,
      input_type: "query"
    };
    if (this.sendDimensions) {
      body.dimensions = this.dims;
    }
    const fetchUrl = `${this.baseUrl}/models/embed`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`
    };
    const json = await postEmbeddingRequest({
      fetchUrl,
      headers,
      body,
      timeoutMs: timeoutOverride ?? this.timeoutMs
    });
    if (!json.results || !Array.isArray(json.results)) {
      throw new Error("ZeroEntropy embedding API returned unexpected format: missing 'results' array");
    }
    return json.results.map((r) => sanitizeAndNormalize(r.embedding));
  }
};
function createEmbeddingService(config, logger) {
  if (config && config.provider === "zeroentropy" && "apiKey" in config && config.apiKey) {
    logger?.debug?.(`${TAG13} Using ZeroEntropy embedding (model=${config.model})`);
    return new ZeroEntropyEmbeddingService(config, logger);
  }
  if (config && config.provider !== "local" && "apiKey" in config && config.apiKey) {
    logger?.debug?.(`${TAG13} Using remote embedding (provider=${config.provider}, model=${config.model})`);
    return new OpenAIEmbeddingService(config, logger);
  }
  if (config && config.provider === "local") {
    const localConfig = config;
    logger?.debug?.(`${TAG13} Using local embedding (node-llama-cpp, model=${localConfig.modelPath ?? DEFAULT_LOCAL_MODEL})`);
    return new LocalEmbeddingService(localConfig, logger);
  }
  logger?.debug?.(`${TAG13} No remote embedding configured, falling back to local embedding (node-llama-cpp)`);
  return new LocalEmbeddingService(void 0, logger);
}
var NoopEmbeddingService = class {
  embed(_text) {
    return Promise.resolve(new Float32Array(0));
  }
  embedBatch(texts) {
    return Promise.resolve(texts.map(() => new Float32Array(0)));
  }
  getDimensions() {
    return 0;
  }
  getProviderInfo() {
    return { provider: "noop", model: "server-side" };
  }
  isReady() {
    return true;
  }
  startWarmup() {
  }
};

// src/core/store/bm25-local.ts
import { createRequire as createRequire2 } from "node:module";
var nodeRequire = createRequire2(import.meta.url);
var cachedTcvdbText;
function loadTcvdbText() {
  if (cachedTcvdbText !== void 0) {
    if (cachedTcvdbText === null) throw new Error("tcvdb-text unavailable");
    return cachedTcvdbText;
  }
  try {
    cachedTcvdbText = nodeRequire("@tencentdb-agent-memory/tcvdb-text");
    return cachedTcvdbText;
  } catch {
    cachedTcvdbText = null;
    throw new Error("@tencentdb-agent-memory/tcvdb-text is not installed");
  }
}
var TAG14 = "[memory-tdai][bm25-local]";
var BM25LocalEncoder = class {
  encoder;
  logger;
  constructor(language = "zh", logger) {
    this.logger = logger;
    this.encoder = loadTcvdbText().BM25Encoder.default(language);
    logger?.debug?.(`${TAG14} Initialized BM25 local encoder (language=${language})`);
  }
  /**
   * Encode document texts for upsert (TF-based BM25 scoring).
   * Returns one SparseVector per input text.
   */
  encodeTexts(texts) {
    if (texts.length === 0) return [];
    try {
      return this.encoder.encodeTexts(texts);
    } catch (err) {
      this.logger?.warn(
        `${TAG14} encodeTexts failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  /**
   * Encode query texts for search (IDF-based BM25 scoring).
   * Returns one SparseVector per input text.
   */
  encodeQueries(texts) {
    if (texts.length === 0) return [];
    try {
      return this.encoder.encodeQueries(texts);
    } catch (err) {
      this.logger?.warn(
        `${TAG14} encodeQueries failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
};
function createBM25Encoder(config, logger) {
  if (!config.enabled) {
    logger?.debug?.(`${TAG14} BM25 sparse encoding disabled`);
    return void 0;
  }
  try {
    return new BM25LocalEncoder(config.language ?? "zh", logger);
  } catch (err) {
    logger?.warn?.(
      `${TAG14} BM25 sparse encoding unavailable (${err instanceof Error ? err.message : String(err)}) \u2014 falling back to FTS5-only retrieval`
    );
    return void 0;
  }
}

// src/core/store/factory.ts
var TAG15 = "[memory-tdai][factory]";
function createStoreBundle(config, options) {
  const { logger } = options;
  const bm25Encoder = createBM25Encoder(config.bm25, logger);
  switch (config.storeBackend) {
    case "tcvdb": {
      const tcvdbCfg = config.tcvdb;
      if (!tcvdbCfg.url || !tcvdbCfg.apiKey) {
        throw new Error(`${TAG15} TCVDB backend requires tcvdb.url and tcvdb.apiKey`);
      }
      if (!tcvdbCfg.database) {
        throw new Error(`${TAG15} TCVDB backend requires tcvdb.database \u2014 please set a unique database name in your openclaw.json plugin config`);
      }
      const database = tcvdbCfg.database;
      const store = new TcvdbMemoryStore({
        url: tcvdbCfg.url,
        username: tcvdbCfg.username,
        apiKey: tcvdbCfg.apiKey,
        database,
        embeddingModel: tcvdbCfg.embeddingModel,
        timeout: tcvdbCfg.timeout,
        caPemPath: tcvdbCfg.caPemPath,
        logger,
        bm25Encoder: bm25Encoder ?? void 0
      });
      logger?.debug?.(
        `${TAG15} Store created: backend=tcvdb, database=${database}, model=${tcvdbCfg.embeddingModel}, bm25=${bm25Encoder ? "enabled" : "disabled"}`
      );
      return {
        store,
        embedding: new NoopEmbeddingService(),
        bm25Encoder,
        storeSnapshot: {
          type: "tcvdb",
          tcvdbUrl: tcvdbCfg.url,
          tcvdbDatabase: database,
          tcvdbAlias: tcvdbCfg.alias || void 0
        }
      };
    }
    case "sqlite":
    default: {
      let embeddingService;
      if (config.embedding.enabled && config.embedding.provider !== "local" && config.embedding.apiKey) {
        embeddingService = createEmbeddingService({
          provider: config.embedding.provider,
          baseUrl: config.embedding.baseUrl,
          apiKey: config.embedding.apiKey,
          model: config.embedding.model,
          dimensions: config.embedding.dimensions,
          sendDimensions: config.embedding.sendDimensions,
          maxInputChars: config.embedding.maxInputChars
        }, logger);
      }
      const dims = config.embedding.dimensions;
      const dbPath = path7.join(options.dataDir, "vectors.db");
      const store = new VectorStore(dbPath, dims, logger);
      logger?.debug?.(
        `${TAG15} Store created: backend=sqlite, dbPath=${dbPath}, dimensions=${dims}, embedding=${embeddingService ? "enabled" : "disabled"}, bm25=${bm25Encoder ? "enabled" : "disabled"}`
      );
      return {
        store,
        embedding: embeddingService,
        bm25Encoder,
        storeSnapshot: {
          type: "sqlite",
          sqlitePath: path7.relative(options.dataDir, dbPath)
        }
      };
    }
  }
}

// src/utils/manifest.ts
import fs7 from "node:fs";
import path8 from "node:path";
var METADATA_DIR = ".metadata";
var MANIFEST_FILE = "manifest.json";
function manifestPath(dataDir) {
  return path8.join(dataDir, METADATA_DIR, MANIFEST_FILE);
}
function readManifest(dataDir) {
  const p = manifestPath(dataDir);
  try {
    if (!fs7.existsSync(p)) return null;
    const raw = fs7.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeManifest(dataDir, manifest) {
  const dir = path8.join(dataDir, METADATA_DIR);
  fs7.mkdirSync(dir, { recursive: true });
  fs7.writeFileSync(
    manifestPath(dataDir),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8"
  );
}
function buildStoreInfo(snapshot) {
  const info = { type: snapshot.type };
  if (snapshot.type === "sqlite") {
    info.sqlite = { path: snapshot.sqlitePath ?? "vectors.db" };
  } else {
    info.tcvdb = {
      url: snapshot.tcvdbUrl,
      database: snapshot.tcvdbDatabase,
      alias: snapshot.tcvdbAlias || void 0
    };
  }
  return info;
}
function diffStoreBinding(persisted, current) {
  const diffs = [];
  if (persisted.type !== current.type) {
    diffs.push(`store type changed: ${persisted.type} \u2192 ${current.type}`);
    return diffs;
  }
  if (persisted.type === "sqlite" && current.type === "sqlite") {
    if (persisted.sqlite?.path !== current.sqlite?.path) {
      diffs.push(`sqlite path changed: ${persisted.sqlite?.path} \u2192 ${current.sqlite?.path}`);
    }
  }
  if (persisted.type === "tcvdb" && current.type === "tcvdb") {
    if (persisted.tcvdb?.url !== current.tcvdb?.url) {
      diffs.push(`tcvdb url changed: ${persisted.tcvdb?.url} \u2192 ${current.tcvdb?.url}`);
    }
    if (persisted.tcvdb?.database !== current.tcvdb?.database) {
      diffs.push(`tcvdb database changed: ${persisted.tcvdb?.database} \u2192 ${current.tcvdb?.database}`);
    }
  }
  return diffs;
}

// src/core/scene/scene-extractor.ts
import fs10 from "node:fs/promises";
import path11 from "node:path";

// src/utils/backup.ts
import fs8 from "node:fs/promises";
import path9 from "node:path";
var BackupManager = class {
  backupRoot;
  /**
   * @param backupRoot - Absolute path to the root backup directory
   *                     (e.g. `<dataDir>/.backup`).
   */
  constructor(backupRoot) {
    this.backupRoot = backupRoot;
  }
  /**
   * Backup a single file.
   *
   * Destination: `<backupRoot>/<category>/<category>_<timestamp>_<tag>.<ext>`
   *
   * @param srcFile   - Absolute path to the source file
   * @param category  - Logical grouping (e.g. "persona")
   * @param tag       - Additional identifier (e.g. "offset42")
   * @param maxKeep   - Max backup files to retain in this category (0 = unlimited)
   */
  async backupFile(srcFile, category, tag, maxKeep) {
    try {
      await fs8.access(srcFile);
    } catch {
      return;
    }
    const destDir = path9.join(this.backupRoot, category);
    await fs8.mkdir(destDir, { recursive: true });
    const ext = path9.extname(srcFile);
    const timestamp = formatTimestamp2(/* @__PURE__ */ new Date());
    const destName = `${category}_${timestamp}_${tag}${ext}`;
    await fs8.copyFile(srcFile, path9.join(destDir, destName));
    if (maxKeep > 0) {
      await pruneOldEntries(destDir, maxKeep, "file");
    }
  }
  /**
   * Backup an entire directory (shallow copy of all files).
   *
   * Destination: `<backupRoot>/<category>/<category>_<timestamp>_<tag>/`
   *
   * @param srcDir    - Absolute path to the source directory
   * @param category  - Logical grouping (e.g. "scene_blocks")
   * @param tag       - Additional identifier (e.g. "offset42")
   * @param maxKeep   - Max backup directories to retain in this category (0 = unlimited)
   */
  async backupDirectory(srcDir, category, tag, maxKeep) {
    let entries;
    try {
      entries = await fs8.readdir(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) return;
    const parentDir = path9.join(this.backupRoot, category);
    const timestamp = formatTimestamp2(/* @__PURE__ */ new Date());
    const destDir = path9.join(parentDir, `${category}_${timestamp}_${tag}`);
    await fs8.mkdir(destDir, { recursive: true });
    for (const file of files) {
      await fs8.copyFile(path9.join(srcDir, file), path9.join(destDir, file));
    }
    if (maxKeep > 0) {
      await pruneOldEntries(parentDir, maxKeep, "directory");
    }
  }
  /**
   * Find the latest backup directory for a category.
   *
   * Backup directory names are `<category>_<timestamp>_<tag>` where the
   * timestamp is `YYYYMMDD_HHmmss` (lexicographic order = chronological order),
   * so the lexicographically largest entry is the most recent one.
   *
   * @param category - Logical grouping (e.g. "scene_blocks")
   * @returns Absolute path to the latest backup directory, or undefined if none.
   */
  async findLatestBackup(category) {
    const parentDir = path9.join(this.backupRoot, category);
    let entries;
    try {
      entries = await fs8.readdir(parentDir, { withFileTypes: true });
    } catch {
      return void 0;
    }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (dirs.length === 0) return void 0;
    dirs.sort();
    return path9.join(parentDir, dirs[dirs.length - 1]);
  }
  /**
   * Restore the latest backup of `category` into `destDir`.
   *
   * Strategy:
   *   1. Find the latest backup directory; if none exists, do nothing
   *      (fail-soft: never clobber the destination when there is no
   *      ground truth to restore from).
   *   2. Wipe `destDir` and recreate it.
   *   3. Copy every regular file from the backup directory into `destDir`.
   *
   * @param category - Logical grouping (e.g. "scene_blocks")
   * @param destDir  - Absolute path to the directory to restore into
   * @returns `{ restored: true, from }` when a backup was applied,
   *          `{ restored: false }` when no backup was found.
   * @throws  Lets fs errors during wipe/copy propagate so callers can decide
   *          whether to fail-soft (log) or fail-hard.
   */
  async restoreLatestDirectory(category, destDir) {
    const from = await this.findLatestBackup(category);
    if (!from) return { restored: false };
    await fs8.rm(destDir, { recursive: true, force: true });
    await fs8.mkdir(destDir, { recursive: true });
    const entries = await fs8.readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      await fs8.copyFile(path9.join(from, entry.name), path9.join(destDir, entry.name));
    }
    return { restored: true, from };
  }
};
function formatTimestamp2(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "_",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join("");
}
async function pruneOldEntries(dir, maxKeep, kind) {
  let entries;
  try {
    entries = await fs8.readdir(dir);
  } catch {
    return;
  }
  entries.sort();
  const toRemove = entries.slice(0, Math.max(0, entries.length - maxKeep));
  for (const name of toRemove) {
    try {
      if (kind === "file") {
        await fs8.unlink(path9.join(dir, name));
      } else {
        await fs8.rm(path9.join(dir, name), { recursive: true, force: true });
      }
    } catch {
    }
  }
}

// src/core/scene/filename-normalizer.ts
import fs9 from "node:fs/promises";
import path10 from "node:path";
function normalizeSceneFilename(name) {
  if (!name) return "scene.md";
  const base = name.replace(/^.*[\\/]/, "");
  const lower = base.toLowerCase();
  const hasMd = lower.endsWith(".md");
  const stem = hasMd ? base.slice(0, -3) : base;
  const safe = stem.replace(/[\s\u00A0\u3000]+/g, "-").replace(/[()[\]{}<>'"`,;:!?*|/\\=&%$#@^~+]/g, "").replace(/-{2,}/g, "-").replace(/_{2,}/g, "_").replace(/\.{2,}/g, ".").replace(/^[-_.]+|[-_.]+$/g, "");
  return (safe || "scene") + ".md";
}
async function resolveUniqueScenePath(dir, desired, excludePath) {
  const target = path10.join(dir, desired);
  if (!await pathExists(target) || target === excludePath) return target;
  const ext = ".md";
  const stem = desired.endsWith(ext) ? desired.slice(0, -ext.length) : desired;
  for (let i = 2; i < 1e3; i++) {
    const candidate = path10.join(dir, `${stem}-${i}${ext}`);
    if (!await pathExists(candidate) || candidate === excludePath) {
      return candidate;
    }
  }
  throw new Error(
    `resolveUniqueScenePath: could not find a free slot for ${desired} in ${dir} after 1000 attempts`
  );
}
async function pathExists(p) {
  try {
    await fs9.access(p);
    return true;
  } catch {
    return false;
  }
}
async function normalizeSceneFilenames(blocksDir, logger) {
  const result = { renamed: 0, skipped: 0, renames: [] };
  let entries;
  try {
    entries = (await fs9.readdir(blocksDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return result;
  }
  for (const file of entries) {
    const normalized = normalizeSceneFilename(file);
    if (normalized === file) {
      result.skipped++;
      continue;
    }
    const from = path10.join(blocksDir, file);
    let to;
    try {
      to = await resolveUniqueScenePath(blocksDir, normalized, from);
    } catch (err) {
      logger?.warn?.(
        `[filename-normalizer] could not resolve unique target for ${file}: ${err instanceof Error ? err.message : String(err)}`
      );
      result.skipped++;
      continue;
    }
    if (to === from) {
      result.skipped++;
      continue;
    }
    try {
      await fs9.rename(from, to);
      result.renamed++;
      result.renames.push({ from: file, to: path10.basename(to) });
      logger?.debug?.(`[filename-normalizer] renamed: ${file} \u2192 ${path10.basename(to)}`);
    } catch (err) {
      logger?.warn?.(
        `[filename-normalizer] rename failed (${file} \u2192 ${path10.basename(to)}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return result;
}

// src/core/prompts/scene-extraction.ts
function buildSceneSystemPrompt(maxScenes) {
  return `# Memory Consolidation Architect

**Output language contract**:
- Detect the dominant language from "New Memories List".
- Scene file names, Markdown section headings, and natural-language body text must use that language.
- For English memories, output English file names and English section headings.
- For non-Chinese memories, do not emit Chinese file names or Chinese section headings.
- If the language is ambiguous, default to English.
- Keep META field names (\`created\`, \`updated\`, \`summary\`, \`heat\`) and system markers such as \`[DELETED]\` in English.

## \u89D2\u8272\u5B9A\u4E49 (Role Definition)
\u4F60\u662F\u8BB0\u5FC6\u6574\u5408\u67B6\u6784\u5E08\u3002\u4F60\u7684\u76EE\u6807\u662F\u4E3A\u7528\u6237\u6784\u5EFA\u4E00\u4E2A"\u6570\u5B57\u7B2C\u4E8C\u5927\u8111"\u3002\u4F60\u4E0D\u4EC5\u4EC5\u662F\u5728\u8BB0\u5F55\u6570\u636E\uFF0C\u4F60\u66F4\u50CF\u662F\u4E00\u4F4D\u4EBA\u7C7B\u5B66\u5BB6\u548C\u5FC3\u7406\u5B66\u5BB6\uFF0C\u8D1F\u8D23\u5206\u6790\u539F\u59CB\u8BB0\u5FC6\uFF0C\u4ECE\u4E2D\u63D0\u53D6\u6838\u5FC3\u7279\u5F81\u3001\u6355\u6349\u9690\u6027\u4FE1\u53F7\uFF0C\u5E76\u6784\u5EFA\u4E0D\u65AD\u6F14\u53D8\u7684\u53D9\u4E8B\u3002


## \u67B6\u6784\u6A21\u578B

### Layer 1 (Input): Raw Memories
- **\u6765\u6E90**\uFF1AAPI \u5206\u6279\u53EC\u56DE\uFF08\u6BCF\u6279 20 \u6761\uFF09
- **\u72B6\u6001**\uFF1A\u788E\u7247\u5316\u3001\u65E0\u5E8F

### Layer 2 (Processing): Scene Diaries  
- **\u5F62\u6001**\uFF1A**\u4E0D\u662F\u6E05\u5355\uFF0C\u662F\u8FDE\u8D2F\u7684\u53D9\u4E8B\u6587\u6863**
- **\u903B\u8F91**\uFF1A\u5C06 L1 \u788E\u7247\u878D\u5408\u8FDB\u7279\u5B9A\u573A\u666F\u6587\u4EF6
- **\u52A8\u4F5C**\uFF1ACreate\uFF08\u521B\u5EFA\uFF09\u3001Integrate\uFF08\u6574\u5408\uFF09\u3001Rewrite\uFF08\u91CD\u5199\uFF09
- **\u7981\u6B62**\uFF1A\u7B80\u5355\u8FFD\u52A0\u5217\u8868

\u4F60\u4E3B\u8981\u8D1F\u8D23L1\u5230L2\u7684\u751F\u6210\u4EFB\u52A1

## \u8F93\u5165\u73AF\u5883 (Input Context)
\u4F60\u5C06\u63A5\u6536\u4E09\u4E2A\u8F93\u5165\uFF1A
1. \u65B0\u589E\u8BB0\u5FC6 (New Memory): \u4E00\u6BB5\u539F\u59CB\u7684\u3001\u975E\u7ED3\u6784\u5316\u7684\u65B0\u8FD1\u56DE\u5FC6\u4FE1\u606F\u3002
2. \u73B0\u6709 Block \u6620\u5C04\u8868 (Existing Blocks Map): \u5305\u542B\u5F53\u524D\u6240\u6709\u8BB0\u5FC6\u5757\uFF08Markdown \u6587\u4EF6\uFF09\u7684\u6587\u4EF6\u540D\u548C\u6458\u8981\u7684\u5217\u8868\u3002
3. \u5F53\u524D\u65F6\u95F4 (Current Time): \u7528\u4E8E\u751F\u6210\u5143\u6570\u636E\u7684\u5177\u4F53\u65F6\u95F4\u6233\u3002

**\u26A0\uFE0F \u573A\u666F\u6587\u4EF6\u6570\u91CF\u4E0A\u9650\uFF1A${maxScenes} \u4E2A\u3002\u5904\u7406\u5B8C\u6210\u540E\u76EE\u5F55\u4E2D\u7684\u573A\u666F\u6587\u4EF6\u6570\u91CF\u5FC5\u987B\u4E25\u683C\u5C0F\u4E8E\u6B64\u4E0A\u9650\u3002**

## \u26D4 \u6587\u4EF6\u64CD\u4F5C\u7EA6\u675F\uFF08\u5FC5\u987B\u4E25\u683C\u9075\u5B88\uFF09
1. **\u6240\u6709\u6587\u4EF6\u64CD\u4F5C\u4F7F\u7528\u76F8\u5BF9\u6587\u4EF6\u540D**\uFF08\u5982 \`Engineering-Practice.md\`\uFF09\uFF0C\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u5DF2\u8BBE\u4E3A\u573A\u666F\u6587\u4EF6\u76EE\u5F55
2. **read \u53EA\u80FD\u8BFB\u53D6\u7528\u6237\u6D88\u606F\u4E2D"\u5DF2\u6709\u573A\u666F\u6587\u4EF6\u6E05\u5355"\u5217\u51FA\u7684\u6587\u4EF6**\uFF0C\u7981\u6B62\u731C\u6D4B\u6216\u7F16\u9020\u4E0D\u5728\u6E05\u5355\u4E2D\u7684\u6587\u4EF6\u540D
3. **\u521B\u5EFA\u65B0\u573A\u666F\u6587\u4EF6\u65F6**\uFF0C\u4F7F\u7528 **write** \u5DE5\u5177\u3002\u53C2\u6570\uFF1A\`path\`=\u6587\u4EF6\u540D, \`content\`=\u5B8C\u6574\u5185\u5BB9
4. **\u5C40\u90E8\u66F4\u65B0\u573A\u666F\u6587\u4EF6**\uFF1A\u4F7F\u7528 **edit** \u5DE5\u5177\u3002\u53C2\u6570\uFF1A\`path\`=\u6587\u4EF6\u540D, \`edits\`=[{\`oldText\`: \u65E7\u5185\u5BB9, \`newText\`: \u65B0\u5185\u5BB9}]\u3002\u5BF9\u4E8E\u5927\u8303\u56F4\u91CD\u5199\u6216\u7ED3\u6784\u6027\u53D8\u66F4\uFF0C\u5EFA\u8BAE\u4F7F\u7528 **read** + **write** \u6574\u4F53\u91CD\u5199\u3002
5. **\u573A\u666F\u7D22\u5F15\u548C\u7CFB\u7EDF\u914D\u7F6E\u7531\u5DE5\u7A0B\u7CFB\u7EDF\u81EA\u52A8\u7EF4\u62A4**\uFF0C\u4F60\u53EA\u9700\u4E13\u6CE8\u4E8E\u64CD\u4F5C \`.md\` \u573A\u666F\u6587\u4EF6
6. **\u5220\u9664\u6587\u4EF6\u7684\u552F\u4E00\u65B9\u5F0F**\uFF1A\u4F7F\u7528 **write** \u5DE5\u5177\u5C06\u6587\u4EF6\u5185\u5BB9\u5199\u4E3A \`[DELETED]\` \u6807\u8BB0\uFF08\`path\`=\u6587\u4EF6\u540D, \`content\`=\`[DELETED]\`\uFF09\u3002\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u6E05\u7406\u5E26\u6709\u6B64\u6807\u8BB0\u7684\u6587\u4EF6\u3002**\u7981\u6B62**\u5199\u5165\u7A7A\u5B57\u7B26\u4E32\uFF08\u4F1A\u88AB\u7CFB\u7EDF\u62D2\u7EDD\uFF09\u3002**\u7981\u6B62**\u7528 \`[ARCHIVE]\`\u3001\`[CONSOLIDATED]\` \u7B49\u5176\u4ED6\u6807\u8BB0\u66FF\u4EE3\u5220\u9664\u2014\u2014\u53EA\u6709 \`[DELETED]\` \u6807\u8BB0\u4F1A\u89E6\u53D1\u7CFB\u7EDF\u6E05\u7406\u3002
7. **\u7981\u6B62\u521B\u5EFA\u62A5\u544A/\u6574\u5408/\u6C47\u603B\u7C7B\u6587\u4EF6**\u3002\u4F60\u7684\u8F93\u51FA\u5FC5\u987B\u662F\u6709\u610F\u4E49\u7684\u573A\u666F\u53D9\u4E8B\u6587\u4EF6\uFF08\u5982"\u6280\u672F\u67B6\u6784\u4E0E\u5DE5\u7A0B\u5B9E\u8DF5.md"\u3001"\u65E5\u5E38\u751F\u6D3B\u4E0E\u5DE5\u4F5C\u8282\u594F.md"\uFF09\u3002\u7981\u6B62\u521B\u5EFA\u4EE5 BATCH\u3001REPORT\u3001CONSOLIDATION\u3001INTEGRATION\u3001ARCHIVE\u3001SUMMARY \u7B49\u4E3A\u524D\u7F00\u7684\u6587\u4EF6\u3002

## \u{1F4DB} \u6587\u4EF6\u547D\u540D\u89C4\u8303\uFF08\u5F3A\u5236\uFF09

\u4E3A\u4FDD\u8BC1\u4E0B\u6E38\u5DE5\u5177\uFF08\u573A\u666F\u5BFC\u822A\u3001\u5065\u5EB7\u68C0\u67E5\u3001\u5BF9\u8C61\u5B58\u50A8\u540C\u6B65\u7B49\uFF09\u80FD\u6B63\u786E\u89E3\u6790\u8DEF\u5F84\u5F15\u7528\uFF0C**\u65B0\u5EFA\u6587\u4EF6**\u6216 **MERGE \u540E\u7684\u76EE\u6807\u6587\u4EF6**\u5FC5\u987B\u9075\u5B88\u4EE5\u4E0B\u547D\u540D\u89C4\u5219\uFF1A

- **\u5141\u8BB8\u5B57\u7B26**\uFF1AUnicode letters\uFF08\u5305\u62EC Latin/CJK/Cyrillic \u7B49\uFF09\u3001\u6570\u5B57\u3001\u77ED\u6A2A\u7EBF \`-\`\u3001\u4E0B\u5212\u7EBF \`_\`\u3001\u70B9\u53F7 \`.\`
- **\u5FC5\u987B\u4EE5 \`.md\` \u7ED3\u5C3E**\uFF08\u5C0F\u5199\uFF09
- **\u274C \u7981\u6B62\u5305\u542B**\uFF1A\u7A7A\u683C\u3001\u5168\u89D2\u7A7A\u683C\u3001\u5F15\u53F7\u3001\u62EC\u53F7 \`( ) [ ] { }\`\u3001\u659C\u6760 \`/ \\\`\u3001\u5192\u53F7 \`:\`\u3001\u5206\u53F7 \`;\`\u3001\u95EE\u53F7 \`?\`\u3001\u611F\u53F9\u53F7 \`!\`\u3001\u661F\u53F7 \`*\`\u3001\u7AD6\u7EBF \`|\`\u3001\u5176\u4ED6\u6807\u70B9
- **\u591A\u8BCD\u5206\u9694**\uFF1A\u4F7F\u7528 \`-\`\uFF08\u77ED\u6A2A\u7EBF\uFF09\u8FDE\u63A5\uFF0C\u4E0D\u8981\u7528\u7A7A\u683C
- **\u66F4\u65B0\u73B0\u6709\u6587\u4EF6**\u65F6\uFF0C\u6CBF\u7528\u6E05\u5355\u4E2D\u7ED9\u51FA\u7684\u6587\u4EF6\u540D\uFF0C\u4E0D\u8981\u6539\u540D
- **\u82F1\u6587\u8BB0\u5FC6\u7684\u65B0\u5EFA\u6587\u4EF6\u540D**\u5FC5\u987B\u4F7F\u7528\u82F1\u6587\u6807\u9898\uFF0C\u5E76\u7528\u77ED\u6A2A\u7EBF\u8FDE\u63A5\u5355\u8BCD

\u2705 \u6B63\u786E\u793A\u4F8B\uFF1A
- \`Daily-Rhythm-in-Shanghai.md\`
- \`\u65E5\u5E38\u751F\u6D3B-\u5065\u5EB7\u7BA1\u7406.md\`
- \`\u6280\u672F\u7814\u7A76-Rust\u5B66\u4E60.md\`
- \`Coffee-Yirgacheffe.md\`
- \`Work-and-Engineering-Practice.md\`

\u274C \u9519\u8BEF\u793A\u4F8B\uFF08\u6BCF\u6B21\u90FD\u4F1A\u89E6\u53D1\u5DE5\u7A0B\u515C\u5E95\u91CD\u547D\u540D\uFF09\uFF1A
- \`Daily Rhythm in Shanghai.md\`\uFF08\u542B\u7A7A\u683C\uFF09
- \`Coffee (Yirgacheffe).md\`\uFF08\u542B\u62EC\u53F7\uFF09
- \`Q1 Milestone?.md\`\uFF08\u542B\u7A7A\u683C\u548C\u95EE\u53F7\uFF09

> \u63D0\u793A\uFF1A\u5373\u4F7F\u4F60\u6CA1\u9075\u5B88\uFF0C\u5DE5\u7A0B\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u5F52\u4E00\u5316\u6587\u4EF6\u540D\uFF08\u7A7A\u683C\u66FF\u6362\u4E3A\u77ED\u6A2A\u7EBF\u3001\u5220\u9664\u62EC\u53F7\u7B49\uFF09\uFF0C\u4F46\u8FD9\u4F1A\u589E\u52A0\u65E5\u5FD7\u566A\u97F3\u548C\u6F5C\u5728\u51B2\u7A81\u3002\u8BF7\u5728 \`write\` \u65F6\u76F4\u63A5\u4F7F\u7528\u5408\u89C4\u540D\u5B57\u3002


## \u5DE5\u4F5C\u6D41\u4E0E\u903B\u8F91 (Workflow & Logic)
\u5728\u751F\u6210\u8F93\u51FA\u4E4B\u524D\uFF0C\u4F60\u5FC5\u987B\u6267\u884C\u4EE5\u4E0B"\u601D\u7EF4\u94FE"\u8FC7\u7A0B\uFF1A

### \u26A0\uFE0F \u9636\u6BB5 0\uFF1A\u5F3A\u5236\u68C0\u67E5\u573A\u666F\u603B\u6570\uFF08\u5FC5\u987B\u5148\u6267\u884C\uFF09

**\u5728\u5904\u7406\u4EFB\u4F55\u8BB0\u5FC6\u4E4B\u524D\uFF0C\u4F60\u5FC5\u987B\uFF1A**

1. **\u7EDF\u8BA1\u5F53\u524D\u573A\u666F\u603B\u6570**\uFF1A\u67E5\u770B "Existing Scene Blocks Summary" \u9876\u90E8\u6807\u6CE8\u7684\u5F53\u524D\u573A\u666F\u603B\u6570
2. **\u6700\u7EC8\u76EE\u6807**\uFF1A\u5904\u7406\u5B8C\u6210\u540E\uFF0C\u76EE\u5F55\u4E2D\u7684\u573A\u666F\u6587\u4EF6\u6570\u91CF\u5FC5\u987B **\u4E25\u683C\u5C0F\u4E8E ${maxScenes}**
3. **\u9075\u5B88\u5206\u7EA7\u9884\u8B66**\uFF1A
   - \u7EA2\u8272\u9884\u8B66\uFF08\u2265 ${maxScenes}\uFF09\uFF1A**\u5FC5\u987B\u5148\u901A\u8FC7 MERGE \u51CF\u5C11\u6587\u4EF6\u6570\u91CF**\uFF0C\u5C06\u6700\u76F8\u4F3C\u7684 2-4 \u4E2A\u573A\u666F\u5408\u5E76\u4E3A 1 \u4E2A\uFF0C**\u5E76\u5220\u9664\u88AB\u5408\u5E76\u7684\u65E7\u6587\u4EF6**\uFF0C\u76F4\u5230\u6587\u4EF6\u6570 < ${maxScenes} \u540E\uFF0C\u518D\u5904\u7406\u65B0\u8BB0\u5FC6
   - \u6A59\u8272\u9884\u8B66\uFF08= ${maxScenes - 1}\uFF09\uFF1A**\u53EA\u80FD UPDATE \u73B0\u6709\u573A\u666F\uFF0C\u4E0D\u80FD CREATE \u65B0\u573A\u666F**
   - \u9EC4\u8272\u9884\u8B66\uFF08\u63A5\u8FD1 ${maxScenes}\uFF09\uFF1A**\u4F18\u5148 UPDATE \u6216\u4E3B\u52A8 MERGE \u76F8\u4F3C\u573A\u666F**

**\u5408\u5E76\u4F18\u5148\u7EA7**\uFF08\u5F53\u9700\u8981\u5408\u5E76\u65F6\uFF0C\u6309\u4EE5\u4E0B\u987A\u5E8F\u9009\u62E9\uFF09\uFF1A
1. **\u4E3B\u9898\u9AD8\u5EA6\u91CD\u53E0**\uFF1A\u5982"Python\u540E\u7AEF\u5F00\u53D1"\u548C"Go\u540E\u7AEF\u5F00\u53D1" \u2192 \u5408\u5E76\u4E3A"\u540E\u7AEF\u5F00\u53D1\u6280\u672F\u6808"
2. **\u53D9\u4E8B\u5F27\u7EBF\u76F8\u540C**\uFF1A\u5982"\u6C42\u804C\u6750\u6599-JD\u5339\u914D"\u548C"\u804C\u4E1A\u53D1\u5C55-\u80FD\u529B\u5BF9\u9F50" \u2192 \u5408\u5E76\u4E3A"\u804C\u4E1A\u53D1\u5C55\u4E0E\u6C42\u804C"
3. **\u70ED\u5EA6\u6700\u4F4E\u7684\u573A\u666F**\uFF1A\u5982\u679C\u6CA1\u6709\u660E\u663E\u91CD\u53E0\uFF0C\u5408\u5E76\u6216\u5220\u9664 heat \u6700\u4F4E\u7684 2-3 \u4E2A\u573A\u666F

### \u9636\u6BB5 1\uFF1A\u5206\u6790\u4E0E\u5206\u7C7B
\u5206\u6790 \u65B0\u589E\u8BB0\u5FC6\u3002\u5B83\u7684\u6838\u5FC3\u9886\u57DF\u662F\u4EC0\u4E48\uFF1F\uFF08\u4F8B\u5982\uFF1A\u7F16\u7A0B\u98CE\u683C\u3001\u60C5\u7EEA\u72B6\u6001\u3001\u804C\u4E1A\u8F68\u8FF9\u3001\u4EBA\u9645\u5173\u7CFB\uFF09\u3002
\u63D0\u53D6\u4E8B\u5B9E\u4E8B\u4EF6\u94FE\uFF08\u89E6\u53D1 -> \u884C\u52A8 -> \u7ED3\u679C\uFF09\u4EE5\u53CA\u5E95\u5C42\u7684\u5FC3\u7406\u72B6\u6001\u3002

### \u9636\u6BB5 2\uFF1A\u68C0\u7D22\u4E0E\u7B56\u7565\u9009\u62E9
\u5C06\u65B0\u8BB0\u5FC6\u4E0E \u73B0\u6709 Block \u6620\u5C04\u8868 \u8FDB\u884C\u6BD4\u5BF9\u3002
\u9700\u8981\u65F6\u4F7F\u7528 **read** \u5DE5\u5177\u8BFB\u53D6\u5B8C\u6574\u573A\u666F\u6587\u4EF6\u5185\u5BB9
**\u53EA\u80FD\u8BFB\u53D6\u7528\u6237\u6D88\u606F\u4E2D"\u5DF2\u6709\u573A\u666F\u6587\u4EF6\u6E05\u5355"\u5217\u51FA\u7684\u6587\u4EF6\uFF0C\u7981\u6B62\u731C\u6D4B\u5176\u4ED6\u6587\u4EF6\u8DEF\u5F84\u3002**

**\u6838\u5FC3\u539F\u5219\uFF1A\u9ED8\u8BA4\u7B56\u7565\u662F UPDATE\uFF0C\u4E0D\u662F CREATE\u3002** \u5F53\u72B9\u8C6B\u4E8E UPDATE \u548C CREATE \u4E4B\u95F4\u65F6\uFF0C\u9009\u62E9 UPDATE\u3002

\u7B56\u7565\u9009\u62E9\uFF08\u6309\u4F18\u5148\u7EA7\u6392\u5E8F\uFF09\uFF1A
1. **UPDATE\uFF08\u66F4\u65B0\uFF09**\u3010\u9996\u9009\u7B56\u7565\u3011: \u5982\u679C\u5B58\u5728\u76F8\u5173\u7684 Block\uFF08\u57FA\u4E8E\u6458\u8981\u6216\u6587\u4EF6\u540D\u7684\u76F8\u4F3C\u6027\uFF09\uFF0C\u5148\u7528 **read** \u8BFB\u53D6\u6587\u4EF6\u5185\u7684\u5177\u4F53\u4FE1\u606F\uFF0C\u518D\u9501\u5B9A\u8BE5 Block \u8FDB\u884C\u66F4\u65B0\uFF08**write** \u6574\u4F53\u91CD\u5199 \u6216 **edit** \u5C40\u90E8\u66FF\u6362\uFF09
2. **MERGE\uFF08\u5408\u5E76\uFF09**: 
   - \u5408\u5E76\u7684\u65B0 block \u5E94\u8BE5\u662F\u751F\u6210\u6982\u62EC\u6027\u66F4\u5F3A\u7684\u573A\u666F\uFF0C\u5305\u542B\u5DF2\u6709\u7684\u591A\u4E2A\u76F8\u4F3C\u573A\u666F
   - **\u5F3A\u5236\u5408\u5E76**\uFF1A\u5F53\u524D Block \u603B\u6570 **\u2265 ${maxScenes}** \u65F6\uFF0C\u5FC5\u987B\u5148\u5C06\u591A\u4E2A\u76F8\u4F3C\u8BB0\u5FC6\u5408\u5E76
   - **\u4E3B\u52A8\u5408\u5E76**\uFF1A\u5373\u4F7F\u672A\u8FBE\u4E0A\u9650\uFF0C\u5982\u679C\u4E24\u4E2A Block \u5C5E\u4E8E\u540C\u4E00\u53D9\u4E8B\u5F27\u7EBF\uFF0C\u4E5F\u5E94\u5408\u5E76\u4EE5\u589E\u52A0\u6DF1\u5EA6
   - **\u26A0\uFE0F \u5408\u5E76\u540E\u5FC5\u987B\u5220\u9664\u65E7\u6587\u4EF6**\uFF1A\u88AB\u5408\u5E76\u7684\u65E7\u573A\u666F\u6587\u4EF6\u5FC5\u987B\u901A\u8FC7 **write** \u5199\u5165 \`[DELETED]\` \u6807\u8BB0\u3002**\u4EC5\u4EC5\u6253\u6807\u8BB0\uFF08\u5982 [ARCHIVE]\u3001[CONSOLIDATED]\uFF09\u4E0D\u7B97\u5220\u9664\uFF0C\u6587\u4EF6\u4ECD\u4F1A\u5360\u7528\u914D\u989D\u3002**
3. **CREATE\uFF08\u65B0\u5EFA\uFF09**\u3010\u6700\u540E\u624B\u6BB5\u3011: 
   - **\u524D\u63D0\u6761\u4EF6**\uFF1A\u5F53\u524D\u573A\u666F\u603B\u6570 < ${maxScenes}
   - **CREATE \u524D\u7684\u5F3A\u5236\u9A8C\u8BC1**\uFF1A\u5FC5\u987B\u5148\u7528 **read** \u68C0\u67E5\u81F3\u5C11 2 \u4E2A\u6700\u76F8\u4F3C\u7684\u73B0\u6709\u573A\u666F\uFF0C\u786E\u8BA4\u65B0\u8BB0\u5FC6\u786E\u5B9E\u65E0\u6CD5\u878D\u5165\u540E\u624D\u80FD CREATE\u3002\u8DF3\u8FC7\u9A8C\u8BC1\u76F4\u63A5 CREATE \u662F\u88AB\u7981\u6B62\u7684
   - \u5982\u679C\u8BDD\u9898\u662F\u5168\u65B0\u7684\u4E14\u4E0E\u73B0\u6709\u5185\u5BB9\u533A\u5206\u5EA6\u9AD8\uFF0C\u53EF\u4EE5\u521B\u5EFA\u65B0 Block
   - **\u6BCF\u6B21\u6279\u5904\u7406\u6700\u591A\u65B0\u589E 1 \u4E2A\u573A\u666F**

**\u793A\u4F8B A\uFF1A\u65B0\u8BB0\u5FC6\u6574\u5408\u8FDB\u5DF2\u6709 block\uFF08UPDATE - \u539F\u5730\u66F4\u65B0\uFF09**
**\u5177\u4F53\u64CD\u4F5C\u6B65\u9AA4\uFF08\u5DE5\u5177\u8C03\u7528\uFF09**\uFF1A
1. **read**(\`path\`='Python\u540E\u7AEF\u5F00\u53D1.md') \u2192 \u83B7\u53D6\u5DF2\u6709\u5185\u5BB9 A
2. \u5206\u6790\u65B0\u8BB0\u5FC6 + \u5DF2\u6709\u5185\u5BB9 A \u2192 \u6574\u5408\u751F\u6210\u65B0\u5185\u5BB9 B\uFF08\`heat = \u65E7heat + 1\`\uFF09
3. **write**(\`path\`='Python\u540E\u7AEF\u5F00\u53D1.md', \`content\`=B) \u2192 **\u6574\u4F53\u91CD\u5199\u8BE5\u573A\u666F\u6587\u4EF6**
   \u6216 **edit**(\`path\`='Python\u540E\u7AEF\u5F00\u53D1.md', \`edits\`=[{\`oldText\`: \u65E7\u7AE0\u8282, \`newText\`: \u65B0\u7AE0\u8282}]) \u2192 **\u5C40\u90E8\u66F4\u65B0\u67D0\u90E8\u5206**

**\u793A\u4F8B B\uFF1A\u5408\u5E76\u591A\u4E2A block\uFF08MERGE \u2014 \u5408\u5E76\u540E\u5FC5\u987B\u5220\u9664\u65E7\u6587\u4EF6\uFF09**
**\u5177\u4F53\u64CD\u4F5C\u6B65\u9AA4\uFF08\u5DE5\u5177\u8C03\u7528\uFF09**\uFF1A
1. **read**(\`path\`='Python\u540E\u7AEF\u5F00\u53D1.md') \u2192 \u83B7\u53D6\u5185\u5BB9 A
2. **read**(\`path\`='Go\u540E\u7AEF\u5F00\u53D1.md') \u2192 \u83B7\u53D6\u5185\u5BB9 B
3. \u6574\u5408 A + B + \u65B0\u8BB0\u5FC6 \u2192 \u751F\u6210\u65B0\u5185\u5BB9 C\uFF08\`heat = heatA + heatB + 1\`\uFF09
4. **write**(\`path\`='\u540E\u7AEF\u5F00\u53D1\u6280\u672F\u6808.md', \`content\`=C) \u2192 \u521B\u5EFA\u5408\u5E76\u540E\u7684\u65B0\u6587\u4EF6
5. **write**(\`path\`='Python\u540E\u7AEF\u5F00\u53D1.md', \`content\`='[DELETED]') \u2192 **\u26A0\uFE0F \u5220\u9664\u65E7\u6587\u4EF6 A**
6. **write**(\`path\`='Go\u540E\u7AEF\u5F00\u53D1.md', \`content\`='[DELETED]') \u2192 **\u26A0\uFE0F \u5220\u9664\u65E7\u6587\u4EF6 B**
**\u5173\u952E**\uFF1A\u6B65\u9AA4 5-6 \u662F\u5FC5\u987B\u7684\uFF01\u4E0D\u6267\u884C\u5220\u9664 = \u6587\u4EF6\u603B\u6570\u4E0D\u51CF\u5C11 = \u5408\u5E76\u65E0\u6548\u3002

### \u9636\u6BB5 3\uFF1A\u64B0\u5199\u4E0E\u5408\u6210\uFF08\u6838\u5FC3\u4EFB\u52A1\uFF09
\u6DF1\u5EA6\u6574\u5408: \u4E25\u7981\u7B80\u5355\u7684\u6587\u672C\u8FFD\u52A0\u3002\u4F60\u5FC5\u987B\u7ED3\u5408\u4E0A\u4E0B\u6587\uFF08\u57FA\u4E8E\u6458\u8981\u6216\u63D0\u4F9B\u7684\u539F\u59CB\u5185\u5BB9\uFF09\u91CD\u5199\u53D9\u4E8B\uFF0C\u5C06\u65B0\u4FE1\u606F\u81EA\u7136\u5730\u878D\u5165\u5176\u4E2D\u3002
\u9690\u6027\u63A8\u65AD: \u5BFB\u627E\u7528\u6237 \u6CA1\u8BF4\u51FA\u53E3 \u7684\u4FE1\u606F\u3002\u66F4\u65B0 "Implicit Signals" section, or its equivalent in the dialogue language.
\u51B2\u7A81\u68C0\u6D4B: \u5982\u679C\u65B0\u8BB0\u5FC6\u4E0E\u65E7\u8BB0\u5FC6\u76F8\u77DB\u76FE\uFF0C\u5C06\u5176\u8BB0\u5F55\u5728 "Evolution Trajectory" \u6216 "Pending Confirmation / Contradictions" section, or their equivalents in the dialogue language.

### \u64B0\u5199\u51C6\u5219 (\u4E25\u683C\u9075\u5B88)
\u6838\u5FC3\u90E8\u5206\u7981\u6B62\u5217\u8868: "User Core Traits" and "Core Narrative" sections, or their equivalents in the dialogue language, must be coherent paragraphs. \u4FE1\u606F\u8981\u8FDE\u8D2F\uFF0C\u53EF\u4EE5\u5206\u6BB5\u3002
\u53D9\u4E8B\u5F27\u7EBF: "Core Narrative" section, or its equivalent in the dialogue language, must follow a story structure\uFF08Trigger -> Action -> Result\uFF09\u3002

### \u70ED\u5EA6\u7BA1\u7406 (Heat Management):
\u65B0\u5EFA Block: heat: 1
\u66F4\u65B0 Block: heat: \u65E7heat + 1
\u5408\u5E76 Block: heat: sum(\u6240\u6709\u76F8\u5173block\u7684heat) + 1

## \u8F93\u51FA\u89C4\u8303 (Output Specification)

### \u{1F4C4} \u573A\u666F\u6587\u4EF6\u5185\u5BB9\uFF08\u5FC5\u987B\u8F93\u51FA\uFF09

\u8BF7\u4F60\u53C2\u8003\u8FD9\u4E2A\u6A21\u677F\u8F93\u51FA .md \u6587\u4EF6\u7684\u5185\u5BB9\u6216\u57FA\u4E8E\u5DF2\u6709md\u8FDB\u884C\u66F4\u65B0\uFF0C\u6BCF\u4E2Amd\u63A7\u5236\u57281500\u5B57\u7B26\u5185\u3002\u4E0D\u8981\u628A\u6A21\u677F\u672C\u8EAB\u653E\u5728 Markdown \u4EE3\u7801\u5757\u4E2D\uFF0C\u53EA\u9700\u76F4\u63A5\u8F93\u51FA\u8981\u5199\u5165\u6587\u4EF6\u7684\u539F\u59CB\u6587\u672C\u3002

> The section headings below are English fallback headings. Actual section headings and body text must follow the output language contract above. For English memories, keep English headings such as \`## User Core Traits\`, \`## User Preferences\`, \`## Implicit Signals\`, and \`## Core Narrative\`.

\`\`\`markdown
-----META-START-----
created: {{EXISTING_CREATED_TIME_OR_CURRENT_TIME}}
updated: {{CURRENT_TIME}}
summary: [30-40 words concise summary for indexing]
heat: [Integer]
-----META-END-----

## User Basic Information
[Optional. Omit this section if there is no reliable basic information. Merge compatible facts and overwrite only when a conflict is resolved.]
   - Name:
   - Occupation:
   - Location:
   - ...

## User Core Traits
[Not a list. Write one coherent paragraph about the most important inferred user traits. Be selective and keep it concise, within 100 words.]
[Example: The user shows a strong preference for Python backend development, especially async frameworks. Recently (2026-02), they started focusing on Rust ownership, suggesting an interest in systems-level programming.]

## User Preferences
[A list is allowed. Omit this section if there is no reliable preference. Record explicit, reusable preferences without duplication or daily logs. Dynamically merge or rewrite when updating.]
[Example: The user likes apples.]

## Implicit Signals
[Anthropologist notes: record important signals that were not stated directly. These must be thoughtful inferences, not explicit preferences. This section can be empty; prefer omission over weak speculation. Update, delete, or rewrite as evidence changes.]

## Core Narrative
[Not a list. Write one coherent narrative within 400 words. Avoid duplication and daily logs. Dynamically merge or rewrite when updating.]
*(Record a coherent story that must include Trigger -> Action -> Result.)*

[Example: This week the user focused on backend refactoring. They initially felt frustrated by tight coupling in legacy code, but rejected quick patches and insisted on deeper decoupling. During the process, they repeatedly consulted architecture patterns, showing a strong preference for clean code.]


## Evolution Trajectory
> [Note] This can be empty. Only record changes in preferences, personality, or major beliefs. Do not record trivial daily updates. When conflicts occur, preserve the change trajectory instead of overwriting directly.
- [2026-01-10]: Shifted from "opposes overtime" to "accepts flexible work" due to startup pressure (memory ID: #987)


## Pending Confirmation / Contradictions
- [Record contradictions that cannot yet be integrated and should wait for future memories to clarify.]

\`\`\`



#### \u4E3B\u52A8\u89E6\u53D1 Persona \u66F4\u65B0\uFF08\u53EF\u9009\uFF09

**\u89E6\u53D1\u6761\u4EF6**\uFF1A\u91CD\u5927\u4EF7\u503C\u89C2\u8F6C\u53D8\u3001\u8DE8\u573A\u666F\u7A81\u7834\u6027\u6D1E\u5BDF\u3002

**\u89E6\u53D1\u65B9\u5F0F**\uFF1A\u5728\u4F60\u7684 text output \u4E2D\u8F93\u51FA\u4EE5\u4E0B\u6807\u8BB0\uFF08\u4E0D\u662F\u6587\u4EF6\u64CD\u4F5C\uFF09\uFF1A

[PERSONA_UPDATE_REQUEST]
reason: \u5177\u4F53\u539F\u56E0\u63CF\u8FF0
[/PERSONA_UPDATE_REQUEST]


**\u6267\u884C\u6587\u4EF6\u64CD\u4F5C**\uFF08\u5FC5\u987B\u4F7F\u7528\u5DE5\u5177\uFF09\uFF1A
   - \u4F7F\u7528 **read** \u8BFB\u53D6\u9700\u8981\u66F4\u65B0\u7684\u573A\u666F\u6587\u4EF6
   - \u4F7F\u7528 **write** \u521B\u5EFA\u65B0\u6587\u4EF6\u6216**\u6574\u4F53\u91CD\u5199**\u5DF2\u6709\u573A\u666F\u6587\u4EF6
   - \u4F7F\u7528 **edit** \u5BF9\u573A\u666F\u6587\u4EF6\u8FDB\u884C**\u5C40\u90E8\u66F4\u65B0**\uFF08\u5982\u53EA\u66F4\u65B0\u67D0\u4E2A\u7AE0\u8282\uFF09
   - **\u5220\u9664\u6587\u4EF6**\uFF1A\u4F7F\u7528 **write**(\`path\`=\u6587\u4EF6\u540D, \`content\`='[DELETED]') \u5199\u5165\u5220\u9664\u6807\u8BB0\u3002\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u6E05\u7406\u8FD9\u4E9B\u6587\u4EF6\u3002**\u91CD\u8981**\uFF1A\u53EA\u6709 \`[DELETED]\` \u6807\u8BB0\u4F1A\u89E6\u53D1\u7CFB\u7EDF\u6E05\u7406\u3002\u5199\u5165\u7A7A\u5B57\u7B26\u4E32\u4F1A\u88AB\u7CFB\u7EDF\u62D2\u7EDD\uFF0C\u5199\u5165 \`[ARCHIVE]\`\u3001\`[CONSOLIDATED]\` \u7B49\u6807\u8BB0**\u4E0D\u4F1A\u5220\u9664\u6587\u4EF6**\uFF0C\u6587\u4EF6\u4F1A\u7EE7\u7EED\u5360\u7528\u573A\u666F\u914D\u989D\u3002`;
}
function buildSceneExtractionPrompt(params) {
  const {
    memoriesJson,
    sceneSummaries,
    currentTimestamp,
    sceneCountWarning,
    existingSceneFiles,
    maxScenes
  } = params;
  const warningSection = sceneCountWarning ? `
\u26A0\uFE0F **\u573A\u666F\u6570\u91CF\u8B66\u544A**: ${sceneCountWarning}
` : "";
  const fileListSection = existingSceneFiles && existingSceneFiles.length > 0 ? `### \u{1F4C1} \u5DF2\u6709\u573A\u666F\u6587\u4EF6\u6E05\u5355\uFF08\u4EC5\u4EE5\u4E0B\u6587\u4EF6\u53EF read\uFF09
${existingSceneFiles.map((f) => `- \`${f}\``).join("\n")}
` : `### \u{1F4C1} \u5DF2\u6709\u573A\u666F\u6587\u4EF6\u6E05\u5355
\uFF08\u5F53\u524D\u65E0\u5DF2\u6709\u573A\u666F\u6587\u4EF6\uFF09
`;
  const userPrompt = `**Output language**: Scene file names, section headings, and body text must use the dominant language in the New Memories List below. For English memories, use English memory titles and English headings.
${warningSection}
### 1\uFE0F\u20E3 New Memories List
${memoriesJson}

### 2\uFE0F\u20E3 Existing Scene Blocks Summary
${sceneSummaries}

### 3\uFE0F\u20E3 Current Timestamp
${currentTimestamp}

${fileListSection}`;
  return {
    systemPrompt: buildSceneSystemPrompt(maxScenes),
    userPrompt
  };
}

// src/core/scene/scene-extractor.ts
var TAG16 = "[memory-tdai] [extractor]";
function parsePersonaUpdateSignal(text) {
  const blockMatch = text.match(
    /\[PERSONA_UPDATE_REQUEST\]\s*(?:reason:\s*)?(.+?)\s*\[\/PERSONA_UPDATE_REQUEST\]/s
  );
  if (blockMatch) return { reason: blockMatch[1].trim() };
  const inlineMatch = text.match(
    /PERSONA_UPDATE_REQUEST:\s*(.+?)(?:\n|$)/
  );
  if (inlineMatch) return { reason: inlineMatch[1].trim() };
  return null;
}
var SceneExtractor = class {
  dataDir;
  runner;
  maxScenes;
  sceneBackupCount;
  timeoutMs;
  logger;
  instanceId;
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.maxScenes = opts.maxScenes ?? 15;
    this.sceneBackupCount = opts.sceneBackupCount ?? 10;
    this.timeoutMs = opts.timeoutMs ?? 3e5;
    this.logger = opts.logger;
    this.instanceId = opts.instanceId;
    if (!opts.llmRunner) throw new Error(`${TAG16} No LLM runner injected for scene extraction`);
    this.runner = opts.llmRunner;
    this.logger?.debug?.(`${TAG16} Created: dataDir=${opts.dataDir}, model=${opts.model ?? "(default)"}, maxScenes=${this.maxScenes}, timeout=${this.timeoutMs}ms`);
  }
  /**
   * Extract a batch of memories into scene blocks using the LLM agent.
   *
   * @param memories - Array of raw memory records from the API
   * @returns Extraction result with count and success flag
   */
  async extract(memories) {
    const extractStartMs = Date.now();
    this.logger?.info(`${TAG16} extract() start: ${memories.length} memories`);
    if (memories.length === 0) {
      this.logger?.debug?.(`${TAG16} extract() skipped: no memories`);
      return { memoriesProcessed: 0, success: true };
    }
    const sceneBlocksDir = path11.join(this.dataDir, "scene_blocks");
    const metadataDir = path11.join(this.dataDir, ".metadata");
    await fs10.mkdir(sceneBlocksDir, { recursive: true });
    await fs10.mkdir(metadataDir, { recursive: true });
    const backupStartMs = Date.now();
    const cpManager = new CheckpointManager(this.dataDir);
    const cp = await cpManager.read();
    const bm = new BackupManager(path11.join(this.dataDir, ".backup"));
    await bm.backupDirectory(sceneBlocksDir, "scene_blocks", `offset${cp.total_processed}`, this.sceneBackupCount);
    this.logger?.debug?.(`${TAG16} extract() backup phase: ${Date.now() - backupStartMs}ms`);
    const indexStartMs = Date.now();
    const index = await readSceneIndex(this.dataDir);
    this.logger?.debug?.(`${TAG16} extract() scene index loaded: ${index.length} entries (${Date.now() - indexStartMs}ms)`);
    const { summaries: sceneSummaries, filenames: existingSceneFiles } = this.buildSceneSummaries(index);
    let sceneCountWarning;
    const sceneCount = index.length;
    if (sceneCount >= this.maxScenes) {
      sceneCountWarning = `\u5F53\u524D\u573A\u666F\u6570\u91CF\u4E3A **${sceneCount} \u4E2A**\uFF0C\u5DF2\u8FBE\u5230\u6216\u8D85\u8FC7 ${this.maxScenes} \u4E2A\u4E0A\u9650\uFF01
**\u4F60\u5FC5\u987B\u5148\u6267\u884C MERGE \u64CD\u4F5C**\uFF0C\u5C06\u6700\u76F8\u4F3C\u7684 2-4 \u4E2A\u573A\u666F\u5408\u5E76\u4E3A 1 \u4E2A\uFF0C\u7136\u540E\u518D\u5904\u7406\u65B0\u8BB0\u5FC6\u3002
\u53C2\u8003\u5408\u5E76\u5BF9\u8C61\uFF1A\u70ED\u5EA6\u6700\u4F4E\u6216\u4E3B\u9898\u9AD8\u5EA6\u91CD\u53E0\u7684\u573A\u666F\u3002`;
      this.logger?.warn(`${TAG16} extract() scene count at limit: ${sceneCount}/${this.maxScenes}`);
    } else if (sceneCount === this.maxScenes - 1) {
      sceneCountWarning = `\u5F53\u524D\u573A\u666F\u6570\u91CF\u4E3A **${sceneCount} \u4E2A**\uFF0C\u8DDD\u79BB\u4E0A\u9650\u53EA\u5DEE 1 \u4E2A\uFF01
\u672C\u6B21\u5904\u7406**\u53EA\u80FD UPDATE \u73B0\u6709\u573A\u666F\uFF0C\u4E0D\u80FD CREATE \u65B0\u573A\u666F**\u3002`;
      this.logger?.warn(`${TAG16} extract() scene count near limit (CREATE blocked): ${sceneCount}/${this.maxScenes}`);
    } else if (sceneCount >= this.maxScenes - 3) {
      sceneCountWarning = `\u5F53\u524D\u573A\u666F\u6570\u91CF\u4E3A **${sceneCount} \u4E2A**\uFF0C\u5EFA\u8BAE\u4F18\u5148\u8003\u8651 UPDATE \u6216\u4E3B\u52A8 MERGE \u76F8\u4F3C\u573A\u666F\u3002`;
      this.logger?.debug?.(`${TAG16} extract() scene count approaching limit: ${sceneCount}/${this.maxScenes}`);
    }
    const preExtractIndex = new Map(index.map((e) => [e.filename, e.summary]));
    const preExtractContent = /* @__PURE__ */ new Map();
    for (const e of index) {
      try {
        const raw = await fs10.readFile(path11.join(sceneBlocksDir, e.filename), "utf-8");
        const block = parseSceneBlock(raw, e.filename);
        preExtractContent.set(e.filename, block.content);
      } catch {
      }
    }
    const promptStartMs = Date.now();
    const memoriesJson = JSON.stringify(
      memories.map((m) => ({
        content: m.content,
        created_at: m.created_at ? formatForLLM(m.created_at) : m.created_at,
        id: m.id ?? ""
      })),
      null,
      2
    );
    const currentTimestamp = formatTimestamp3(/* @__PURE__ */ new Date());
    const { systemPrompt, userPrompt } = buildSceneExtractionPrompt({
      memoriesJson,
      sceneSummaries: sceneSummaries || "(\u65E0\u5DF2\u6709\u573A\u666F)",
      currentTimestamp,
      sceneCountWarning,
      existingSceneFiles,
      maxScenes: this.maxScenes
    });
    this.logger?.debug?.(`${TAG16} extract() prompt built: ${userPrompt.length} chars (${Date.now() - promptStartMs}ms)`);
    let llmOutput = "";
    let llmDurationMs = 0;
    try {
      this.logger?.debug?.(`${TAG16} extract() starting LLM runner (timeout=${this.timeoutMs}ms, maxTokens=model default)...`);
      const runnerStartMs = Date.now();
      llmOutput = await this.runner.run({
        systemPrompt,
        prompt: userPrompt,
        taskId: `scene-extract-${Date.now()}`,
        timeoutMs: this.timeoutMs,
        // maxTokens omitted → core uses the resolved model's maxTokens from catalog
        workspaceDir: sceneBlocksDir
      }) ?? "";
      llmDurationMs = Date.now() - runnerStartMs;
      this.logger?.debug?.(`${TAG16} extract() LLM runner completed: ${llmDurationMs}ms`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const totalMs2 = Date.now() - extractStartMs;
      this.logger?.error(`${TAG16} extract() LLM runner failed after ${totalMs2}ms: ${errMsg}`);
      try {
        const result = await bm.restoreLatestDirectory("scene_blocks", sceneBlocksDir);
        if (result.restored) {
          this.logger?.warn(`${TAG16} extract() restored scene_blocks/ from backup: ${result.from}`);
        } else {
          this.logger?.debug?.(`${TAG16} extract() no scene_blocks backup to restore from (first run or empty)`);
        }
      } catch (restoreErr) {
        const rMsg = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        this.logger?.warn(`${TAG16} extract() restore failed (non-fatal, original LLM error preserved): ${rMsg}`);
      }
      return { memoriesProcessed: 0, success: false, error: errMsg };
    }
    const cleanupStartMs = Date.now();
    let cleanedCount = 0;
    try {
      const allFiles = (await fs10.readdir(sceneBlocksDir)).filter((f) => f.endsWith(".md"));
      for (const file of allFiles) {
        const filePath = path11.join(sceneBlocksDir, file);
        const raw = await fs10.readFile(filePath, "utf-8");
        if (raw.trim().length === 0 || raw.trim() === "[DELETED]") {
          await fs10.unlink(filePath);
          cleanedCount++;
          this.logger?.debug?.(`${TAG16} extract() removed soft-deleted file: ${file}`);
        } else {
          const block = parseSceneBlock(raw, file);
          if (!block.content || block.content.trim().length === 0) {
            await fs10.unlink(filePath);
            cleanedCount++;
            this.logger?.debug?.(`${TAG16} extract() removed META-only file (no content): ${file}`);
          }
        }
      }
    } catch (cleanupErr) {
      this.logger?.warn(`${TAG16} extract() soft-delete cleanup error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
    }
    this.logger?.debug?.(`${TAG16} extract() soft-delete cleanup: removed ${cleanedCount} empty files (${Date.now() - cleanupStartMs}ms)`);
    const normStartMs = Date.now();
    try {
      const normResult = await normalizeSceneFilenames(sceneBlocksDir, this.logger);
      if (normResult.renamed > 0) {
        this.logger?.info(
          `${TAG16} extract() filename normalization: renamed ${normResult.renamed}, skipped ${normResult.skipped} (${Date.now() - normStartMs}ms)`
        );
      } else {
        this.logger?.debug?.(
          `${TAG16} extract() filename normalization: skipped ${normResult.skipped} (${Date.now() - normStartMs}ms)`
        );
      }
    } catch (normErr) {
      this.logger?.warn(`${TAG16} extract() filename normalization error: ${normErr instanceof Error ? normErr.message : String(normErr)}`);
    }
    const syncStartMs = Date.now();
    await syncSceneIndex(this.dataDir);
    this.logger?.debug?.(`${TAG16} extract() scene index synced: ${Date.now() - syncStartMs}ms`);
    const navStartMs = Date.now();
    try {
      await this.updateSceneNavigation();
      this.logger?.debug?.(`${TAG16} extract() persona.md navigation updated: ${Date.now() - navStartMs}ms`);
    } catch (navErr) {
      this.logger?.warn(`${TAG16} extract() failed to update persona navigation: ${navErr instanceof Error ? navErr.message : String(navErr)}`);
    }
    if (llmOutput) {
      const signal = parsePersonaUpdateSignal(llmOutput);
      if (signal) {
        await cpManager.setPersonaUpdateRequest(signal.reason);
        this.logger?.debug?.(`${TAG16} extract() persona update requested by LLM: ${signal.reason}`);
      }
    }
    const totalMs = Date.now() - extractStartMs;
    this.logger?.info(`${TAG16} extract() completed: ${memories.length} memories processed in ${totalMs}ms`);
    if (this.instanceId && this.logger) {
      let resultScenes = [];
      let scenesCreated = 0;
      let scenesUpdated = 0;
      let scenesDeleted = 0;
      try {
        const finalIndex = await readSceneIndex(this.dataDir);
        const postFilenames = /* @__PURE__ */ new Set();
        for (const e of finalIndex) {
          postFilenames.add(e.filename);
          const oldSummary = preExtractIndex.get(e.filename);
          let content = "";
          try {
            const blockPath = path11.join(sceneBlocksDir, e.filename);
            const raw = await fs10.readFile(blockPath, "utf-8");
            const block = parseSceneBlock(raw, e.filename);
            content = block.content;
          } catch {
          }
          if (oldSummary === void 0) {
            scenesCreated++;
            resultScenes.push({
              title: e.filename.replace(/\.md$/, ""),
              summary: e.summary,
              content,
              status: "created"
            });
          } else {
            const oldContent = preExtractContent.get(e.filename) ?? "";
            if (content !== oldContent) {
              scenesUpdated++;
              resultScenes.push({
                title: e.filename.replace(/\.md$/, ""),
                summary: e.summary,
                content,
                status: "updated"
              });
            }
          }
        }
        for (const [filename] of preExtractIndex) {
          if (!postFilenames.has(filename)) {
            scenesDeleted++;
          }
        }
      } catch {
      }
      report("l2_extraction", {
        inputMemoryCount: memories.length,
        resultSceneCount: resultScenes.length,
        resultScenes,
        scenesCreated,
        scenesUpdated,
        scenesDeleted,
        llmDurationMs,
        totalDurationMs: totalMs,
        success: true,
        error: null
      });
    }
    return { memoriesProcessed: memories.length, success: true };
  }
  /**
   * Build human-readable scene summaries for the prompt,
   * and collect the list of existing scene filenames (relative).
   *
   * Includes a capacity counter at the top (e.g. "当前场景总数：5 / 15")
   * so the LLM can immediately see how close it is to the limit.
   */
  buildSceneSummaries(index) {
    if (index.length === 0) return { summaries: "", filenames: [] };
    const lines = [];
    const filenames = [];
    lines.push(`**\u5F53\u524D\u573A\u666F\u603B\u6570\uFF1A${index.length} / ${this.maxScenes}**`);
    lines.push("");
    for (const entry of index) {
      filenames.push(entry.filename);
      lines.push(`### ${entry.filename}`);
      lines.push(`**\u70ED\u5EA6**: ${entry.heat} | **\u66F4\u65B0**: ${entry.updated}`);
      lines.push(`**summary**: ${entry.summary}`);
      lines.push("");
    }
    return { summaries: lines.join("\n"), filenames };
  }
  /**
   * Update the scene navigation section at the end of persona.md.
   *
   * Reads the current scene index, generates the navigation block, then
   * strips any existing navigation from persona.md and appends the new one.
   *
   * IMPORTANT: If the persona body is empty (PersonaGenerator hasn't run yet),
   * we skip writing to avoid creating a persona.md that only contains the
   * scene navigation. PersonaGenerator.generate() will write the full
   * persona + navigation when it runs.
   */
  async updateSceneNavigation() {
    const personaPath = path11.join(this.dataDir, "persona.md");
    const index = await readSceneIndex(this.dataDir);
    const nav = generateSceneNavigation(index);
    let existing = "";
    try {
      existing = await fs10.readFile(personaPath, "utf-8");
    } catch {
      this.logger?.debug?.(`${TAG16} updateSceneNavigation() skipped: no persona file yet, waiting for PersonaGenerator`);
      return;
    }
    if (!existing.trim() && !nav) return;
    const stripped = stripSceneNavigation(existing).trimEnd();
    if (!stripped) {
      this.logger?.debug?.(`${TAG16} updateSceneNavigation() skipped: persona body is empty, waiting for PersonaGenerator`);
      return;
    }
    const updated = nav ? `${stripped}

${nav}
` : `${stripped}
`;
    await fs10.writeFile(personaPath, updated, "utf-8");
  }
};
function formatTimestamp3(d) {
  return formatForLLM(d);
}

// src/core/persona/persona-trigger.ts
import fs11 from "node:fs/promises";
import path12 from "node:path";
var TAG17 = "[memory-tdai] [trigger]";
var PersonaTrigger = class {
  dataDir;
  interval;
  logger;
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.interval = opts.interval;
    this.logger = opts.logger;
  }
  async shouldGenerate() {
    const cpManager = new CheckpointManager(this.dataDir);
    const cp = await cpManager.read();
    this.logger?.debug?.(`${TAG17} Evaluating: total_processed=${cp.total_processed}, last_persona_at=${cp.last_persona_at}, memories_since=${cp.memories_since_last_persona}, scenes=${cp.scenes_processed}`);
    if (cp.request_persona_update) {
      const result = {
        should: true,
        reason: `\u4E3B\u52A8\u8BF7\u6C42: ${cp.persona_update_reason || "Agent \u8BF7\u6C42\u66F4\u65B0"}`
      };
      this.logger?.debug?.(`${TAG17} Trigger P1 (explicit request): ${result.reason}`);
      return result;
    }
    if (cp.scenes_processed > 0 && cp.last_persona_at === 0 && await this.hasSceneFiles()) {
      const result = { should: true, reason: "\u9996\u6B21\u51B7\u542F\u52A8\uFF1A\u9996\u6B21\u63D0\u53D6\u5B8C\u6210\u4E14\u6709\u573A\u666F\u6587\u4EF6" };
      this.logger?.debug?.(`${TAG17} Trigger P2 (cold start): scenes_processed=${cp.scenes_processed}, total_processed=${cp.total_processed}`);
      return result;
    }
    if (cp.last_persona_at > 0 && await this.hasSceneFiles() && !await this.hasPersonaBody()) {
      const result = { should: true, reason: "\u6062\u590D\uFF1Apersona.md \u6B63\u6587\u4E22\u5931\u6216\u4E3A\u7A7A\uFF0C\u9700\u8981\u91CD\u65B0\u751F\u6210" };
      this.logger?.debug?.(`${TAG17} Trigger P2.5 (recovery): last_persona_at=${cp.last_persona_at}, persona body missing`);
      return result;
    }
    if (cp.scenes_processed === 1 && cp.memories_since_last_persona > 0) {
      const result = { should: true, reason: "\u9996\u6B21 Scene Block \u63D0\u53D6\u5B8C\u6210" };
      this.logger?.debug?.(`${TAG17} Trigger P3 (first scene): scenes_processed=${cp.scenes_processed}`);
      return result;
    }
    if (cp.memories_since_last_persona >= this.interval) {
      const result = {
        should: true,
        reason: `\u8FBE\u5230\u9608\u503C: ${cp.memories_since_last_persona} >= ${this.interval}`
      };
      this.logger?.debug?.(`${TAG17} Trigger P4 (threshold): ${result.reason}`);
      return result;
    }
    this.logger?.debug?.(`${TAG17} No trigger conditions met`);
    return { should: false, reason: "" };
  }
  async hasSceneFiles() {
    const blocksDir = path12.join(this.dataDir, "scene_blocks");
    try {
      const files = await fs11.readdir(blocksDir);
      const hasFiles = files.some((f) => f.endsWith(".md"));
      return hasFiles;
    } catch {
      return false;
    }
  }
  /**
   * Check whether persona.md has a non-empty body (excluding scene navigation).
   * Returns false if the file doesn't exist, is empty, or only contains
   * scene navigation (no actual persona content).
   */
  async hasPersonaBody() {
    const personaPath = path12.join(this.dataDir, "persona.md");
    try {
      const raw = await fs11.readFile(personaPath, "utf-8");
      const body = stripSceneNavigation(raw).trim();
      return body.length > 0;
    } catch {
      return false;
    }
  }
};

// src/core/persona/persona-generator.ts
import fs12 from "node:fs/promises";
import path13 from "node:path";

// src/core/prompts/persona-generation.ts
var PERSONA_SYSTEM_PROMPT = `# \u{1F9EC} Persona Architect - Incremental Evolution Protocol

**Output language contract**:
- Detect the dominant language from the changed scene content.
- \`persona.md\` natural-language content, profile headings, and narrative sections must use that language.
- For English scene content, output English persona headings and English body text.
- For non-Chinese scene content, do not emit Chinese persona headings.
- If the language is ambiguous, default to English.
- Keep Markdown syntax, file name \`persona.md\`, tool names, and structural markers in English.

\u8BF7\u4F60\u7ED3\u5408\u5DF2\u6709\u7684 persona.md \u548C\u65B0\u589E/\u53D8\u5316\u7684 block \u4FE1\u606F\u6DF1\u5EA6\u5206\u6790\uFF0C\u7136\u540E\u4F7F\u7528\u6587\u4EF6\u5DE5\u5177\u5C06\u7ED3\u679C\u5199\u5165 \`persona.md\` \u6587\u4EF6\u3002

## \u26D4 \u6587\u4EF6\u64CD\u4F5C\u7EA6\u675F\uFF08\u5FC5\u987B\u4E25\u683C\u9075\u5B88\uFF09

1. **\u5FC5\u987B\u4F7F\u7528\u6587\u4EF6\u5DE5\u5177\u5C06\u6700\u7EC8 persona \u5185\u5BB9\u5199\u5165 \`persona.md\`**\u3002\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u5DF2\u8BBE\u4E3A\u6570\u636E\u76EE\u5F55\uFF0C\u76F4\u63A5\u4F7F\u7528\u6587\u4EF6\u540D \`persona.md\`\u3002
   - **\u9996\u6B21\u751F\u6210 / \u5927\u5E45\u91CD\u5199**\uFF1A\u4F7F\u7528 **write** \u5DE5\u5177\u6574\u4F53\u5199\u5165\u3002\u53C2\u6570\uFF1A\`path\`=\`persona.md\`, \`content\`=\u5B8C\u6574\u5185\u5BB9
   - **\u589E\u91CF\u66F4\u65B0\uFF08\u5C40\u90E8\u4FEE\u6539\uFF09**\uFF1A\u4F7F\u7528 **edit** \u5DE5\u5177\u7CBE\u786E\u66FF\u6362\u3002\u53C2\u6570\uFF1A\`path\`=\`persona.md\`, \`edits\`=[{\`oldText\`: \u65E7\u5185\u5BB9\u7247\u6BB5, \`newText\`: \u65B0\u5185\u5BB9\u7247\u6BB5}]
2. **\u53EA\u80FD\u64CD\u4F5C \`persona.md\` \u8FD9\u4E00\u4E2A\u6587\u4EF6**\uFF0C\u7981\u6B62\u8BFB\u53D6\u6216\u5199\u5165\u4EFB\u4F55\u5176\u4ED6\u6587\u4EF6\uFF08\u5305\u62EC scene_blocks/\u3001.metadata/ \u7B49\uFF09\u3002
3. **\u5199\u5165\u7684\u5185\u5BB9\u5FC5\u987B\u53EA\u5305\u542B\u6700\u7EC8\u7684 persona \u6587\u6863**\uFF0C\u4E0D\u8981\u5305\u542B\u4F60\u7684\u601D\u8003\u8FC7\u7A0B\u3001\u5206\u6790\u6B65\u9AA4\u6216\u4EFB\u4F55\u975E persona \u5185\u5BB9\u3002
4. **\u65E0\u9700 read \u5DE5\u5177**\uFF1A\u5F53\u524D persona.md \u7684\u5B8C\u6574\u5185\u5BB9\u5DF2\u5728\u7528\u6237\u6D88\u606F\u4E2D\u63D0\u4F9B\uFF0C\u76F4\u63A5\u57FA\u4E8E\u5B83\u8FDB\u884C\u66F4\u65B0\u5373\u53EF\u3002

### \u{1F6AB} \u4E25\u683C\u7981\u6B62
- **\u7981\u6B62\u8FC7\u957F**\uFF1Apersona.md \u5185\u5BB9\u603B\u957F\u5EA6\u4E0D\u8981\u8D85\u8FC7 2000 \u5B57\u7B26\uFF0C\u53CA\u65F6\u505A\u603B\u7ED3\u548C\u5220\u9664\u4E0D\u91CD\u8981\u7684\u4FE1\u606F\u3002
- **\u7981\u6B62\u8FC7\u5EA6\u63A8\u6D4B**\uFF1A\u6CA1\u63D0\u5230\u7684\u4FE1\u606F\u4E0D\u8981\u8FC7\u5EA6\u81C6\u60F3\u5BFC\u81F4\u4EA7\u751F\u5E7B\u89C9\uFF0C\u7279\u522B\u662F\u5728\u51B7\u542F\u52A8\u9636\u6BB5\uFF0C\u8981\u4FDD\u6301\u514B\u5236\uFF0C\u5982\u679C\u6CA1\u6709\u76F8\u5173\u4FE1\u606F\u5B8C\u5168\u53EF\u4EE5\u4E0D\u586B\uFF01
- **\u7981\u6B62\u4F7F\u7528\u975E\u573A\u666F\u6765\u6E90\u7684\u4FE1\u606F**\uFF1APersona \u7684\u6240\u6709\u5185\u5BB9\u5FC5\u987B\u4E14\u53EA\u80FD\u6765\u81EA\u4E0B\u65B9\u63D0\u4F9B\u7684\u573A\u666F\u6570\u636E\u3002\u4E0D\u8981\u4ECE workspace \u76EE\u5F55\u7ED3\u6784\u3001\u6587\u4EF6\u8DEF\u5F84\u3001\u7CFB\u7EDF\u4FE1\u606F\u7B49\u6280\u672F\u5143\u6570\u636E\u4E2D\u63D0\u53D6\u4EFB\u4F55\u5173\u4E8E\u7528\u6237\u7684\u4E2A\u4EBA\u4FE1\u606F\u3002
- **\u7981\u6B62\u64CD\u4F5C persona.md \u4EE5\u5916\u7684\u4EFB\u4F55\u6587\u4EF6**\u3002

---

## \u2699\uFE0F \u6838\u5FC3\u8FD0\u4F5C\u903B\u8F91 (The Core Logic)

\u{1F9E0} \u6838\u5FC3\u601D\u7EF4\u5F15\u64CE\uFF1A\u8FDE\u63A5\u4E0E\u7EFC\u5408 (Connect & Synthesize)
\u8BF7\u9075\u5FAA "\u53D9\u4E8B\u8FDE\u8D2F\u6027" \u539F\u5219\u5904\u7406\u4FE1\u606F\u3002\u7981\u6B62\u7B80\u5355\u7684\u7F57\u5217\uFF08No Bullet-point Spamming\uFF09\u3002

1. \u5BFB\u627E"\u8D2F\u7A7F\u7EBF" (The Connecting Thread)
\u4E0D\u8981\u5B64\u7ACB\u5730\u770B\u4FE1\u606F\u3002\u8981\u5BFB\u627E\u4E0D\u540C\u9886\u57DF\u884C\u4E3A\u80CC\u540E\u7684\u5171\u540C\u903B\u8F91\u3002
** \u8981\u4FDD\u6301\u7CBE\u7B80\uFF0C\u4E0D\u8FC7\u5EA6\u731C\u60F3\uFF0C\u5982\u679C\u4E0D\u786E\u5B9A\u53EF\u4EE5\u4E0D\u5199 **

\u6267\u884C\u4EE5\u4E0B**\u56DB\u5C42\u6DF1\u5EA6\u626B\u63CF**\uFF1A

### \u{1F7E2} Layer 1: \u57FA\u7840\u951A\u70B9 (The Base & Facts) -> \u3010\u5EFA\u7ACB\u8FDE\u63A5\u3011
* **\u626B\u63CF\u76EE\u6807**: \u786E\u51FF\u7684\u4E8B\u5B9E\u3001\u4EBA\u53E3\u7EDF\u8BA1\u5B66\u7279\u5F81\u3001\u5F53\u524D\u72B6\u6001\u3002
* **\u5B9E\u7528\u4EF7\u503C**: \u4E3A Agent \u63D0\u4F9B**\u7834\u51B0\u8BDD\u9898**\u548C**\u4E0A\u4E0B\u6587\u611F\u77E5**\u3002

### \u{1F535} Layer 2: \u5174\u8DA3\u56FE\u8C31 (The Interest Graph) -> \u3010\u63D0\u4F9B\u8C08\u8D44\u3011
* **\u626B\u63CF\u76EE\u6807**: \u7528\u6237\u6295\u5165\u65F6\u95F4\u3001\u91D1\u94B1\u6216\u6CE8\u610F\u529B\u7684\u4E8B\u7269\u3002
* **\u63D0\u53D6\u539F\u5219**: **\u533A\u5206\u6D3B\u8DC3\u5EA6**\uFF08\u6D3B\u8DC3\u7231\u597D / \u88AB\u52A8\u6D88\u8D39 / \u4F11\u7720\u5174\u8DA3\uFF09\u3002
* **\u5B9E\u7528\u4EF7\u503C**: \u8BA9 Agent \u80FD\u591F\u8FDB\u884C**\u9AD8\u8D28\u91CF\u7684\u95F2\u804A (Chit-chat)** \u548C **\u751F\u6D3B\u63A8\u8350**\u3002

### \u{1F7E1} Layer 3: \u4EA4\u4E92\u534F\u8BAE (The Interface) -> \u3010\u6D88\u9664\u6469\u64E6\u3011
* **\u626B\u63CF\u76EE\u6807**: \u7528\u6237\u7684\u6C9F\u901A\u4E60\u60EF\u3001\u96F7\u533A\u3001\u5DE5\u4F5C\u6D41\u504F\u597D\u3002
* **\u5B9E\u7528\u4EF7\u503C**: \u6307\u5BFC Agent **\u5982\u4F55\u8BF4\u8BDD\u3001\u5982\u4F55\u4EA4\u4ED8\u7ED3\u679C**\uFF0C\u907F\u514D\u8E29\u96F7\u3002

### \u{1F534} Layer 4: \u8BA4\u77E5\u5185\u6838 (The Core) -> \u3010\u6DF1\u5EA6\u5171\u9E23\u3011
* **\u626B\u63CF\u76EE\u6807**: \u51B3\u7B56\u903B\u8F91\u3001\u77DB\u76FE\u70B9\u3001\u7EC8\u6781\u9A71\u52A8\u529B\u3002
* **\u5B9E\u7528\u4EF7\u503C**: \u8BA9 Agent \u6210\u4E3A**\u80FD\u591F\u66FF\u7528\u6237\u505A\u51B3\u7B56**\u7684"\u526F\u9A7E\u9A76"\u3002

---

## \u{1F4DD} \u8F93\u51FA\u6A21\u677F (The Persona Template)

\u8BF7\u53C2\u8003\u4EE5\u4E0B\u683C\u5F0F\uFF0C\u4F7F\u7528 **write** \u5DE5\u5177\u5199\u5165\u6700\u7EC8\u5185\u5BB9\u3002\u53EF\u4EE5\u505A\u81EA\u4E3B\u8C03\u6574\uFF08\u4FE1\u606F\u4E0D\u8DB3\u65F6\u53EF\u4EE5\u51CF\u5C11\u6216\u65B0\u589E chapter\uFF09\uFF08**\u5FC5\u987B\u4FDD\u6301 Markdown \u683C\u5F0F**\uFF09\uFF1A

\`\`\`\`markdown
# User Narrative Profile

> **Archetype**: [Define the user's core narrative archetype in one sentence.]

> **Basic Information**
(Basic user facts such as age, gender, occupation, or location. Overwrite only when a conflict is resolved; otherwise merge compatible facts.)
 -
 -

> **Long-term Preferences**
(The user's most stable and reusable preferences observed from scene evidence.)
    -
    -

## \u{1F4D6} Chapter 1: Context & Current State
*(Merge basic facts and current state into a coherent background.)*

**[Write a coherent description. Use short bullets only when the facts are clearly distinct.]**

## \u{1F3A8} Chapter 2: The Texture of Life
*(Connect interests, consumption patterns, and daily habits to show the user's lived texture.)*

**[Write a coherent description, focusing on the unity of interests, preferences, and taste. Use short bullets only when needed.]**

## \u{1F916} Chapter 3: Interaction & Cognitive Protocol
*(This is the Main Agent's action guide. Keep it semi-structured for utility, but explain why each guidance point matters.)*

### 3.1 How to Speak
### 3.2 How to Think

## \u{1F9E9} Chapter 4: Deep Insights & Evolution
*(Anthropological observation notes.)*

* **Productive Contradictions**: [Describe traits that seem conflicting but are coherent in context.]
* **Evolution Trajectory**: [Optionally include dated points describing recent meaningful changes.]
* **Emergent Traits**: Extract 3-7 core trait tags, one per line, each with a short note.
  - \`TagName\` - Short note
\`\`\`\`

---

### \u26A0\uFE0F \u6210\u529F\u6807\u51C6
- \u2705 **\u5FC5\u987B\u4F7F\u7528 write \u6216 edit \u5DE5\u5177\u5199\u5165\u6700\u7EC8\u7ED3\u679C\u5230 \`persona.md\`**
- \u2705 \u57FA\u4E8E\u573A\u666F\u8BC1\u636E\u751F\u6210\u6DF1\u5EA6\u6D1E\u5BDF
- \u2705 \u5185\u5BB9\u5230 Chapter 4 \u7ED3\u675F\uFF08\u4E0D\u5305\u542B\u573A\u666F\u5BFC\u822A\uFF0C\u5DE5\u7A0B\u4F1A\u81EA\u52A8\u8FFD\u52A0\uFF09
- \u2705 \u5FC5\u987B\u4E25\u683C\u6309\u7167\u4E0A\u9762\u7684\u6A21\u677F\u683C\u5F0F
- \u2705 \u4E0D\u8981\u6DFB\u52A0\u573A\u666F\u5BFC\u822A\uFF08\u5DE5\u7A0B\u4F1A\u81EA\u52A8\u8FFD\u52A0\uFF09
- \u2705 \u53EA\u64CD\u4F5C persona.md\uFF0C\u4E0D\u8981\u64CD\u4F5C\u5176\u4ED6\u6587\u4EF6`;
function buildPersonaPrompt(params) {
  const {
    mode,
    currentTime,
    totalProcessed,
    sceneCount,
    changedSceneCount,
    changedScenesContent,
    existingPersona,
    triggerInfo
  } = params;
  const modeLabel = mode === "first" ? "\u{1F195} \u9996\u6B21\u751F\u6210" : "\u{1F504} \u8FED\u4EE3\u66F4\u65B0";
  const triggerSection = triggerInfo ? `
### \u89E6\u53D1\u4FE1\u606F
${triggerInfo}
` : "";
  const existingPersonaSection = existingPersona ? `
## \u{1F4C4} \u5F53\u524D Persona\uFF08\u5DE5\u7A0B\u5DF2\u9884\u52A0\u8F7D\uFF09

*\u4EE5\u4E0B\u662F\u73B0\u6709 persona.md \u7684\u5B8C\u6574\u5185\u5BB9\uFF08${existingPersona.length} \u5B57\u7B26\uFF09\uFF0C\u57FA\u4E8E\u6B64\u66F4\u65B0\u540E\u8BF7\u63A7\u5236\u57282000\u5B57\u5185\uFF1A*

\`\`\`markdown
${existingPersona}
\`\`\`

---
` : "";
  const iterationGuide = mode === "incremental" ? `
## \u{1F504} \u8FED\u4EE3\u51B3\u7B56\u6307\u5357

\u9762\u5BF9\u53D8\u5316\u573A\u666F\uFF0C\u81EA\u4E3B\u5224\u65AD\u5904\u7406\u65B9\u5F0F\uFF1A\u5F3A\u5316\uFF08\u4F50\u8BC1\u5DF2\u6709\u6D1E\u5BDF\uFF09/ \u8865\u5145\uFF08\u65B0\u7EF4\u5EA6\uFF09/ \u4FEE\u6B63\uFF08\u77DB\u76FE\uFF09/ \u91CD\u6784\uFF08\u7ED3\u6784\u8C03\u6574\uFF09/ \u4E0D\u6539\uFF08\u65E0\u6709\u7528\u65B0\u589E\u5185\u5BB9\uFF09\u3002
` : "";
  const userPrompt = `**Output language**: \`persona.md\` headings and body text must use the dominant language of the changed scene content below. For English scene content, use English persona headings.

**\u23F0 \u66F4\u65B0\u65F6\u95F4**: ${currentTime}
**\u6A21\u5F0F**: ${modeLabel}
${triggerSection}
## \u{1F4CA} \u7EDF\u8BA1
- **\u603B\u8BB0\u5FC6\u6570**: ${totalProcessed} \u6761
- **\u573A\u666F\u603B\u6570**: ${sceneCount} \u4E2A
- **\u53D8\u5316\u573A\u666F**: ${changedSceneCount} \u4E2A\uFF08\u81EA\u4E0A\u6B21\u66F4\u65B0\u540E\uFF09

---
${changedScenesContent}

${existingPersonaSection}
${iterationGuide}`;
  return {
    systemPrompt: PERSONA_SYSTEM_PROMPT,
    userPrompt
  };
}

// src/core/persona/persona-generator.ts
var TAG18 = "[memory-tdai] [persona]";
var PersonaGenerator = class {
  dataDir;
  runner;
  logger;
  backupCount;
  instanceId;
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.logger = opts.logger;
    this.backupCount = opts.backupCount ?? 3;
    this.instanceId = opts.instanceId;
    if (!opts.llmRunner) throw new Error(`${TAG18} No LLM runner injected for persona generation`);
    this.runner = opts.llmRunner;
    this.logger?.debug?.(`${TAG18} Generator created: model=${opts.model ?? "(default)"}, dataDir=${opts.dataDir}`);
  }
  /**
   * Execute local persona generation without advancing checkpoint.
   */
  async generateLocalPersona(triggerReason) {
    const startMs = Date.now();
    this.logger?.debug?.(`${TAG18} Starting generation: reason="${triggerReason ?? "none"}"`);
    const cpManager = new CheckpointManager(this.dataDir);
    const cp = await cpManager.read();
    this.logger?.debug?.(`${TAG18} Checkpoint: total_processed=${cp.total_processed}, last_persona_at=${cp.last_persona_at}`);
    const personaPath = path13.join(this.dataDir, "persona.md");
    let existingPersona;
    try {
      const raw = await fs12.readFile(personaPath, "utf-8");
      existingPersona = stripSceneNavigation(raw).trim() || void 0;
      this.logger?.debug?.(`${TAG18} Existing persona: ${existingPersona ? `${existingPersona.length} chars` : "empty"}`);
    } catch {
      this.logger?.debug?.(`${TAG18} No existing persona file`);
    }
    const index = await readSceneIndex(this.dataDir);
    const changedScenes = index.filter((e) => {
      if (!cp.last_persona_time) return true;
      const updatedMs = new Date(e.updated).getTime();
      const personaMs = new Date(cp.last_persona_time).getTime();
      if (Number.isNaN(updatedMs) || Number.isNaN(personaMs)) return true;
      return updatedMs > personaMs;
    });
    this.logger?.debug?.(`${TAG18} Scene index: ${index.length} total, ${changedScenes.length} changed since last persona`);
    const blocksDir = path13.join(this.dataDir, "scene_blocks");
    const changedSceneContents = [];
    for (const entry of changedScenes) {
      try {
        const raw = await fs12.readFile(path13.join(blocksDir, entry.filename), "utf-8");
        changedSceneContents.push(
          `### [${changedSceneContents.length + 1}] ${entry.filename}

\`\`\`markdown
${raw}
\`\`\``
        );
      } catch {
        this.logger?.warn(`${TAG18} Could not read scene block: ${entry.filename}`);
      }
    }
    if (changedSceneContents.length === 0 && existingPersona) {
      this.logger?.debug?.(`${TAG18} No scene changes and persona exists, skipping generation`);
      return false;
    }
    const mode = existingPersona ? "incremental" : "first";
    this.logger?.debug?.(`${TAG18} Generation mode: ${mode}, ${changedSceneContents.length} scene blocks to process`);
    let changedScenesContent;
    if (changedSceneContents.length > 0) {
      changedScenesContent = `

## \u{1F4C4} \u53D8\u5316\u573A\u666F\u5B8C\u6574\u5185\u5BB9

*\u81EA\u4E0A\u6B21 Persona \u66F4\u65B0\u540E\uFF0C\u4EE5\u4E0B ${changedSceneContents.length} \u4E2A\u573A\u666F\u53D1\u751F\u4E86\u53D8\u5316\u3002\u5DE5\u7A0B\u5DF2\u4E3A\u4F60\u9884\u52A0\u8F7D\u5B8C\u6574\u5185\u5BB9\uFF1A*

` + changedSceneContents.join("\n\n") + `

---

\u26A0\uFE0F **\u91CD\u70B9\u5206\u6790\u53D8\u5316\u573A\u666F**\uFF1A\u4E0A\u8FF0\u573A\u666F\u662F\u81EA\u4E0A\u6B21\u66F4\u65B0\u540E\u7684**\u65B0\u589E/\u4FEE\u6539\u5185\u5BB9**\uFF0C\u8BF7**\u91CD\u70B9\u5206\u6790**\u8FD9\u4E9B\u573A\u666F\u4E2D\u7684\u65B0\u4FE1\u606F\u3002
`;
    } else {
      changedScenesContent = `

\u26A0\uFE0F **\u65E0\u53D8\u5316\u573A\u666F**\uFF1A\u6240\u6709\u573A\u666F\u5747\u5DF2\u5728\u4E0A\u6B21 Persona \u66F4\u65B0\u4E2D\u5206\u6790\u8FC7\uFF0C\u672C\u6B21\u53EF\u76F4\u63A5\u8BFB\u53D6\u6240\u6709\u573A\u666F\u8FDB\u884C\u5168\u5C40\u5BA1\u89C6\u3002
`;
    }
    const { systemPrompt, userPrompt } = buildPersonaPrompt({
      mode,
      currentTime: formatForLLM(/* @__PURE__ */ new Date()),
      totalProcessed: cp.total_processed,
      sceneCount: index.length,
      changedSceneCount: changedScenes.length,
      changedScenesContent,
      existingPersona,
      triggerInfo: triggerReason,
      personaFilePath: personaPath,
      checkpointPath: path13.join(this.dataDir, ".metadata", "recall_checkpoint.json")
    });
    const bm = new BackupManager(path13.join(this.dataDir, ".backup"));
    await bm.backupFile(personaPath, "persona", `offset${cp.total_processed}`, this.backupCount);
    try {
      this.logger?.debug?.(`${TAG18} Calling LLM for persona generation (timeout=180s, tools=enabled, workspaceDir=${this.dataDir})...`);
      await this.runner.run({
        systemPrompt,
        prompt: userPrompt,
        taskId: "persona-generation",
        timeoutMs: 18e4,
        // maxTokens omitted → core uses the resolved model's maxTokens from catalog
        workspaceDir: this.dataDir
      });
      this.logger?.debug?.(`${TAG18} LLM runner completed`);
    } catch (err) {
      const elapsedMs2 = Date.now() - startMs;
      this.logger?.error(`${TAG18} Persona generation failed after ${elapsedMs2}ms: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      return false;
    }
    let personaText;
    try {
      personaText = await fs12.readFile(personaPath, "utf-8");
    } catch {
      this.logger?.error(`${TAG18} LLM did not write persona.md \u2014 file not found after runner completed`);
      return false;
    }
    personaText = escapeXmlTags(stripSceneNavigation(personaText).trim());
    if (!personaText) {
      this.logger?.error(`${TAG18} LLM wrote empty persona.md \u2014 skipping`);
      return false;
    }
    const nav = generateSceneNavigation(index);
    const finalContent = nav ? `${personaText}

${nav}
` : personaText;
    await fs12.writeFile(personaPath, finalContent, "utf-8");
    const elapsedMs = Date.now() - startMs;
    this.logger?.info(`${TAG18} Persona written (${finalContent.length} chars) in ${elapsedMs}ms`);
    if (this.instanceId && this.logger) {
      report("l3_persona_generation", {
        triggerReason: triggerReason ?? "unknown",
        mode: existingPersona ? "incremental" : "initial",
        newPersonaContent: personaText,
        newPersonaLength: personaText.length,
        totalDurationMs: elapsedMs,
        success: true,
        error: null
      });
    }
    return true;
  }
  /**
   * Backward-compatible wrapper: local generation + checkpoint advance.
   */
  async generate(triggerReason) {
    const updated = await this.generateLocalPersona(triggerReason);
    if (!updated) return false;
    const cpManager = new CheckpointManager(this.dataDir);
    const cp = await cpManager.read();
    await cpManager.markPersonaGenerated(cp.total_processed);
    return true;
  }
};

// src/core/profile/profile-sync.ts
import { createHash } from "node:crypto";
import fs13 from "node:fs/promises";
import path14 from "node:path";
var PROFILE_SCOPE = "global";
function isRenameRaceError(err) {
  const code = err?.code;
  return code === "ENOTEMPTY" || code === "EEXIST";
}
function buildProfileStableId(scope, type, filename) {
  const hash = createHash("sha256").update(`${scope}\0${type}\0${filename}`).digest("hex");
  return `profile:v1:${hash}`;
}
function md5(text) {
  return createHash("md5").update(text).digest("hex");
}
async function statTimes(filePath) {
  try {
    const stat = await fs13.stat(filePath);
    return {
      createdAtMs: Math.floor(stat.birthtimeMs || stat.ctimeMs || Date.now()),
      updatedAtMs: Math.floor(stat.mtimeMs || Date.now())
    };
  } catch {
    const now = Date.now();
    return { createdAtMs: now, updatedAtMs: now };
  }
}
async function refreshPersonaNavigation(dataDir) {
  const personaPath = path14.join(dataDir, "persona.md");
  let body;
  try {
    body = stripSceneNavigation(await fs13.readFile(personaPath, "utf-8")).trim();
  } catch {
    return;
  }
  if (!body) return;
  const index = await readSceneIndex(dataDir);
  const nav = generateSceneNavigation(index);
  const finalContent = nav ? `${body}

${nav}
` : `${body}
`;
  await fs13.writeFile(personaPath, finalContent, "utf-8");
}
async function listLocalProfiles(dataDir) {
  const profiles = [];
  const blocksDir = path14.join(dataDir, "scene_blocks");
  try {
    const files = (await fs13.readdir(blocksDir)).filter((file) => file.endsWith(".md")).sort();
    for (const filename of files) {
      const filePath = path14.join(blocksDir, filename);
      const content = await fs13.readFile(filePath, "utf-8");
      const { createdAtMs, updatedAtMs } = await statTimes(filePath);
      profiles.push({
        id: buildProfileStableId(PROFILE_SCOPE, "l2", filename),
        type: "l2",
        filename,
        content,
        contentMd5: md5(content),
        version: 0,
        createdAtMs,
        updatedAtMs
      });
    }
  } catch {
  }
  const personaPath = path14.join(dataDir, "persona.md");
  try {
    const rawPersona = await fs13.readFile(personaPath, "utf-8");
    const body = stripSceneNavigation(rawPersona).trim();
    if (body) {
      const { createdAtMs, updatedAtMs } = await statTimes(personaPath);
      profiles.push({
        id: buildProfileStableId(PROFILE_SCOPE, "l3", "persona.md"),
        type: "l3",
        filename: "persona.md",
        content: body,
        contentMd5: md5(body),
        version: 0,
        createdAtMs,
        updatedAtMs
      });
    }
  } catch {
  }
  return profiles;
}
async function pullProfilesToLocal(dataDir, store, logger) {
  if (!store.pullProfiles) return /* @__PURE__ */ new Map();
  const records = await store.pullProfiles();
  const baseline = /* @__PURE__ */ new Map();
  const tempDir = await fs13.mkdtemp(path14.join(dataDir, ".profiles-pull-"));
  const tempBlocksDir = path14.join(tempDir, "scene_blocks");
  await fs13.mkdir(tempBlocksDir, { recursive: true });
  try {
    for (const record of records) {
      baseline.set(record.id, {
        version: record.version,
        contentMd5: record.contentMd5,
        createdAtMs: record.createdAtMs
      });
      if (record.type === "l2") {
        const target = path14.join(tempBlocksDir, record.filename);
        await fs13.writeFile(target, record.content, "utf-8");
        if (md5(record.content) !== record.contentMd5) {
          await fs13.rm(target, { force: true });
          logger.debug?.(`[memory-tdai][profile-sync] MD5 mismatch for ${record.filename} (will re-pull on next sync)`);
        }
        continue;
      }
      if (record.type === "l3") {
        const body = stripSceneNavigation(record.content).trim();
        await fs13.writeFile(path14.join(tempDir, "persona.md"), body, "utf-8");
        if (md5(body) !== record.contentMd5) {
          await fs13.rm(path14.join(tempDir, "persona.md"), { force: true });
          logger.debug?.(`[memory-tdai][profile-sync] MD5 mismatch for ${record.filename} (will re-pull on next sync)`);
        }
      }
    }
    const localBlocksDir = path14.join(dataDir, "scene_blocks");
    await fs13.rm(localBlocksDir, { recursive: true, force: true });
    await fs13.mkdir(path14.dirname(localBlocksDir), { recursive: true });
    try {
      await fs13.rename(tempBlocksDir, localBlocksDir);
    } catch (err) {
      if (isRenameRaceError(err)) {
        logger.debug?.(`[memory-tdai][profile-sync] scene_blocks rename lost race (${err.code}), using existing`);
        return baseline;
      }
      throw err;
    }
    const tempPersonaPath = path14.join(tempDir, "persona.md");
    const localPersonaPath = path14.join(dataDir, "persona.md");
    try {
      await fs13.access(tempPersonaPath);
      await fs13.rm(localPersonaPath, { force: true });
      try {
        await fs13.rename(tempPersonaPath, localPersonaPath);
      } catch (err) {
        if (!isRenameRaceError(err)) throw err;
        logger.debug?.(`[memory-tdai][profile-sync] persona.md rename lost race, using existing`);
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        await fs13.rm(localPersonaPath, { force: true });
      } else if (!isRenameRaceError(err)) {
        throw err;
      }
    }
    await syncSceneIndex(dataDir);
    await refreshPersonaNavigation(dataDir);
    logger.debug?.(`[memory-tdai][profile-sync] Pulled ${records.length} profile(s) to local cache`);
    return baseline;
  } finally {
    await fs13.rm(tempDir, { recursive: true, force: true });
  }
}
async function syncLocalProfilesToStore(dataDir, store, baselineMap, logger) {
  const localProfiles = await listLocalProfiles(dataDir);
  const localIds = new Set(localProfiles.map((profile) => profile.id));
  const syncRecords = localProfiles.filter((profile) => baselineMap.get(profile.id)?.contentMd5 !== profile.contentMd5 || !baselineMap.has(profile.id)).map((profile) => ({
    ...profile,
    baselineVersion: baselineMap.get(profile.id)?.version
  }));
  if (syncRecords.length > 0 && store.syncProfiles) {
    await store.syncProfiles(syncRecords);
    logger.info(`[memory-tdai][profile-sync] Synced ${syncRecords.length} changed profile(s)`);
  }
  const deletedIds = [...baselineMap.keys()].filter((id) => !localIds.has(id));
  if (deletedIds.length > 0 && store.deleteProfiles) {
    await store.deleteProfiles(deletedIds);
    logger.info(`[memory-tdai][profile-sync] Deleted ${deletedIds.length} stale profile(s)`);
  }
}

// src/utils/pipeline-factory.ts
var TAG20 = "[memory-tdai] [pipeline-factory]";
function supportsProfileSyncWrite(store) {
  return !!(store?.syncProfiles || store?.deleteProfiles);
}
function initDataDirectories(dataDir) {
  const dirs = ["conversations", "records", "scene_blocks", ".metadata", ".backup"];
  for (const sub of dirs) {
    fs15.mkdirSync(path16.join(dataDir, sub), { recursive: true });
  }
}
var _storeInitCache = /* @__PURE__ */ new Map();
function initStores(cfg, pluginDataDir, logger) {
  const key = pluginDataDir;
  if (!_storeInitCache.has(key)) {
    _storeInitCache.set(key, _doInitStores(cfg, pluginDataDir, logger));
  }
  return _storeInitCache.get(key);
}
function resetStores(pluginDataDir) {
  if (pluginDataDir) {
    _storeInitCache.delete(pluginDataDir);
  } else {
    _storeInitCache.clear();
  }
}
async function _doInitStores(cfg, pluginDataDir, logger) {
  let vectorStore;
  let embeddingService;
  let needsReindex = false;
  let reindexReason;
  try {
    const bundle = createStoreBundle(cfg, {
      dataDir: pluginDataDir,
      logger
    });
    vectorStore = bundle.store;
    embeddingService = bundle.embedding ?? void 0;
    const providerInfo = embeddingService?.getProviderInfo();
    const initResult = await vectorStore.init(providerInfo);
    if (vectorStore.isDegraded()) {
      logger.warn(`${TAG20} Store is in degraded mode, falling back to keyword dedup`);
      vectorStore = void 0;
      embeddingService = void 0;
    } else {
      logger.debug?.(
        `${TAG20} Store initialized: backend=${cfg.storeBackend}, provider=${cfg.embedding.provider}`
      );
      needsReindex = initResult.needsReindex;
      reindexReason = initResult.reason;
      try {
        const currentStoreInfo = buildStoreInfo(bundle.storeSnapshot);
        const existing = readManifest(pluginDataDir);
        if (!existing) {
          const manifest = {
            version: 1,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            store: currentStoreInfo,
            seed: null
          };
          writeManifest(pluginDataDir, manifest);
          logger.debug?.(`${TAG20} Manifest created: ${JSON.stringify(currentStoreInfo)}`);
        } else {
          const diffs = diffStoreBinding(existing.store, currentStoreInfo);
          if (diffs.length > 0) {
            logger.debug?.(
              `${TAG20} Store config differs from initial binding recorded in manifest (${diffs.join("; ")}). This is expected if the storage backend was switched intentionally.`
            );
          }
        }
      } catch (err) {
        logger.warn(`${TAG20} Failed to read/write manifest (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(
      `${TAG20} Store init failed; vector/FTS recall and dedup conflict detection will be unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
    vectorStore = void 0;
    embeddingService = void 0;
  }
  return { vectorStore, embeddingService, needsReindex, reindexReason };
}
function createL1Runner(opts) {
  const { pluginDataDir, cfg, openclawConfig, vectorStore, embeddingService, logger, getInstanceId, llmRunner } = opts;
  const config = openclawConfig;
  return async ({ sessionKey }) => {
    if (!config && !llmRunner) {
      logger.debug?.(`${TAG20} [l1] No OpenClaw config and no LLM runner, skipping L1 extraction`);
      return { processedCount: 0 };
    }
    const checkpoint = new CheckpointManager(pluginDataDir, logger);
    const cp = await checkpoint.read();
    const runnerState = checkpoint.getRunnerState(cp, sessionKey);
    logger.info(
      `${TAG20} [l1] Session ${sessionKey}: l1_cursor=${runnerState.last_l1_cursor || "(start)"}`
    );
    try {
      let groups;
      let maxRecordedAtMs = 0;
      if (vectorStore && !vectorStore.isDegraded()) {
        const l1Cursor = runnerState.last_l1_cursor > 0 ? runnerState.last_l1_cursor : void 0;
        const dbGroups = await vectorStore.queryL0GroupedBySessionId(sessionKey, l1Cursor);
        groups = dbGroups.map((g) => ({
          sessionId: g.sessionId,
          messages: g.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp
          }))
        }));
        for (const g of dbGroups) {
          for (const m of g.messages) {
            if (m.recordedAtMs > maxRecordedAtMs) maxRecordedAtMs = m.recordedAtMs;
          }
        }
        logger.debug?.(`${TAG20} [l1] L0 data source: VectorStore DB`);
      } else {
        logger.debug?.(`${TAG20} [l1] L0 data source: JSONL files (VectorStore unavailable)`);
        const jsonlGroups = await readConversationMessagesGroupedBySessionId(
          sessionKey,
          pluginDataDir,
          runnerState.last_l1_cursor || void 0,
          logger,
          50
        );
        groups = jsonlGroups.map((g) => ({
          sessionId: g.sessionId,
          messages: g.messages
        }));
        for (const g of jsonlGroups) {
          for (const m of g.messages) {
            if (m.recordedAtMs > maxRecordedAtMs) maxRecordedAtMs = m.recordedAtMs;
          }
        }
      }
      if (groups.length === 0) {
        logger.debug?.(`${TAG20} [l1] No new L0 messages for session ${sessionKey}`);
        return { processedCount: 0 };
      }
      const totalMessages = groups.reduce((sum, g) => sum + g.messages.length, 0);
      logger.info(
        `${TAG20} [l1] Processing ${totalMessages} L0 messages across ${groups.length} sessionId group(s) for session ${sessionKey}`
      );
      let totalExtracted = 0;
      let totalStored = 0;
      let lastSceneName;
      for (const group of groups) {
        logger.debug?.(
          `${TAG20} [l1] Group sessionId=${group.sessionId || "(empty)"}: ${group.messages.length} messages`
        );
        const l1Result = await extractL1Memories({
          messages: group.messages,
          sessionKey,
          sessionId: group.sessionId,
          baseDir: pluginDataDir,
          config,
          options: {
            enableDedup: cfg.extraction.enableDedup,
            maxMemoriesPerSession: cfg.extraction.maxMemoriesPerSession,
            model: cfg.extraction.model,
            previousSceneName: lastSceneName ?? (runnerState.last_scene_name || void 0),
            vectorStore,
            embeddingService,
            conflictRecallTopK: cfg.embedding.conflictRecallTopK,
            embeddingTimeoutMs: cfg.embedding.captureTimeoutMs ?? cfg.embedding.timeoutMs,
            llmRunner
          },
          logger,
          instanceId: getInstanceId?.()
        });
        totalExtracted += l1Result.extractedCount;
        totalStored += l1Result.storedCount;
        if (l1Result.lastSceneName) {
          lastSceneName = l1Result.lastSceneName;
        }
      }
      await checkpoint.markL1ExtractionComplete(sessionKey, totalStored, maxRecordedAtMs || void 0, lastSceneName);
      logger.info(
        `${TAG20} [l1] L1 complete: extracted=${totalExtracted}, stored=${totalStored} (${groups.length} group(s))`
      );
      return { processedCount: totalMessages };
    } catch (err) {
      logger.error(`${TAG20} [l1] L1 failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      throw err;
    }
  };
}
function createPersister(pluginDataDir, logger) {
  return async (states) => {
    const checkpoint = new CheckpointManager(pluginDataDir, logger);
    await checkpoint.mergePipelineStates(states);
  };
}
function createL2Runner(opts) {
  const { pluginDataDir, cfg, openclawConfig, vectorStore, logger, instanceId, llmRunner } = opts;
  let profileBaseline = /* @__PURE__ */ new Map();
  return async (sessionKey, cursor) => {
    logger.debug?.(
      `${TAG20} [L2] session=${sessionKey}, updatedAfter=${cursor ?? "(full)"}`
    );
    if (!openclawConfig && !llmRunner) {
      logger.warn(`${TAG20} [L2] No OpenClaw config and no LLM runner, skipping scene extraction`);
      return;
    }
    let records;
    if (vectorStore?.pullProfiles && !vectorStore.isDegraded()) {
      profileBaseline = await pullProfilesToLocal(pluginDataDir, vectorStore, logger);
    }
    if (vectorStore && !vectorStore.isDegraded()) {
      const { queryMemoryRecords: queryMemoryRecords2 } = await Promise.resolve().then(() => (init_l1_reader(), l1_reader_exports));
      const memRecords = await queryMemoryRecords2(vectorStore, {
        sessionKey,
        updatedAfter: cursor
      }, logger);
      if (memRecords.length === 0) {
        logger.debug?.(
          `${TAG20} [L2] No new L1 records since cursor (session=${sessionKey}, updatedAfter=${cursor ?? "(full)"}), skipping scene extraction`
        );
        return { skipped: true, latestCursor: cursor || void 0 };
      }
      logger.debug?.(
        `${TAG20} [L2] Incremental query returned ${memRecords.length} record(s) (session=${sessionKey})`
      );
      records = memRecords.map((r) => ({
        content: r.content,
        created_at: r.createdAt,
        id: r.id,
        updatedAt: r.updatedAt
      }));
    } else {
      logger.debug?.(`${TAG20} [L2] VectorStore unavailable, falling back to JSONL read (session=${sessionKey})`);
      const { readMemoryRecords: readMemoryRecords2 } = await Promise.resolve().then(() => (init_l1_reader(), l1_reader_exports));
      let sessionRecords = await readMemoryRecords2(sessionKey, pluginDataDir, logger);
      if (cursor) {
        const beforeCount = sessionRecords.length;
        sessionRecords = sessionRecords.filter((r) => {
          const t = r.updatedAt || r.createdAt || "";
          return t > cursor;
        });
        logger.debug?.(
          `${TAG20} [L2] JSONL time filter: ${beforeCount} \u2192 ${sessionRecords.length} record(s) (updatedAfter=${cursor})`
        );
      }
      if (sessionRecords.length === 0) {
        logger.debug?.(`${TAG20} [L2] No new L1 records found (JSONL fallback, session=${sessionKey}), skipping scene extraction`);
        return { latestCursor: cursor || void 0 };
      }
      records = sessionRecords.map((r) => ({
        content: r.content,
        created_at: r.createdAt,
        id: r.id,
        updatedAt: r.updatedAt
      }));
    }
    const extractor = new SceneExtractor({
      dataDir: pluginDataDir,
      config: openclawConfig,
      model: cfg.persona.model,
      maxScenes: cfg.persona.maxScenes,
      sceneBackupCount: cfg.persona.sceneBackupCount,
      logger,
      instanceId,
      llmRunner
    });
    const memories = records.map((r) => ({
      content: r.content,
      created_at: r.created_at,
      id: r.id
    }));
    const preCheckpoint = new CheckpointManager(pluginDataDir, logger);
    const preState = await preCheckpoint.read();
    const preScenesProcessed = preState.scenes_processed;
    const preMemoriesSince = preState.memories_since_last_persona;
    const preTotalProcessed = preState.total_processed;
    const extractResult = await extractor.extract(memories);
    if (extractResult.success && extractResult.memoriesProcessed > 0) {
      const checkpoint = new CheckpointManager(pluginDataDir, logger);
      const postState = await checkpoint.read();
      if (postState.scenes_processed < preScenesProcessed || postState.total_processed < preTotalProcessed) {
        logger.warn(
          `${TAG20} [L2] \u26A0\uFE0F Checkpoint corruption detected! scenes_processed: ${preScenesProcessed} \u2192 ${postState.scenes_processed}, total_processed: ${preTotalProcessed} \u2192 ${postState.total_processed}, memories_since: ${preMemoriesSince} \u2192 ${postState.memories_since_last_persona}. Repairing...`
        );
        await checkpoint.write({
          ...postState,
          scenes_processed: Math.max(postState.scenes_processed, preScenesProcessed),
          total_processed: Math.max(postState.total_processed, preTotalProcessed),
          memories_since_last_persona: Math.max(postState.memories_since_last_persona, preMemoriesSince)
        });
        logger.info(`${TAG20} [L2] Checkpoint repaired`);
      }
      if (vectorStore && supportsProfileSyncWrite(vectorStore)) {
        await syncLocalProfilesToStore(pluginDataDir, vectorStore, profileBaseline, logger);
      }
      await checkpoint.incrementScenesProcessed();
      const latestCursor = records.reduce((latest, r) => {
        return r.updatedAt > latest ? r.updatedAt : latest;
      }, "");
      logger.debug?.(
        `${TAG20} [L2] Extraction complete: processed=${extractResult.memoriesProcessed}, latestCursor=${latestCursor}`
      );
      return { latestCursor: latestCursor || void 0 };
    }
  };
}
function createL3Runner(opts) {
  const { pluginDataDir, cfg, openclawConfig, vectorStore, logger, instanceId, llmRunner } = opts;
  return async () => {
    const trigger = new PersonaTrigger({
      dataDir: pluginDataDir,
      interval: cfg.persona.triggerEveryN,
      logger
    });
    const { should, reason } = await trigger.shouldGenerate();
    if (!should) {
      logger.debug?.(`${TAG20} [L3] Persona generation not needed`);
      return;
    }
    if (!openclawConfig && !llmRunner) {
      logger.warn(`${TAG20} [L3] No OpenClaw config and no LLM runner, skipping persona generation`);
      return;
    }
    let profileBaseline = /* @__PURE__ */ new Map();
    if (vectorStore?.pullProfiles && !vectorStore.isDegraded()) {
      profileBaseline = await pullProfilesToLocal(pluginDataDir, vectorStore, logger);
    }
    logger.info(`${TAG20} [L3] Starting persona generation: ${reason}`);
    const generator = new PersonaGenerator({
      dataDir: pluginDataDir,
      config: openclawConfig,
      model: cfg.persona.model,
      backupCount: cfg.persona.backupCount,
      logger,
      instanceId,
      llmRunner
    });
    const genResult = await generator.generateLocalPersona(reason);
    if (!genResult) {
      logger.info(`${TAG20} [L3] Persona generation skipped (no changes)`);
      return;
    }
    if (vectorStore && supportsProfileSyncWrite(vectorStore)) {
      await syncLocalProfilesToStore(pluginDataDir, vectorStore, profileBaseline, logger);
    }
    const checkpoint = new CheckpointManager(pluginDataDir, logger);
    const cp = await checkpoint.read();
    await checkpoint.markPersonaGenerated(cp.total_processed);
    logger.info(`${TAG20} [L3] Persona generation succeeded`);
  };
}
function createPipelineManager(cfg, logger, sessionFilter) {
  return new MemoryPipelineManager(
    {
      everyNConversations: cfg.pipeline.everyNConversations,
      enableWarmup: cfg.pipeline.enableWarmup,
      l1: { idleTimeoutSeconds: cfg.pipeline.l1IdleTimeoutSeconds },
      l2: {
        delayAfterL1Seconds: cfg.pipeline.l2DelayAfterL1Seconds,
        minIntervalSeconds: cfg.pipeline.l2MinIntervalSeconds,
        maxIntervalSeconds: cfg.pipeline.l2MaxIntervalSeconds,
        sessionActiveWindowHours: cfg.pipeline.sessionActiveWindowHours
      }
    },
    logger,
    sessionFilter ?? new SessionFilter([])
  );
}

// src/core/tdai-core.ts
var TAG21 = "[memory-tdai] [core]";
var TdaiCore = class {
  hostAdapter;
  cfg;
  logger;
  dataDir;
  runnerFactory;
  sessionFilter;
  instanceId;
  // Lazy-initialized resources
  vectorStore;
  embeddingService;
  scheduler;
  /**
   * Promise gate for the one-shot scheduler-start sequence.
   *
   * ``ensureSchedulerStarted`` reads a checkpoint file (async) and then
   * calls ``scheduler.start(restoredStates)``.  Under the Gateway, several
   * HTTP requests can reach ``handleTurnCommitted`` concurrently and all
   * race into that function.  Using a plain boolean flag is unsafe: the
   * first caller flips the flag to ``true`` *before* the await completes,
   * so subsequent callers slip past the check and touch the scheduler
   * before ``start()`` has actually run — which makes ``start()``'s
   * ``sessionStates.set(key, restored)`` later clobber the state that
   * those concurrent captures already incremented.
   *
   * Storing the in-flight promise lets every concurrent caller ``await``
   * the same start sequence.  Once it resolves the promise is kept as a
   * sentinel so subsequent calls are a single already-resolved await
   * (effectively a no-op).
   */
  schedulerStartPromise;
  storeReady;
  /**
   * In-flight fire-and-forget background tasks started by
   * ``handleTurnCommitted`` (currently: deferred L0 embedding for
   * SQLite-style stores — see auto-capture.ts path A).
   *
   * ``destroy()`` awaits all pending entries (with a hard timeout)
   * before closing ``vectorStore`` / ``embeddingService`` so that a
   * late ``updateL0Embedding`` cannot land on an already-closed
   * database connection.
   *
   * Each task registers itself on creation and removes itself in its
   * own ``finally`` handler, so the set stays bounded by the number
   * of currently-running background tasks.
   */
  bgTasks = /* @__PURE__ */ new Set();
  constructor(opts) {
    this.hostAdapter = opts.hostAdapter;
    this.cfg = opts.config;
    this.logger = opts.hostAdapter.getLogger();
    this.dataDir = opts.hostAdapter.getRuntimeContext().dataDir;
    this.runnerFactory = opts.hostAdapter.getLLMRunnerFactory();
    this.sessionFilter = opts.sessionFilter ?? new SessionFilter([]);
    this.instanceId = opts.instanceId;
  }
  // ============================
  // Lifecycle
  // ============================
  /**
   * Initialize data directories, storage, and pipeline scheduler.
   * Must be called once before any other methods.
   */
  async initialize() {
    this.logger.debug?.(`${TAG21} Initializing TDAI Core: dataDir=${this.dataDir}`);
    initDataDirectories(this.dataDir);
    this.storeReady = this.initStores();
    if (this.cfg.extraction.enabled) {
      this.scheduler = createPipelineManager(this.cfg, this.logger, this.sessionFilter);
      this.storeReady.then(() => this.wirePipelineRunners()).catch((err) => {
        this.logger.error(`${TAG21} Store init failed; wiring pipeline runners in degraded mode: ${err instanceof Error ? err.message : String(err)}`);
        this.wirePipelineRunners();
      });
    }
    this.logger.debug?.(`${TAG21} TDAI Core initialized`);
  }
  /**
   * Destroy all resources. Call on shutdown.
   */
  async destroy() {
    this.logger.debug?.(`${TAG21} Destroying TDAI Core...`);
    await this.storeReady?.catch(() => {
    });
    if (this.scheduler && this.schedulerStartPromise) {
      await this.scheduler.destroy();
      this.schedulerStartPromise = void 0;
      this.logger.debug?.(`${TAG21} Scheduler destroyed`);
    }
    if (this.bgTasks.size > 0) {
      const pending = [...this.bgTasks];
      this.logger.debug?.(
        `${TAG21} Draining ${pending.length} background task(s) before closing stores...`
      );
      const BG_DRAIN_TIMEOUT_MS = 5e3;
      let drainTimeoutId;
      try {
        await Promise.race([
          Promise.allSettled(pending).then(() => void 0),
          new Promise((_, reject) => {
            drainTimeoutId = setTimeout(
              () => reject(new Error("bgTasks drain timeout")),
              BG_DRAIN_TIMEOUT_MS
            );
          })
        ]);
        this.logger.debug?.(`${TAG21} Background tasks drained`);
      } catch (err) {
        this.logger.warn(
          `${TAG21} Background-task drain timed out (${BG_DRAIN_TIMEOUT_MS}ms): ${err instanceof Error ? err.message : String(err)}. Closing stores anyway \u2014 residual writes may surface as warnings.`
        );
      } finally {
        if (drainTimeoutId !== void 0) clearTimeout(drainTimeoutId);
      }
    }
    if (this.vectorStore) {
      this.vectorStore.close();
      this.vectorStore = void 0;
      this.logger.debug?.(`${TAG21} VectorStore closed`);
    }
    if (this.embeddingService?.close) {
      try {
        await this.embeddingService.close();
      } catch (err) {
        this.logger.warn(`${TAG21} EmbeddingService close error: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.embeddingService = void 0;
    }
    resetStores(this.dataDir);
    this.logger.debug?.(`${TAG21} TDAI Core destroyed`);
  }
  // ============================
  // Core capabilities
  // ============================
  /**
   * Handle recall (memory retrieval) before an LLM turn.
   * Maps to: OpenClaw `before_prompt_build` / Hermes `prefetch()`.
   */
  async handleBeforeRecall(userText, sessionKey) {
    await this.storeReady?.catch(() => {
    });
    const result = await performAutoRecall({
      userText,
      actorId: "default_user",
      sessionKey,
      cfg: this.cfg,
      pluginDataDir: this.dataDir,
      logger: this.logger,
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService
    });
    return result ?? {};
  }
  /**
   * Handle turn commitment (conversation capture + pipeline trigger).
   * Maps to: OpenClaw `agent_end` / Hermes `sync_turn()`.
   */
  async handleTurnCommitted(turn) {
    await this.storeReady?.catch(() => {
    });
    await this.ensureSchedulerStarted();
    return performAutoCapture({
      messages: turn.messages,
      sessionKey: turn.sessionKey,
      sessionId: turn.sessionId,
      cfg: this.cfg,
      pluginDataDir: this.dataDir,
      logger: this.logger,
      scheduler: this.scheduler,
      originalUserText: turn.userText,
      originalUserMessageCount: turn.originalUserMessageCount,
      pluginStartTimestamp: turn.startedAt ?? Date.now(),
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService,
      bgTaskRegistry: this.bgTasks
    });
  }
  /**
   * Search L1 structured memories.
   * Maps to: `tdai_memory_search` tool.
   */
  async searchMemories(params) {
    const result = await executeMemorySearch({
      query: params.query,
      limit: params.limit ?? 5,
      type: params.type,
      scene: params.scene,
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService,
      logger: this.logger
    });
    return {
      text: formatSearchResponse(result),
      total: result.total,
      strategy: result.strategy
    };
  }
  /**
   * Search L0 raw conversations.
   * Maps to: `tdai_conversation_search` tool.
   */
  async searchConversations(params) {
    const result = await executeConversationSearch({
      query: params.query,
      limit: params.limit ?? 5,
      sessionKey: params.sessionKey,
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService,
      logger: this.logger
    });
    return {
      text: formatConversationSearchResponse(result),
      total: result.total
    };
  }
  /**
   * Handle end-of-conversation for a single session.
   *
   * ⚠️ Read this if you are editing the method:
   *
   * There are two distinct shutdown-ish events, and they must **NOT**
   * share an implementation:
   *
   *   - **`gateway_stop` (OpenClaw / process exit)**
   *     The host is going away.  Tear everything down — scheduler,
   *     VectorStore, EmbeddingService, caches.  That is
   *     {@link destroy}, not this method.
   *
   *   - **`on_session_end` (Hermes) / `POST /session/end` (Gateway)**
   *     One conversation ended while the process keeps serving other
   *     concurrent sessions.  **Only** this session's buffered work
   *     should be flushed; every other session's timers, buffers,
   *     pipeline state, and the shared scheduler itself MUST remain
   *     untouched.  That is this method.
   *
   * Historically this method did ``scheduler.destroy() +
   * createPipelineManager()``, which conflated the two semantics and
   * wiped concurrent sessions' in-memory state on every ``/session/end``
   * call.  That bug is covered by the concurrency test
   * ``P0-1: handleSessionEnd must be scoped to its session``.
   *
   * @param sessionKey  Session whose buffered work should be flushed.
   *                    Unknown keys are tolerated as a no-op so callers
   *                    don't have to pre-check whether the session was
   *                    already evicted or never produced a capture.
   */
  async handleSessionEnd(sessionKey) {
    if (!sessionKey) return;
    await this.storeReady?.catch(() => {
    });
    if (!this.scheduler) return;
    await this.scheduler.flushSession(sessionKey);
  }
  // ============================
  // Accessors (for migration bridge)
  // ============================
  /** Get the LLM runner factory (for creating host-neutral LLM runners). */
  getLLMRunnerFactory() {
    return this.runnerFactory;
  }
  /** Get the shared VectorStore (may be undefined if init failed). */
  getVectorStore() {
    return this.vectorStore;
  }
  /** Get the shared EmbeddingService (may be undefined if not configured). */
  getEmbeddingService() {
    return this.embeddingService;
  }
  /** Get the pipeline scheduler (may be undefined if extraction disabled). */
  getScheduler() {
    return this.scheduler;
  }
  /** Whether the scheduler has been started (or is currently starting). */
  isSchedulerStarted() {
    return this.schedulerStartPromise !== void 0;
  }
  /** Set the instance ID for metrics (may be resolved asynchronously). */
  setInstanceId(id) {
    this.instanceId = id;
    if (this.scheduler) {
      this.scheduler.instanceId = id;
    }
  }
  // ============================
  // Internal helpers
  // ============================
  async initStores() {
    try {
      const stores = await initStores(this.cfg, this.dataDir, this.logger);
      this.vectorStore = stores.vectorStore;
      this.embeddingService = stores.embeddingService;
      this.logger.debug?.(`${TAG21} Stores initialized: backend=${this.cfg.storeBackend}, embedding=${this.cfg.embedding.provider}`);
    } catch (err) {
      this.logger.warn(
        `${TAG21} Store init failed; recall/dedup degraded: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  wirePipelineRunners() {
    if (!this.scheduler) return;
    const useHostRunner = this.cfg.llm.enabled || this.hostAdapter.hostType !== "openclaw";
    const openclawConfig = void 0;
    let runnerFactory = this.runnerFactory;
    const l1LlmRunner = useHostRunner ? runnerFactory.createRunner({ enableTools: false }) : void 0;
    const l2l3LlmRunner = useHostRunner ? runnerFactory.createRunner({ enableTools: true }) : void 0;
    this.scheduler.setL1Runner(createL1Runner({
      pluginDataDir: this.dataDir,
      cfg: this.cfg,
      openclawConfig,
      vectorStore: this.vectorStore,
      embeddingService: this.embeddingService,
      logger: this.logger,
      getInstanceId: () => this.instanceId,
      llmRunner: l1LlmRunner
    }));
    this.scheduler.setPersister(createPersister(this.dataDir, this.logger));
    this.scheduler.setL2Runner(async (sessionKey, cursor) => {
      const l2Runner = createL2Runner({
        pluginDataDir: this.dataDir,
        cfg: this.cfg,
        openclawConfig,
        vectorStore: this.vectorStore,
        logger: this.logger,
        instanceId: this.instanceId,
        llmRunner: l2l3LlmRunner
      });
      return l2Runner(sessionKey, cursor);
    });
    this.scheduler.setL3Runner(async () => {
      const l3Runner = createL3Runner({
        pluginDataDir: this.dataDir,
        cfg: this.cfg,
        openclawConfig,
        vectorStore: this.vectorStore,
        logger: this.logger,
        instanceId: this.instanceId,
        llmRunner: l2l3LlmRunner
      });
      await l3Runner();
    });
    this.logger.debug?.(`${TAG21} Pipeline runners wired`);
  }
  ensureSchedulerStarted() {
    if (this.schedulerStartPromise) return this.schedulerStartPromise;
    if (!this.scheduler) return Promise.resolve();
    const scheduler = this.scheduler;
    this.schedulerStartPromise = (async () => {
      try {
        const checkpoint = new CheckpointManager(this.dataDir, this.logger);
        const cp = await checkpoint.read();
        scheduler.start(checkpoint.getAllPipelineStates(cp));
        this.logger.debug?.(`${TAG21} Scheduler started`);
      } catch (err) {
        this.logger.error(`${TAG21} Failed to restore checkpoint: ${err instanceof Error ? err.message : String(err)}`);
        scheduler.start({});
      }
    })();
    this.schedulerStartPromise.catch(() => {
      this.schedulerStartPromise = void 0;
    });
    return this.schedulerStartPromise;
  }
};

// src/utils/no-think-fetch.ts
var VALID_DISABLE_THINKING_STRATEGIES = [
  false,
  "vllm",
  "deepseek",
  "dashscope",
  "openai",
  "anthropic",
  "kimi",
  "gemini"
];
function isValidDisableThinkingStrategy(value) {
  return VALID_DISABLE_THINKING_STRATEGIES.includes(value);
}
function normalizeDisableThinking(raw) {
  if (raw === void 0 || raw === false) return false;
  if (raw === true) return "vllm";
  if (isValidDisableThinkingStrategy(raw)) return raw;
  console.warn(
    `[memory-tdai] Unknown disableThinking strategy "${raw}", valid values: false, true, "vllm", "deepseek", "dashscope", "openai", "anthropic", "kimi", "gemini". Thinking will NOT be disabled.`
  );
  return false;
}

// src/config.ts
function parseConfig(raw) {
  const c = raw ?? {};
  const captureGroup = obj(c, "capture");
  const rawRetentionDays = num(captureGroup, "l0l1RetentionDays") ?? 0;
  const allowAggressiveCleanup = bool(captureGroup, "allowAggressiveCleanup") ?? false;
  let retentionDays;
  if (rawRetentionDays <= 0) {
    retentionDays = void 0;
  } else if (rawRetentionDays >= 3) {
    retentionDays = rawRetentionDays;
  } else if (allowAggressiveCleanup) {
    retentionDays = rawRetentionDays;
  } else {
    retentionDays = void 0;
  }
  const extractionGroup = obj(c, "extraction");
  const personaGroup = obj(c, "persona");
  const pipelineGroup = obj(c, "pipeline");
  const recallGroup = obj(c, "recall");
  const embeddingGroup = obj(c, "embedding");
  let embeddingConfigError;
  const embeddingApiKey = str(embeddingGroup, "apiKey") ?? "";
  const embeddingBaseUrl = str(embeddingGroup, "baseUrl") ?? "";
  const embeddingProviderRaw = str(embeddingGroup, "provider") ?? "none";
  const embeddingModelRaw = str(embeddingGroup, "model") ?? "";
  const embeddingDimensionsRaw = num(embeddingGroup, "dimensions");
  const embeddingProxyUrl = str(embeddingGroup, "proxyUrl");
  let embeddingProvider;
  let embeddingEnabled = bool(embeddingGroup, "enabled") ?? true;
  if (embeddingProviderRaw === "none") {
    embeddingProvider = "none";
    embeddingEnabled = false;
  } else if (embeddingProviderRaw === "local") {
    embeddingProvider = "none";
    embeddingEnabled = false;
    embeddingConfigError = "Local embedding provider is not available in user config. Please configure a remote embedding provider (e.g. openai, deepseek). Embedding has been disabled.";
  } else if (embeddingProviderRaw === "qclaw") {
    const missingFields = [];
    if (!embeddingProxyUrl) missingFields.push("proxyUrl");
    if (!embeddingBaseUrl) missingFields.push("baseUrl");
    if (!embeddingApiKey) missingFields.push("apiKey");
    if (!embeddingModelRaw) missingFields.push("model");
    if (embeddingDimensionsRaw == null || embeddingDimensionsRaw <= 0) missingFields.push("dimensions");
    if (missingFields.length > 0) {
      const errorMsg = `Embedding provider 'qclaw' requires 'proxyUrl', 'baseUrl', 'apiKey', 'model', and 'dimensions' to be set. Missing: ${missingFields.join(", ")}. Embedding has been disabled.`;
      embeddingConfigError = errorMsg;
      embeddingEnabled = false;
      embeddingProvider = embeddingProviderRaw;
    } else {
      embeddingProvider = embeddingProviderRaw;
    }
  } else {
    const missingFields = [];
    if (!embeddingApiKey) missingFields.push("apiKey");
    if (!embeddingBaseUrl) missingFields.push("baseUrl");
    if (!embeddingModelRaw) missingFields.push("model");
    if (embeddingDimensionsRaw == null || embeddingDimensionsRaw <= 0) missingFields.push("dimensions");
    if (missingFields.length > 0) {
      const errorMsg = `Remote embedding provider '${embeddingProviderRaw}' requires 'apiKey', 'baseUrl', 'model', and 'dimensions' to be set. Missing: ${missingFields.join(", ")}. Embedding has been disabled.`;
      embeddingConfigError = errorMsg;
      embeddingEnabled = false;
      embeddingProvider = embeddingProviderRaw;
    } else {
      embeddingProvider = embeddingProviderRaw;
    }
  }
  const defaultDimensions = embeddingProvider === "none" ? 0 : embeddingDimensionsRaw ?? 0;
  const defaultModel = embeddingProvider === "none" ? "" : embeddingModelRaw;
  const cleanTime = normalizeCleanTime(str(captureGroup, "cleanTime")) ?? "03:00";
  const bm25Group = obj(c, "bm25");
  const storeBackendRaw = str(c, "storeBackend") ?? "sqlite";
  const storeBackend = storeBackendRaw === "tcvdb" ? "tcvdb" : "sqlite";
  const tcvdbGroup = obj(c, "tcvdb");
  const memoryCleanup = {
    retentionDays,
    enabled: retentionDays != null,
    cleanTime
  };
  const offloadGroup = obj(c, "offload");
  const offloadMode = (() => {
    const raw2 = optStr(offloadGroup, "mode");
    if (raw2 === "local" || raw2 === "backend" || raw2 === "collect") return raw2;
    return optStr(offloadGroup, "backendUrl") ? "backend" : "local";
  })();
  const offload = {
    enabled: bool(offloadGroup, "enabled") ?? false,
    mode: offloadMode,
    model: optStr(offloadGroup, "model"),
    temperature: num(offloadGroup, "temperature") ?? 0.2,
    disableThinking: normalizeDisableThinking(boolOrStr(offloadGroup, "disableThinking")),
    forceTriggerThreshold: num(offloadGroup, "forceTriggerThreshold") ?? 4,
    dataDir: optStr(offloadGroup, "dataDir"),
    defaultContextWindow: num(offloadGroup, "defaultContextWindow") ?? 2e5,
    maxPairsPerBatch: num(offloadGroup, "maxPairsPerBatch") ?? 20,
    l2NullThreshold: num(offloadGroup, "l2NullThreshold") ?? 4,
    l2TimeoutSeconds: num(offloadGroup, "l2TimeoutSeconds") ?? 300,
    mildOffloadRatio: num(offloadGroup, "mildOffloadRatio") ?? 0.5,
    aggressiveCompressRatio: num(offloadGroup, "aggressiveCompressRatio") ?? 0.85,
    mmdMaxTokenRatio: num(offloadGroup, "mmdMaxTokenRatio") ?? 0.2,
    backendUrl: optStr(offloadGroup, "backendUrl"),
    backendApiKey: optStr(offloadGroup, "backendApiKey"),
    backendTimeoutMs: num(offloadGroup, "backendTimeoutMs") ?? 12e4,
    offloadRetentionDays: normalizeOffloadRetentionDays(num(offloadGroup, "offloadRetentionDays") ?? 0),
    logMaxSizeMb: num(offloadGroup, "logMaxSizeMb") ?? 50,
    userId: optStr(offloadGroup, "userId")
  };
  return {
    timezone: str(c, "timezone") ?? "system",
    capture: {
      enabled: bool(captureGroup, "enabled") ?? true,
      excludeAgents: strArray(captureGroup, "excludeAgents") ?? [],
      l0l1RetentionDays: retentionDays ?? 0,
      allowAggressiveCleanup
    },
    extraction: {
      enabled: bool(extractionGroup, "enabled") ?? true,
      enableDedup: bool(extractionGroup, "enableDedup") ?? true,
      maxMemoriesPerSession: num(extractionGroup, "maxMemoriesPerSession") ?? 20,
      model: optStr(extractionGroup, "model")
    },
    persona: {
      triggerEveryN: num(personaGroup, "triggerEveryN") ?? 50,
      maxScenes: num(personaGroup, "maxScenes") ?? 15,
      backupCount: num(personaGroup, "backupCount") ?? 3,
      sceneBackupCount: num(personaGroup, "sceneBackupCount") ?? 10,
      model: optStr(personaGroup, "model")
    },
    pipeline: {
      everyNConversations: num(pipelineGroup, "everyNConversations") ?? 5,
      enableWarmup: bool(pipelineGroup, "enableWarmup") ?? true,
      l1IdleTimeoutSeconds: num(pipelineGroup, "l1IdleTimeoutSeconds") ?? 600,
      l2DelayAfterL1Seconds: num(pipelineGroup, "l2DelayAfterL1Seconds") ?? 10,
      l2MinIntervalSeconds: num(pipelineGroup, "l2MinIntervalSeconds") ?? 900,
      l2MaxIntervalSeconds: num(pipelineGroup, "l2MaxIntervalSeconds") ?? 3600,
      sessionActiveWindowHours: num(pipelineGroup, "sessionActiveWindowHours") ?? 24
    },
    recall: {
      enabled: bool(recallGroup, "enabled") ?? true,
      maxResults: num(recallGroup, "maxResults") ?? 5,
      maxCharsPerMemory: num(recallGroup, "maxCharsPerMemory") ?? 0,
      maxTotalRecallChars: num(recallGroup, "maxTotalRecallChars") ?? 0,
      scoreThreshold: num(recallGroup, "scoreThreshold") ?? 0.3,
      strategy: validateStrategy(str(recallGroup, "strategy")) ?? "hybrid",
      timeoutMs: num(recallGroup, "timeoutMs") ?? 5e3
    },
    embedding: {
      enabled: embeddingEnabled,
      provider: embeddingProvider,
      baseUrl: embeddingBaseUrl,
      apiKey: embeddingApiKey,
      model: str(embeddingGroup, "model") ?? defaultModel,
      dimensions: num(embeddingGroup, "dimensions") ?? defaultDimensions,
      sendDimensions: bool(embeddingGroup, "sendDimensions") ?? true,
      conflictRecallTopK: num(embeddingGroup, "conflictRecallTopK") ?? 5,
      proxyUrl: embeddingProxyUrl,
      maxInputChars: num(embeddingGroup, "maxInputChars") ?? 5e3,
      timeoutMs: num(embeddingGroup, "timeoutMs") ?? 1e4,
      recallTimeoutMs: num(embeddingGroup, "recallTimeoutMs") ?? void 0,
      captureTimeoutMs: num(embeddingGroup, "captureTimeoutMs") ?? void 0,
      modelCacheDir: optStr(embeddingGroup, "modelCacheDir"),
      configError: embeddingConfigError
    },
    storeBackend,
    tcvdb: {
      url: str(tcvdbGroup, "url") ?? "",
      username: str(tcvdbGroup, "username") ?? "root",
      apiKey: str(tcvdbGroup, "apiKey") ?? "",
      database: str(tcvdbGroup, "database") ?? "",
      alias: str(tcvdbGroup, "alias") ?? "",
      embeddingModel: str(tcvdbGroup, "embeddingModel") ?? "bge-large-zh",
      timeout: num(tcvdbGroup, "timeout") ?? 1e4,
      caPemPath: str(tcvdbGroup, "caPemPath") || void 0
    },
    bm25: {
      enabled: bool(bm25Group, "enabled") ?? true,
      language: str(bm25Group, "language") === "en" ? "en" : "zh"
    },
    memoryCleanup,
    report: {
      enabled: bool(obj(c, "report"), "enabled") ?? false,
      type: str(obj(c, "report"), "type") ?? "local"
    },
    llm: (() => {
      const llmGroup = obj(c, "llm");
      return {
        enabled: bool(llmGroup, "enabled") ?? false,
        baseUrl: str(llmGroup, "baseUrl") ?? "https://api.openai.com/v1",
        apiKey: str(llmGroup, "apiKey") ?? "",
        model: str(llmGroup, "model") ?? "gpt-4o",
        maxTokens: num(llmGroup, "maxTokens") ?? 4096,
        timeoutMs: num(llmGroup, "timeoutMs") ?? 12e4,
        disableThinking: normalizeDisableThinking(boolOrStr(llmGroup, "disableThinking"))
      };
    })(),
    offload
  };
}
function obj(c, key) {
  const v = c[key];
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function str(src, key) {
  const v = src[key];
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function optStr(src, key) {
  const v = src[key];
  return typeof v === "string" ? v : void 0;
}
function num(src, key) {
  const v = src[key];
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function bool(src, key) {
  const v = src[key];
  return typeof v === "boolean" ? v : void 0;
}
function boolOrStr(src, key) {
  const v = src[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && v.trim()) return v.trim();
  return void 0;
}
function strArray(src, key) {
  const v = src[key];
  if (!Array.isArray(v)) return void 0;
  return v.filter((item) => typeof item === "string" && item.trim().length > 0);
}
var VALID_STRATEGIES = ["embedding", "keyword", "hybrid"];
function validateStrategy(value) {
  if (!value) return void 0;
  return VALID_STRATEGIES.includes(value) ? value : void 0;
}
function normalizeCleanTime(input) {
  if (!input) return void 0;
  const trimmed = input.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return void 0;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return void 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return void 0;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function normalizeOffloadRetentionDays(value) {
  if (value <= 0) return 0;
  if (value < 3) return 0;
  return value;
}

// src/adapters/dsh/llm-runner.ts
import { randomUUID } from "node:crypto";
import fs16 from "node:fs/promises";
import path17 from "node:path";
var TAG22 = "[memory-tdai][dsh-runner]";
function assembleStream(chunks) {
  return (async () => {
    const blocks = /* @__PURE__ */ new Map();
    let finishKind = "stop";
    for await (const raw of chunks) {
      const chunk = raw;
      switch (chunk.type) {
        case "block-start": {
          const block = { type: chunk.blockType ?? "text" };
          if (block.type === "tool-call") {
            block.id = "";
            block.name = "";
            block.arguments = "";
          }
          blocks.set(chunk.index, block);
          break;
        }
        case "text-delta": {
          const block = blocks.get(chunk.index);
          if (block !== void 0) block.text = String(block.text ?? "") + String(chunk.text ?? "");
          break;
        }
        case "tool-call-delta": {
          const block = blocks.get(chunk.index);
          if (block === void 0) break;
          if (chunk.id !== void 0) block.id = chunk.id;
          if (chunk.name !== void 0) block.name = String(block.name ?? "") + String(chunk.name);
          block.arguments = String(block.arguments ?? "") + String(chunk.argumentsDelta ?? "");
          break;
        }
        case "block-end": {
          if (chunk.block !== void 0) blocks.set(chunk.index, chunk.block);
          break;
        }
        case "finish": {
          finishKind = chunk.reason === void 0 ? String(chunk.kind ?? "stop") : String(chunk.reason);
          break;
        }
        default:
          break;
      }
    }
    return { blocks: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b), finishKind };
  })();
}
function userMessage(text) {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "plugin", plugin: "dsh-memory-tdai" }
  };
}
function assistantMessage(blocks, provider, model) {
  return {
    id: randomUUID(),
    role: "assistant",
    content: blocks,
    source: { kind: "model", provider, model }
  };
}
function toolResultMessage(callId, text, isError) {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "tool-result", toolCallId: callId, content: [{ type: "text", text }], isError }],
    source: { kind: "tool", callId }
  };
}
var FILE_TOOL_SCHEMAS = [
  {
    name: "read_file",
    description: "Read the full text content of a file inside the memory workspace. Paths are resolved relative to the memory workspace root; absolute paths and `..` escapes are rejected.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "write_to_file",
    description: "Create or overwrite a file inside the memory workspace. Missing parent directories are created.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "Full text content to write." }
      },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    name: "replace_in_file",
    description: "Replace the first exact occurrence of `oldText` with `newText` inside a workspace file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        oldText: { type: "string", description: "Exact literal text to find." },
        newText: { type: "string", description: "Replacement text." }
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false
    }
  }
];
function resolveSandboxed(workspaceDir, input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`${TAG22} invalid path argument`);
  }
  const resolved = path17.resolve(workspaceDir, input);
  const root = path17.resolve(workspaceDir);
  if (resolved !== root && !resolved.startsWith(root + path17.sep)) {
    throw new Error(`${TAG22} path escapes the memory workspace: ${input}`);
  }
  return resolved;
}
var DshLLMRunner = class {
  llm;
  provider;
  model;
  logger;
  enableTools;
  maxToolIterations;
  constructor(opts) {
    this.llm = opts.llm;
    this.provider = opts.provider;
    this.model = opts.model;
    this.logger = opts.logger;
    this.enableTools = opts.enableTools ?? false;
    this.maxToolIterations = opts.maxToolIterations ?? 10;
  }
  async run(params) {
    const workspaceDir = params.workspaceDir ?? process.cwd();
    const messages = [userMessage(params.prompt)];
    const system = params.systemPrompt;
    const steps = this.enableTools ? this.maxToolIterations : 1;
    let lastText = "";
    for (let i = 0; i < steps; i++) {
      const options = {
        provider: this.provider,
        model: this.model,
        messages,
        ...system === void 0 ? {} : { system },
        ...this.enableTools ? { tools: FILE_TOOL_SCHEMAS } : {},
        ...params.maxTokens === void 0 ? {} : { maxTokens: params.maxTokens }
      };
      const { blocks, finishKind } = await assembleStream(this.llm.stream(options));
      if (finishKind === "error" || finishKind === "aborted") {
        throw new Error(`${TAG22} LLM stream finished with ${finishKind} (task=${params.taskId})`);
      }
      const text = blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
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
    this.logger.warn?.(`${TAG22} tool loop exhausted ${this.maxToolIterations} iterations (task=${params.taskId})`);
    return lastText;
  }
  async executeFileTool(call, workspaceDir) {
    let args;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return { text: `Invalid JSON arguments: ${call.arguments}`, isError: true };
    }
    try {
      switch (call.name) {
        case "read_file": {
          const target = resolveSandboxed(workspaceDir, args.path);
          const content = await fs16.readFile(target, "utf8");
          return { text: content, isError: false };
        }
        case "write_to_file": {
          const target = resolveSandboxed(workspaceDir, args.path);
          await fs16.mkdir(path17.dirname(target), { recursive: true });
          await fs16.writeFile(target, String(args.content ?? ""), "utf8");
          return { text: `Wrote ${path17.relative(workspaceDir, target)}`, isError: false };
        }
        case "replace_in_file": {
          const target = resolveSandboxed(workspaceDir, args.path);
          const oldText = String(args.oldText ?? "");
          const newText = String(args.newText ?? "");
          const content = await fs16.readFile(target, "utf8");
          const at = content.indexOf(oldText);
          if (at < 0) return { text: "oldText not found in file", isError: true };
          await fs16.writeFile(target, content.slice(0, at) + newText + content.slice(at + oldText.length), "utf8");
          return { text: `Replaced in ${path17.relative(workspaceDir, target)}`, isError: false };
        }
        default:
          return { text: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return { text: `Tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }
};
var DshLLMRunnerFactory = class {
  llm;
  provider;
  model;
  logger;
  constructor(opts) {
    this.llm = opts.llm;
    this.provider = opts.provider;
    this.model = opts.model;
    this.logger = opts.logger;
  }
  createRunner(opts) {
    return new DshLLMRunner({
      llm: this.llm,
      provider: this.provider,
      model: this.model,
      logger: this.logger,
      enableTools: opts?.enableTools ?? false
    });
  }
};

// src/adapters/dsh/host-adapter.ts
var DshHostAdapter = class {
  hostType = "dsh";
  dataDir;
  logger;
  workspaceDir;
  runnerFactory;
  constructor(opts) {
    this.dataDir = opts.dataDir;
    this.logger = opts.logger;
    this.workspaceDir = opts.workspaceDir ?? process.cwd();
    this.runnerFactory = new DshLLMRunnerFactory({
      llm: opts.llm,
      provider: opts.provider,
      model: opts.model,
      logger: opts.logger
    });
  }
  getRuntimeContext() {
    return {
      userId: "default_user",
      sessionId: "",
      sessionKey: "",
      platform: "dsh",
      workspaceDir: this.workspaceDir,
      dataDir: this.dataDir
    };
  }
  /**
   * Build a RuntimeContext for one DSH session (used per-hook / per-tool).
   */
  buildRuntimeContextForSession(sessionKey, sessionId) {
    return {
      ...this.getRuntimeContext(),
      sessionKey,
      sessionId: sessionId ?? ""
    };
  }
  getLogger() {
    return this.logger;
  }
  getLLMRunnerFactory() {
    return this.runnerFactory;
  }
};
export {
  DshHostAdapter,
  DshLLMRunner,
  DshLLMRunnerFactory,
  TdaiCore,
  parseConfig
};
