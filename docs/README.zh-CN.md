# Runcell Science

**面向科研代码、notebook 和科学 artifact 的开源、模型中立 AI 工作区。**

Runcell Science 是一个开源工作区，面向研究人员和研究工程师。它让 AI coding agent 更容易被检查、定制，并适配具体的科学工作流。

我们不把一次 agent 运行当成一次性聊天。Runcell 会把 prompt、工具活动、项目文件、生成的 artifact、notebook 执行、后续问题，以及 agent 改动过的文件放在同一个研究循环里。

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

[English](../README.md) | 简体中文 | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## 演示

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## 为什么不一样

很多 AI coding 工具都很擅长生成文本和代码补丁，但科研工作不只产出文本。它还会产出 notebook、图表、分子草图、报告、中间文件、diff，以及需要继续检查和交互的半成品实验。

Runcell Science 围绕这个现实来设计：

- **开源且容易定制** — workspace、server、UI 组件、科学 connector 和 artifact renderer 都以可检查、可扩展、可适配为目标。
- **交互式 artifact，而不是静态附件** — 生成结果可以在对话旁打开，保留 UI 状态，并参与下一轮 agent 工作。
- **科学技能和科学界面** — notebook、化学 artifact、科学 connector、生成文件和自定义 renderer 都是一等工作流对象。
- **模型和 runtime 中立** — 可以使用 Codex、Claude Code，以及这些 runtime 暴露出来的模型选项，而不是被锁在单一托管 assistant UI 里。
- **复用已有订阅** — Runcell 可以接入你已经在使用的 Codex 或 Claude Code setup，包括这些工具支持的 subscription-backed access。
- **是 workspace，不只是 chat box** — session、prompt、模型选择、artifact、connector、skill 和 worktree diff 都在同一个聚焦界面里。

## 能做什么

| 能力 | 作用 |
| --- | --- |
| **Agent-backed research sessions** | 从浏览器 UI 开始并继续 Codex 或 Claude Code 驱动的 session，支持流式事件和持久历史。 |
| **交互式 artifact panel** | 打开生成文件、草拟 artifact、检查输出，并在 session 更新之间保留 renderer 状态。 |
| **Notebook 执行** | 使用 Jupyter-backed notebooks，并让 agent workflow 聚焦到具体 notebook 文件。 |
| **Worktree diff** | 不离开研究对话就能检查项目里发生了哪些改动。 |
| **Science connectors** | 启用内置 MCP-style connectors，包括 PubMed、ChEMBL、BioMart、Ensembl、UniProt、AlphaFold、OpenAlex、GTEx、ZINC、CellGuide 等。 |
| **Skills-aware prompting** | 在 composer 里展示可用 skills，让科学工作流更容易被调用。 |
| **Runtime choice** | 选择你想用的 runtime 和模型配置，而不是围绕单一厂商 UI 组织整个工作流。 |

## 适合谁

Runcell Science 面向那些工作经常跨越代码、数据、notebook、论文和生成结果的人：

- 构建原型和分析 pipeline 的 research engineer；
- 反复迭代 notebook、图表、报告和验证代码的科研人员；
- 不想把上下文散落在终端和聊天窗口里的学生和技术团队；
- 构建 AI-assisted scientific tools、renderer 或 connector 的开发者。

## 项目结构

这个仓库是一个 TypeScript monorepo：

- `apps/web` — 浏览器 workspace。
- `apps/server` — API server、session 持久化、provider runtime、Jupyter 管理和 MCP 集成。
- `apps/desktop` — 用于终端用户分发的 Electron 桌面壳。
- `packages/ui` — agent session 和研究界面的共享 UI 组件。
- `packages/science-connectors` — 内置科学 connector registry 和 MCP-compatible tools。
- `packages/nbcli` — agent workflow 使用的 notebook helper CLI。

当前 runtime 集成：

- **Codex** — 通过 JSON-RPC app-server integration。
- **Claude** — 通过 Claude Agent SDK。

## 快速开始

克隆仓库后启动开发环境：

```bash
./scripts/dev.sh
```

然后打开 Web 应用：

```text
http://127.0.0.1:27183
```

Agent-backed sessions 需要对应的 Codex 或 Claude Code runtime 已安装并登录。

Runcell Science 现在也支持 Electron 桌面应用，适合希望直接安装应用的终端用户。日常开发和调试仍然走 Web app 和本地 server；桌面版复用同一套 Web 和 server 能力进行分发。

## 手动启动

如果你想自己启动服务：

```bash
yarn install
yarn dev
```

常用命令：

```bash
yarn dev:web
yarn dev:server
yarn dev:desktop
yarn typecheck
yarn lint
yarn build
yarn build:desktop
yarn dist:desktop
```

## 项目状态

Runcell Science 仍处在早期阶段，并且会快速迭代。当前方向是一个实用、可 hack 的 AI-assisted research workspace，重点放在 scientific skills、interactive artifacts 和 model-neutral agent sessions。

短期目标不是替代完整实验室平台，而是让日常研究循环更紧凑：提出问题、运行、检查、修改，并把结果文件和上下文放在一起。

## 愿景和路线图

Runcell Science 希望成为一个开放的研究工作台，让团队可以围绕自己的模型、工具、数据集和科学领域进行塑形。

我们特别关注这些方向：

- **更多模型选择** — 支持更多自定义 provider、本地或自托管模型、OpenAI-compatible endpoints，以及更丰富的 per-session model routing。
- **更多 scientific skills** — 为文献综述、数据分析、化学、生物、计算 notebook、报告写作和可复现性检查提供更深的 workflow packs。
- **更丰富的 interactive artifacts** — 更多科学对象 renderer、更好的 artifact provenance，以及能检查、编辑并送回 agent 的更紧密循环。
- **桌面版分发** — Electron 桌面应用已经支持；后续重点是 release hardening、签名、公证和更新/分发流程。
- **Connector ecosystem** — 更多 first-party 和社区维护的科学数据库、计算平台、notebook 和实验工具 connector。
- **更好的定制化入口** — 更容易添加 skills、artifact renderers、connector definitions、model presets 和项目专属 workflows。

长期方向很简单：保持 agent experience 开放、可检查、可适配，同时让科学输出成为原生体验，而不是后贴上去的附件。
