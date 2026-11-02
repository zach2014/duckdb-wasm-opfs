import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import {
  ArrowUpRight,
  BookOpen,
  FileText,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  docHash,
  docUrl,
  fetchDocText,
  fetchDocsCatalog,
  resolveDocAsset,
  resolveDocLink,
  safeDocUrl,
  type DocEntry,
  type DocsCatalog,
} from '../docs';
import {
  classNames,
  formatBytes,
  formatDate,
  formatInt,
} from '../lib/format';
import { folderLabel } from '../db/sources';
import { EmptyState, PageHeader, Spinner } from '../components/ui';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isModifiedClick(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** True when the document leads with its own level-one title. */
function startsWithH1(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;
  if (lines[index]?.trim() === '---') {
    index++;
    while (index < lines.length && lines[index].trim() !== '---') index++;
    index++;
    while (index < lines.length && !lines[index].trim()) index++;
  }
  return /^#\s+/.test(lines[index] ?? '');
}

export default function Docs({
  docPath,
  anchor,
  onOpenDoc,
}: {
  docPath?: string;
  anchor?: string;
  onOpenDoc: (path: string, anchor?: string) => void;
}) {
  const [catalog, setCatalog] = useState<DocsCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogKey, setCatalogKey] = useState(0);
  const [query, setQuery] = useState('');
  const [text, setText] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docKey, setDocKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(null);
    fetchDocsCatalog(controller.signal)
      .then((next) => {
        setCatalog(next);
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setCatalogError(errorMessage(error));
      });
    return () => controller.abort();
  }, [catalogKey]);

  useEffect(() => {
    if (!docPath) {
      setText('');
      setDocError(null);
      setDocLoading(false);
      return;
    }

    const controller = new AbortController();
    setText('');
    setDocError(null);
    setDocLoading(true);
    fetchDocText(docPath, controller.signal)
      .then((next) => {
        setText(next);
        setDocLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setDocError(errorMessage(error));
        setDocLoading(false);
      });
    return () => controller.abort();
  }, [docPath, docKey]);

  const entry = useMemo(
    () => catalog?.docs.find((doc) => doc.path === docPath),
    [catalog, docPath],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const docs = catalog?.docs ?? [];
    if (!needle) return docs;
    return docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(needle) ||
        doc.name.toLowerCase().includes(needle) ||
        doc.path.toLowerCase().includes(needle),
    );
  }, [catalog, query]);

  const groups = useMemo(() => {
    const map = new Map<string, DocEntry[]>();
    for (const doc of filtered) {
      const list = map.get(doc.folder) ?? [];
      list.push(doc);
      map.set(doc.folder, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const refresh = useCallback(() => {
    setCatalogKey((value) => value + 1);
    setDocKey((value) => value + 1);
  }, []);

  const scrollToAnchor = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  const goToAnchor = useCallback(
    (id: string) => {
      const hash = docHash(docPath ?? '', id);
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash);
      }
      scrollToAnchor(id);
    },
    [docPath, scrollToAnchor],
  );

  useLayoutEffect(() => {
    if (!docPath || !anchor || !text) return;
    scrollToAnchor(anchor);
  }, [docPath, anchor, text, scrollToAnchor]);

  useEffect(() => {
    if (docPath && anchor) return;
    window.scrollTo(0, 0);
  }, [docPath, anchor]);

  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (!href) return <span>{children}</span>;
        const target = resolveDocLink(docPath ?? '', href);
        if (!target) {
          return <span className="docs-link-dead">{children}</span>;
        }
        if (target.kind === 'external') {
          return (
            <a href={target.href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        }
        if (target.kind === 'asset') {
          return (
            <a
              href={docUrl(target.path)}
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          );
        }
        if (target.kind === 'anchor') {
          return (
            <a
              href={docHash(docPath ?? '', target.anchor)}
              onClick={(event) => {
                if (isModifiedClick(event)) return;
                event.preventDefault();
                goToAnchor(target.anchor);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={docHash(target.path, target.anchor)}
            onClick={(event) => {
              if (isModifiedClick(event)) return;
              event.preventDefault();
              onOpenDoc(target.path, target.anchor);
            }}
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        if (!src) return null;
        const resolved = resolveDocAsset(docPath ?? '', src);
        if (!resolved) {
          return <span className="docs-missing-image">{alt || '图片'}</span>;
        }
        return <img src={resolved} alt={alt ?? ''} loading="lazy" />;
      },
      table({ children }) {
        return (
          <div className="docs-table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [docPath, onOpenDoc, goToAnchor],
  );

  if (!catalog && !catalogError) {
    return (
      <div className="view docs-view">
        <div className="docs-loading">
          <Spinner size={16} />
          正在读取文档目录…
        </div>
      </div>
    );
  }

  if (!catalog && catalogError) {
    return (
      <div className="view docs-view">
        <div className="docs-article">
          <EmptyState
            icon={<BookOpen size={22} />}
            title="无法读取文档目录"
            body={
              <>
                {catalogError}。请确认{' '}
                <span className="inline-code">ATLAS_DOCS_ROOT</span>{' '}
                指向包含 Markdown 的目录。
              </>
            }
            action={
              <button className="btn btn--primary" onClick={refresh}>
                <RefreshCw size={13} />
                重试
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const tree = (
    <>
      <div className="docs-side-head">
        <div className="docs-side-title">
          <BookOpen size={14} />
          <span>文档库</span>
          <span className="docs-side-count">
            {formatInt(filtered.length)}
            {query.trim() ? ` / ${formatInt(catalog?.docCount ?? 0)}` : ''}
          </span>
        </div>
        <label className="search docs-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题或路径"
            aria-label="搜索文档"
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

      <div className="docs-tree">
        {groups.length === 0 ? (
          <p className="docs-tree-empty">
            {query ? '没有匹配的文档。' : '暂无文档。'}
          </p>
        ) : (
          groups.map(([folder, docs]) => (
            <div className="docs-group" key={folder || 'root'}>
              <p className="docs-group-label">{folderLabel(folder)}</p>
              {docs.map((doc) => (
                <button
                  key={doc.path}
                  className={classNames(
                    'docs-item',
                    doc.path === docPath && 'docs-item--active',
                  )}
                  onClick={() => onOpenDoc(doc.path)}
                  title={doc.path}
                >
                  <FileText size={13} />
                  <span className="docs-item-text">
                    <span className="docs-item-title">{doc.title}</span>
                    <span className="docs-item-path mono">{doc.path}</span>
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="docs-side-foot">
        <span className="mono" title={catalog?.docsRoot}>
          {catalog?.docsRoot || 'docs'}
        </span>
        <span>{formatInt(catalog?.docCount ?? 0)} 篇</span>
      </div>
    </>
  );

  const sidebar = (
    <aside className="docs-side" aria-label="文档目录">
      {tree}
    </aside>
  );

  if (!docPath) {
    return (
      <div className="view docs-view">
        <PageHeader
          eyebrow="LIBRARY / DOCS"
          title="文档"
          description={
            <>
              在 <span className="inline-code">{catalog?.docsRoot || 'docs'}</span>{' '}
              中共 {formatInt(catalog?.docCount ?? 0)} 篇 Markdown。当前为只读视图，
              文档不会进入 DuckDB。
            </>
          }
          actions={
            <button
              className="btn btn--ghost"
              onClick={refresh}
              disabled={!catalog}
            >
              <RefreshCw size={13} />
              刷新目录
            </button>
          }
        />

        <div className="docs-layout">
          {sidebar}
          <section className="docs-main">
            {filtered.length === 0 ? (
              <div className="docs-article">
                <EmptyState
                  icon={<Search size={22} />}
                  title={query ? '没有匹配的文档' : '文档目录不存在或为空'}
                  body={
                    query
                      ? '换一个关键词试试。'
                      : `在 ${catalog?.docsRoot || 'docs'} 中没有找到 Markdown。请检查 ATLAS_DOCS_ROOT，或添加 .md 文件后刷新目录。`
                  }
                />
              </div>
            ) : (
              <div className="docs-index">
                {filtered.map((doc) => (
                  <button
                    key={doc.path}
                    className="docs-card"
                    onClick={() => onOpenDoc(doc.path)}
                  >
                    <span className="docs-card-icon">
                      <FileText size={16} />
                    </span>
                    <span className="docs-card-body">
                      <span className="docs-card-title">{doc.title}</span>
                      <span className="docs-card-path mono">{doc.path}</span>
                      <span className="docs-card-meta">
                        {formatBytes(doc.bytes)} · {formatDate(doc.modifiedAt)}
                      </span>
                    </span>
                    <ArrowUpRight size={14} className="docs-card-arrow" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  const body = () => {
    if (!entry) {
      return (
        <div className="docs-article">
          <EmptyState
            icon={<FileText size={22} />}
            title="文档不存在"
            body={
              <>
                目录中没有 <span className="inline-code">{docPath}</span>
                。它可能已被移动或删除。
              </>
            }
            action={
              <button
                className="btn btn--primary"
                onClick={() => onOpenDoc('')}
              >
                返回文档索引
              </button>
            }
          />
        </div>
      );
    }

    if (docError) {
      return (
        <div className="docs-article">
          <EmptyState
            icon={<FileText size={22} />}
            title="无法读取文档"
            body={docError}
            action={
              <button
                className="btn btn--primary"
                onClick={() => setDocKey((value) => value + 1)}
              >
                <RefreshCw size={13} />
                重试
              </button>
            }
          />
        </div>
      );
    }

    if (docLoading || !text) {
      return (
        <div className="docs-loading docs-loading--article">
          <Spinner size={16} />
          正在读取 {entry.title}…
        </div>
      );
    }

    return (
      <article className="docs-article">
        <header className="docs-article-head">
          <p className="eyebrow">DOC / {folderLabel(entry.folder)}</p>
          {!startsWithH1(text) && (
            <h1 className="docs-title">{entry.title}</h1>
          )}
          <div className="docs-meta">
            <span className="mono">{entry.path}</span>
            <span>{formatBytes(entry.bytes)}</span>
            <span>{formatDate(entry.modifiedAt)}</span>
            <a
              className="docs-raw"
              href={docUrl(entry.path)}
              target="_blank"
              rel="noreferrer"
            >
              原文件
              <ArrowUpRight size={11} />
            </a>
          </div>
        </header>
        <div className="docs-markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
            urlTransform={safeDocUrl}
            components={components}
            skipHtml
          >
            {text}
          </Markdown>
        </div>
      </article>
    );
  };

  return (
    <div className="view docs-view">
      <div className="docs-layout">
        {sidebar}
        <section className="docs-main">{body()}</section>
      </div>
    </div>
  );
}