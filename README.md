# Open Science

Open Science 是一个面向科研工作者的 Agent 工作流前端脚手架（当前为 Web-only 阶段）。

当前阶段目标是搭建可直接开发的技术骨架：

- React + Vite + TypeScript + shadcn/ui 的前端应用
- Fastify + TypeScript + SQLite 的后端 HTTP server 骨架
- 与前后端共享的基础协议包 `@open-science/contracts`

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

## 运行校验

提交前至少执行：

```bash
yarn typecheck
yarn lint
yarn build
```

启动服务后，确认后端健康检查：

```bash
curl http://127.0.0.1:4000/healthz
```

## 当前 Scaffold 边界（非业务实现）

- 前端：仅提供三栏空状态 Shell（Session / Chat / Artifacts），不包含 session 创建、chat 流程、artifact 持久化逻辑
- 后端：仅提供最小 HTTP 边界与 `/healthz`，不包含 Agent runtime / queue / session persistence / chat persistence / artifact persistence
- 共享层：只定义通用基础契约，不承载业务 domain schema

请在后续迭代中逐步填充 `apps/server/src/services` 与 `apps/server/src/runtime` 的业务与后台能力。
