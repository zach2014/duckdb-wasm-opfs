import type {
  AtlasCatalog,
  LoadedSource,
  ProjectDef,
  SourceDef,
  SourceKind,
} from './types';

const BASE = import.meta.env.BASE_URL;

/** Fetch the generated catalog of data/<project>/<file> entries. */
export async function fetchCatalog(): Promise<AtlasCatalog> {
  const response = await fetch(`${BASE}atlas-catalog.json?ts=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`无法读取数据目录 (${response.status})`);
  }
  const catalog = (await response.json()) as AtlasCatalog;
  if (!Array.isArray(catalog.projects) || !Array.isArray(catalog.sources)) {
    throw new Error('数据目录格式无效');
  }
  return {
    ...catalog,
    sources: catalog.sources.map((source) => ({
      ...source,
      baseName: source.fileName.replace(/\.[^.]+$/, ''),
    })),
  };
}

export function sourceUrl(source: SourceDef): string {
  const encoded = source.relPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${BASE}data/${encoded}`;
}

export function projectUrl(project: ProjectDef): string {
  return `#/p/${encodeURIComponent(project.id)}`;
}

export function sourceRoute(project: ProjectDef, source: SourceDef): string {
  return `#/p/${encodeURIComponent(project.id)}/s/${source.id}`;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function qualifiedName(loaded: LoadedSource): string {
  return `${quoteIdent(loaded.schemaName)}.${quoteIdent(loaded.tableName)}`;
}

interface KindMeta {
  label: string;
  prefix: string;
  tone: 'neutral' | 'gold' | 'green' | 'blue' | 'coral' | 'violet';
}

const KIND_META: Record<SourceKind, KindMeta> = {
  audience_spend: { label: '人群花费', prefix: 'audience_spend', tone: 'gold' },
  audience_roi: { label: '人群收入', prefix: 'audience_roi', tone: 'green' },
  audience_spend_roi: {
    label: '花费 × ROI',
    prefix: 'audience_spend_roi',
    tone: 'blue',
  },
  plan_roi: { label: '计划 ROI', prefix: 'plan_roi', tone: 'blue' },
  plan_orders: { label: '计划成交', prefix: 'plan_orders', tone: 'green' },
  ad_perf: { label: '广告投放', prefix: 'ad_perf', tone: 'gold' },
  geo_perf: { label: '地域表现', prefix: 'geo_perf', tone: 'violet' },
  keyword: { label: '关键词', prefix: 'keyword', tone: 'violet' },
  sales: { label: '成交趋势', prefix: 'sales', tone: 'green' },
  hourly: { label: '分时表现', prefix: 'hourly', tone: 'blue' },
  creative: { label: '创意表现', prefix: 'creative', tone: 'coral' },
  generic: { label: '通用数据', prefix: 'data', tone: 'neutral' },
};

export function sourceKind(columns: string[]): SourceKind {
  const set = new Set(columns);
  const has = (name: string) => set.has(name);
  const hasAll = (...names: string[]) => names.every(has);
  const hasRoi = columns.some((column) => column.toUpperCase().includes('ROI'));
  const hasOrder = columns.some(
    (column) => column.includes('订单') || column.includes('成交'),
  );

  if (has('人群类别') && has('类别花费')) return 'audience_spend';
  if (hasAll('人群类别', '收入', '成本')) return 'audience_roi';
  if (has('人群类别') && hasRoi) return 'audience_spend_roi';
  if ((has('计划id') || has('计划名称')) && hasRoi) return 'plan_roi';
  if (has('计划名称') && hasOrder) return 'plan_orders';
  if (has('关键词')) return 'keyword';
  if (has('省份') || has('城市') || has('城市名称')) return 'geo_perf';
  if (has('创意') || has('广告创意名称')) return 'creative';
  if (has('广告名称') || has('广告主名称')) return 'ad_perf';
  if (has('小时')) return 'hourly';
  if ((has('日期') || has('月份')) && hasOrder) return 'sales';
  return 'generic';
}

export function kindMeta(kind: SourceKind): KindMeta {
  return KIND_META[kind];
}

/** "省份 · 总消耗" — derived from the file's own header, never invented. */
export function sourceTitle(source: SourceDef): string {
  const columns = source.columns;
  if (columns.length === 0) return source.fileName;
  if (columns.length === 1) return columns[0];
  return `${columns[0]} · ${columns[1]}`;
}

export function sourceBadges(source: SourceDef): string[] {
  return source.columns.slice(0, 3);
}

export function shortFileName(source: SourceDef): string {
  if (source.fileName.length <= 22) return source.fileName;
  return `${source.baseName.slice(0, 8)}…${source.baseName.slice(-4)}.${source.format}`;
}

export function folderLabel(folder: string): string {
  return folder || '根目录';
}

/** Only the deepest path segment — keeps table rows compact. */
export function folderTail(folder: string): string {
  if (!folder) return '根目录';
  const parts = folder.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

/** Number of distinct folder groups, including the project root. */
export function folderCount(sources: SourceDef[]): number {
  return new Set(sources.map((source) => source.folder)).size;
}

export function tableNameFor(source: SourceDef): string {
  return `${kindMeta(sourceKind(source.columns)).prefix}_${source.id}`;
}

export function formatLabel(format: string): string {
  return format === 'jsonl' ? 'JSONL' : format.toUpperCase();
}

export function catalogRows(projects: ProjectDef[]): number {
  return projects.reduce((total, project) => total + project.rowCount, 0);
}

export function catalogBytes(projects: ProjectDef[]): number {
  return projects.reduce((total, project) => total + project.bytes, 0);
}
