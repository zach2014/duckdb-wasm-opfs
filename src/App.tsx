import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Database,
  FolderTree,
  LayoutGrid,
  Lock,
  SquareTerminal,
} from 'lucide-react';
import { DatabaseProvider, useDatabase } from './db/DatabaseContext';
import { BootScreen } from './components/BootScreen';
import { Logo } from './components/ui';
import { Projects } from './views/Projects';
import { ProjectDetail } from './views/ProjectDetail';
import { SourceExplorer } from './views/SourceExplorer';
import { sourceTitle } from './db/sources';
import { classNames, formatBytes, formatInt } from './lib/format';

type Route =
  | { view: 'projects' }
  | { view: 'project'; projectId: string }
  | {
      view: 'source';
      projectId: string;
      sourceId: string;
      tab?: 'preview' | 'profile' | 'sql';
    }
  | { view: 'missing'; path: string };

function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const parts = raw
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts.length === 0 || parts[0] === 'projects') return { view: 'projects' };
  if (parts[0] === 'p' && parts[1]) {
    if (parts[2] === 's' && parts[3]) {
      const tab =
        parts[4] === 'sql' || parts[4] === 'profile' || parts[4] === 'preview'
          ? (parts[4] as 'preview' | 'profile' | 'sql')
          : undefined;
      return {
        view: 'source',
        projectId: parts[1],
        sourceId: parts[3],
        tab,
      };
    }
    return { view: 'project', projectId: parts[1] };
  }
  return { view: 'missing', path: raw };
}

function navigate(hash: string) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

export default function App() {
  return (
    <DatabaseProvider>
      <Shell />
    </DatabaseProvider>
  );
}

