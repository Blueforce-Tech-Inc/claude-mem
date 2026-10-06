# Claude-Mem 代码库调研记录

> 调研日期：2026-10-06
>
> 范围：当前仓库源码、构建配置、插件配置、架构文档和测试目录。

## 一、整体理解

Claude-mem 是一个面向编码 Agent 的持久化记忆系统。它不直接参与用户的业务代码，而是监听编码会话，把有价值的工具调用和会话内容交给 AI Agent 压缩成可检索的 observations 和 summaries，再在后续会话中注入相关上下文。

核心数据流可以概括为：

```text
Claude Code / Cursor / Gemini / Codex
        ↓ 生命周期 Hook 或 Transcript
本地 Worker（Express，默认 127.0.0.1:37777）
        ↓
AI 记忆提炼 Agent
        ↓
SQLite 结构化存储
        ↓
Chroma 向量索引 + SSE 实时广播
        ↓
下一次会话的上下文注入 / MCP 搜索 / Viewer UI
```

项目自己的架构说明也按 Hook、Worker、SQLite/Chroma 和 MCP 接口划分，参考 `CLAUDE.md` 和 `docs/architecture-overview.md`。

## 二、Hook 层

Hook 配置位于 `plugin/hooks/hooks.json`，当前覆盖：

- `Setup`
- `SessionStart`
- `UserPromptSubmit`
- `PostToolUse`
- `PreToolUse`
- `Stop`
- `SessionEnd`

实际事件处理逻辑主要位于 `src/cli/handlers/`：

- `SessionStart`：生成历史上下文并注入。
- `UserPromptSubmit`：创建或恢复会话、保存用户 Prompt，并执行语义上下文注入。
- `PostToolUse`：记录工具调用。
- `PreToolUse(Read)`：查询当前文件相关的历史记忆。
- `Stop`：请求生成会话总结并等待处理完成。
- `SessionEnd`：清理会话。

Hook 通过 HTTP 调用 Worker，例如：

- `src/cli/handlers/session-init.ts`
- `src/cli/handlers/observation.ts`
- `src/cli/handlers/summarize.ts`

一个重要设计是“故障不阻塞用户”：Worker 不可用、网络超时或服务端错误时，Hook 通常返回成功并跳过记忆处理，不阻塞 Claude Code 本身。错误分类集中在 `src/cli/hook-command.ts`。

## 三、Worker 服务

Worker 的主入口是 `src/services/worker-service.ts`。它负责：

- 启动 Express HTTP 服务。
- 初始化 SQLite。
- 初始化 Chroma/MCP 连接。
- 注册 Session、Data、Search、Settings、Viewer、Corpus 等路由。
- 启动 Transcript Watcher。
- 管理后台 Agent 子进程。
- 处理健康检查、优雅关闭、PID 和孤儿进程回收。

默认监听 `127.0.0.1:37777`。默认配置位于 `src/shared/SettingsDefaultsManager.ts`，数据目录和端口也支持环境变量或用户 settings 覆盖。

Worker 不只是 Web Server，更像一个本地的“记忆后台服务 + Agent 调度器 + 数据访问层”。

## 四、Session 生命周期和双 Session ID

代码中同时维护两个关键 ID：

### `contentSessionId`

来自宿主平台，例如 Claude Code 的会话 ID，用于关联同一个外部会话中的：

- 用户 Prompt
- 工具调用
- 平台事件

### `memorySessionId`

来自实际执行记忆提炼的 AI Agent/Claude SDK，可能随着 Agent 重启、恢复或 Provider 切换而变化。

SQLite 中的 `observations` 和 `session_summaries` 主要通过 `memorySessionId` 建立外键关系，因此不能直接把 `contentSessionId` 当成记忆数据的外键。

关系可以概括为：

```text
宿主会话 contentSessionId
        ↓
sdk_sessions
        ↓
Agent 捕获 memorySessionId
        ↓
observations / session_summaries
```

主要实现位于：

- `src/services/sqlite/SessionStore.ts`
- `src/services/worker/SDKAgent.ts`
- `docs/SESSION_ID_ARCHITECTURE.md`

