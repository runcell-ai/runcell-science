# Runcell Science

Runcell Science 是一个面向科研工作者的本地优先工作区，帮助你使用 AI coding agent，同时保留项目上下文、文件和控制权。

它把 agent 对话、项目状态、生成内容和后续任务放在同一个专注界面里。你不需要在终端、聊天窗口和零散笔记之间来回切换，可以把研究过程集中管理。

[English](../README.md) | 简体中文 | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## 它解决什么问题

科研工作经常横跨代码、数据、论文、notebook 和实验。Runcell Science 的目标是让这个循环更容易管理：

- 从浏览器界面开始并继续 AI 辅助的编码会话。
- 将 agent 回复、工具活动和生成结果保留在同一个 session 中。
- 围绕本地项目文件工作，而不是完全依赖托管式聊天流程。
- 用 agent 协助分析代码、原型、notebook、文档和可复现实验任务。

## 适合谁

Runcell Science 适合研究人员、研究工程师、学生和技术团队。它面向那些希望 AI 辅助开发环境更像项目工作区，而不是一次性聊天线程的人。

当工作需要反复迭代时，它会尤其有用：探索数据集、搭建原型、调试 pipeline、编写分析代码，或把一个想法变成可复现的产物。

## 快速开始

克隆仓库后，启动本地开发环境：

```bash
./scripts/dev.sh
```

然后打开 Web 应用：

```text
http://127.0.0.1:27183
```

如果你想运行由 agent 支持的 session，需要先在本机安装并登录 `codex` 或 `claude` 等 CLI。

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
yarn typecheck
yarn lint
yarn build
```

## 项目状态

Runcell Science 仍处在早期阶段，并且会快速迭代。当前重点是为 AI 辅助研究和开发提供实用的本地工作流，同时让文档保持轻量、清晰，并面向国际用户。
