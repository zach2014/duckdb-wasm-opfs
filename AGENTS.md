# Atlas Workbench

Local-first DuckDB-Wasm workbench for browsing a data root (default `data/`) and querying one file at a time in the browser. React 19 + TypeScript + Vite 6.

## Data model

- The data root is an immediate parent of **projects**; a tabular file anywhere beneath a project is a **source**. An XLSX workbook contributes one source per non-empty sheet.
- One project maps to one DuckDB schema (its slug). One source maps to one table named `<kind>_<id>`.
- Every source keeps its own column model. Loading is per source: one file = one table, so conflicting headers stay isolated.
- The data root is the user's input. Treat it as read-only and keep fixtures, caches, and outputs in a separate scratch directory.

## Configuration

`ATLAS_DATA_ROOT` selects the filesystem root. `vite.config.ts` reads it with `loadEnv(mode, process.cwd(), '')`, so `.env.<mode>` files and shell values both work; relative values resolve from the project root and unset means `data`. Modes are `development` (`npm run dev`), `staging` (`dev:staging` / `build:staging`), and `production` (`npm run build`).

The client and catalog always use `/data/` as the public URL prefix, whatever the configured root. Dev serves raw files through `serveDataFile()` — keep its traversal, dot-path, and format-extension guards. A build packages the configured root as `dist/data`.

## Catalog

`vite.config.ts` owns `atlasCatalog()`. It scans the filesystem, derives metadata (columns, approximate rows, bytes, FNV-1a fingerprint), and serves `/atlas-catalog.json`: a dev middleware rescans on every request; `closeBundle` writes `dist/atlas-catalog.json` and copies the data root into `dist/data`.

The client reads that catalog for browsing; raw files are fetched only when a source is opened (`src/db/sources.ts`). Keep filesystem discovery in the plugin.

Formats are `csv`, `tsv`, `json`, `jsonl`/`ndjson`, and `xlsx`. To add one, update `FORMATS` (Vite plugin), `SourceFormat` (`src/db/types.ts`), the ingest path (`engine.ts`), and the source URL/format helpers.

XLSX files produce one source per non-empty sheet: `sheet` is the sheet name, the id hashes `relPath + sheet`, and all sheets share the workbook fingerprint. `src/db/sheet.ts` converts the selected sheet to CSV for `read_csv_auto`; it is imported dynamically so SheetJS only loads when a workbook is opened.

## Lazy tables

`src/db/engine.ts` opens `opfs://atlas-workbench.duckdb` with an in-memory fallback and records loaded sources in `_atlas_sources`. Opening a source fetches its raw file (an XLSX sheet is first converted to CSV), registers a virtual file, runs `CREATE OR REPLACE TABLE "<schema>"."<table>" AS SELECT * FROM read_csv_auto / read_json_auto`, drops the virtual file, then describes, counts, records the fingerprint, and checkpoints the OPFS database.

A matching fingerprint reuses the table; a changed fingerprint rebuilds it. `readLoadedSources()` ignores metadata whose table is missing. When adding loaded-source metadata, update the meta table schema, the read path, the insert, and `LoadedSource` together.

DuckDB-Wasm hands Arrow dates/timestamps over as epoch milliseconds. `normalizeValue()` formats them (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`) and converts BigInts; render through it instead of formatting per view.

## Map

| Path | Owns |
| --- | --- |
| `vite.config.ts` | data-root config, catalog scan, dev endpoints, build packaging |
| `src/db/sources.ts` | catalog fetch, URL/identifier helpers, source kinds and labels |
| `src/db/sheet.ts` | XLSX worksheet → CSV conversion (lazy SheetJS chunk) |
| `src/db/engine.ts` | warehouse boot, lazy ingestion, metadata, query normalization |
| `src/db/DatabaseContext.tsx` | boot state, `loaded`, `ensureSource`, refresh/reset |
| `src/App.tsx` | hash routes, shell, shortcuts, rail |
| `src/views/Projects.tsx` | project grid, catalog tree, loaded warehouse |
| `src/views/ProjectDetail.tsx` | source browser, filters, load on open |
| `src/views/SourceExplorer.tsx` | preview, profile, SQL panels |
| `src/styles.css` | all styling (single global stylesheet) |

Routes are hash-only: `#/projects`, `#/p/<projectId>`, `#/p/<projectId>/s/<sourceId>[/preview|/profile|/sql]`. A new view needs `parseRoute`, the shell switch, and the rail/mobile navigation updated.

UI copy is Chinese; identifiers and comments are English. Keep table naming in `tableNameFor()`, URL encoding in `sourceUrl()`, and identifier quoting in `quoteIdent()` rather than re-deriving them. Prefix new CSS classes by view to avoid collisions.

## Verify

`npm run build` runs the typecheck, the bundle, and catalog/data packaging; it must pass. The packaged build is a separate path: run `npm run preview` and repeat the load/reload check there. Run once with a non-default `ATLAS_DATA_ROOT` in dev and build: the catalog, raw files, and packaged `dist/data` must all follow it.

In the browser, open a project, load a source, and check preview, profile, and SQL. Reload: the table should restore from OPFS with the same row count. Load two sources in one project and confirm `information_schema.tables` lists two separate tables. Load the same file in two projects and confirm two schemas, each with its own table. For a multi-sheet XLSX, load two sheets and confirm two tables with their own columns and row counts. Check 390 px, 768 px, and 1440 px plus a clean console.

Done means the build passes, those browser checks pass in dev and preview, and no console errors remain.
