import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbWasmMvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbWorkerMvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import type {
  ColumnInfo,
  LoadedSource,
  QueryResult,
  SourceDef,
  StorageEstimate,
} from './types';
import { quoteIdent, sourceUrl, sqlString, tableNameFor } from './sources';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbWasmMvp,
    mainWorker: duckdbWorkerMvp,
  },
  eh: {
    mainModule: duckdbWasmEh,
    mainWorker: duckdbWorkerEh,
  },
};

const DB_FILE = 'opfs://atlas-workbench.duckdb';
const META_TABLE = '_atlas_sources';
const SEED_DIR = 'atlas-seed';

export type DbMode = 'opfs' | 'memory';

export interface Warehouse {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
  mode: DbMode;
  engineVersion: string;
}

export type BootReporter = (
  step: 'engine' | 'storage' | 'catalog' | 'ready',
  detail?: string,
) => void;

function formatTemporal(date: Date, withTime: boolean): string {
  if (Number.isNaN(date.getTime())) return date.toString();
  const iso = date.toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

function normalizeValue(value: unknown, rawType = ''): unknown {
  const dateOnly = rawType.includes('Date32') || rawType.includes('Date64');
  if (value instanceof Date) {
    return formatTemporal(value, !dateOnly);
  }
  if (typeof value === 'bigint' || typeof value === 'number') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && rawType) {
      // duckdb-wasm hands Arrow date/timestamp vectors over as epoch
      // milliseconds, so no unit conversion is needed here.
      if (dateOnly) return formatTemporal(new Date(numeric), false);
      if (rawType.includes('Timestamp')) {
        return formatTemporal(new Date(numeric), true);
      }
    }
  }
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value === undefined) return null;
  return value;
}

function arrowTypeLabel(field: { type: unknown }): string {
  const raw = String(field.type);
  const map: Record<string, string> = {
    Int8: 'INT8',
    Int16: 'INT16',
    Int32: 'INT32',
    Int64: 'INT64',
    Float32: 'FLOAT',
    Float64: 'DOUBLE',
    Utf8: 'VARCHAR',
    Bool: 'BOOLEAN',
    Date32: 'DATE',
    Date64: 'DATE',
    Timestamp: 'TIMESTAMP',
    Decimal: 'DECIMAL',
  };
  for (const key of Object.keys(map)) {
    if (raw.includes(key)) return map[key];
  }
  return raw.replace(/^DuckDB/, '').toUpperCase();
}

export async function runQuery<T = Record<string, unknown>>(
  conn: duckdb.AsyncDuckDBConnection,
  sql: string,
): Promise<QueryResult<T>> {
  const started = performance.now();
  const result = await conn.query(sql);
  const elapsedMs = performance.now() - started;
  const columns: ColumnInfo[] = result.schema.fields.map((field) => ({
    name: field.name,
    type: arrowTypeLabel(field),
  }));
  const fieldTypes = new Map(
    result.schema.fields.map((field) => [field.name, String(field.type)]),
  );
  const rows = result.toArray().map((row) => {
    const json = row.toJSON() as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(json)) {
      normalized[key] = normalizeValue(json[key], fieldTypes.get(key) ?? '');
    }
    return normalized as T;
  });
  return { rows, columns, elapsedMs, sql };
}

