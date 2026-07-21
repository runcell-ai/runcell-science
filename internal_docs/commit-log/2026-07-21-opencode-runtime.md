# OpenCode Runtime：参考产品调研、方案取舍与完整验收

日期：2026-07-21。对应代码：与本文同一提交（`feat(runtime): add OpenCode provider`）。

## 目标与阶段划分

本次工作先研究 T3 Code 如何接入 OpenCode，再为 open-science 设计、实现并验收等价能力。评估后将它定义为一个完整实施阶段：只有 server lifecycle、SDK/SSE runtime、持久化恢复、模型发现、审批/问题 UI 和 provider wiring 同时落地，才形成可独立使用和验收的 provider；拆成多个中间提交会留下不可工作的半成品。

阶段交付标准是：

1. 能托管本机 OpenCode，也能连接显式配置的 external server；
2. 复用 OpenCode 自己的 provider/model 与认证配置，不重写 agent loop；
3. 首轮、续轮、进程重建后的 resume、interrupt、审批和提问都能投影到现有 session 模型；
4. 默认权限不自动放行工具，managed server 必须有 loopback 鉴权；
5. 动态发现模型，并在 OpenCode 不可用时保持现有 provider 可用；
6. 通过真实 OpenCode CLI/模型验收、独立代码评审和独立验收。

## 外部调研结论

### 固定研究版本

T3 Code 源码以 commit `c0bb2373450231e3931937d2f703e35ce906ed85`（2026-07-20）为基准，避免快速变化的 `main` 让结论漂移。重点入口：

- `OpenCodeDriver.ts`：启动/连接方式与 driver 生命周期；
- `opencodeRuntime.ts`：managed server、external URL、鉴权和 SDK client；
- `OpenCodeAdapter.ts`：SDK event 到产品事件的转换；
- `OpenCodeProvider.ts`：模型、session 与 provider 编排；
- PR #1758、#2218、#3617：初始接入、进程生命周期与 resume 修复的演进证据。

上游 OpenCode 以 `v1.18.4`（2026-07-20）为实现和真实验收版本。官方资料入口：

- <https://opencode.ai/docs/server/>：`opencode serve`、HTTP API、SSE 与 Basic Auth；
- <https://opencode.ai/docs/sdk/>：`@opencode-ai/sdk` client；
- <https://opencode.ai/docs/acp/>：ACP 的 stdio/IDE host 定位；
- <https://github.com/anomalyco/opencode/releases/tag/v1.18.4>：固定 release；
- <https://github.com/anomalyco/opencode/blob/v1.18.4/packages/sdk/js/src/v2/client.ts> 与 `gen/sdk.gen.ts`：当前 v2 client 和生成 API 形状。

### T3 Code 实际怎样接入

核心结论是：T3 Code 没有调用模型 completion API，也没有用 ACP 承载桌面产品 runtime。它启动 `opencode serve`，通过 `@opencode-ai/sdk/v2` 调用 HTTP/OpenAPI，并订阅 `event.subscribe` 的 SSE 流。

其关键语义包括：

- managed 模式由 host 启动本机 server；external 模式接受 URL/password；
- model 是 `provider/model`，来自 OpenCode provider inventory；
- OpenCode session ID 是 opaque resume anchor；
- cwd 不匹配时 fork，而不是错误复用另一个工作目录的 session；
- text、tool、diff、permission、question、idle/error 通过事件流投影；
- child process、SSE subscription 与产品 session 使用同一个受控生命周期；
- 后续修复专门处理过 session resume 和进程退出竞态，说明 happy path 之外的 ownership 才是接入难点。

ACP 没有被选为本项目桌面/web runtime 的主通道：它更适合 IDE 通过 stdio NDJSON 托管 agent，而 OpenCode 官方 server/SDK 已直接提供当前产品需要的 HTTP、动态 provider/model、session API 与 SSE。这里迁移的是协议和生命周期经验，不复制 T3 Code 的 Effect/driver 抽象层级。

## 本项目方案

### 1. Managed sidecar + SDK v2

每个活跃产品 session 持有一个 managed `opencode serve` sidecar，监听动态探测到的 `127.0.0.1` 空闲端口。host 为每个 sidecar 生成随机 password，并只通过 Basic Auth SDK client 访问；启动环境显式隔离 `OPENCODE_CONFIG_CONTENT`，退出时先终止进程组，再在超时后强制清理。

SDK 固定为精确版本 `@opencode-ai/sdk@1.18.4`。兼容门槛接受同一 major 且不低于 1.18.4 的 server，拒绝旧版本和新 major，避免生成 client 与 server API 静默漂移。

### 2. External server 的安全与能力边界

external URL 拒绝 userinfo、query 和 fragment；远程地址必须使用 HTTPS 并配置 password，只有 loopback 允许明文 HTTP 或无 password。

OpenCode 的 dynamic MCP 配置以 directory 为作用域，不是产品 session 作用域。因此 external server 不注入 bundled connectors，避免两个同 cwd session 互相覆盖工具配置。API 返回 `unsupportedSessionProviders: ["opencode"]`，session connector PATCH 返回明确 409，UI 隐藏开关并说明 connector 由 external server 自己管理。managed sidecar 因为由单 session 独占，仍安全支持 bundled connectors。

### 3. Session、resume 与 cwd

首轮创建 OpenCode session，并将其 ID 同时保存为 `providerSessionId`、`providerThreadId` 和版本化 resume cursor。runtime 丢失后，续轮先 `session.get`；只有结构化 404 才新建 session，其他错误直接暴露。若上游 session cwd 与当前项目不同，则 `session.fork` 后绑定新 ID；路径比较使用 realpath，兼容 symlink。

