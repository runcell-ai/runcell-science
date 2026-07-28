# Agent Provider 接入、检测与设置页架构调研

> 状态：Final，Fable 二轮复核 `APPROVED`  
> 调研日期：2026-07-27  
> T3Code 基线：[`pingdotgg/t3code@f0121f3`](https://github.com/pingdotgg/t3code/tree/f0121f31d0e7c069f4007480fc13907c28efd4d5)  
> 目标仓库：Runcell Science (`open-science`)
>
> Fable 首轮审核：`changes requested`；第二轮审核：`APPROVED`。最终版已纳入其关于范围、
> Local setup、登录状态机、loopback/CSRF、安全探测语义、冻结 diff 与验收矩阵的意见。

## 1. 结论摘要

Runcell Science 已经具备三套会话执行 runtime：

- Codex：JSON-RPC `codex app-server`
- Claude Code：Claude Agent SDK
- Grok Build：Agent Client Protocol（`grok agent stdio`）

当前缺口不是“再次接入模型”，而是缺少位于 runtime 之上的统一 Provider 管理控制面：

1. 没有稳定的安装、版本、认证状态快照。
2. 没有统一的检测、刷新、登录与本地 setup API。
3. 没有独立的 Agent Settings 页面。
4. Provider 契约仍是封闭 union，检测逻辑散落在模型枚举与会话启动路径中。

建议借鉴 T3Code 的 `Driver → Instance → Snapshot → Registry → Settings UI` 分层，但只迁移与本项目规模相符的部分：

- 保留现有三套会话 runtime，不重写执行层。
- 新增轻量 `AgentProviderDriver` SPI，统一检测、认证启动和 setup 元数据。
- 新增 `AgentProviderRegistryService`，并发探测三种 Provider，做短 TTL 缓存和同请求去重。
- 新增无敏感信息的统一 `AgentProviderSnapshot` 契约。
- 新增管理侧开放的 `AgentProviderDriverKind` / `AgentProviderInstanceId`；首版注册三个默认
  Instance，执行层继续使用现有三种 Provider allowlist。
- 新增持久化 Local setup override、候选路径发现和统一解析服务，probe、模型枚举、MCP、
  Skills 与新会话 runtime 必须使用同一份解析结果。
- 新增 `/api/agent-provider-instances` 等控制面 API。
- 新增独立 Agent Settings 页面，固定展示 Grok Build、Codex、Claude Code 三个内置选项。
- 新增独立 `LoginAttempt` 资源，授权过程可轮询、可取消、可过期并能观察失败。
- 本地控制 API 默认仅允许 loopback，并使用 Origin/Host 校验与每进程 CSRF nonce。
- 第一版把“可扩展”落在开放管理契约和编译期管理面 Driver 注册接口上，不开放执行任意用户
  命令，不允许用户加载第三方代码，也暂不允许用户新增第二个账号 Instance。

这比直接复制 T3Code 全量的多实例、热重载、版本更新系统更适合当前仓库，同时为后续自定义 Provider Instance、不同账号/不同 home 目录和第三方 Driver 留出清晰演进路径。

### 1.1 “自定义 Provider”范围定义

T3Code 语境中的“自定义 Provider”至少有三种不同含义：

1. **用户新增已注册 Driver 的 Instance**，例如 `codex_personal` 与 `codex_work`。
2. **开发者在源码中注册新的 Driver**，由构建产物携带实现与配置 schema。
3. **运行时加载用户提供的第三方代码或任意 CLI adapter**。

本次交付范围是：

- 完成第 2 项所需的开放管理契约、管理面 Driver SPI 和通用 UI snapshot；
- 注册 Grok Build、Codex、Claude Code 三个默认 Instance；
- UI 验收固定覆盖这三个默认 Instance；
- 不实现第 1 项的多实例执行路由，也不实现第 3 项。

原因是当前会话表、`AgentProvider`、runtime map 和模型选择都以三种 Provider 为 CHECK/union。
若本次同时开放多实例，会连带改变 session 持久化、resume identity、模型偏好和 runtime 生命周期，
不再是单纯的设置页与检测架构。后续加入多实例时可以复用本次 snapshot 与 setup 契约，但仍必须
新增数据库迁移和执行路由；本文不再声称它“无需修改执行/UI 路由”。

## 2. T3Code 的实际技术架构

### 2.1 契约层区分 Driver Kind 与 Instance ID

T3Code 不再把 Provider 名称同时当作“实现类型”和“路由身份”：

- `ProviderDriverKind`：选择实现，例如 `codex`、`claudeAgent`、`grok`。
- `ProviderInstanceId`：用户配置实例的稳定路由键，例如 `codex_personal`、`codex_work`。
- `ProviderInstanceConfig`：保存 display name、accent color、环境变量和 Driver 私有配置。

`ProviderDriverKind` 是开放的 branded slug，而不是封闭 literal union。未知 Driver 不会让旧版本解析失败；系统保留配置并显示 unavailable shadow。这是 T3Code 支持 fork、回滚和自定义 Driver 的关键兼容性设计。

参考：

- [Provider Instance 契约](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/packages/contracts/src/providerInstance.ts)
- [Provider Session 契约](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/packages/contracts/src/provider.ts)

### 2.2 Driver SPI 同时产出执行能力与管理快照

T3Code 的 `ProviderDriver` 是普通值注册表，不是按 Provider 创建一组全局 singleton。每个 Driver 声明：

- `driverKind`
- 静态 metadata
- 私有配置 schema
- 默认配置
- `create(instanceConfig)` 工厂

工厂为每个 Instance 产出相互隔离的：

- `snapshot`：安装、认证、模型、版本等管理状态
- `adapter`：session/turn/approval 执行能力
- `textGeneration`：标题、commit、PR 等辅助生成能力

每个实例有独立 scope，配置变化或实例删除时可单独释放进程、watcher 和缓存，不影响同 Driver 的其他实例。

参考：

- [ProviderDriver SPI](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/ProviderDriver.ts)
- [内置 Driver 注册表](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/builtInDrivers.ts)
- [Instance Registry](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts)

### 2.3 Snapshot 是 UI 与 Provider 私有实现之间的防腐层

T3Code 统一输出 `ServerProvider` 快照，核心字段包括：

- `instanceId`、`driver`
- `enabled`、`installed`
- `version`
- `status`: `ready | warning | error | disabled`
- `auth.status`: `authenticated | unauthenticated | unknown`
- 可选的认证类型、标签和邮箱
- `checkedAt`、面向用户的 `message`
- models、skills、slash commands
- version advisory 与 update state
- `availability` 与 unavailable reason

UI 不解析各 CLI 的 stdout/stderr，也不读取各家的 credential 文件。Provider 私有探测先转换为统一快照，UI 只负责展示状态和可用动作。

参考：

- [ServerProvider 契约](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/packages/contracts/src/server.ts)
- [Snapshot 构建与通用探测工具](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/providerSnapshot.ts)

### 2.4 Managed Snapshot 负责缓存、刷新和事件推送

每个 Provider Instance 有一个 managed snapshot：

1. 立即返回 pending/fallback 状态，避免首屏空白。
2. 后台执行真实 probe。
3. 配置变化时刷新。
4. 定时刷新（当前 Driver 通常为 5 分钟）。
5. 通过 stream 发布完整新快照。
6. Registry 聚合所有 Instance，并把最近快照写入磁盘缓存。

这使“CLI 探测较慢或暂时失败”不会把整个 Provider 列表清空，也避免 UI 重复并发启动多个 CLI。

参考：

- [Managed Server Provider](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/makeManagedServerProvider.ts)
- [Provider Registry 聚合层](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/Layers/ProviderRegistry.ts)
- [状态缓存](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/providerStatusCache.ts)

### 2.5 三种 Provider 的检测策略

#### Codex

T3Code 启动短生命周期 `codex app-server`，完成：

1. `initialize`
2. `account/read`
3. 已登录或无需 OpenAI auth 时，读取 `model/list` 和 `skills/list`
4. 从 initialize 的 user agent 提取版本

`account/read` 同时覆盖 ChatGPT、API key、Amazon Bedrock 和无需 OpenAI auth 的自定义模型 Provider。特别重要的是：`account === null` 不等于未登录；只有 `requiresOpenaiAuth === true` 才应判定为 unauthenticated。

参考：

- [T3Code Codex probe](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/Layers/CodexProvider.ts)
- [Codex app-server Auth endpoints](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#auth-endpoints)

#### Claude Code

T3Code 先用 `claude --version` 判断安装与版本，再启动一个“只完成 SDK initialization、永不发送用户 prompt”的 Claude Agent SDK 会话，读取 account、subscription、API backend 和 slash commands，随后 abort。

这个做法能获得较丰富的账号元数据，但成本高，Bedrock 初始化可能需要更长超时。当前 Runcell Science 第一版应优先使用官方 CLI 已提供的 `claude auth status --json` 做轻量认证判断；只有输出无法确认时，才考虑 SDK initialization fallback。

参考：

- [T3Code Claude probe](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/Layers/ClaudeProvider.ts)
- [Anthropic Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Anthropic Claude Code setup](https://docs.anthropic.com/en/docs/claude-code/getting-started)

#### Grok Build

T3Code 先执行 `grok --version`，再通过 ACP：

1. 启动 `grok agent stdio`
2. `initialize`
3. 认证
4. 执行一次 `session/new` 并读取可用模型

ACP 启动成功同时证明二进制可执行、协议可用且当前凭据可工作；`session/new` 产生的 metadata
可能保留在 Grok session 列表中。xAI CLI 还明确提供 `grok login --device-auth`，适合
headless/remote setup。

参考：

- [T3Code Grok probe](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/server/src/provider/Layers/GrokProvider.ts)
- [xAI CLI reference](https://docs.x.ai/build/cli/reference)
- [xAI Grok Build overview](https://docs.x.ai/build/overview)

### 2.6 Settings UI 是 schema-driven 的通用 Provider 卡片

T3Code 的 `/settings/providers` 页面由以下部分组成：

- Provider 列表与最后检测时间
- 手动 Refresh
- 每个 Instance 的安装、认证、版本、错误状态
- 可展开的 binary path、home path、launch args、环境变量与自定义模型
- Add Provider Instance wizard
- Driver schema annotation 自动生成设置表单
- 未知 Driver 的只读 unavailable 状态
- 可选的一键 update 与手动命令

参考：

- [Provider settings route](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/web/src/routes/settings.providers.tsx)
- [Provider settings panel](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/web/src/components/settings/SettingsPanels.tsx)
- [Provider Instance card](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/web/src/components/settings/ProviderInstanceCard.tsx)
- [通用设置表单](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/web/src/components/settings/ProviderSettingsForm.tsx)
- [Driver UI metadata](https://github.com/pingdotgg/t3code/blob/f0121f31d0e7c069f4007480fc13907c28efd4d5/apps/web/src/components/settings/providerDriverMeta.ts)

### 2.7 不能直接照搬的部分

1. T3Code 的 Provider 文档部分内容落后于当前实现；本调研以固定提交的 contracts、Driver 和 Registry 源码为准。
2. T3Code 当前设置页能展示登录状态和 setup 提示，但并未为 Codex、Claude、Grok 全部提供统一的一键登录 API。
3. T3Code 使用 Effect、WebSocket 状态流、多实例 hot reload 和磁盘 snapshot cache；Runcell Science 当前是 Fastify REST + React 单页应用，第一版照搬这些基础设施会扩大风险。
4. Runcell Science 已有稳定的三套 runtime。把 Provider 管理与会话执行重新合并，会造成不必要的重写。

## 3. 当前仓库现状与差距

| 领域 | 当前实现 | 差距 |
| --- | --- | --- |
| Provider 类型 | `AgentProvider = 'codex' | 'claude' | 'grok'`，数据库也有三值 CHECK | 执行层可保持封闭；管理层需引入开放 Driver/Instance 身份 |
| 会话 runtime | 三种均已实现 | 不应重写 |
| 模型发现 | `/api/models` 并行调用三种 Provider | 失败只返回 warning，没有结构化安装/认证状态 |
| Codex 管理连接 | `McpManagementService` 持久化 `codex app-server` | 可复用底层连接，但不应继续让 Provider 管理依赖“MCP”语义 |
| Claude 检测 | 模型枚举通过 Agent SDK | 没有独立 `auth status` |
| Grok 检测 | model catalog / ACP | 没有独立状态快照 |
| 配置 | 服务启动时从环境变量一次性读取 binary/home/model | Finder/Electron PATH 可能找不到已安装 CLI；缺少持久化 override 与统一解析 |
| UI | 会话页、Connectors、Skills | 无 Agent Settings 页面 |
| Auth | 要求用户预先在终端登录 | 页面不能启动授权流程 |

## 4. 拟落地架构

### 4.1 分层

```text
Agent Settings UI
        │ local-control REST（统一快照、setup、login attempt）
        ▼
AgentProviderRegistryService
        │
        ├── CodexProviderDriver ── codex app-server account/read + login
        ├── ClaudeProviderDriver ─ claude --version + auth status/login
        └── GrokProviderDriver ─── grok --version + ACP auth/login
        │
        ├── AgentProviderConfigService ─ SQLite override + PATH/candidate discovery
        └── CodexManagementClientService ─ shared app-server lifecycle
        │
        ▼
现有 RuntimeRegistry（会话执行协议不改，路径/config 改为读取统一解析服务）
```

管理面与执行面共享 Provider ID 和配置来源，但生命周期分离：

- 管理 probe 失败不会杀死已有会话。
- 会话启动仍由现有 runtime 做最终可用性校验。
- Settings UI 不直接解析 CLI 输出。
- Local setup 保存后只影响后续新建/重建的 Provider 进程；已有会话继续使用其启动时配置。
- Codex Models、MCP、Skills、probe/login 共用一个中性的 management client；服务 shutdown 时显式释放。

### 4.2 统一契约

建议新增以下 contracts：

```ts
type AgentProviderDriverKind = string // 运行时校验为安全 slug
type AgentProviderInstanceId = string // 运行时校验为安全 slug

type AgentProviderAvailability =
  | 'checking'
  | 'ready'
  | 'needs_auth'
  | 'not_installed'
  | 'error'
type AgentProviderAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown'
type AgentProviderRefreshState = 'idle' | 'refreshing'
type AgentProviderConfigSource =
  | 'persisted'
  | 'environment'
  | 'discovered'
  | 'default'

interface AgentProviderSnapshot {
  instanceId: AgentProviderInstanceId
  driver: AgentProviderDriverKind
  displayName: string
  installed: boolean
  version: string | null
  configuredCommand: string
  resolvedExecutablePath: string | null
  configHome: string | null
  commandSource: AgentProviderConfigSource
  homeSource: AgentProviderConfigSource | null
  availability: AgentProviderAvailability
  auth: {
    status: AgentProviderAuthStatus
    label?: string
  }
  refreshState: AgentProviderRefreshState
  checkedAt: string | null
  lastSuccessfulAt: string | null
  stale: boolean
  message: string | null
  capabilities: {
    login: boolean
    localSetup: boolean
    loginMode: 'device_code' | 'local_process' | 'manual_only'
  }
  setup: {
    loginCommand: string
    docsUrl: string
    installInstructions: Array<{
      platform: 'macos' | 'linux' | 'windows' | 'all'
      label: string
      command: string | null
    }>
  }
}
```

`displayName` 是受长度限制的普通字符串，不使用三个 literal；账号邮箱不在第一版 DTO 中返回。
安装提示按平台建模，避免把单个 npm 命令误当成唯一安装渠道。

登录使用独立资源，而不是一个无后续状态的响应：

```ts
type AgentProviderLoginAttemptStatus =
  | 'starting'
  | 'awaiting_user'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'cancelled'

type AgentProviderLoginFlow =
  | { kind: 'browser'; url: string }
  | { kind: 'device_code'; verificationUrl: string; userCode: string }
  | { kind: 'external_process'; message: string }
  | { kind: 'manual'; command: string; message: string }

interface AgentProviderLoginAttempt {
  id: string
  instanceId: AgentProviderInstanceId
  status: AgentProviderLoginAttemptStatus
  flow: AgentProviderLoginFlow | null
  startedAt: string
  expiresAt: string
  finishedAt: string | null
  message: string | null
}
```

所有响应必须经过显式 DTO 清洗，不得返回 token、credential 路径内容、原始环境变量或完整 stderr。

### 4.3 Driver SPI

第一版 SPI 保持轻量：

```ts
interface AgentProviderDriver {
  readonly driver: AgentProviderDriverKind
  readonly metadata: AgentProviderMetadata
  probe(instance: ResolvedAgentProviderInstance): Promise<AgentProviderProbeResult>
  startLogin(
    instance: ResolvedAgentProviderInstance,
    attempt: AgentProviderLoginAttempt
  ): Promise<void>
  cancelLogin?(attemptId: string): Promise<void>
  dispose(): Promise<void>
}
```

管理侧注册表用开放 slug 作为 key，但只接受构建中显式注册的 Driver。首版有三个默认 Instance，
`instanceId` 分别为 `grok`、`codex`、`claude`：

```ts
new Map<AgentProviderDriverKind, AgentProviderDriver>([
  ['grok', grokDriver],
  ['codex', codexDriver],
  ['claude', claudeDriver]
])
```

执行层暂时通过显式映射把这三个默认 Instance 解析为现有 `AgentProvider`。未知 Driver/Instance
配置应能在管理契约中 round-trip 并显示 unavailable，但不能启动 session。未来多实例仍需迁移
session schema 与 runtime routing。

### 4.4 Probe 规则与状态语义

| 条件 | installed | auth | availability |
| --- | ---: | --- | --- |
| 尚未完成首次 probe | false | unknown | checking |
| 找不到命令（ENOENT） | false | unknown | not_installed |
| `--version` 成功，明确未登录 | true | unauthenticated | needs_auth |
| 协议/account probe 成功 | true | authenticated 或 unknown | ready |
| 自定义 Provider 明确不需要官方 auth | true | unknown | ready |
| 命令存在但超时/协议失败 | true | unknown | error |

实现约束：

- 每个子进程有超时和输出上限。
- 只用 `execFile`/`spawn` 参数数组，不拼接 shell 字符串。
- `ENOENT` 与“命令返回非零”必须区分。
- Registry 对并发 refresh 做 in-flight 去重。
- Registry 启动时创建三个 pending snapshot 并在后台 probe；GET 立即返回当前快照。
- 普通 GET 在 TTL（建议 30 秒）过期时触发 stale-while-revalidate，不阻塞首屏。
- 显式 refresh 启动后台探测；`refreshState`、`stale`、`lastSuccessfulAt` 可观察。
- 任一 Driver 失败不得使整个列表请求失败。
- 返回顺序固定为 Grok Build、Codex、Claude Code，保证 UI 稳定。
- “自动检测”不主动发起登录、安装或真实用户 turn；Vendor CLI 仍可能刷新 token、更新缓存或
  写入自己的临时/session metadata，因此不作“绝对只读”承诺。

Grok 的 ACP `authenticate` 成功在本项目中定义为“credential 已验证”，因此可返回
`auth.status = authenticated`，即使没有账号身份信息。这比 T3Code 当前仍返回 `unknown`
更强，属于 Runcell Science 的显式新增语义。只有稳定、可识别的认证错误才映射为
`unauthenticated`；其他 ACP 失败保持 `unknown + error`。

### 4.5 统一 Local setup 与路径解析

新增 `agent_provider_instance_settings` SQLite 表，保存：

- `instance_id`
- `driver`
- `binary_path_override`
- `config_home_override`
- `updated_at`

解析优先级：

1. 用户在 Agent Settings 保存的 persisted override
2. 现有环境变量（例如 `CODEX_BINARY_PATH`、`CLAUDE_CONFIG_DIR`）
3. 受控候选路径发现
4. Driver 默认 command（`codex`、`claude`、`grok`）

候选发现只检查有限的已知位置和当前 PATH，例如 Homebrew、`~/.local/bin`、
`~/.nvs/default/bin`、`~/.grok/bin`；不递归扫描整个 home。快照同时返回
`configuredCommand` 与 `resolvedExecutablePath`，避免把“配置了命令”误报为“已解析”。
command 和 config home 分别记录 source，因为它们可以来自不同优先级。

Local setup UI 必须支持：

- 自动发现候选路径；
- 编辑 binary path；
- Codex 的 `CODEX_HOME`、Claude 的 `CLAUDE_CONFIG_DIR`；
- `Test`（不持久化，用候选配置执行 probe）；
- `Save`（持久化并刷新）；
- `Reset`（删除 override，回到环境/发现/default）；
- 固定官方安装/登录命令复制与文档链接。

同一个 `AgentProviderConfigService` 必须供 Provider probe、Models、MCP、Skills 和新会话
runtime 使用。保存后清理相关 model cache 和 Codex management client；已有会话不热切换。

### 4.6 Provider 特定实现

#### Codex

- 检测：抽取中性的 `CodexManagementClientService`，Models、MCP、Skills、Provider
  probe/login 共享同一个按解析配置建立的 app-server。
- 状态：`account/read`，仅当 `requiresOpenaiAuth` 为 true 且 account 为空时标记 `needs_auth`。
- 登录：优先 `account/login/start({ type: 'chatgptDeviceCode' })`，把 verification URL/code
  放进 attempt。Device code 不依赖 OAuth callback 指向服务端主机，适合 Electron、普通本地
  Web 和 SSH port-forward/headless。
- 完成：监听 `account/login/completed` / `account/updated` 更新 attempt，并刷新 snapshot。
- 取消：`account/login/cancel`。
- 特殊 setup：可保存 binary path 与 `CODEX_HOME`，另显示 `codex login --device-auth`。

#### Claude Code

- 检测：`claude --version` + `claude auth status --json`。
- 本地桌面/本地 Web：固定参数启动 `claude auth login --claudeai`，attempt 为
  `external_process`；监控 child exit 后重新 probe，映射 succeeded/failed。
- headless/远程：Claude CLI 没有等价 device-code 参数，不在服务端盲目打开浏览器；attempt
  返回 `manual`，要求用户在服务端主机运行固定命令并由 UI `Check status`。
- local/manual 拓扑由明确的服务端 deployment mode 或 Electron 启动标记决定，不通过
  peer、Host 或 Origin 猜测；SSH port-forward 在服务端看来也可能是 loopback。
- 企业/API 场景：若 auth status 表明 Bedrock、Vertex、API key 等外部认证可用，不能强制要求 Claude subscription login。
- 特殊 setup：可保存 binary path 与 `CLAUDE_CONFIG_DIR`。

#### Grok Build

- 检测：`grok --version` 后执行最小 ACP `initialize + authenticate`，不创建真实用户 turn。
- API key：存在 `XAI_API_KEY` 时选择 API key auth；否则检查 cached token。
- 登录：固定启动官方为 headless/remote 设计的 `grok login --device-auth`，受限捕获 stdout，
  解析 verification URL/code 写入 attempt；child exit 后重新 probe。
- 特殊 setup：可保存 binary path，显示认证方式提示和 xAI 官方 CLI 文档。

### 4.7 HTTP API

```text
GET    /api/agent-provider-control/token
GET    /api/agent-provider-instances
POST   /api/agent-provider-instances/:instanceId/refresh
POST   /api/agent-provider-instances/:instanceId/setup/test
PUT    /api/agent-provider-instances/:instanceId/setup
DELETE /api/agent-provider-instances/:instanceId/setup
POST   /api/agent-provider-instances/:instanceId/login-attempts
GET    /api/agent-provider-instances/:instanceId/login-attempts/:attemptId
POST   /api/agent-provider-instances/:instanceId/login-attempts/:attemptId/cancel
```

约束：

- `:instanceId` 先经安全 slug 校验，再从 Registry 查找；它永远不能直接映射为命令。
- 所有 login flow 都有 attempt ID；同 Instance 同时只允许一个未结束 attempt，冲突返回 409。
- attempt 定义成功、失败、取消、过期和 sanitized message；默认 10 分钟过期。
- login 是用户显式动作；GET 不主动启动授权或安装。
- 第一版不提供“自动安装”，避免从网页触发 package manager 或 curl 管道。
- Local setup 可以保存/测试受限路径字段，但不接受或执行用户提供的 shell args。

### 4.8 Agent Settings 页面验收形态

当前 Web 没有 router。第一版把 Agent Settings 实现为可导航主视图：

- 稳定 URL hash：`#agent-settings`
- sidebar footer 入口，与 Connectors、Skills 同级
- 浏览器 back/forward 可返回 workspace
- 主容器稳定 selector：`[data-testid="agent-settings-page"]`

它不是模型下拉菜单中的临时 popover。

页面内容：

1. 标题 `Agent Settings`
2. 全局 `Refresh status`
3. 固定三张 Provider 卡片，显示顺序：
   - Grok Build
   - Codex
   - Claude Code
4. 每张卡片至少显示：
   - Installed / Not installed
   - 登录状态
   - 版本
   - configured command 与 resolved executable path
   - 上次检测时间
   - refreshing/stale 状态
   - 状态说明
5. 动作：
   - `Sign in` 或 `Authorize`
   - `Refresh`
   - `Local setup` 展开区
   - binary/home 的 Test、Save、Reset
   - 安装/登录命令复制
   - 官方文档链接
6. 登录后轮询 login attempt，并在结束时刷新 Provider snapshot，不能要求整页刷新。
7. 窄屏下卡片单列，所有主要动作可键盘访问并有明确 aria label。

### 4.9 本地控制 API 安全边界

- UI 不接受任意 shell command。
- 登录和 setup 命令由内置 Driver 常量提供。
- binary path override 是受信任本地控制面的特权能力：保存/测试前必须校验目标是 regular
  file、具备可执行权限，并通过对应 Driver 的 version/protocol probe。它不对远程控制面开放。
- 不回传或记录 API key、OAuth token、credential 文件内容。
- 不把完整 CLI stderr 直接展示给浏览器；先做长度限制和敏感模式清洗。
- 不使用 shell 管道执行安装命令。
- 登录进程单 Provider 同时最多一个；超时后自动清理。
- 服务退出时清理所有管理连接和登录子进程。
- 默认所有 Agent Provider control API 仅接受 loopback peer；LAN 直连返回 403。
- 校验 Host 与 Origin；允许当前 server origin、配置的 `WEB_ORIGIN` 及其明确的 loopback
  hostname 等价形式，不使用 `*`。
- 进程启动、setup 保存、refresh 和 cancel 强制 JSON content type。
- 服务启动时生成随机 CSRF nonce；同源 UI 先通过 loopback-only token endpoint 获取，再在
  mutation 请求中发送 `X-Runcell-Control-Token`。跨站网页无法读取 nonce。
- 无 Origin 的 headless 客户端仍必须提供 nonce；有 Origin 但不在 allowlist 时一律拒绝。
- 对 login/setup mutation 做单 Instance 并发限制和简单速率限制。
- 记录动作类型、Instance、结果和时间，但不记录 credential、完整命令输出或用户隐私字段。
- 非 loopback/remote 部署默认禁用 `external_process`；Claude 降级为 manual flow。
- 只有用户创建 login attempt 才允许主动写 credential。普通 probe 不主动登录/安装，但
  Vendor CLI 自身可能刷新 token 或缓存。

## 5. 分阶段实施与质量门槛

### 阶段 A：契约、Registry 与状态探测

- 开放的管理侧 Driver/Instance contracts
- `agent_provider_instance_settings` migration 与 Config Service
- 候选路径发现、Test/Save/Reset、三个默认 Instance
- 抽取共享 `CodexManagementClientService` 并接入 shutdown
- 管理面 Driver SPI、三个内置 Driver probe、Registry stale-while-revalidate
- 把 Models、MCP、Skills 和新会话 runtime 接到同一份 resolved config
- loopback/Host/Origin/CSRF guard
- snapshot/refresh/setup API
- server 单元、路由与安全测试

完成条件：headless API 能稳定区分 checking、installed、needs_auth、not_installed、error；
Finder/Electron 常见候选路径可发现；setup override 会真实影响 probe 与后续 runtime。

### 阶段 B：LoginAttempt 与授权动作

- Codex app-server device auth
- Claude local-process/manual topology
- Grok device auth output parser
- attempt create/query/cancel/expire/conflict
- child/client cleanup
- CSRF、速率限制和 sanitized failure
- 安全与错误测试

完成条件：三种 Provider 都有明确的页面内授权入口或可观察的 manual fallback；成功、失败、
取消、过期和重复启动均可确定性测试。

### 阶段 C：Agent Settings UI

- `#agent-settings` 导航、sidebar 入口与独立页面
- Provider cards、refresh、登录状态轮询
- Local setup 的发现、Test、Save、Reset 与复制动作
- responsive/a11y
- web 单元测试

完成条件：UI 至少完整展示 Grok Build、Codex、Claude Code，并能按真实 API 状态更新。

### 每阶段强制 Review

每个阶段完成后、进入下一阶段前，同时进行：

1. 一个独立 subagent 的 Code Review。
2. Claude Code 的独立 Code Review。
3. 修复后重新运行该阶段测试；若修复实质改变被审逻辑，则再次复审相关 diff。

每次 Review 先生成冻结 manifest，记录：

- workspace 绝对路径
- base commit SHA
- 审查文件列表及逐文件 SHA-256
- aggregate diff hash
- review revision

subagent、Claude Code 和最终独立验收都必须声明看到的 manifest hash。实质修复后生成新 revision，
只复审受影响文件及其调用边界。

#### Claude Review 型号

用户于 2026-07-27 澄清原“3.5”为口误，并指定使用 Claude Opus 5。Anthropic 当前官方
model ID 为 `claude-opus-5`。

来源：[What's new in Claude Opus 5](https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5)。

每次 Claude Review 必须显式传入 `--model claude-opus-5`，并记录 Claude CLI 版本、请求
model ID、实际返回/解析的 model；不允许静默 fallback。首次 Review 前还必须确认本机
Claude Code 已完成授权。

### 确定性测试矩阵

所有 probe/login 必须支持注入 process/client factory。自动测试至少覆盖：

- ENOENT；
- installed + authenticated；
- installed + unauthenticated；
- timeout / protocol error；
- custom/enterprise auth 不需要官方 login；
- stale snapshot 在后台 refresh 时仍可读；
- setup candidate 的 Test、Save、Reset 与 config cache invalidation；
- 登录成功、失败、取消、过期、重复启动 409；
- Grok 非认证 ACP 错误不会误报 unauthenticated；
- 三个 Driver 中任一个失败时列表仍完整且顺序稳定；
- 非 loopback、错误 Origin/Host、缺失/错误 CSRF nonce、非 JSON mutation 被拒绝。

真实本机 probe 只作为 smoke evidence；自动验收不得修改真实 credential，也不以当前账号状态
作为唯一 oracle。

### 最终验收

Code Review 全部关闭后：

1. 创建独立 Codex agent task/thread。
2. 验收 task 先确认冻结 manifest hash，再做 headless 验收：
   typecheck、lint、tests、build、fake-driver 状态矩阵与只读真实 API smoke probe。
3. UI 部分再使用 BrowserUse/浏览器自动化验收：
   - 进入 Agent Settings。
   - 验证三张卡片及顺序。
   - 用 fixture/mock API 验证确定性安装和登录状态，再对真实状态做只读 smoke。
   - 验证 refresh。
   - 验证 Local setup 的 Test、Save、Reset（隔离测试数据库/目录）。
   - 验证成功、失败、取消的 mocked auth flow；不得改真实 credential。
   - 验证窄屏。
4. 独立验收通过后才允许 commit。

## 6. 非目标

本次不包含：

- 运行时加载任意第三方 JavaScript/TypeScript Provider 插件。
- 从 UI 自动执行 `curl | sh`、npm global install 或系统 package manager。
- 多账号 Provider Instance 与 credential vault。
- Provider CLI 自动更新。
- 重写现有 Codex、Claude、Grok 会话 runtime。
- 将 Provider auth token 存入 Runcell Science 数据库。

## 7. 架构决策

1. **采纳 T3Code 的 Provider Snapshot 与 Driver Registry 思路。**
2. **不照搬全量 Effect、多实例 hot reload 和磁盘 cache。**
3. **现有会话协议不重写；路径/config 改为读取统一解析服务。**
4. **管理契约使用开放 Driver/Instance slug，第一版固定三个默认 Instance；这只是管理面
   扩展点，新增可执行 Provider 仍须显式扩展 session schema 与 runtime mapping。**
5. **不实现多账号 Instance 执行路由，也不加载任意第三方代码。**
6. **Codex 用原生 device auth；Grok 用 device auth；Claude 按 local/manual 拓扑处理。**
7. **所有授权通过可轮询、可取消、可过期的 LoginAttempt 表达。**
8. **Local setup 可持久化 binary/home override，并被 probe 与 runtime 共用。**
9. **本地控制 API 默认仅 loopback，并具备 Origin/Host/CSRF 防护。**
10. **自动检测不主动登录、安装或发送真实 turn；Vendor 自身副作用如实承认。**
11. **UI 不执行任意安装脚本，只提供固定官方说明。**

## 8. Fable 审核记录

### 首轮：changes requested

Fable 提出的 Blocking 项及处理：

1. 自定义 Provider 范围不清：已增加三类定义，并明确本次只做编译期 Driver SPI 与三个默认 Instance。
2. Local setup 只有命令：已改为 SQLite override、候选发现、Test/Save/Reset，并要求 runtime 共用。
3. 登录不可观察/取消：已改为独立 LoginAttempt 资源和完整状态机。
4. 本地 API 缺少网络/CSRF 边界：已增加 loopback、Host/Origin、nonce、JSON、限流与审计要求。
5. Claude Review 型号不可执行：用户后续澄清原“3.5”为口误，最终固定使用
   `claude-opus-5`；首次 Review 前仍需完成本机登录。

Important/Suggestion 项已处理：

- 明确 Grok credential-verified 语义与错误降级。
- 删除“检测绝对只读”的承诺。
- 决定抽取共享 Codex management client 并接入 shutdown。
- snapshot 增加 checking、refreshing、stale、lastSuccessfulAt。
- 增加可注入 fake 的确定性状态矩阵。
- 增加冻结 review manifest。
- display name 改为普通受限字符串，不返回账号邮箱。
- setup instructions 改为平台列表。
- 明确 `#agent-settings` 导航和稳定 selector。

### 复核

Fable 第二轮 verdict：`APPROVED`。其确认首轮 5 个 Blocking 和全部 Important 项均已解决，
未发现新的架构阻断项，也未发现对 T3Code 核心行为的重大夸大。

第二轮非阻断建议亦已纳入最终版：

- command 与 config home 分别记录配置来源；
- Claude local/manual 拓扑由显式 deployment mode 决定；
- binary override 明确为受信任本地控制面的特权能力并增加文件/协议校验；
- Grok probe 如实说明 `session/new` metadata 的潜在持久化；
- 明确 Driver SPI 是管理面扩展点，新增可执行 Provider 仍需扩展 session/runtime mapping。
