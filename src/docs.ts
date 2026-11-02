import { encodePath } from './db/sources';

export interface DocEntry {
  path: string;
  folder: string;
  name: string;
  title: string;
  bytes: number;
  modifiedAt: string;
}

export interface DocsCatalog {
  generatedAt: string;
  root: string;
  docsRoot: string;
  docCount: number;
  ignored: number;
  docs: DocEntry[];
}

const DOCS_URL_PREFIX = '/docs/';
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export async function fetchDocsCatalog(
  signal?: AbortSignal,
): Promise<DocsCatalog> {
  const response = await fetch('/docs-catalog.json', {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`无法读取文档目录（${response.status}）`);
  }
  const catalog = (await response.json()) as DocsCatalog;
  return {
    ...catalog,
    docs: Array.isArray(catalog.docs) ? catalog.docs : [],
  };
}

/** Public URL for a Markdown file or an asset inside the docs root. */
export function docUrl(docPath: string): string {
  return DOCS_URL_PREFIX + encodePath(docPath);
}

/** Hash route for a document, optionally scrolling to a heading. */
export function docHash(docPath?: string, anchor?: string): string {
  if (!docPath) return '#/docs';
  const base = `#/docs/${encodePath(docPath)}`;
  return anchor ? `${base}?anchor=${encodeURIComponent(anchor)}` : base;
}

export async function fetchDocText(
  docPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(docUrl(docPath), {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(`无法读取文档（${response.status}）`);
  }
  const type = response.headers.get('content-type') ?? '';
  if (!/^text\/markdown\b/i.test(type)) {
    // A static host may SPA-fallback a missing file to index.html.
    throw new Error('返回的内容不是 Markdown');
  }
  return response.text();
}

function decodePathPart(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

function splitHref(href: string): { pathname: string; suffix: string } {
  const cut = href.search(/[?#]/);
  if (cut === -1) return { pathname: href, suffix: '' };
  return { pathname: href.slice(0, cut), suffix: href.slice(cut) };
}

function isExternalHref(href: string): boolean {
  return SCHEME_PATTERN.test(href) || href.startsWith('//');
}

/**
 * Resolve a relative link or image path against the current document.
 * Returns null when the target escapes the docs root or uses a URL scheme.
 */
export function resolveDocPath(
  currentPath: string,
  href: string,
): string | null {
  const { pathname } = splitHref(href.trim());
  if (!pathname || pathname.startsWith('#') || isExternalHref(pathname)) {
    return null;
  }

  let relative = pathname;
  let base: string[] = [];
  if (relative.startsWith('/docs/')) {
    relative = relative.slice('/docs/'.length);
  } else if (relative.startsWith('/')) {
    return null;
  } else if (currentPath) {
    base = currentPath.split('/').slice(0, -1);
  }

  const parts = base;
  for (const rawSegment of relative.split('/')) {
    const segment = decodePathPart(rawSegment);
    if (
      segment === null ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      return null;
    }
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (segment.startsWith('.')) return null;
    parts.push(segment);
  }

  return parts.length > 0 ? parts.join('/') : null;
}

export type DocLink =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'doc'; path: string; anchor?: string }
  | { kind: 'asset'; path: string }
  | { kind: 'external'; href: string };

/** Classify a Markdown link relative to the document being read. */
export function resolveDocLink(
  currentPath: string,
  href: string,
): DocLink | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('#')) {
    const anchor = decodePathPart(trimmed.slice(1));
    return anchor ? { kind: 'anchor', anchor } : null;
  }

  if (isExternalHref(trimmed)) {
    return safeDocUrl(trimmed)
      ? { kind: 'external', href: trimmed }
      : null;
  }

  const path = resolveDocPath(currentPath, trimmed);
  if (!path) return null;

  const name = path.split('/').pop() ?? '';
  if (/\.[^./]+$/.test(name) && !/\.(md|markdown)$/i.test(name)) {
    return /\.(png|jpe?g|gif|webp)$/i.test(name)
      ? { kind: 'asset', path }
      : null;
  }

  const { suffix } = splitHref(trimmed);
  const hashIndex = suffix.indexOf('#');
  let anchor: string | undefined;
  if (hashIndex !== -1) {
    anchor = decodePathPart(suffix.slice(hashIndex + 1)) ?? undefined;
  }
  return { kind: 'doc', path, anchor };
}

/** Allow http(s), mailto, in-page anchors, and same-docs relative URLs. */
export function safeDocUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return trimmed;
  if (trimmed.startsWith('//')) return null;
  if (SCHEME_PATTERN.test(trimmed)) {
    return /^(https?|mailto):/i.test(trimmed) ? trimmed : null;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith(DOCS_URL_PREFIX)) {
    return null;
  }
  return trimmed;
}

/** Resolve a Markdown image source to a public docs URL. */
export function resolveDocAsset(
  currentPath: string,
  src: string,
): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//') || SCHEME_PATTERN.test(trimmed)) return null;
  if (trimmed.startsWith('#')) return null;
  const path = resolveDocPath(currentPath, trimmed);
  return path ? docUrl(path) : null;
}