function Shell() {
  const {
    status,
    mode,
    engineVersion,
    projects,
    sources,
    loaded,
    storage,
  } = useDatabase();
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/projects');
      setRoute({ view: 'projects' });
    }
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 1) return;
      if (index === 1) {
        event.preventDefault();
        navigate('#/projects');
        return;
      }
      const project = projects[index - 2];
      if (project) {
        event.preventDefault();
        navigate(`#/p/${encodeURIComponent(project.id)}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projects]);

  const project = useMemo(() => {
    if (route.view !== 'project' && route.view !== 'source') return undefined;
    return projects.find((item) => item.id === route.projectId);
  }, [projects, route]);

  const source = useMemo(() => {
    if (route.view !== 'source') return undefined;
    return sources.find((item) => item.id === route.sourceId);
  }, [sources, route]);

  if (status !== 'ready') {
    return <BootScreen />;
  }

  const loadedCount = Object.keys(loaded).length;
  const activeProjectId =
    route.view === 'source' || route.view === 'project' ? route.projectId : null;

  const openProject = (projectId: string) =>
    navigate(`#/p/${encodeURIComponent(projectId)}`);
  const openSource = (projectId: string, sourceId: string, tab?: string) =>
    navigate(
      `#/p/${encodeURIComponent(projectId)}/s/${sourceId}${
        tab ? `/${tab}` : ''
      }`,
    );

  let content: ReactNode;
  if (route.view === 'projects') {
    content = (
      <Projects
        onOpenProject={(item) => openProject(item.id)}
        onOpenSource={(item, file) => openSource(item.id, file.id)}
      />
    );
  } else if (route.view === 'project' && project) {
    content = (
      <ProjectDetail
        project={project}
        onBack={() => navigate('#/projects')}
        onOpenSource={(item, file) => openSource(item.id, file.id)}
      />
    );
  } else if (route.view === 'source' && project && source) {
    content = (
      <SourceExplorer
        project={project}
        source={source}
        initialTab={route.tab ?? 'preview'}
        onBack={() => openProject(project.id)}
      />
    );
  } else {
    content = (
      <div className="view">
        <div className="missing">
          <p className="eyebrow">404 / NOT FOUND</p>
          <h1 className="page-title">这个地址没有对应的数据</h1>
          <p className="page-desc">
            项目或数据源可能已从 data/ 中移除。刷新目录后再试一次。
          </p>
          <button className="btn btn--primary" onClick={() => navigate('#/projects')}>
            返回项目总览
          </button>
        </div>
      </div>
    );
  }

  const routeKey =
    route.view === 'source'
      ? `source:${route.sourceId}:${route.tab ?? 'preview'}`
      : route.view === 'project'
        ? `project:${route.projectId}`
        : route.view;

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand-mark">
            <Logo size={32} />
          </span>
          <div>
            <p className="brand-name">Atlas Workbench</p>
            <p className="brand-sub">本地数据项目工作台</p>
          </div>
        </div>

        <nav className="rail-nav" aria-label="主导航">
          <p className="rail-label">WORKSPACE</p>
          <button
            className={classNames(
              'rail-item',
              route.view === 'projects' && 'rail-item--active',
            )}
            onClick={() => navigate('#/projects')}
          >
            <span className="rail-item-index">01</span>
            <LayoutGrid size={16} strokeWidth={1.7} />
            <span className="rail-item-label">项目总览</span>
            <span className="rail-key">⌘1</span>
          </button>

          <p className="rail-label rail-label--sub">PROJECTS</p>
          <div className="rail-projects">
            {projects.map((item, index) => (
              <button
                key={item.id}
                className={classNames(
                  'rail-item',
                  activeProjectId === item.id && 'rail-item--active',
                )}
                onClick={() => openProject(item.id)}
                title={item.dir}
              >
                <span className="rail-item-index">
                  {String(index + 2).padStart(2, '0')}
                </span>
                <FolderTree size={15} strokeWidth={1.7} />
                <span className="rail-item-label rail-item-label--project">
                  {item.name}
                </span>
                <span className="rail-project-count mono">
                  {formatInt(item.sourceCount)}
                </span>
                {index < 8 && <span className="rail-key">⌘{index + 2}</span>}
              </button>
            ))}
          </div>
        </nav>

        <div className="rail-snapshot">
          <div className="rail-snapshot-head">
            <span className="eyebrow">LOCAL WAREHOUSE</span>
            <span className="live-dot" />
          </div>
          <p className="rail-snapshot-value">
            {formatInt(loadedCount)}
            <span>张已加载表</span>
          </p>
          <p className="rail-snapshot-meta">
            {projects.length} 个项目 · {formatInt(sources.length)} 个数据源
          </p>
          <div className="rail-snapshot-bar">
            <span
              style={{
                width: `${Math.min(
                  100,
                  sources.length ? (loadedCount / sources.length) * 100 : 0,
                )}%`,
              }}
            />
          </div>
          <p className="rail-snapshot-foot">
            {formatBytes(storage?.usage ?? 0)} · {engineVersion || 'duckdb-wasm'}
          </p>
        </div>

        <div className="rail-foot">
          <div className="rail-lock">
            <Lock size={12} />
            <span>数据不离开浏览器</span>
          </div>
          <p className="rail-foot-sub">
            DuckDB-Wasm · {mode === 'opfs' ? 'OPFS' : 'MEMORY'} · local-first
          </p>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <button className="crumb-root crumb-link" onClick={() => navigate('#/projects')}>
              ATLAS
            </button>
            <span className="crumb-sep">/</span>
            {project ? (
              <>
                <button
                  className="crumb-link"
                  onClick={() => openProject(project.id)}
                >
                  {project.name}
                </button>
                {source && (
                  <>
                    <span className="crumb-sep">/</span>
                    <span className="crumb-current">{sourceTitle(source)}</span>
                  </>
                )}
              </>
            ) : (
              <span className="crumb-current">项目总览</span>
            )}
          </div>
          <div className="topbar-right">
            <span className="topbar-hint">
              {projects.length > 0
                ? `⌘1 总览 · ⌘2–${Math.min(projects.length + 1, 9)} 项目`
                : 'LOCAL-FIRST'}
            </span>
            <span
              className={classNames(
                'db-pill',
                mode === 'opfs' ? 'db-pill--ok' : 'db-pill--warn',
              )}
              title={
                mode === 'opfs'
                  ? '数据库持久化在浏览器 Origin Private File System'
                  : 'OPFS 不可用，当前使用内存数据库'
              }
            >
              <i />
              {mode === 'opfs' ? 'OPFS · 已持久化' : '内存模式'}
            </span>
          </div>
        </header>

        <main className="content" key={routeKey}>
          {content}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="移动端导航">
        <button
          className={route.view === 'projects' ? 'active' : ''}
          onClick={() => navigate('#/projects')}
        >
          <LayoutGrid size={18} />
          <span>项目</span>
        </button>
        <button
          className={route.view === 'project' ? 'active' : ''}
          onClick={() => (project ? openProject(project.id) : navigate('#/projects'))}
        >
          <Database size={18} />
          <span>数据源</span>
        </button>
        <button
          className={route.view === 'source' ? 'active' : ''}
          onClick={() =>
            project && source
              ? openSource(project.id, source.id, 'sql')
              : navigate('#/projects')
          }
        >
          <SquareTerminal size={18} />
          <span>SQL</span>
        </button>
      </nav>
    </div>
  );
}
