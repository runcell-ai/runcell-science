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
- **真正可执行的科学 skills** — 核心科学能力不是 prompt pack 摆设；Runcell 包含可按项目启用的 MCP-compatible connectors、Jupyter-backed notebook skill 和可交互的 chemistry artifacts，agent 可以调用，用户也可以检查。
- **模型和 runtime 中立** — 可以使用 Codex、Claude Code，以及这些 runtime 暴露出来的模型选项，而不是被锁在单一托管 assistant UI 里。
- **复用已有订阅** — Runcell 可以接入你已经在使用的 Codex 或 Claude Code setup，包括这些工具支持的 subscription-backed access。
- **是 workspace，不只是 chat box** — session、prompt、模型选择、artifact、connector、skill 和 worktree diff 都在同一个聚焦界面里。

## 可执行的科学工作流

Runcell Science 优先关注可执行的科学工作流，而不是单纯追求 skill 数量。它的科学能力层围绕 agent 能调用的工具、能执行的 notebook、能保存的文件，以及用户可以检查的 artifact 来设计。

目前内置 science connector registry 包含 **23 个 implemented MCP-compatible connectors** 和 **60 个 declared tools**。这些 connectors 支持 project-scoped enablement，包含 upstream source metadata，并且有 smoke tests 覆盖真实 tool calls。

| 领域 | Connectors |
| --- | --- |
| 文献和临床试验 | PubMed、bioRxiv/medRxiv、ClinicalTrials.gov、OpenAlex、Europe PMC |
| 基因、蛋白和基因组 | BioMart、Ensembl、MyGene.info、EBI OLS、QuickGO、UniProt、InterPro、RCSB PDB、AlphaFold DB、UCSC Genome Browser |
| 变异、表达和组学 | ClinVar、dbSNP、GWAS Catalog、GTEx、GEO、PRIDE、ENCODE、JASPAR、RNAcentral、Cell Ontology、CELLxGENE |
| 化学和药物发现 | ChEMBL、PubChem、ChEBI、KEGG、ZINC、交互式 Ketcher chemistry artifacts |
| 资助、监管和癌症资源 | NIH RePORTER、openFDA、Drugs@FDA、cBioPortal |

Notebook workflow 由共享 Jupyter kernel 和 CLI skill 支撑，agent 可以检查 cells、执行 cells、持久化 outputs，并提取 plot media。化学 workflow 也包含交互式 Ketcher artifact surface，而不是只给一段画分子的文字说明。

这刻意区别于 markdown-only skill definitions。Prompt guidance 有价值，但 Runcell 的核心科学 skills 被设计成把 agent 工作绑定到真实 API、项目文件、notebook、interactive artifacts 和可复现 tool outputs。真正重要的测试不是有多少个 skill 名字，而是一个 workflow 能不能查询数据库、运行代码、保存证据，并把可检查的结果带入下一轮研究。

实现细节可以查看 [`packages/science-connectors`](../packages/science-connectors)、[`packages/nbcli`](../packages/nbcli) 和 [science connector smoke tests](../packages/science-connectors/test/smoke.test.ts)。

## 能做什么

| 能力 | 作用 |
| --- | --- |
| **Agent-backed research sessions** | 从浏览器 UI 开始并继续 Codex 或 Claude Code 驱动的 session，支持流式事件和持久历史。 |
| **交互式 artifact panel** | 打开生成文件、草拟 artifact、检查输出，并在 session 更新之间保留 renderer 状态。 |
| **Notebook 执行 skill** | 使用 Jupyter-backed `.ipynb` notebooks 和 `notebook-analysis`；agent 可以检查 cells、执行持久化 cells、读取保存后的 outputs，并和用户侧 notebook panel 共享同一个 kernel state。 |
| **Worktree diff** | 不离开研究对话就能检查项目里发生了哪些改动。 |
| **Science connectors** | 启用内置 MCP-compatible connectors，包括 PubMed、ChEMBL、BioMart、Ensembl、UniProt、AlphaFold、OpenAlex、GTEx、ZINC、CellGuide 等。这些是 implemented tools，不是 placeholder descriptions。 |
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

Runcell Science 提供 Electron 桌面应用，终端用户无需 Node、终端或克隆仓库即可一键安装。

**[⬇ 下载最新版本](https://github.com/runcell-ai/runcell-science/releases/latest)** — 提供 macOS（Apple Silicon / Intel `.dmg`）、Windows（`.exe`）、Linux（`.AppImage` / `.deb`）。

- 桌面版复用同一套 agent CLI，请保持 **Codex** 和/或 **Claude Code** 已安装并登录，应用会自动从 `PATH` 找到它们。
- macOS 已签名并公证，打开 `.dmg` 拖入「应用程序」即可；Windows 暂未签名，SmartScreen 会提示「未知发布者」，点击 **更多信息 → 仍要运行**；Linux `.AppImage` 需先 `chmod +x` 再运行。

日常开发和调试仍然走 Web app 和本地 server。从源码打包可运行 `yarn dist:desktop`，发布流程见 [docs/desktop-release.md](desktop-release.md)。

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
- **更多 scientific workflow skills** — 在现有真实 notebook、artifact 和 connector tools 之上，为文献综述、数据分析、化学、生物、报告写作和可复现性检查提供更深的 workflow packs。
- **更丰富的 interactive artifacts** — 更多科学对象 renderer、更好的 artifact provenance，以及能检查、编辑并送回 agent 的更紧密循环。
- **✅ 桌面版分发** — 已签名并公证的 macOS 安装包以及 Windows/Linux 构建会在每次打 tag 时发布到 [GitHub Releases](https://github.com/runcell-ai/runcell-science/releases/latest)。后续：Windows 代码签名与应用内自动更新。
- **Connector ecosystem** — 更多 first-party 和社区维护的科学数据库、计算平台、notebook 和实验工具 connector。
- **更好的定制化入口** — 更容易添加 skills、artifact renderers、connector definitions、model presets 和项目专属 workflows。

长期方向很简单：保持 agent experience 开放、可检查、可适配，同时让科学输出成为原生体验，而不是后贴上去的附件。
