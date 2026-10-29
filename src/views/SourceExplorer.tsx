import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Columns3,
  Download,
  FileDown,
  FolderTree,
  Hash,
  Loader2,
  Play,
  RefreshCw,
  Search,
  SquareTerminal,
  Table2,
  Terminal,
  X,
} from 'lucide-react';
import { useDatabase } from '../db/DatabaseContext';
import type { ColumnInfo, LoadedSource, ProjectDef, QueryResult, SourceDef } from '../db/types';
import {
  escapeLike,
  formatLabel,
  kindMeta,
  qualifiedName,
  quoteIdent,
  sourceFileLabel,
  sourceKind,
  sourceTitle,
  sourceUrl,
  sqlString,
} from '../db/sources';
import {
  classNames,
  copyText,
  downloadCsv,
  formatBytes,
  formatInt,
  formatPct,
} from '../lib/format';
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui';
import { SqlEditor, type SqlEditorHandle } from '../components/SqlEditor';

type TabKey = 'preview' | 'profile' | 'sql';

const TABS: { key: TabKey; label: string; icon: typeof Table2 }[] = [
  { key: 'preview', label: '数据预览', icon: Table2 },
  { key: 'profile', label: '字段画像', icon: Columns3 },
  { key: 'sql', label: 'SQL 查询', icon: SquareTerminal },
];

function isNumericType(type: string) {
  return /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|HUGEINT|UBIGINT|REAL/i.test(type);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="null">NULL</span>;
  }
  if (typeof value === 'object') {
    return <span className="mono">{cellText(value)}</span>;
  }
  return <span title={String(value)}>{String(value)}</span>;
}

export function SourceExplorer({
  project,
  source,
  initialTab = 'preview',
  onBack,
}: {
  project: ProjectDef;
  source: SourceDef;
  initialTab?: TabKey;
  onBack: () => void;
}) {
  const {
    ensureSource,
    loaded,
    loading,
    loadErrors,
    run,
    mode,
  } = useDatabase();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [copied, setCopied] = useState<string | null>(null);

  const entry = loaded[source.id];
  const isLoading = Boolean(loading[source.id]);
  const loadError = loadErrors[source.id];
  const kind = sourceKind(source.columns);
  const meta = kindMeta(kind);

  const ensureRef = useRef(ensureSource);
  ensureRef.current = ensureSource;

  useEffect(() => {
    setTab(initialTab);
  }, [source.id, initialTab]);

  useEffect(() => {
    ensureRef.current(source).catch(() => {
      // The error is surfaced through loadErrors.
    });
  }, [source.id, source.fingerprint]);

  const flash = useCallback(async (key: string, text: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1400);
  }, []);

  const downloadRaw = useCallback(async () => {
    const response = await fetch(sourceUrl(source));
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = source.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [source]);

  const tableRef = entry ? qualifiedName(entry) : `"${project.slug}"."…"`;

  return (
    <div className="view source-view">
      <PageHeader
        eyebrow={`SOURCE / ${project.slug} / ${source.id}`}
        title={sourceTitle(source)}
        description={
          <>
            <span className="inline-code">{source.relPath}</span>{' '}
            <Badge tone={meta.tone}>{meta.label}</Badge>{' '}
            <Badge tone="neutral">{formatLabel(source.format)}</Badge>{' '}
            {source.sheet && <Badge tone="neutral">工作表 · {source.sheet}</Badge>}
          </>
        }
        actions={
          <>
            <button className="btn btn--ghost" onClick={onBack}>
              <ArrowLeft size={13} />
              {project.name}
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => flash('table', tableRef)}
              title={tableRef}
            >
              {copied === 'table' ? <Check size={13} /> : <ClipboardCopy size={13} />}
              {copied === 'table' ? '已复制' : '复制表名'}
            </button>
            <button className="btn btn--ghost" onClick={downloadRaw}>
              <Download size={13} />
              原文件
            </button>
            {entry && (
              <button
                className="btn btn--ghost"
                onClick={() =>
                  ensureRef.current(source, true).catch(() => undefined)
                }
                disabled={isLoading}
              >
                {isLoading ? <Spinner /> : <RefreshCw size={13} />}
                重新加载
              </button>
            )}
          </>
        }
      />

      <div className="source-facts">
        <div className="source-fact">
          <span>行数</span>
          <strong>{entry ? formatInt(entry.rowCount) : formatInt(source.rows)}</strong>
          <em>{entry ? 'DuckDB' : '目录估算'}</em>
        </div>
        <div className="source-fact">
          <span>字段</span>
          <strong>{formatInt(entry?.columns.length ?? source.columns.length)}</strong>
          <em>列</em>
        </div>
        <div className="source-fact">
          <span>体积</span>
          <strong>{formatBytes(source.bytes)}</strong>
          <em>{formatLabel(source.format)}</em>
        </div>
        <div className="source-fact">
          <span>指纹</span>
          <strong className="mono">{source.fingerprint}</strong>
          <em>{entry && entry.fingerprint !== source.fingerprint ? 'stale' : 'content'}</em>
        </div>
        <div className="source-fact source-fact--wide">
          <span>独立表</span>
          <button
            className="table-ref mono"
            onClick={() => flash('table', tableRef)}
            title={tableRef}
          >
            {tableRef}
            {copied === 'table' ? <Check size={11} /> : <ClipboardCopy size={11} />}
          </button>
          <em>{mode === 'opfs' ? 'OPFS 持久化' : '内存模式'}</em>
        </div>
      </div>

      {isLoading && !entry ? (
        <LoadingPanel source={source} project={project} />
      ) : loadError && !entry ? (
        <div className="panel-error source-error">
          <div>
            <p>数据源加载失败</p>
            <code>{loadError}</code>
          </div>
          <button
            className="btn btn--primary btn--small"
            onClick={() => ensureRef.current(source, true).catch(() => undefined)}
          >
            重试
          </button>
        </div>
      ) : !entry ? (
        <LoadingPanel source={source} project={project} />
      ) : (
        <>
          <div className="source-tabs" role="tablist">
            {TABS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  className={classNames(
                    'source-tab',
                    tab === item.key && 'source-tab--active',
                  )}
                  onClick={() => setTab(item.key)}
                >
                  <Icon size={13} />
                  {item.label}
                </button>
              );
            })}
            <span className="source-tabs-meta mono">
              {entry.reused ? 'restored from OPFS' : 'created just now'} ·{' '}
              {formatInt(entry.rowCount)} rows
            </span>
          </div>

          {loadError && (
            <div className="panel-error source-error source-error--inline">
              <div>
                <p>刷新失败，仍显示上一次加载的表</p>
                <code>{loadError}</code>
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <PreviewPanel entry={entry} source={source} project={project} run={run} />
          )}
          {tab === 'profile' && (
            <ProfilePanel entry={entry} source={source} run={run} />
          )}
          {tab === 'sql' && (
            <SqlPanel entry={entry} source={source} run={run} />
          )}
        </>
      )}

      <footer className="view-footer">
        <span className="mono">
          {project.slug} / {sourceFileLabel(source)}
        </span>
        <span>
          <FolderTree size={10} /> 一个数据源 = 一张独立表 · 不做 UNION
        </span>
      </footer>
    </div>
  );
}