这是整个系统中最重要、也最容易产生状态错误的部分之一。

## 五、Observation 异步处理

`PostToolUse` 不直接调用 AI，而是把工具调用发送到 Worker，再放入持久化队列。队列大致遵循：

```text
pending
  ↓ claim
processing
  ↓ Agent 成功解析并写入数据库
删除队列消息
```

相关实现位于：

- `src/services/sqlite/PendingMessageStore.ts`
- `src/services/worker/SessionManager.ts`
- `src/services/worker/SDKAgent.ts`

这是一套 claim-confirm 机制：只有 observation/summary 成功写入数据库后，才确认删除队列消息。Worker 或 Agent 中途崩溃时，消息可以重新进入待处理状态，避免静默丢失。

## 六、AI Provider 抽象

当前记忆提炼支持：

- Claude SDK
- Gemini
- OpenRouter

主要 Agent 为：

- `src/services/worker/SDKAgent.ts`
- `src/services/worker/GeminiAgent.ts`
- `src/services/worker/OpenRouterAgent.ts`

三个 Provider 共用 `src/services/worker/agents/ResponseProcessor.ts`：

1. 解析 Agent 返回的 XML 标签。
2. 提取 observations。
3. 提取 summary。
4. 事务性写入 SQLite。
5. 异步同步到 Chroma。
6. 通过 SSE 广播给 Viewer。
7. 清理已处理的队列消息。

代码还支持按队列复杂度进行模型分层，例如简单的 `Read`、`Glob`、`Grep` 使用简单模型，总结任务使用更强模型。

## 七、SQLite 数据层

SQLite 是事实数据源，默认位于：

```text
~/.claude-mem/claude-mem.db
```

主要数据包括：

- `sdk_sessions`
- `observations`
- `session_summaries`
- `user_prompts`
- `pending_messages`
- 反馈和搜索相关字段

`SessionStore` 同时承担了较多职责：

- Schema 初始化。
- 多版本兼容迁移。
- Session CRUD。
- Observation/summary 写入。
- 内容去重。
- Session ID 修复和关联。

Observation 会根据 `memory_session_id + title + narrative` 计算内容哈希，并在短时间窗口内执行去重。

## 八、Chroma 和搜索

搜索采用策略选择和降级机制：

- 没有 query、只做过滤：使用 SQLite。
- 有 query 且 Chroma 可用：使用语义搜索。
- Chroma 失败：降级到 SQLite。
- 部分场景使用 Hybrid Search。

核心调度器是 `src/services/worker/search/SearchOrchestrator.ts`，具体策略位于：

- `SQLiteSearchStrategy.ts`
- `ChromaSearchStrategy.ts`
- `HybridSearchStrategy.ts`

Chroma 同步由 `src/services/sync/ChromaSync.ts` 负责，通常采用异步同步方式，不让向量数据库故障影响 SQLite 主流程。

## 九、上下文注入

系统有两种主要上下文注入模式。

### 会话开始时注入

`SessionStart` 从 SQLite 查询历史 observations 和 summaries，经过 Context Builder 生成结构化上下文，内容通常包括：

- 最近历史工作。
- 按日期和文件组织的时间线。
- 最近会话总结。
- 相关文件和观察记录。
- Token 经济统计。

相关代码位于：

- `src/services/context/ContextBuilder.ts`
- `src/services/context/ObservationCompiler.ts`
- `src/cli/handlers/context.ts`

### 每个 Prompt 的语义注入

`UserPromptSubmit` 会在 Prompt 足够长时请求 `/api/context/semantic`，查询与当前问题相关的历史 observations，并通过 `additionalContext` 返回给宿主。

实现位于 `src/cli/handlers/session-init.ts`。

因此系统同时支持：

- 会话级历史上下文。
- Prompt 级相关记忆。
- 显式 MCP 搜索。

## 十、MCP 搜索接口

MCP Server 位于 `src/servers/mcp-server.ts`，核心记忆工具为：

