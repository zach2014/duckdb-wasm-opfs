import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import * as XLSX from 'xlsx';

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/*                                                                     */
/* ATLAS_DATA_ROOT is the filesystem root Atlas reads (default data).  */
/* Every immediate sub-folder is a project; every tabular file beneath */
/* it is an independent source. The catalog is generated from the      */
/* files themselves so the browser never has to guess (or union)       */
/* schemas. The public URL prefix stays /data/ for every root.         */
/* ------------------------------------------------------------------ */

const DEFAULT_DATA_ROOT = 'data';
const DATA_URL_PREFIX = '/data/';

const FORMATS: Record<string, string> = {
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.json': 'json',
  '.jsonl': 'jsonl',
  '.ndjson': 'jsonl',
  '.xlsx': 'xlsx',
};

const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

interface CatalogSource {
  id: string;
  projectId: string;
  projectName: string;
  relPath: string;
  fileName: string;
  folder: string;
  format: string;
  /** Sheet name when the file is a workbook; one sheet = one source. */
  sheet?: string;
  bytes: number;
  rows: number;
  columns: string[];
  fingerprint: string;
  modifiedAt: string;
}

interface CatalogProject {
  id: string;
  slug: string;
  name: string;
  dir: string;
  sourceCount: number;
  rowCount: number;
  bytes: number;
  folders: string[];
  formats: string[];
}

function stripBom(text: string) {
  return text.replace(/^\uFEFF/, '');
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fnv1aBuffer(buffer: Buffer): string {
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  cells.push(field);
  return cells.map((cell) => stripBom(cell).trim()).filter(Boolean);
}

function describeDelimited(text: string, delimiter: string) {
  const clean = stripBom(text);
  const lines = clean.split(/\r?\n/);
  const columns = splitDelimited(lines[0] ?? '', delimiter);
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim().length > 0) rows++;
  }
  return { columns, rows };
}

function describeJson(text: string, newlineDelimited: boolean) {
  const records: Record<string, unknown>[] = [];
  if (newlineDelimited) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          records.push(value as Record<string, unknown>);
        }
      } catch {
        // Ignore malformed lines; DuckDB will be the source of truth.
      }
    }
  } else {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            records.push(item as Record<string, unknown>);
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not valid JSON – expose no metadata rather than inventing some.
    }
  }
  const columns: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return { columns, rows: records.length };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  return slug || `project_${fnv1a(name).slice(0, 6)}`;
}

function listFiles(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(abs, rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

function headerLabel(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function countSheetRows(matrix: unknown[][]): number {
  let rows = 0;
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    if (
      row.some(
        (cell) =>
          cell !== null && cell !== undefined && String(cell).trim() !== '',
      )
    ) {
      rows++;
    }
  }
  return rows;
}

function buildCatalog(dataDir: string, dataRoot: string) {
  const usedIds = new Set<string>();
  const sources: CatalogSource[] = [];
  const projectMap = new Map<string, CatalogProject>();
  let ignored = 0;

  const addSource = (input: {
    projectName: string;
    relPath: string;
    fileName: string;
    folder: string;
    format: string;
    sheet?: string;
    bytes: number;
    rows: number;
    columns: string[];
    fingerprint: string;
    modifiedAt: string;
  }) => {
    const { projectName } = input;
    let project = projectMap.get(projectName);
    if (!project) {
      project = {
        id: projectName,
        slug: slugify(projectName),
        name: projectName,
        dir: `${dataRoot}/${projectName}`,
        sourceCount: 0,
        rowCount: 0,
        bytes: 0,
        folders: [],
        formats: [],
      };
      projectMap.set(projectName, project);
    }

    // A workbook sheet is its own source, so its identity includes the sheet.
    const idSeed = input.sheet
      ? `${input.relPath}\u0000${input.sheet}`
      : input.relPath;
    let id = fnv1a(idSeed);
    let attempt = 0;
    while (usedIds.has(id)) {
      attempt++;
      id = `${fnv1a(idSeed)}${attempt.toString(16)}`;
    }
    usedIds.add(id);

    sources.push({
      id,
      projectId: project.slug,
      projectName,
      relPath: input.relPath,
      fileName: input.fileName,
      folder: input.folder,
      format: input.format,
      sheet: input.sheet,
      bytes: input.bytes,
      rows: input.rows,
      columns: input.columns,
      fingerprint: input.fingerprint,
      modifiedAt: input.modifiedAt,
    });

    project.sourceCount++;
    project.rowCount += input.rows;
    if (input.folder && !project.folders.includes(input.folder)) {
      project.folders.push(input.folder);
    }
    if (!project.formats.includes(input.format)) project.formats.push(input.format);
  };

  for (const relPath of listFiles(dataDir)) {
    const segments = relPath.split('/');
    if (segments.length < 2) {
      ignored++;
      continue;
    }
    const projectName = segments[0];
    const fileName = segments[segments.length - 1];
    const folder = segments.slice(1, -1).join('/');
    const ext = path.extname(fileName).toLowerCase();
    const format = FORMATS[ext];
    if (!format) {
      ignored++;
      continue;
    }

    const abs = path.join(dataDir, ...segments);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
      if (stat.size === 0) {
        ignored++;
        continue;
      }
    } catch {
      ignored++;
      continue;
    }
    const modifiedAt = stat.mtime.toISOString();

    if (format === 'xlsx') {
      let workbook: XLSX.WorkBook;
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(abs);
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } catch {
        ignored++;
        continue;
      }
      const fingerprint = fnv1aBuffer(buffer);
      let added = 0;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        });
        const columns = (matrix[0] ?? []).map(headerLabel).filter(Boolean);
        if (columns.length === 0) continue;
        addSource({
          projectName,
          relPath,
          fileName,
          folder,
          format,
          sheet: sheetName,
          bytes: stat.size,
          rows: countSheetRows(matrix),
          columns,
          fingerprint,
          modifiedAt,
        });
        added++;
      }
      if (added === 0) ignored++;
      continue;
    }

    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      ignored++;
      continue;
    }

    let described: { columns: string[]; rows: number };
    if (format === 'csv') described = describeDelimited(text, ',');
    else if (format === 'tsv') described = describeDelimited(text, '\t');
    else if (format === 'jsonl') described = describeJson(text, true);
    else described = describeJson(text, false);

    if (described.columns.length === 0) {
      ignored++;
      continue;
    }

    addSource({
      projectName,
      relPath,
      fileName,
      folder,
      format,
      bytes: stat.size,
      rows: described.rows,
      columns: described.columns,
      fingerprint: fnv1a(text),
      modifiedAt,
    });
  }

  // Sheets of one workbook share a file; count its bytes once per project.
  const files = new Map<string, { projectName: string; bytes: number }>();
  for (const source of sources) {
    files.set(`${source.projectName}\u0000${source.relPath}`, {
      projectName: source.projectName,
      bytes: source.bytes,
    });
  }
  for (const file of files.values()) {
    const project = projectMap.get(file.projectName);
    if (project) project.bytes += file.bytes;
  }

  // Make schema slugs unique even when folder names collide after slugging.
  const slugs = new Map<string, number>();
  for (const project of projectMap.values()) {
    const base = project.slug;
    const seen = slugs.get(base) ?? 0;
    if (seen > 0) project.slug = `${base}_${seen + 1}`;
    slugs.set(base, seen + 1);
    for (const source of sources) {
      if (source.projectName === project.name) source.projectId = project.slug;
    }
  }

  const projects = [...projectMap.values()].sort(
    (a, b) => b.sourceCount - a.sourceCount || a.name.localeCompare(b.name),
  );
  sources.sort(
    (a, b) =>
      a.projectName.localeCompare(b.projectName) ||
      a.folder.localeCompare(b.folder) ||
      a.fileName.localeCompare(b.fileName) ||
      (a.sheet ?? '').localeCompare(b.sheet ?? ''),
  );

  return {
    generatedAt: new Date().toISOString(),
    root: DEFAULT_DATA_ROOT,
    dataRoot,
    projectCount: projects.length,
    sourceCount: sources.length,
    ignored,
    projects,
    sources,
  };
}