async function ensureMetaTable(conn: duckdb.AsyncDuckDBConnection) {
  await conn.query(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (
    source_id VARCHAR PRIMARY KEY,
    schema_name VARCHAR NOT NULL,
    table_name VARCHAR NOT NULL,
    fingerprint VARCHAR NOT NULL,
    row_count BIGINT,
    columns_json VARCHAR,
    bytes BIGINT,
    loaded_at VARCHAR
  )`);
}

function parseColumns(json: unknown): ColumnInfo[] {
  if (typeof json !== 'string' || !json) return [];
  try {
    const parsed = JSON.parse(json) as ColumnInfo[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (column) =>
        column && typeof column.name === 'string' && typeof column.type === 'string',
    );
  } catch {
    return [];
  }
}

/** Read persisted source metadata and keep only entries whose table still exists. */
export async function readLoadedSources(
  conn: duckdb.AsyncDuckDBConnection,
): Promise<Record<string, LoadedSource>> {
  const meta = await runQuery<{
    source_id: string;
    schema_name: string;
    table_name: string;
    fingerprint: string;
    row_count: number | null;
    columns_json: string | null;
    bytes: number | null;
    loaded_at: string | null;
  }>(conn, `SELECT * FROM ${META_TABLE}`);

  const tables = await runQuery<{ table_schema: string; table_name: string }>(
    conn,
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema NOT IN ('main', 'information_schema', 'pg_catalog')`,
  );
  const existing = new Set(
    tables.rows.map((row) => `${row.table_schema}\u0000${row.table_name}`),
  );

  const loaded: Record<string, LoadedSource> = {};
  for (const row of meta.rows) {
    if (!existing.has(`${row.schema_name}\u0000${row.table_name}`)) continue;
    loaded[row.source_id] = {
      sourceId: row.source_id,
      schemaName: row.schema_name,
      tableName: row.table_name,
      fingerprint: row.fingerprint,
      rowCount: Number(row.row_count ?? 0),
      columns: parseColumns(row.columns_json),
      bytes: Number(row.bytes ?? 0),
      loadedAt: row.loaded_at ?? '',
      reused: true,
    };
  }
  return loaded;
}

