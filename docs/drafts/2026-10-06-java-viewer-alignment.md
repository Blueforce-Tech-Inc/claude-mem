# 2026-10-06 — Java Viewer 对齐记录

> Status: Local implementation complete; Blueforce merge/publish remains pending.

## 背景

本记录对应父研究仓库对 `upstream/main` 的合并复盘，也对应本仓库对配套 Java Viewer 的适配。目标不是把 TypeScript 合并本身当作完成，而是确认新的 Viewer 行为在 Java/Spring Boot 后端上有可用、可验证的契约。

- TypeScript reference target: `bbe11c70f`
- WebUI pre-merge checkout: `ddfbc4d26`
- WebUI merge base: `70a150db`
- Paired WebUI push target: `https://github.com/Blueforce-Tech-Inc/claude-mem.git`
- Parent integration pointer: the research repository's `java/webui` gitlink; it is unchanged until a published Blueforce commit is selected.

## Implemented locally

- Retained upstream Sessions/catalog, session detail, deletion, pagination and SSE behavior while preserving the Java runtime-specific settings panel.
- Added Java-compatible UUID feed IDs, `content_session_id`, `platform_source`, imported dual-ID resolution, exact offset pagination, source-scoped context preview and session/item deletion contracts.
- Added Java runtime metadata (`CLAUDE_MEM_BACKEND: "java"`) and uppercase Viewer settings round-tripping without posting the metadata field back.
- Kept TypeScript-only provider/subscription, startup-all-sources and file-read-gate controls out of the Java runtime UI instead of presenting them as functional.

## Verification

- `node_modules/.bin/tsc --noEmit -p src/ui/viewer/tsconfig.json --types node,react,react-dom` — passed.
- `node scripts/build-viewer.js` — passed; generated bundles were not hand-edited.
- `bun test tests/viewer tests/ui/viewer/observation-metadata-shapes.test.tsx` — 93 passed.
- `bun test tests/ui/viewer` — 76 passed.
- `WEBUI_TEST_URL=http://127.0.0.1:<isolated-port> WEBUI_TEST_ALLOW_MUTATIONS=1 node java/scripts/webui-contract-test.mjs` — 11 contract checks passed against disposable PostgreSQL.
- Maven `-DskipTests package` — passed; the repository does not currently provide a Java unit-test suite for these paths.
- Real-browser smoke test against the built Viewer and isolated Java API — passed for Sessions/detail, UUID item deletion with two-tab SSE, Java settings, and full-session deletion. Separate-origin test used exact `CLAUDEMEM_CORS_ALLOWED_ORIGINS` configuration.

## Delivery boundary

The WebUI checkout is intentionally still in its existing unfinished merge state. Do not reference its local commit from the parent gitlink until the merge is reviewed, committed and pushed to Blueforce. The parent Java changes and this record are likewise not a commit/push request by themselves; publish only when explicitly authorized.

The broader upstream range is not full parity: cloud sync/tombstones, subscription/provider migration, and other TypeScript-only runtime features remain outside this scoped contract alignment.
