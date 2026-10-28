import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AtlasCatalog,
  LoadedSource,
  ProjectDef,
  QueryResult,
  SourceDef,
  StorageEstimate,
} from './types';
import { fetchCatalog } from './sources';
import {
  bootWarehouse,
  clearWarehouse,
  loadSource,
  readLoadedSources,
  runQuery,
  storageEstimate,
  type BootReporter,
  type DbMode,
  type Warehouse,
} from './engine';

export type BootStepId = 'engine' | 'storage' | 'catalog' | 'ready';

export interface BootStep {
  id: BootStepId;
  label: string;
  hint: string;
  state: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}

const INITIAL_STEPS: BootStep[] = [
  {
    id: 'engine',
    label: '启动 DuckDB-Wasm 引擎',
    hint: 'WebAssembly',
    state: 'active',
  },
  {
    id: 'storage',
    label: '挂载本地持久化仓库',
    hint: 'OPFS',
    state: 'pending',
  },
  {
    id: 'catalog',
    label: '索引数据根目录',
    hint: 'CATALOG',
    state: 'pending',
  },
  {
    id: 'ready',
    label: '还原已加载的数据表',
    hint: 'NO UNION',
    state: 'pending',
  },
];

interface DatabaseContextValue {
  status: 'booting' | 'ready' | 'error';
  steps: BootStep[];
  error: string | null;
  mode: DbMode;
  engineVersion: string;
  catalog: AtlasCatalog | null;
  projects: ProjectDef[];
  sources: SourceDef[];
  sourceById: (id: string) => SourceDef | undefined;
  loaded: Record<string, LoadedSource>;
  loading: Record<string, boolean>;
  loadErrors: Record<string, string>;
  storage: StorageEstimate | null;
  run: <T = Record<string, unknown>>(sql: string) => Promise<QueryResult<T>>;
  ensureSource: (source: SourceDef, force?: boolean) => Promise<LoadedSource>;
  refreshCatalog: () => Promise<void>;
  clearAll: () => Promise<void>;
  clearing: boolean;
  refreshing: boolean;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

function advance(
  steps: BootStep[],
  id: BootStepId,
  detail?: string,
): BootStep[] {
  const index = steps.findIndex((step) => step.id === id);
  if (index === -1) return steps;
  return steps.map((step, i) => {
    if (i < index) return step.state === 'error' ? step : { ...step, state: 'done' };
    if (i === index) {
      return { ...step, state: 'done', detail: detail ?? step.detail };
    }
    if (i === index + 1) return { ...step, state: 'active' };
    return step;
  });
}

let warehousePromise: Promise<Warehouse> | null = null;

function loadWarehouse(report: BootReporter): Promise<Warehouse> {
  if (!warehousePromise) {
    warehousePromise = bootWarehouse(report).catch((error) => {
      warehousePromise = null;
      throw error;
    });
  }
  return warehousePromise;
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'booting' | 'ready' | 'error'>('booting');
  const [steps, setSteps] = useState<BootStep[]>(INITIAL_STEPS);
  const [error, setError] = useState<string | null>(null);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [catalog, setCatalog] = useState<AtlasCatalog | null>(null);
  const [loaded, setLoaded] = useState<Record<string, LoadedSource>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [clearing, setClearing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const inflight = useRef(new Map<string, Promise<LoadedSource>>());

  useEffect(() => {
    mounted.current = true;
    const report: BootReporter = (id, detail) => {
      if (!mounted.current) return;
      setSteps((prev) => advance(prev, id, detail));
    };

    const catalogPromise = fetchCatalog();

    loadWarehouse(report)
      .then(async (wh) => {
        const nextCatalog = await catalogPromise;
        report(
          'catalog',
          `${nextCatalog.projectCount} 个项目 · ${nextCatalog.sourceCount} 个数据源`,
        );
        const restored = await readLoadedSources(wh.conn);
        const estimate = await storageEstimate();
        if (!mounted.current) return;
        setWarehouse(wh);
        setCatalog(nextCatalog);
        setLoaded(restored);
        setStorage(estimate);
        report(
          'ready',
          Object.keys(restored).length > 0
            ? `从 OPFS 还原 ${Object.keys(restored).length} 张表`
            : '等待选择数据源',
        );
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[atlas] boot failed', err);
        setError(message);
        setSteps((prev) => {
          const active = prev.findIndex((step) => step.state === 'active');
          if (active === -1) return prev;
          return prev.map((step, i) =>
            i === active ? { ...step, state: 'error' } : step,
          );
        });
        setStatus('error');
      });

    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchCatalog();
      setCatalog(next);
      const estimate = await storageEstimate();
      setStorage(estimate);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const ensureSource = useCallback(
    async (source: SourceDef, force = false): Promise<LoadedSource> => {
      if (!warehouse) throw new Error('数据库尚未就绪');
      const existing = loaded[source.id] ?? null;
      if (!force && existing && existing.fingerprint === source.fingerprint) {
        return existing;
      }
      const running = inflight.current.get(source.id);
      if (running) return running;

      setLoading((prev) => ({ ...prev, [source.id]: true }));
      setLoadErrors((prev) => {
        if (!(source.id in prev)) return prev;
        const next = { ...prev };
        delete next[source.id];
        return next;
      });

      const promise = loadSource(
        warehouse,
        source,
        source.projectId,
        existing,
        force,
      )
        .then((result) => {
          setLoaded((prev) => ({ ...prev, [source.id]: result }));
          storageEstimate().then((estimate) => {
            if (mounted.current) setStorage(estimate);
          });
          return result;
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setLoadErrors((prev) => ({ ...prev, [source.id]: message }));
          throw err;
        })
        .finally(() => {
          inflight.current.delete(source.id);
          setLoading((prev) => {
            if (!(source.id in prev)) return prev;
            const next = { ...prev };
            delete next[source.id];
            return next;
          });
        });

      inflight.current.set(source.id, promise);
      return promise;
    },
    [warehouse, loaded],
  );

  const run = useCallback(
    async <T,>(sql: string): Promise<QueryResult<T>> => {
      if (!warehouse) throw new Error('数据库尚未就绪');
      return runQuery<T>(warehouse.conn, sql);
    },
    [warehouse],
  );

  const clearAll = useCallback(async () => {
    if (!warehouse || !catalog) return;
    setClearing(true);
    try {
      await clearWarehouse(
        warehouse,
        catalog.projects.map((project) => project.slug),
      );
      setLoaded({});
      setLoading({});
      setLoadErrors({});
      const estimate = await storageEstimate();
      setStorage(estimate);
    } finally {
      setClearing(false);
    }
  }, [warehouse, catalog]);

  const sourceById = useCallback(
    (id: string) => catalog?.sources.find((source) => source.id === id),
    [catalog],
  );

  const projects = catalog?.projects ?? [];
  const sources = catalog?.sources ?? [];

  const value = useMemo<DatabaseContextValue>(
    () => ({
      status,
      steps,
      error,
      mode: warehouse?.mode ?? 'memory',
      engineVersion: warehouse?.engineVersion ?? '',
      catalog,
      projects,
      sources,
      sourceById,
      loaded,
      loading,
      loadErrors,
      storage,
      run,
      ensureSource,
      refreshCatalog,
      clearAll,
      clearing,
      refreshing,
    }),
    [
      status,
      steps,
      error,
      warehouse,
      catalog,
      projects,
      sources,
      sourceById,
      loaded,
      loading,
      loadErrors,
      storage,
      run,
      ensureSource,
      refreshCatalog,
      clearAll,
      clearing,
      refreshing,
    ],
  );

  return (
    <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
  );
}

export function useDatabase(): DatabaseContextValue {
  const context = useContext(DatabaseContext);
  if (!context) throw new Error('useDatabase must be used inside DatabaseProvider');
  return context;
}
