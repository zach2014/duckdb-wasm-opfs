import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Database,
  FolderOpen,
  FolderTree,
  HardDrive,
  Layers,
  Lock,
  RefreshCw,
  Rows3,
  Trash2,
} from 'lucide-react';
import { useDatabase } from '../db/DatabaseContext';
import type { ProjectDef, SourceDef } from '../db/types';
import {
  catalogBytes,
  catalogRows,
  folderCount,
  formatLabel,
  shortFileName,
  sourceTitle,
} from '../db/sources';
import {
  classNames,
  formatBytes,
  formatInt,
} from '../lib/format';
import { Badge, Card, EmptyState, KpiCard, PageHeader, Spinner } from '../components/ui';

const TONES = ['gold', 'green', 'blue', 'coral'] as const;

export function Projects({
  onOpenProject,
  onOpenSource,
}: {
  onOpenProject: (project: ProjectDef) => void;
  onOpenSource: (project: ProjectDef, source: SourceDef) => void;
}) {
  const {
    catalog,
    projects,
    sources,
    loaded,
    storage,
    refreshCatalog,
    refreshing,
    clearAll,
    clearing,
  } = useDatabase();
  const [confirmClear, setConfirmClear] = useState(false);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.slug, project])),
    [projects],
  );

  const sourcesByProject = useMemo(() => {
    const map = new Map<string, SourceDef[]>();
    for (const source of sources) {
      const list = map.get(source.projectId) ?? [];
      list.push(source);
      map.set(source.projectId, list);
    }
    return map;
  }, [sources]);

  const signatures = useMemo(() => {
    const buckets = new Map<string, Set<string>>();
    for (const source of sources) {
      let bucket = buckets.get(source.projectId);
      if (!bucket) {
        bucket = new Set<string>();
        buckets.set(source.projectId, bucket);
      }
      bucket.add(source.columns.join('\u0001'));
    }
    const counts = new Map<string, number>();
    for (const [project, bucket] of buckets) counts.set(project, bucket.size);
    return counts;
  }, [sources]);

  const totalSignatures = useMemo(
    () => new Set(sources.map((source) => source.columns.join('\u0001'))).size,
    [sources],
  );

  const totalRows = catalogRows(projects);
  const totalBytes = catalogBytes(projects);
  const loadedCount = Object.keys(loaded).length;
  const loadedSources = useMemo(() => {
    return Object.values(loaded)
      .sort((a, b) => b.loadedAt.localeCompare(a.loadedAt))
      .map((entry) => sources.find((source) => source.id === entry.sourceId))
      .filter((source): source is SourceDef => Boolean(source))
      .slice(0, 8);
  }, [loaded, sources]);

  const loadedByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of Object.values(loaded)) {
      map.set(entry.schemaName, (map.get(entry.schemaName) ?? 0) + 1);
    }
    return map;
  }, [loaded]);

  return (
    <div className="view">
      <PageHeader
        eyebrow="CATALOG / PROJECTS"
        title="数据项目"
        description={
          <>
            <b>data/</b> 是数据库根目录。每个子目录是一个项目，目录里的每个文件都是一个独立数据源。
            文件之间不会自动合并，选择项目后再选择数据源加载。
          </>
        }
        actions={
          <>
            <button
              className="btn btn--ghost"
              onClick={() => refreshCatalog()}
              disabled={refreshing}
            >
              {refreshing ? <Spinner /> : <RefreshCw size={13} />}
              刷新目录
            </button>
            {confirmClear ? (
              <>
                <button
                  className="btn btn--danger"
                  onClick={async () => {
                    await clearAll();
                    setConfirmClear(false);
                  }}
                  disabled={clearing}
                >
                  {clearing ? <Spinner /> : <Trash2 size={13} />}
                  确认清空 {loadedCount} 张表
                </button>
                <button className="btn btn--ghost" onClick={() => setConfirmClear(false)}>
                  取消
                </button>
              </>
            ) : (
              <button
                className="btn btn--ghost"
                onClick={() => setConfirmClear(true)}
                disabled={loadedCount === 0}
                title="删除 OPFS 中所有已加载的数据表"
              >
                <Trash2 size={13} />
                重置仓库
              </button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <KpiCard
          index="01"
          label="项目"
          value={formatInt(projects.length)}
          suffix="个"
          hint="data/ 下的每个子目录"
          tone="gold"
          delay={0}
          footer={
            <p className="micro-caption micro-caption--single">
              <i style={{ background: 'var(--gold)' }} />
              {projects.map((project) => project.name).join(' · ') || '等待目录'}
            </p>
          }
        />
        <KpiCard
          index="02"
          label="数据源"
          value={formatInt(sources.length)}
          suffix="个文件"
          hint="每个文件独立成表，从不 UNION"
          tone="green"
          delay={60}
          footer={
            <p className="micro-caption micro-caption--single">
              <Layers size={9} />
              {formatInt(totalSignatures)} 种独立字段结构
            </p>
          }
        />
        <KpiCard
          index="03"
          label="目录行数"
          value={formatInt(totalRows)}
          suffix="行"
          hint="索引阶段按文件头估算，加载后以 DuckDB 为准"
          tone="blue"
          delay={120}
          footer={
            <p className="micro-caption micro-caption--single">
              <Rows3 size={9} />
              {formatBytes(totalBytes)} 原始文本
            </p>
          }
        />
        <KpiCard
          index="04"
          label="已加载"
          value={formatInt(loadedCount)}
          suffix="张表"
          hint={`按需写入 ${catalog ? '本地 OPFS' : '内存'} 仓库`}
          tone="coral"
          delay={180}
          footer={
            <p className="micro-caption micro-caption--single">
              <HardDrive size={9} />
              {formatBytes(storage?.usage ?? 0)} 浏览器存储占用
            </p>
          }
        />
      </div>

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderOpen size={26} />}
            title="还没有发现项目"
            body="在 data/ 下创建子目录并放入 CSV / TSV / JSON 文件，然后点击“刷新目录”。"
          />
        </Card>
      ) : (
        <div className="project-grid">
          {projects.map((project, index) => {
            const projectSources = sourcesByProject.get(project.slug) ?? [];
            const loadedHere = loadedByProject.get(project.slug) ?? 0;
            const ratio = project.sourceCount
              ? loadedHere / project.sourceCount
              : 0;
            const signaturesHere = signatures.get(project.slug) ?? 0;
            return (
              <button
                key={project.id}
                className={classNames(
                  'project-card',
                  `project-card--${TONES[index % TONES.length]}`,
                )}
                onClick={() => onOpenProject(project)}
              >
                <div className="project-card-top">
                  <span className="project-icon">
                    <FolderTree size={17} />
                  </span>
                  <Badge tone={TONES[index % TONES.length]}>
                    {formatInt(project.sourceCount)} 数据源
                  </Badge>
                </div>
                <h2 className="project-name">{project.name}</h2>
                <p className="project-path mono">
                  <FolderOpen size={10} />
                  {project.dir}
                </p>
                <div className="project-stats">
                  <div>
                    <span>行数</span>
                    <strong>{formatInt(project.rowCount)}</strong>
                  </div>
                  <div>
                    <span>体积</span>
                    <strong>{formatBytes(project.bytes)}</strong>
                  </div>
                  <div>
                    <span>字段结构</span>
                    <strong>{formatInt(signaturesHere)}</strong>
                  </div>
                </div>
                <div className="project-progress">
                  <span style={{ width: `${Math.max(ratio * 100, loadedHere ? 4 : 0)}%` }} />
                </div>
                <div className="project-foot">
                  <span>
                    {loadedHere > 0
                      ? `${loadedHere} / ${project.sourceCount} 已加载`
                      : `${formatInt(folderCount(projectSources))} 个目录分组`}
                  </span>
                  <span className="project-cta">
                    浏览
                    <ArrowUpRight size={13} />
                  </span>
                </div>
                {projectSources.length > 0 && (
                  <div className="project-sample">
                    {projectSources.slice(0, 3).map((source) => (
                      <span key={source.id} className="mono">
                        {shortFileName(source)}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="projects-split">
        <Card
          eyebrow="FILESYSTEM"
          title="目录结构"
          subtitle="项目是文件夹，数据源是文件。层级只用于组织，不会触发任何合并。"
          action={<Badge tone="neutral">{catalog?.generatedAt ? 'CATALOG' : '—'}</Badge>}
        >
          <div className="catalog-tree">
            <div className="tree-row tree-row--root">
              <FolderOpen size={12} />
              <span className="mono">data/</span>
              <span className="tree-meta">{projects.length} 个项目</span>
            </div>
            {projects.map((project) => {
              const projectSources = sourcesByProject.get(project.slug) ?? [];
              return (
                <div key={project.id} className="tree-project">
                  <div className="tree-row">
                    <span className="tree-indent" />
                    <FolderTree size={12} />
                    <button className="tree-link" onClick={() => onOpenProject(project)}>
                      {project.name}/
                    </button>
                    <span className="tree-meta">
                      {formatInt(project.sourceCount)} files · {formatInt(project.rowCount)} rows
                    </span>
                  </div>
                  {projectSources.slice(0, 3).map((source) => (
                    <div key={source.id} className="tree-row tree-row--file">
                      <span className="tree-indent" />
                      <span className="tree-indent" />
                      <Database size={11} />
                      <button
                        className="tree-link tree-link--file mono"
                        onClick={() => onOpenSource(project, source)}
                      >
                        {shortFileName(source)}
                      </button>
                      <span className="tree-meta">
                        {formatLabel(source.format)} · {formatInt(source.rows)} rows
                      </span>
                    </div>
                  ))}
                  {projectSources.length > 3 && (
                    <div className="tree-row tree-row--more">
                      <span className="tree-indent" />
                      <span className="tree-indent" />
                      <span className="mono">
                        + {formatInt(projectSources.length - 3)} more files
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          eyebrow="MODELING"
          title="为什么不做 UNION"
          subtitle="不同报表的字段结构可能互相冲突，合并只会制造错误。"
        >
          <ol className="rules">
            <li>
              <span className="rule-index">01</span>
              <div>
                <p className="rule-title">目录即项目</p>
                <p className="rule-body">
                  <span className="inline-code">data/&lt;project&gt;/…</span>{' '}
                  的每一层目录只负责组织，不改变数据。
                </p>
              </div>
            </li>
            <li>
              <span className="rule-index">02</span>
              <div>
                <p className="rule-title">文件即数据源</p>
                <p className="rule-body">
                  每个 CSV / TSV / JSON 文件拥有自己的字段、行数与指纹。
                </p>
              </div>
            </li>
            <li>
              <span className="rule-index">03</span>
              <div>
                <p className="rule-title">一源一表</p>
                <p className="rule-body">
                  加载时写入 <span className="inline-code">"项目"."表"</span>，
                  同名或冲突字段互不覆盖。
                </p>
              </div>
            </li>
            <li>
              <span className="rule-index">04</span>
              <div>
                <p className="rule-title">显式选择与加载</p>
                <p className="rule-body">
                  先选项目、再选数据源；只有打开的数据源才会进入 DuckDB。
                </p>
              </div>
            </li>
          </ol>
          <div className="rules-lock">
            <Lock size={12} />
            表与元数据只写入浏览器 Origin Private File System
          </div>
        </Card>
      </div>

      <Card
        eyebrow="WAREHOUSE"
        title="已加载到本地仓库"
        subtitle="这些数据源的表已经持久化，刷新页面后仍可直接查询。"
        action={
          loadedCount > 0 ? (
            <Badge tone="green" dot>
              {loadedCount} 张表
            </Badge>
          ) : undefined
        }
      >
        {loadedSources.length === 0 ? (
          <EmptyState
            icon={<Database size={22} />}
            title="仓库还是空的"
            body="打开任意项目，选择一个数据源，它会被单独加载成一张表。"
            action={
              projects[0] ? (
                <button
                  className="btn btn--primary btn--small"
                  onClick={() => onOpenProject(projects[0])}
                >
                  选择第一个项目
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="loaded-grid">
            {loadedSources.map((source) => {
              const project = projectById.get(source.projectId);
              const entry = loaded[source.id];
              return (
                <button
                  key={source.id}
                  className="loaded-card"
                  onClick={() => project && onOpenSource(project, source)}
                >
                  <span className="loaded-icon">
                    <CheckCircle2 size={13} />
                  </span>
                  <span className="loaded-text">
                    <span className="loaded-title">{sourceTitle(source)}</span>
                    <span className="loaded-meta mono">
                      {project?.name ?? source.projectName} ·{' '}
                      {entry ? formatInt(entry.rowCount) : 0} rows
                    </span>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              );
            })}
            {Object.keys(loaded).length > loadedSources.length && (
              <p className="loaded-more mono">
                + {Object.keys(loaded).length - loadedSources.length} more tables
              </p>
            )}
          </div>
        )}
      </Card>

      <footer className="view-footer">
        <span>
          <Lock size={10} /> 数据不离开浏览器 · {formatBytes(storage?.usage ?? 0)} in OPFS
        </span>
        <span className="mono">
          {catalog?.sourceCount ?? 0} sources · {catalog?.ignored ?? 0} unsupported files
        </span>
      </footer>
    </div>
  );
}