/** Show the configured root relative to the project when possible. */
function dataRootLabel(root: string, dataDir: string): string {
  const rel = path.relative(root, dataDir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join('/');
  }
  return dataDir.split(path.sep).join('/');
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

/**
 * Dev-only static serving for the configured root. Only catalog formats are
 * exposed, and every decoded path must stay inside the root.
 */
function serveDataFile(
  req: IncomingMessage,
  res: ServerResponse,
  dataDir: string,
  pathname: string,
) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'Method Not Allowed');
    return;
  }

  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(DATA_URL_PREFIX.length));
  } catch {
    sendText(res, 400, 'Malformed path');
    return;
  }

  const segments = relative.split('/');
  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        segment.includes('\\') ||
        segment.includes('\0'),
    )
  ) {
    sendText(res, 400, 'Invalid path');
    return;
  }

  const filePath = path.resolve(dataDir, ...segments);
  const rel = path.relative(dataDir, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!FORMATS[ext]) {
    sendText(res, 404, 'Not found');
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (res.headersSent) res.destroy();
    else sendText(res, 500, 'Read failed');
  });
  stream.pipe(res);
}

function atlasCatalog(configuredDataRoot: string): Plugin {
  let root = process.cwd();
  let outDir = path.join(root, 'dist');
  let dataDir = path.resolve(root, configuredDataRoot);
  let dataRoot = configuredDataRoot.split(path.sep).join('/');

  return {
    name: 'atlas-catalog',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
      dataDir = path.resolve(root, configuredDataRoot);
      dataRoot = dataRootLabel(root, dataDir);
      if (!fs.existsSync(dataDir)) {
        console.warn(`[atlas] ATLAS_DATA_ROOT not found: ${dataDir}`);
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url.startsWith(DATA_URL_PREFIX)) {
          serveDataFile(req, res, dataDir, url);
          return;
        }
        if (url !== '/atlas-catalog.json') {
          next();
          return;
        }
        try {
          const catalog = buildCatalog(dataDir, dataRoot);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(catalog));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
    closeBundle() {
      try {
        if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
          throw new Error(
            `ATLAS_DATA_ROOT is not a directory: ${dataDir} (set it in .env or the shell)`,
          );
        }
        const fromOut = path.relative(outDir, dataDir);
        if (!fromOut || (!fromOut.startsWith('..') && !path.isAbsolute(fromOut))) {
          throw new Error(
            `ATLAS_DATA_ROOT must be outside the build output: ${dataDir}`,
          );
        }
        const catalog = buildCatalog(dataDir, dataRoot);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
          path.join(outDir, 'atlas-catalog.json'),
          JSON.stringify(catalog),
        );
        const target = path.join(outDir, DEFAULT_DATA_ROOT);
        fs.rmSync(target, { recursive: true, force: true });
        fs.cpSync(dataDir, target, { recursive: true });
      } catch (error) {
        this.error(
          `Failed to package data catalog: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredDataRoot =
    env.ATLAS_DATA_ROOT?.trim() || DEFAULT_DATA_ROOT;

  return {
    plugins: [react(), atlasCatalog(configuredDataRoot)],
    server: {
      port: 5173,
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
    },
  };
});