1. `search`
2. `timeline`
3. `get_observations`

推荐的三层流程是：

```text
search → 得到紧凑索引和 ID
timeline → 查看某个结果前后的上下文
get_observations → 只取最终需要的完整内容
```

这样可以避免一次性把大量历史内容塞进上下文。此外，MCP Server 还提供基于 Tree-sitter 的：

- `smart_search`
- `smart_unfold`
- `smart_outline`

因此它既是记忆搜索服务，也是本地代码结构探索工具。

## 十一、Viewer UI

Viewer 源码位于 `src/ui/viewer/`，由 Worker 本地提供。它使用：

- 分页 API 获取历史数据。
- SSE 获取新 observation/summary。
- Settings API 修改配置。
- Logs API 查看日志。
- Processing API 查看队列状态。

Viewer 更像本地记忆流和 Worker 运维面板，而不是独立的数据系统。

## 十二、多平台接入

当前代码已经不只针对 Claude Code：

- Claude Code：Hook + Claude SDK。
- Cursor：Hook、MCP、上下文文件。
- Gemini CLI：Hook 集成。
- Windsurf：Hook 集成。
- OpenCode：插件。
- OpenClaw：插件。
- Codex CLI：Transcript Watcher。
- 其他 transcript-based client：通过 Transcript Watcher 接入。

例如 Codex 集成主要通过 `transcript-watch.json` 和 Transcript Watcher，而不是依赖 Claude Code 的 `session_id`。相关实现位于 `src/services/integrations/CodexCliInstaller.ts` 和 `src/services/transcripts/watcher.ts`。

## 十三、构建和发布

仓库同时包含源码和可分发产物：

```text
src/       ← TypeScript/React 源码
plugin/    ← 插件运行时和构建产物
dist/      ← npm/CLI 等构建产物
```

构建流程会：

- 用 esbuild 打包 Worker。
- 打包 MCP Server。
- 打包 Hook/CLI。
- 构建 React Viewer。
- 同步插件 manifest。
- 生成插件运行时依赖配置。

主要入口：

- `package.json` 中的 `build`、`build-and-sync`。
- `scripts/build-hooks.js`。
- `scripts/build-viewer.js`。

因此修改 `src/` 后通常需要重新构建，不能只修改源码就认为插件运行时已经更新。

## 十四、工程特点和复杂度

### 做得比较扎实的地方

- Hook 和 Worker 解耦，Worker 挂掉不会阻塞用户编码。
- SQLite 作为可靠主存储，Chroma 作为可降级的语义索引。
- 有持久化消息队列和重试机制。
- 对 Agent 子进程、PID、孤儿进程和优雅关闭做了较多处理。
- 本地 HTTP 默认只监听 localhost。
- CORS 和管理端点有本地访问限制。
- 支持隐私标签和项目排除。
- 多 Provider 共用统一的响应解析和存储流程。
- 测试覆盖 SQLite、Hook、Worker、Search、Supervisor、MCP、Chroma 等关键区域。

### 复杂度主要集中在哪里

- `contentSessionId` 与 `memorySessionId` 的双 ID 生命周期。
- `SessionStore` 同时承担 Schema、迁移、业务存储和兼容逻辑。
- Worker、Agent、队列、子进程之间的状态同步。
- Claude、Gemini、OpenRouter 三套 Agent 的切换与会话复用。
- 源码和 `plugin/` 构建产物需要保持同步。
- 多平台 Hook、Transcript、Plugin 适配逻辑比较分散。

## 十五、仓库身份的补充观察

当前 Git `origin` 已指向 `Blueforce-Tech-Inc/claude-mem.git`，但 `package.json` 和插件 manifest 中仍保留上游 `thedotmack` 的 repository/author 信息。这两套配置彼此独立：

- Git remote 影响代码同步和推送。
- npm/package/plugin manifest 影响发布元数据和插件展示信息。

如果这个仓库未来要作为 Blueforce 的独立发行版本，可能需要单独评估是否更新这些发布元数据；如果只是内部 fork，则保留上游元数据也可能是有意的。

