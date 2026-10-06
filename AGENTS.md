# claude-mem 工作记忆

本文件适用于整个仓库。先阅读 `CLAUDE.md`；它是项目已有的开发说明，本文件只补充 fork 维护和关键锚点。

## 关键锚点

- 整体架构：`docs/architecture-overview.md`、`docs/SESSION_ID_ARCHITECTURE.md`
- 本地调研记录：`docs/drafts/README.md`、`docs/drafts/2026-10-06-codebase-understanding.md`
- Hook 入口：`plugin/hooks/hooks.json`、`src/cli/hook-command.ts`、`src/cli/handlers/`
- Worker 编排：`src/services/worker-service.ts`、`src/services/worker/http/routes/`
- Session/队列：`src/services/sqlite/SessionStore.ts`、`src/services/sqlite/PendingMessageStore.ts`、`src/services/worker/SessionManager.ts`
- Agent 结果处理：`src/services/worker/SDKAgent.ts`、`src/services/worker/agents/ResponseProcessor.ts`
- 存储/检索：`src/services/sqlite/`、`src/services/sync/ChromaSync.ts`、`src/services/worker/search/SearchOrchestrator.ts`
- MCP/Viewer：`src/servers/mcp-server.ts`、`src/ui/viewer/`
- 配置/路径：`src/shared/SettingsDefaultsManager.ts`、`src/shared/paths.ts`

## 修改纪律

- 业务源码以 `src/` 为准；`plugin/` 和 `dist/` 是构建/分发产物，修改源码后按需运行 `npm run build`。
- 保持 Hook 的 fail-open 行为、`contentSessionId`/`memorySessionId` 双 ID 约束、队列 claim-confirm 语义，以及 SQLite 主存储/Chroma 可降级设计。
- 涉及会话、队列、外键、Provider 或进程生命周期的改动，优先补充或运行相邻测试；隐私标签处理不要绕过 `src/utils/tag-stripping.ts`。
- 不手工修改生成的 `CHANGELOG.md`；不要顺带修复无关问题。
- `npm run build-and-sync` 会同步本地 marketplace 并重启 Worker，只有明确需要时才运行；普通验证优先使用 `npm run build` 和定向 `bun test`。

## Fork / upstream

- 保持 `origin` 指向 `https://github.com/Blueforce-Tech-Inc/claude-mem.git`，保持 `upstream` 指向上游 `thedotmack/claude-mem`。
- 同步上游前先检查工作区和本地提交；默认保护 `docs/drafts/` 及 fork 专属修改，不要用上游版本覆盖本地调研记录。
- 上游同步后重新检查架构锚点、构建产物和测试；除非用户明确要求，不自动提交、推送或重写发布元数据。