数据库 migration 重建带 provider CHECK 的 sessions、events 和 checkpoints 表，将 `opencode` 加入约束，并保留原数据、索引和外键关系。

### 4. 事件投影与交互

SSE runtime 将 assistant text、tool lifecycle、diff、retry、permission、question、idle 和 error 映射到现有 provider-neutral session service：

- cumulative text 与 delta text 去重合并；
- tool 类型映射到现有 timeline item；
- diff 进入 turn diff/checkpoint；
- permission 在默认模式为 ask，只有 `full_access` 才 allow；
- legacy/v2 question 都进入 pending request；
- UI 支持多问题、单选、多选和 custom answer，并按 OpenCode 所需的 `string[][]` 回传；
- idle 完成 turn，error 失败 turn，未激活首轮的异步失败会删除隐藏 pending session。

### 5. Interrupt 状态机

interrupt 先把 active turn 移入 `interruptingTurnId`，防止同时到达的 idle/error 抢先把数据库轮次结算成 completed/failed。abort 成功后直接退休 sidecar；下一轮以同一 upstream session ID 在新 sidecar 上恢复，从而隔离迟到事件。

abort 请求失败时，runtime 恢复原 active turn。等待 abort 期间到达的非 terminal 事件按原顺序缓存，恢复后先回放 text/tool/diff/request，再结算 deferred idle/error。这一处理来自终审发现的 P2：只延迟 terminal 而不回放尾部 text 会让极端竞态下的 transcript 不完整。

### 6. 动态模型与产品接线

模型服务使用 OpenCode `provider.list`，只暴露 connected、非 deprecated model，slug 保留嵌套 model ID。探测拥有共享 15 秒 deadline、并发 in-flight 复用和 5 分钟缓存；失败只产生 warning，不阻断其他 provider。

contracts、runtime registry、session routes、skills 降级、模型选择器、storage migration、timeline pending question、README、`.env.example` 和 `scripts/dev.sh` 同步加入 OpenCode。

## 独立评审如何改变实现

独立 sub-agent 共进行了多轮只读 review；Claude Code 也按仓库规定运行 `claude -p --model sonnet "/code-review medium"`，该命令没有返回额外评审文本。

必须修复的 P1 包括：

1. interrupt 与 SSE terminal 的竞态可能错误结算或卡住 turn；
2. UI 最初只能展示 permission，不能真正回答 OpenCode question；
3. abort 失败时已到达的 terminal outcome 会被丢弃；
4. external server 的 directory-scoped MCP 不能冒充 session 隔离。

对应修复是明确 interrupt 状态机、完整 question UI、deferred terminal 回放，以及 external connector capability 的 server/API/UI 三层强制边界。终审 P0/P1 均为零。

终审另报一个 P2：abort 失败的极端竞态仍可能遗漏等待窗口中的尾部 assistant text。由于它影响 transcript 完整性，本次没有接受该风险，而是加入有序事件缓存/回放和真实回归断言。另一个 P2 是 capability/失败分支测试不足；external capability 已由独立 Fastify 验收覆盖，abort 失败分支已进入 gated real integration test。

## 测试与验收证据

最终验证结果：

- `yarn typecheck`：通过；
- `yarn lint`：通过，仅保留 `artifacts-panel.tsx` 一个既有 hooks warning；
- 服务端常规测试：95 项，93 通过、0 失败、2 个条件跳过；
- Web 测试：16 项，15 通过、0 失败、1 个既有 Jupyter 条件跳过；
- 真实 OpenCode gated 测试：95 项，94 通过、0 失败、1 个既有 Jupyter 环境跳过；
- `yarn build`：通过，只有既有 Jupyter direct-eval 与大 chunk warning；
- `bash -n scripts/dev.sh` 与 `git diff --check`：通过。

独立 acceptance session 使用真实 OpenCode 1.18.4 和真实可用 model 验证：

- managed sidecar 启动，未鉴权 health 返回 401；
- provider/model 动态发现与非空 assistant 输出；
- 首轮 completed/ready，provider session ID 持久化；
- runtime reset 后续轮 resume，upstream ID 不变；
- 正常 interrupt 最终为 interrupted；
- 模拟 abort transport failure、等 terminal 已缓存后抛错，恢复后 turn completed 且 assistant 尾部文本存在；
- external 配置的 bundled connectors API 返回 `unsupportedSessionProviders: ["opencode"]`；
- 测试完成和清理窗口后不存在残留 `opencode serve` 进程。

`packages/nbcli` 的单独测试有一个既有环境失败：测试固定依赖的 `/tmp/open-science-jupyter-spike-venv/bin/python` 不存在。该失败与本次 provider 代码无关，服务端和 Web 中相应集成测试均按既有规则跳过。

## 已知边界与未来重验点

- OpenCode permission 是 agent 工具审批，不是操作系统 sandbox；`full_access` 应保持显式用户选择。
- external server 的 MCP/connector 完全由该 server 管理；若未来 OpenCode 提供真正 session-scoped MCP API，可重新开放产品内开关。
- managed sidecar 仍会复用用户本机 OpenCode provider/auth 配置；host 不读取或复制 provider token。
- SDK/server 升级必须先核对 session create/prompt model 形状、SSE event union、permission/question legacy/v2 兼容和 abort 行为，再提高最低版本。
- 真模型测试通过 `OPENCODE_TEST_BINARY` 显式开启，日常无 CLI/凭据环境不会误触发网络调用。

这次最可迁移的结论不是某个 SDK 调用，而是三个 ownership 规则：host 拥有 sidecar/SSE 生命周期，OpenCode 拥有 agent loop/provider auth，数据库中的 opaque upstream session ID 是二者之间唯一的恢复锚点。
