# duckdb-wasm-opfs

Local-first DuckDB-Wasm workbench: browse a folder of tabular files, open one source at a time, and query it in the browser. Each file becomes its own table, so unrelated schemas never collide. React 19 + TypeScript + Vite 6, persisted in OPFS.

## Run

```bash
npm install
npm run dev
```

The default data root is `data/`. Every immediate subfolder is a project; every CSV, TSV, JSON, JSONL, or NDJSON file beneath a project is an independent source. Files sitting directly in the data root are ignored.

XLSX workbooks are supported too: each non-empty sheet becomes its own source and its own table, so sheets with different columns never collide. The browser loads the workbook only when a sheet is opened.

## Data root

Set `ATLAS_DATA_ROOT` to read another folder, either relative to the project root or absolute. Point it at the folder that **contains** project folders, not at a project folder itself:

```bash
# shows every project in data/
ATLAS_DATA_ROOT=data npm run dev

# /srv/atlas-data must contain project subfolders, e.g. /srv/atlas-data/project-a/*.csv
ATLAS_DATA_ROOT=/srv/atlas-data npm run dev
```

To browse only `data/new`, keep the root at `data/` and open the `new` project in the UI. Setting the root to `data/new` finds no projects because its children are files.

Vite modes pick up `.env.<mode>` files, so dev, staging, and production can point at different folders:

| Mode | Command | Loads |
| --- | --- | --- |
| development | `npm run dev` | `.env`, `.env.local`, `.env.development*` |
| staging | `npm run dev:staging`, `npm run build:staging` | `.env`, `.env.local`, `.env.staging*` |
| production | `npm run build` | `.env`, `.env.local`, `.env.production*` |

Shell values win over files. Start from [`.env.example`](.env.example).

The browser always requests sources under `/data/…`; the dev server maps that prefix to the configured root, and a build writes the catalog plus a `data/` copy into `dist/`.

## Docs viewer

Markdown under `docs/` is browsable in the app at `#/docs` (or the **文档** rail item). The viewer renders GitHub-flavored Markdown, including tables, task lists, code fences, relative links between documents, and images stored beside the docs.

Set `ATLAS_DOCS_ROOT` to index a different folder; relative paths resolve from the project root and unset means `docs`:

```bash
ATLAS_DOCS_ROOT=handbook npm run dev
```

The viewer is read-only. A build writes `dist/docs-catalog.json` and copies the docs root into `dist/docs`, so `npm run preview` behaves like dev. A missing docs root shows an empty state and does not fail the build.

## Build

```bash
npm run build
npm run preview
```

The build fails if the configured data root does not exist; the docs root is optional.