function LoadingPanel({
  source,
  project,
}: {
  source: SourceDef;
  project: ProjectDef;
}) {
  return (
    <div className="source-loading">
      <div className="source-loading-head">
        <Loader2 size={18} className="spin" />
        <div>
          <p>正在把数据源加载为独立的 DuckDB 表</p>
          <span className="mono">
            "{project.slug}"."{source.id}"
          </span>
        </div>
      </div>
      <ol className="source-loading-steps">
        <li>
          <span>01</span> 读取 {formatLabel(source.format)}{' '}
          {source.sheet ? '工作表' : '文件'}
        </li>
        <li>
          <span>02</span> 在项目 schema 中建立独立表
        </li>
        <li>
          <span>03</span> 写入指纹与加载元数据
        </li>
      </ol>
      <p className="source-loading-foot mono">
        {source.relPath}
        {source.sheet ? ` · ${source.sheet}` : ''} · {formatBytes(source.bytes)} ·{' '}
        {formatInt(source.rows)} rows
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

interface PreviewState {
  rows: Record<string, unknown>[];
  total: number;
  elapsed: number;
}

function PreviewPanel({
  entry,
  source,
  project,
  run,
}: {
  entry: LoadedSource;
  source: SourceDef;
  project: ProjectDef;
  run: <T = Record<string, unknown>>(sql: string) => Promise<QueryResult<T>>;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(
    null,
  );
  const [state, setState] = useState<PreviewState>({ rows: [], total: 0, elapsed: 0 });
  const [columns, setColumns] = useState<ColumnInfo[]>(entry.columns);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const table = qualifiedName(entry);

  useEffect(() => {
    setPage(0);
    setQuery('');
    setApplied('');
    setSort(null);
    setState({ rows: [], total: 0, elapsed: 0 });
    setColumns(entry.columns);
  }, [entry.tableName, entry.fingerprint]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setApplied(query.trim());
      setPage(0);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  const whereSql = useMemo(() => {
    if (!applied) return '';
    const condition = entry.columns
      .map(
        (column) =>
          `CAST(${quoteIdent(column.name)} AS VARCHAR) ILIKE ${sqlString(
            `%${escapeLike(applied)}%`,
          )} ESCAPE '\\'`,
      )
      .join(' OR ');
    return condition ? ` WHERE ${condition}` : '';
  }, [applied, entry.columns]);

  const orderSql = sort
    ? ` ORDER BY ${quoteIdent(sort.column)} ${sort.dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`
    : '';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError(null);
      try {
        const count = await run<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${table}${whereSql}`,
        );
        const pageResult = await run(
          `SELECT * FROM ${table}${whereSql}${orderSql} LIMIT ${pageSize} OFFSET ${
            page * pageSize
          }`,
        );
        if (cancelled) return;
        setState({
          rows: pageResult.rows,
          total: Number(count.rows[0]?.n ?? 0),
          elapsed: count.elapsedMs + pageResult.elapsedMs,
        });
        if (pageResult.columns.length > 0) setColumns(pageResult.columns);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [run, table, whereSql, orderSql, page, pageSize]);

  const pageCount = Math.max(1, Math.ceil(state.total / pageSize));
  const current = Math.min(page, pageCount - 1);

  const toggleSort = (column: string) => {
    setPage(0);
    setSort((prev) => {
      if (prev?.column !== column) return { column, dir: 'asc' };
      if (prev.dir === 'asc') return { column, dir: 'desc' };
      return null;
    });
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const result = await run(`SELECT * FROM ${table}${whereSql}${orderSql}`);
      downloadCsv(
        `${project.name}_${source.id}.csv`,
        result.columns.map((column) => column.name),
        result.rows,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <label className="search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`在 ${entry.columns.length} 个字段中搜索`}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')} aria-label="清除">
              <X size={12} />
            </button>
          )}
        </label>
        <div className="preview-actions">
          <span className="preview-count mono">
            {formatInt(state.total)} 行{applied ? ' · 已筛选' : ''}
          </span>
          <select
            className="select select--compact"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
            aria-label="每页行数"
          >
            <option value={25}>25 / 页</option>
            <option value={50}>50 / 页</option>
            <option value={100}>100 / 页</option>
            <option value={200}>200 / 页</option>
          </select>
          <button className="btn btn--small btn--ghost" onClick={exportAll} disabled={exporting}>
            {exporting ? <Spinner /> : <FileDown size={12} />}
            导出 CSV
          </button>
        </div>
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : (
        <div className="table-card preview-card">
          <div className="result-scroll preview-scroll">
            <table className="result-table preview-table">
              <thead>
                <tr>
                  <th className="preview-rank">#</th>
                  {columns.map((column) => {
                    const active = sort?.column === column.name;
                    return (
                      <th key={column.name}>
                        <button
                          className={classNames('preview-head', active && 'active')}
                          onClick={() => toggleSort(column.name)}
                          title={`${column.name} · ${column.type}`}
                        >
                          <span className="preview-head-name">{column.name}</span>
                          <span className="preview-head-type">{column.type}</span>
                          {active ? (
                            sort?.dir === 'asc' ? (
                              <ArrowUp size={10} />
                            ) : (
                              <ArrowDown size={10} />
                            )
                          ) : (
                            <ArrowUpDown size={10} className="sort-idle" />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row, index) => (
                  <tr key={index}>
                    <td className="preview-rank mono">
                      {current * pageSize + index + 1}
                    </td>
                    {columns.map((column) => (
                      <td
                        key={column.name}
                        className={classNames(
                          isNumericType(column.type) && 'cell-num',
                          'preview-cell',
                        )}
                      >
                        {renderCell(row[column.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {state.rows.length === 0 && !busy && (
              <div className="result-empty">
                <Table2 size={20} />
                <p>{applied ? '没有匹配当前搜索的行' : '这张表还没有数据'}</p>
              </div>
            )}
            {busy && state.rows.length === 0 && (
              <div className="result-empty">
                <Spinner size={18} />
                <p>正在查询本地表…</p>
              </div>
            )}
          </div>
          <div className="table-footer">
            <span className="mono">
              {state.total === 0
                ? '0 rows'
                : `${formatInt(current * pageSize + 1)}–${formatInt(
                    Math.min(state.total, (current + 1) * pageSize),
                  )} / ${formatInt(state.total)}`}
              {busy && <span className="preview-busy"> · 查询中</span>}
              {state.elapsed > 0 && (
                <span className="preview-elapsed"> · {state.elapsed.toFixed(0)} ms</span>
              )}
            </span>
            <div className="pager">
              <button
                className="btn btn--icon btn--small"
                onClick={() => setPage(Math.max(0, current - 1))}
                disabled={current === 0 || busy}
                aria-label="上一页"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="mono pager-count">
                {current + 1} / {pageCount}
              </span>
              <button
                className="btn btn--icon btn--small"
                onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
                disabled={current >= pageCount - 1 || busy}
                aria-label="下一页"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

interface ProfileRow {
  column_name: string;
  column_type: string;
  total: number;
  non_null: number;
  nulls: number;
  distinct_count: number;
  min_value: string | null;
  max_value: string | null;
}

function ProfilePanel({
  entry,
  source,
  run,
}: {
  entry: LoadedSource;
  source: SourceDef;
  run: <T = Record<string, unknown>>(sql: string) => Promise<QueryResult<T>>;
}) {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const table = qualifiedName(entry);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setError(null);
      try {
        const selects = entry.columns.map((column) => {
          const id = quoteIdent(column.name);
          // Complex Arrow types cannot be compared natively, so fall back to
          // their text form for distinct counts and extremes. Text columns
          // only support lexicographic extremes; numerics/dates keep native
          // ordering before being rendered as text.
          const complex = /STRUCT|LIST|MAP|UNION|ARRAY/i.test(column.type);
          const textual =
            complex || /CHAR|TEXT|STRING|UUID|ENUM/i.test(column.type);
          const distinctExpr = complex
            ? `COUNT(DISTINCT CAST(${id} AS VARCHAR))`
            : `COUNT(DISTINCT ${id})`;
          const minExpr = textual
            ? `CAST(MIN(CAST(${id} AS VARCHAR)) AS VARCHAR)`
            : `CAST(MIN(${id}) AS VARCHAR)`;
          const maxExpr = textual
            ? `CAST(MAX(CAST(${id} AS VARCHAR)) AS VARCHAR)`
            : `CAST(MAX(${id}) AS VARCHAR)`;
          return `SELECT ${sqlString(column.name)} AS column_name,
            ${sqlString(column.type)} AS column_type,
            COUNT(*) AS total,
            COUNT(${id}) AS non_null,
            COUNT(*) - COUNT(${id}) AS nulls,
            ${distinctExpr} AS distinct_count,
            ${minExpr} AS min_value,
            ${maxExpr} AS max_value
          FROM ${table}`;
        });
        const result = await run<ProfileRow>(selects.join('\nUNION ALL\n'));
        if (cancelled) return;
        setRows(result.rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [run, table, entry.columns]);

  const totalCells = rows.reduce((sum, row) => sum + Number(row.total), 0);
  const filledCells = rows.reduce((sum, row) => sum + Number(row.non_null), 0);
  const coverage = totalCells > 0 ? filledCells / totalCells : 1;

  const copyList = async () => {
    const text = entry.columns
      .map((column) => `${column.name} ${column.type}`)
      .join('\n');
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div className="profile-panel">
      <div className="profile-strip">
        <div>
          <span>覆盖度</span>
          <strong>{formatPct(coverage)}</strong>
        </div>
        <div>
          <span>总单元格</span>
          <strong>{formatInt(totalCells)}</strong>
        </div>
        <div>
          <span>字段</span>
          <strong>{formatInt(entry.columns.length)}</strong>
        </div>
        <button className="btn btn--small btn--ghost" onClick={copyList}>
          {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
          {copied ? '已复制' : '复制字段清单'}
        </button>
      </div>

      {error ? (
        <div className="panel-error">{error}</div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="data-table profile-table">
              <thead>
                <tr>
                  <th>字段</th>
                  <th>类型</th>
                  <th className="num">非空</th>
                  <th className="num">空值</th>
                  <th className="num">唯一值</th>
                  <th>最小值</th>
                  <th>最大值</th>
                  <th>覆盖</th>
                </tr>
              </thead>
              <tbody>
                {(busy ? entry.columns.map((column) => ({
                  column_name: column.name,
                  column_type: column.type,
                  total: 0,
                  non_null: 0,
                  nulls: 0,
                  distinct_count: 0,
                  min_value: null,
                  max_value: null,
                })) : rows).map((row) => {
                  const ratio = Number(row.total) > 0 ? Number(row.non_null) / Number(row.total) : 0;
                  return (
                    <tr key={row.column_name}>
                      <td>
                        <span className="profile-name mono">{row.column_name}</span>
                      </td>
                      <td>
                        <span className="profile-type mono">{row.column_type}</span>
                      </td>
                      <td className="num" data-label="非空">
                        {busy ? '—' : formatInt(row.non_null)}
                      </td>
                      <td className="num num--dim" data-label="空值">
                        {busy ? '—' : formatInt(row.nulls)}
                      </td>
                      <td className="num" data-label="唯一值">
                        {busy ? '—' : formatInt(row.distinct_count)}
                      </td>
                      <td className="profile-extreme" data-label="最小值">
                        {busy ? '…' : row.min_value === null ? <span className="null">NULL</span> : cellText(row.min_value)}
                      </td>
                      <td className="profile-extreme" data-label="最大值">
                        {busy ? '…' : row.max_value === null ? <span className="null">NULL</span> : cellText(row.max_value)}
                      </td>
                      <td data-label="覆盖">
                        <div className="profile-coverage">
                          <span>
                            <i style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }} />
                          </span>
                          <em>{busy ? '—' : formatPct(ratio, 0)}</em>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span className="mono">
              COUNT / COUNT DISTINCT / MIN / MAX · 全表扫描
            </span>
            <span className="mono">{sourceFileLabel(source)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SQL                                                                 */
/* ------------------------------------------------------------------ */

interface HistoryEntry {
  sql: string;
  rows: number;
  elapsed: number;
  error: boolean;
}

function SqlPanel({
  entry,
  source,
  run,
}: {
  entry: LoadedSource;
  source: SourceDef;
  run: <T = Record<string, unknown>>(sql: string) => Promise<QueryResult<T>>;
}) {
  const table = qualifiedName(entry);
  const [sql, setSql] = useState(`SELECT * FROM ${table} LIMIT 100;`);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<SqlEditorHandle>(null);

  useEffect(() => {
    setSql(`SELECT * FROM ${table} LIMIT 100;`);
    setResult(null);
    setError(null);
    setHistory([]);
  }, [table]);

  const execute = useCallback(async () => {
    const statement = sql.trim();
    if (!statement || running) return;
    setRunning(true);
    setError(null);
    try {
      const next = await run(statement);
      setResult(next);
      setHistory((prev) =>
        [
          {
            sql: statement,
            rows: next.rows.length,
            elapsed: next.elapsedMs,
            error: false,
          },
          ...prev,
        ].slice(0, 7),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setResult(null);
      setHistory((prev) =>
        [{ sql: statement, rows: 0, elapsed: 0, error: true }, ...prev].slice(0, 7),
      );
    } finally {
      setRunning(false);
    }
  }, [sql, running, run]);

  const executeRef = useRef(execute);
  executeRef.current = execute;

  const examples = useMemo(() => {
    const items: { label: string; sql: string }[] = [
      { label: '预览 100 行', sql: `SELECT * FROM ${table} LIMIT 100;` },
      { label: '总行数', sql: `SELECT COUNT(*) AS rows FROM ${table};` },
    ];
    const textColumn = entry.columns.find((column) => /VARCHAR|TEXT/i.test(column.type));
    if (textColumn) {
      items.push({
        label: `按 ${textColumn.name} 分组`,
        sql: `SELECT ${quoteIdent(textColumn.name)} AS value, COUNT(*) AS n\nFROM ${table}\nGROUP BY 1\nORDER BY n DESC\nLIMIT 10;`,
      });
    }
    const numericColumns = entry.columns.filter((column) => isNumericType(column.type));
    if (numericColumns.length > 0) {
      const id = quoteIdent(numericColumns[0].name);
      items.push({
        label: `汇总 ${numericColumns[0].name}`,
        sql: `SELECT COUNT(${id}) AS n, MIN(${id}) AS min, AVG(${id}) AS avg, MAX(${id}) AS max\nFROM ${table};`,
      });
    }
    if (entry.columns.length >= 2) {
      const first = quoteIdent(entry.columns[0].name);
      const second = quoteIdent(entry.columns[1].name);
      items.push({
        label: '按前两列排序',
        sql: `SELECT ${first}, ${second}\nFROM ${table}\nORDER BY ${second} DESC NULLS LAST\nLIMIT 50;`,
      });
    }
    return items;
  }, [entry.columns, table]);

  const copySql = async () => {
    if (await copyText(sql)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div className="sql-panel">
      <div className="sql-tools">
        <div className="sql-examples">
          <span className="eyebrow">EXAMPLES</span>
          {examples.map((example) => (
            <button
              key={example.label}
              className="chip"
              onClick={() => {
                setSql(example.sql);
                editorRef.current?.focus();
              }}
            >
              {example.label}
            </button>
          ))}
        </div>
        <span className="sql-scope mono">
          <Hash size={10} />
          {table}
        </span>
      </div>

      <div className="editor-card">
        <div className="editor-head">
          <span className="editor-title">
            <Terminal size={13} />
            query.sql
            <span className="editor-scope">{sourceFileLabel(source)}</span>
          </span>
          <div className="editor-head-actions">
            <span className="kbd-hint">
              <kbd>⌘</kbd>
              <kbd>↵</kbd>
              运行
            </span>
            <button className="btn btn--icon btn--small" onClick={copySql} title="复制 SQL">
              {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
            </button>
            <button
              className="btn btn--primary btn--small run-btn"
              onClick={() => executeRef.current()}
              disabled={running}
            >
              {running ? <Spinner /> : <Play size={11} />}
              运行
            </button>
          </div>
        </div>
        <SqlEditor
          ref={editorRef}
          value={sql}
          onChange={setSql}
          onRun={() => executeRef.current()}
          schema={[
            {
              name: entry.tableName,
              columns: entry.columns.map((column) => column.name),
            },
          ]}
        />
        <div className="editor-foot">
          <span className="editor-meta">
            <span className="mono">schema {entry.schemaName}</span>
            <i className="dot-sep" />
            <span className="mono">{entry.columns.length} columns</span>
            <i className="dot-sep" />
            <span className="mono">{formatInt(entry.rowCount)} rows</span>
          </span>
          <span className="editor-meta mono">只查询这一张表</span>
        </div>
      </div>

      {error && (
        <div className="sql-error">
          <AlertTriangle size={15} />
          <div>
            <p>SQL 执行失败</p>
            <pre>{error}</pre>
          </div>
        </div>
      )}

      {result && (
        <div className="result-card">
          <div className="result-head">
            <div className="result-status">
              <span className="status-pill status-pill--ok">
                <i />
                OK
              </span>
              <span className="result-meta">
                {formatInt(result.rows.length)} rows · {result.elapsedMs.toFixed(1)} ms
              </span>
            </div>
            <div className="result-actions">
              <button
                className="btn btn--small btn--ghost"
                onClick={() =>
                  downloadCsv(
                    `${source.id}_result.csv`,
                    result.columns.map((column) => column.name),
                    result.rows,
                  )
                }
              >
                <FileDown size={12} />
                导出结果
              </button>
            </div>
          </div>
          <div className="result-scroll">
            <table className="result-table">
              <thead>
                <tr>
                  {result.columns.map((column) => (
                    <th key={column.name}>
                      <span className="result-col-name">{column.name}</span>
                      <span className="result-col-type">{column.type}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {result.columns.map((column) => (
                      <td
                        key={column.name}
                        className={
                          isNumericType(column.type) ? 'cell-num' : 'cell-text'
                        }
                      >
                        {renderCell(row[column.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length === 0 && (
              <div className="result-empty">
                <Table2 size={20} />
                <p>查询成功，但没有返回任何行</p>
              </div>
            )}
          </div>
          <div className="result-foot">
            {result.sql.length > 160 ? `${result.sql.slice(0, 160)}…` : result.sql}
          </div>
        </div>
      )}

      {!result && !error && (
        <div className="result-card">
          <div className="result-empty">
            <SquareTerminal size={22} />
            <p>运行 SQL 查询当前数据源，或从上方示例开始</p>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="history">
          <div className="history-head">
            <span className="eyebrow">HISTORY</span>
            <span>本次会话</span>
          </div>
          <div className="history-list">
            {history.map((item, index) => (
              <button
                key={`${index}-${item.sql.slice(0, 12)}`}
                className="history-item"
                onClick={() => setSql(item.sql)}
              >
                <span className="history-sql">
                  {item.error ? '× ' : ''}
                  {item.sql.replace(/\s+/g, ' ')}
                </span>
                <span className="history-meta">
                  {item.error ? 'error' : `${formatInt(item.rows)} rows`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
