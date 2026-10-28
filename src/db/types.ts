export type SourceFormat = 'csv' | 'tsv' | 'json' | 'jsonl';

/** Semantic shape of a source, derived from its column names. */
export type SourceKind =
  | 'audience_spend'
  | 'audience_roi'
  | 'audience_spend_roi'
  | 'plan_roi'
  | 'plan_orders'
  | 'ad_perf'
  | 'geo_perf'
  | 'keyword'
  | 'sales'
  | 'hourly'
  | 'creative'
  | 'generic';

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface ProjectDef {
  /** Original folder name under data/ */
  id: string;
  /** Safe DuckDB schema name */
  slug: string;
  name: string;
  dir: string;
  sourceCount: number;
  rowCount: number;
  bytes: number;
  folders: string[];
  formats: string[];
}

export interface SourceDef {
  /** Stable key derived from the relative path */
  id: string;
  projectId: string;
  projectName: string;
  /** Path relative to data/, e.g. leda/8ab…csv */
  relPath: string;
  fileName: string;
  baseName: string;
  folder: string;
  format: SourceFormat;
  bytes: number;
  rows: number;
  columns: string[];
  fingerprint: string;
  modifiedAt: string;
}

export interface AtlasCatalog {
  generatedAt: string;
  root: string;
  projectCount: number;
  sourceCount: number;
  ignored: number;
  projects: ProjectDef[];
  sources: SourceDef[];
}

export interface LoadedSource {
  sourceId: string;
  schemaName: string;
  tableName: string;
  fingerprint: string;
  rowCount: number;
  columns: ColumnInfo[];
  bytes: number;
  loadedAt: string;
  reused: boolean;
}

export interface SchemaEntry {
  name: string;
  kind: 'table' | 'view';
  columns: ColumnInfo[];
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  columns: ColumnInfo[];
  elapsedMs: number;
  sql: string;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}
