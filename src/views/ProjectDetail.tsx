import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  FileText,
  FolderTree,
  Layers,
  RefreshCw,
  Search,
  Table2,
  X,
} from 'lucide-react';
import { useDatabase } from '../db/DatabaseContext';
import type { ProjectDef, SourceDef } from '../db/types';
import {
  folderLabel,
  folderTail,
  formatLabel,
  kindMeta,
  shortSourceLabel,
  sourceBadges,
  sourceKind,
  sourceTitle,
} from '../db/sources';
import {
  classNames,
  formatBytes,
  formatInt,
} from '../lib/format';
import { Badge, EmptyState, PageHeader, Spinner } from '../components/ui';

const PAGE_SIZE = 25;

type FilterKey = 'all' | 'loaded' | 'unloaded' | 'changed';
type SortKey = 'default' | 'rows' | 'bytes' | 'name' | 'columns';

export function ProjectDetail({
  project,
  onBack,
  onOpenSource,
}: {
  project: ProjectDef;
  onBack: () => void;
  onOpenSource: (project: ProjectDef, source: SourceDef) => void;
}) {
  const {
    sources,
    loaded,
    loading,
    refreshCatalog,
    refreshing,
  } = useDatabase();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortKey>('default');
  const [page, setPage] = useState(0);

  const projectSources = useMemo(
    () => sources.filter((source) => source.projectId === project.slug),
    [sources, project.slug],
  );

  const loadedCount = useMemo(
    () =>
      projectSources.filter((source) => {
        const entry = loaded[source.id];
        return entry && entry.fingerprint === source.fingerprint;
      }).length,
    [projectSources, loaded],
  );

  const changedCount = useMemo(
    () =>
      projectSources.filter((source) => {
        const entry = loaded[source.id];
        return entry && entry.fingerprint !== source.fingerprint;
      }).length,
    [projectSources, loaded],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = projectSources.filter((source) => {
      const entry = loaded[source.id];
      const isLoaded = Boolean(
        entry && entry.fingerprint === source.fingerprint,
      );
      const isChanged = Boolean(
        entry && entry.fingerprint !== source.fingerprint,
      );
      if (filter === 'loaded' && !isLoaded) return false;
      if (filter === 'unloaded' && (isLoaded || isChanged)) return false;
      if (filter === 'changed' && !isChanged) return false;
      if (folder !== 'all' && source.folder !== folder) return false;
      if (!needle) return true;
      return (
        source.fileName.toLowerCase().includes(needle) ||
        (source.sheet?.toLowerCase().includes(needle) ?? false) ||
        source.folder.toLowerCase().includes(needle) ||
        source.columns.some((column) => column.toLowerCase().includes(needle)) ||
        sourceTitle(source).toLowerCase().includes(needle)
      );
    });

    const sorted = [...result];
    if (sort === 'rows') sorted.sort((a, b) => b.rows - a.rows);
    else if (sort === 'bytes') sorted.sort((a, b) => b.bytes - a.bytes);
    else if (sort === 'name')
      sorted.sort(
        (a, b) =>
          a.fileName.localeCompare(b.fileName) ||
          (a.sheet ?? '').localeCompare(b.sheet ?? ''),
      );
    else if (sort === 'columns')
      sorted.sort((a, b) => b.columns.length - a.columns.length);
    return sorted;
  }, [projectSources, query, folder, filter, sort, loaded]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    current * PAGE_SIZE,
    current * PAGE_SIZE + PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [query, folder, filter, sort, project.slug]);

  const folders = useMemo(() => {
    const map = new Map<string, number>();
    for (const source of projectSources) {
      map.set(source.folder, (map.get(source.folder) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [projectSources]);

  return (
    <div className="view">
      <PageHeader
        eyebrow={`PROJECT / ${project.slug}`}
        title={project.name}
        description={
          <>
            <span className="inline-code">{project.dir}</span> ·{' '}
            {formatInt(project.sourceCount)} 个数据源，每个数据源独立建表。选择数据源后才会加载进
            DuckDB。
          </>
        }
        actions={
          <>
            <button className="btn btn--ghost" onClick={onBack}>
              <ArrowLeft size={13} />
              项目总览
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => refreshCatalog()}
              disabled={refreshing}
            >
              {refreshing ? <Spinner /> : <RefreshCw size={13} />}
              刷新目录
            </button>
          </>
        }
      />

      <div className="stat-strip">
        <div className="stat-strip-item">
          <span className="stat-strip-icon stat-strip-icon--gold">
            <FileText size={14} />
          </span>
          <div>
            <span className="stat-strip-label">数据源</span>
            <strong>{formatInt(project.sourceCount)}</strong>
          </div>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-icon stat-strip-icon--green">
            <Table2 size={14} />
          </span>
          <div>
            <span className="stat-strip-label">已加载</span>
            <strong>
              {formatInt(loadedCount)}
              <em> / {formatInt(project.sourceCount)}</em>
            </strong>
          </div>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-icon stat-strip-icon--blue">
            <Layers size={14} />
          </span>
          <div>
            <span className="stat-strip-label">目录行数</span>
            <strong>{formatInt(project.rowCount)}</strong>
          </div>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-icon stat-strip-icon--violet">
            <Columns3 size={14} />
          </span>
          <div>
            <span className="stat-strip-label">目录分组</span>
            <strong>{formatInt(folders.length)}</strong>
          </div>
        </div>
        <div className="stat-strip-item">
          <span className="stat-strip-icon stat-strip-icon--coral">
            <Database size={14} />
          </span>
          <div>
            <span className="stat-strip-label">原始体积</span>
            <strong>{formatBytes(project.bytes)}</strong>
          </div>
        </div>
      </div>

      <div className="source-note">
        <span className="source-note-icon">
          <FolderTree size={13} />
        </span>
        <p>
          本项目内不同数据源的字段结构可能互相冲突，因此 <b>不会</b> 被合并成一张宽表。每张表使用
          <span className="inline-code">"{project.slug}"."&lt;kind&gt;_&lt;id&gt;"</span>{' '}
          的限定名，可以安全地单独查询或 Join。
        </p>
      </div>

      <div className="table-toolbar">
        <div className="filter-chips">
          {(
            [
              ['all', '全部', project.sourceCount],
              ['loaded', '已加载', loadedCount],
              ['unloaded', '未加载', project.sourceCount - loadedCount - changedCount],
              ['changed', '有更新', changedCount],
            ] as [FilterKey, string, number][]
          ).map(([key, label, count]) => (
            <button
              key={key}
              className={classNames('chip', filter === key && 'chip--active')}
              onClick={() => setFilter(key)}
            >
              {label}
              <span className="chip-count">{formatInt(Math.max(0, count))}</span>
            </button>
          ))}
          {changedCount > 0 && (
            <span className="chip chip--warn mono">
              <RefreshCw size={9} />
              指纹变化，打开时自动重建
            </span>
          )}
        </div>
        <div className="table-tools">
          <select
            className="select"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            aria-label="按目录过滤"
          >
            <option value="all">全部目录 · {folders.length}</option>
            {folders.map(([path, count]) => (
              <option key={path || 'root'} value={path}>
                {folderLabel(path)} · {count}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="排序"
          >
            <option value="default">默认顺序</option>
            <option value="rows">行数最多</option>
            <option value="bytes">体积最大</option>
            <option value="columns">字段最多</option>
            <option value="name">文件名</option>
          </select>
          <label className="search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文件名、字段或目录"
            />
            {query && (
              <button
                className="search-clear"
                onClick={() => setQuery('')}
                aria-label="清除搜索"
              >
                <X size={12} />
              </button>
            )}
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="table-card">
          <EmptyState
            icon={<Search size={22} />}
            title="没有匹配的数据源"
            body="换一个关键词、目录或状态筛选试试。"
          />
        </div>
      ) : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="data-table source-table">
              <thead>
                <tr>
                  <th>数据源</th>
                  <th>字段</th>
                  <th className="num">行数</th>
                  <th className="num">体积</th>
                  <th>状态</th>
                  <th className="col-chev" aria-label="打开" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((source) => {
                  const entry = loaded[source.id];
                  const isLoaded = Boolean(
                    entry && entry.fingerprint === source.fingerprint,
                  );
                  const isChanged = Boolean(
                    entry && entry.fingerprint !== source.fingerprint,
                  );
                  const kind = sourceKind(source.columns);
                  const meta = kindMeta(kind);
                  const isLoading = Boolean(loading[source.id]);
                  return (
                    <tr
                      key={source.id}
                      className="row--clickable"
                      onClick={() => onOpenSource(project, source)}
                    >
                      <td className="cell-source">
                        <div className="source-line">
                          <span className="source-name">{sourceTitle(source)}</span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                        <div className="source-subline mono">
                          {shortSourceLabel(source)}
                          {source.folder && (
                            <span className="source-folder" title={source.folder}>
                              <FolderTree size={9} />
                              {folderTail(source.folder)}
                            </span>
                          )}
                          <span className="source-format">{formatLabel(source.format)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="column-chips">
                          {sourceBadges(source).map((column) => (
                            <span key={column} className="column-chip">
                              {column}
                            </span>
                          ))}
                          {source.columns.length > 3 && (
                            <span className="column-chip column-chip--more">
                              +{source.columns.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="num">{formatInt(source.rows)}</td>
                      <td className="num num--dim">{formatBytes(source.bytes)}</td>
                      <td>
                        {isLoading ? (
                          <span className="state-pill state-pill--loading">
                            <Spinner size={10} />
                            加载中
                          </span>
                        ) : isLoaded ? (
                          <span className="state-pill state-pill--ok">
                            <i />
                            已加载
                          </span>
                        ) : isChanged ? (
                          <span className="state-pill state-pill--warn">
                            <i />
                            有更新
                          </span>
                        ) : (
                          <span className="state-pill state-pill--idle">
                            <i />
                            未加载
                          </span>
                        )}
                      </td>
                      <td className="col-chev">
                        <button
                          className="row-open"
                          title="加载并打开数据源"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenSource(project, source);
                          }}
                        >
                          <ArrowUpRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span className="mono">
              {formatInt(current * PAGE_SIZE + 1)}–
              {formatInt(Math.min(filtered.length, (current + 1) * PAGE_SIZE))} /{' '}
              {formatInt(filtered.length)} 个数据源
            </span>
            <div className="pager">
              <button
                className="btn btn--icon btn--small"
                onClick={() => setPage(Math.max(0, current - 1))}
                disabled={current === 0}
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
                disabled={current >= pageCount - 1}
                aria-label="下一页"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="view-footer">
        <span className="mono">
          schema = "{project.slug}" · {formatInt(project.sourceCount)} tables max
        </span>
        <span>{project.formats.map(formatLabel).join(' · ')}</span>
      </div>
    </div>
  );
}