async function describeTable(
  conn: duckdb.AsyncDuckDBConnection,
  schemaName: string,
  tableName: string,
): Promise<ColumnInfo[]> {
  const described = await runQuery<{ column_name: string; column_type: string }>(
    conn,
    `DESCRIBE ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
  );
  return described.rows.map((column) => ({
    name: column.column_name,
    type: column.column_type,
  }));
}

async function countRows(
  conn: duckdb.AsyncDuckDBConnection,
  schemaName: string,
  tableName: string,
): Promise<number> {
  const result = await runQuery<{ n: number }>(
    conn,
    `SELECT COUNT(*) AS n FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

type IngestFormat = 'csv' | 'tsv' | 'json' | 'jsonl';

function readerSql(format: IngestFormat, virtualPath: string): string {
  const path = sqlString(virtualPath);
  if (format === 'csv') {
    return `read_csv_auto(${path}, HEADER = true, SAMPLE_SIZE = -1)`;
  }
  if (format === 'tsv') {
    return `read_csv_auto(${path}, HEADER = true, SAMPLE_SIZE = -1, DELIM = '\\t')`;
  }
  if (format === 'jsonl') {
    return `read_json_auto(${path}, FORMAT = 'newline_delimited')`;
  }
  return `read_json_auto(${path})`;
}

/**
 * Load exactly one file or worksheet into its project schema. Sources are
 * never unioned: each gets its own table so conflicting headers stay isolated.
 */
export async function loadSource(
  warehouse: Warehouse,
  source: SourceDef,
  projectSlug: string,
  existing?: LoadedSource | null,
  force = false,
): Promise<LoadedSource> {
  const { db, conn, mode } = warehouse;
  const tableName = tableNameFor(source);

  if (
    !force &&
    existing &&
    existing.fingerprint === source.fingerprint &&
    existing.columns.length > 0
  ) {
    return { ...existing, reused: true };
  }

  const response = await fetch(sourceUrl(source));
  if (!response.ok) {
    throw new Error(`无法读取 ${source.relPath} (${response.status})`);
  }

  let content: string;
  if (source.format === 'xlsx') {
    if (!source.sheet) {
      throw new Error(`XLSX 数据源缺少工作表信息：${source.relPath}`);
    }
    const { sheetToCsv } = await import('./sheet');
    try {
      content = sheetToCsv(await response.arrayBuffer(), source.sheet);
    } catch (error) {
      throw new Error(
        `无法读取 ${source.relPath} 的工作表「${source.sheet}」：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    content = await response.text();
  }

  // XLSX sheets are converted to CSV before ingestion.
  const ingestFormat: IngestFormat =
    source.format === 'xlsx' ? 'csv' : source.format;

  await conn.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(projectSlug)}`);

  const virtualPath = `${SEED_DIR}/${source.id}-${source.fingerprint}.${ingestFormat}`;
  await db.registerFileText(virtualPath, content);
  try {
    await conn.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(projectSlug)}.${quoteIdent(tableName)} AS
       SELECT * FROM ${readerSql(ingestFormat, virtualPath)}`,
    );
  } finally {
    try {
      await db.dropFile(virtualPath);
    } catch {
      // The virtual file is memory-only; a failed cleanup is harmless.
    }
  }

  const columns = await describeTable(conn, projectSlug, tableName);
  const rowCount = await countRows(conn, projectSlug, tableName);
  const loadedAt = new Date().toISOString();

  await conn.query(
    `INSERT OR REPLACE INTO ${META_TABLE}
     (source_id, schema_name, table_name, fingerprint, row_count, columns_json, bytes, loaded_at)
     VALUES (${sqlString(source.id)}, ${sqlString(projectSlug)}, ${sqlString(tableName)},
             ${sqlString(source.fingerprint)}, ${rowCount},
             ${sqlString(JSON.stringify(columns))}, ${source.bytes}, ${sqlString(loadedAt)})`,
  );

  if (mode === 'opfs') {
    try {
      await conn.query('CHECKPOINT');
    } catch (error) {
      console.warn('[atlas] checkpoint failed', error);
    }
  }

  return {
    sourceId: source.id,
    schemaName: projectSlug,
    tableName,
    fingerprint: source.fingerprint,
    rowCount,
    columns,
    bytes: source.bytes,
    loadedAt,
    reused: false,
  };
}

export async function bootWarehouse(report: BootReporter): Promise<Warehouse> {
  report('engine', 'booting wasm…');
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker, (progress) => {
    const total = progress.bytesTotal;
    const loaded = progress.bytesLoaded;
    if (total > 0) {
      const pct = (loaded / total) * 100;
      if (Number.isFinite(pct) && pct > 0) {
        report('engine', `wasm ${Math.min(99, Math.round(pct))}%`);
      }
    }
  });

  const engineVersion = await db.getVersion();

  let mode: DbMode = 'memory';

  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    'getDirectory' in navigator.storage
  ) {
    try {
      await db.open({
        path: DB_FILE,
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        opfs: { fileHandling: 'auto' },
        query: {
          castBigIntToDouble: true,
          castDecimalToDouble: true,
        },
      });
      mode = 'opfs';
      report('storage', 'OPFS handle acquired');
    } catch (error) {
      console.warn('[atlas] OPFS unavailable, using in-memory database', error);
      report('storage', 'OPFS unavailable → memory');
    }
  } else {
    report('storage', 'no OPFS → memory');
  }

  if (mode === 'memory') {
    try {
      await db.open({
        path: ':memory:',
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        query: {
          castBigIntToDouble: true,
          castDecimalToDouble: true,
        },
      });
    } catch {
      // instantiate() already opened the default in-memory database
    }
  }

  const conn = await db.connect();
  await ensureMetaTable(conn);

  return { db, conn, mode, engineVersion };
}

export async function clearWarehouse(
  warehouse: Warehouse,
  projectSlugs: string[],
): Promise<void> {
  const { conn, mode } = warehouse;
  for (const slug of projectSlugs) {
    await conn.query(`DROP SCHEMA IF EXISTS ${quoteIdent(slug)} CASCADE`);
  }
  await conn.query(`DELETE FROM ${META_TABLE}`);
  if (mode === 'opfs') {
    try {
      await conn.query('CHECKPOINT');
    } catch (error) {
      console.warn('[atlas] checkpoint failed', error);
    }
  }
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

export const WAREHOUSE_INFO = {
  dbFile: DB_FILE,
  metaTable: META_TABLE,
};
