# Open Science

Open Science 是一个面向科研工作者的 Agent 工作流前端与本地 Code Agent session 管理原型。

当前 V0 已跑通主体流程：

- React + Vite + TypeScript + shadcn/ui 的前端应用
- Fastify + TypeScript + SQLite 的后端 HTTP server
- 与前后端共享的基础协议包 `@open-science/contracts`
- Web UI 创建 draft conversation，并在首条真实回复后激活 session
- 本地 Codex CLI runtime
- 本地 Claude Code runtime
- SSE streaming、follow-up turn、interrupt、pending request 基础接口

## 项目结构

- `apps/web`: 前端应用（React + Vite）
- `apps/server`: 后端 API 服务（Fastify）
- `packages/contracts`: 前后端共享类型与契约

## 依赖管理

- 包管理器：Yarn
- 根 `package.json` 已写入 `packageManager`（约束 Yarn 版本）
- 仓库内固定了 `.yarn/releases/yarn-4.5.1.cjs`，即使本机全局 Yarn 仍是 classic 版本，裸 `yarn` 命令也会转到项目要求的 Yarn 4。
- 建议同时启用 Corepack，让本仓库按 `packageManager` 固定 Yarn 版本：

```bash
corepack enable
```

如果本机没有权限写入全局 Corepack shim，可直接使用仓库内的 `yarn` 配置继续执行下方命令。

## 安装与启动

1. 安装依赖

```bash
yarn install
```

2. 启动全部开发服务（并写日志到 `logs/dev`）

```bash
yarn dev
```

3. 分别启动前端

```bash
yarn dev:web
```

4. 分别启动后端

```bash
yarn dev:server
```

## 常用端口

- Web：`5173`
- Server：`4000`（可通过 `SERVER_PORT` 配置）
- Health check：`http://127.0.0.1:4000/healthz`

## 环境变量

- Server 示例配置：`apps/server/.env.example`
- 运行时可在仓库根目录 `.env` 或 `apps/server/.env` 放置本地配置
- `SQLITE_PATH`、`LOG_DIR`、`MIGRATION_DIR` 等相对路径会基于仓库根目录解析
- Web dev server 默认把 `/api` 和 `/healthz` 代理到 `http://127.0.0.1:4000`
- Web 代理目标可通过 `VITE_API_PROXY_TARGET` 覆盖
- Draft working directory 可通过 `VITE_AGENT_DEFAULT_CWD` 预填

## 日志

- Dev server 日志：`logs/dev/web.log`、`logs/dev/server.log`
- 默认兼容 stdout
- Server runtime 日志目录默认：`logs/server`

## 常用命令

- `yarn install`
- `yarn dev`
- `yarn dev:web`
- `yarn dev:server`
- `yarn build`
- `yarn typecheck`
- `yarn lint`
- `yarn db:migrate`
- `yarn workspace @open-science/server test`

## Provider 前置条件

V0 假设本机已经安装并登录以下 CLI：

- `codex`
- `claude`

默认权限模式偏向 Full Access：

- Codex：`CODEX_APPROVAL_POLICY=never`、`CODEX_SANDBOX=danger-full-access`
- Claude Code：`CLAUDE_PERMISSION_MODE=bypassPermissions`、`CLAUDE_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS=true`

如需指定本地二进制或配置目录，可使用：

- `CODEX_BINARY_PATH`
- `CODEX_HOME`
- `CLAUDE_CODE_BINARY_PATH`
- `CLAUDE_CONFIG_DIR`

## 运行校验

提交前至少执行：

```bash
yarn typecheck
yarn lint
yarn build
yarn workspace @open-science/server test
```

启动服务后，确认后端健康检查：

```bash
curl http://127.0.0.1:4000/healthz
```

## V0 边界

V0 包含：

- 创建真实 session：首条 user message + provider assistant response 后激活
- Codex / Claude Code 基础连接
- 单 session 单 running turn
- Assistant streaming 文本展示
- 工具/运行状态的简要 activity 展示
- SQLite 持久化 session、turn、message、pending request 和 raw/canonical provider event

V0 不包含：

- 空 session 持久化
- 多账号隔离
- provider 安装/登录引导
- worktree/checkpoint/diff/artifact lifecycle
- Electron 打包
