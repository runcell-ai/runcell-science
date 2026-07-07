# Runcell Science

**An open, model-neutral AI workspace for research code, notebooks, and scientific artifacts.**

Runcell Science is an open-source workspace for researchers and research engineers who want AI coding agents that are easier to inspect, customize, and adapt to scientific work.

Instead of treating an agent run as a disposable chat, Runcell keeps the research loop in one place: the prompt, tool activity, project files, generated artifacts, notebook execution, follow-up questions, and the files the agent changed.

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

English | [简体中文](docs/README.zh-CN.md) | [日本語](docs/README.ja.md) | [Español](docs/README.es.md) | [Français](docs/README.fr.md) | [Deutsch](docs/README.de.md) | [Português](docs/README.pt-BR.md)

## See It In Action

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## Why It Is Different

Most AI coding tools are excellent at producing text and patches, but research work produces more than text. It produces notebooks, plots, molecule sketches, reports, intermediate files, diffs, and half-finished experiments that need to stay inspectable and interactive.

Runcell Science is built around that reality:

- **Open and customizable** — the workspace, server, UI components, scientific connectors, and artifact renderers are designed to be inspected, extended, and adapted.
- **Interactive artifacts, not static attachments** — generated work can open beside the conversation, keep UI state, and become part of the next turn.
- **Scientific skills and surfaces** — notebooks, chemistry artifacts, scientific connectors, generated files, and custom renderers are first-class parts of the workflow.
- **Model and runtime neutral** — use Codex, Claude Code, and the model options exposed by those runtimes instead of being locked into one hosted assistant.
- **Bring your existing subscription** — Runcell can work with the Codex or Claude Code setup you already use, including subscription-backed access where those tools support it.
- **A workspace, not just a chat box** — sessions, prompts, model choice, artifacts, connectors, skills, and worktree diffs live in one focused surface.

## What It Can Do

| Capability | What it gives you |
| --- | --- |
| **Agent-backed research sessions** | Start and continue Codex or Claude Code-powered sessions from a browser UI, with streamed events and persistent history. |
| **Interactive artifact panel** | Open generated files, draft artifacts, inspect outputs, and keep artifact-specific renderer state across session updates. |
| **Notebook execution** | Work with Jupyter-backed notebooks and let agent workflows focus specific notebook files when needed. |
| **Worktree diffs** | Review what changed in the project without leaving the research conversation. |
| **Science connectors** | Enable bundled MCP-style connectors for PubMed, ChEMBL, BioMart, Ensembl, UniProt, AlphaFold, OpenAlex, GTEx, ZINC, CellGuide, and more. |
| **Skills-aware prompting** | Surface available skills in the composer so scientific workflows can be invoked more directly. |
| **Runtime choice** | Pick the runtime and model configuration you want instead of building your workflow around a single vendor UI. |

## Built For

Runcell Science is for people whose work moves between code, data, notebooks, papers, and generated outputs:

- research engineers building prototypes and analysis pipelines;
- scientists iterating on notebooks, plots, reports, and validation code;
- students and technical teams who want agent help without scattering context across terminals and chat windows;
- developers building AI-assisted scientific tools, renderers, or connectors.

## Project Shape

This repository is a TypeScript monorepo:

- `apps/web` — the browser workspace.
- `apps/server` — the API server, session persistence, provider runtimes, Jupyter management, and MCP integration.
- `apps/desktop` — the Electron desktop shell for packaged end-user distribution.
- `packages/ui` — shared UI components for agent sessions and research surfaces.
- `packages/science-connectors` — bundled scientific connector registry and MCP-compatible tools.
- `packages/nbcli` — notebook helper CLI used by agent workflows.

The current runtime integrations are:

- **Codex** through a JSON-RPC app-server integration.
- **Claude** through the Claude Agent SDK.

## Getting Started

Clone the repository and start the development environment:

```bash
./scripts/dev.sh
```

Then open the web app:

```text
http://127.0.0.1:27183
```

Agent-backed sessions expect the corresponding Codex or Claude Code runtime to be installed and signed in.

Runcell Science also supports an Electron desktop app for end users who prefer a packaged application. Day-to-day development still runs through the web app and local server; the desktop app wraps those same web and server surfaces for distribution.

## Manual Setup

If you prefer to start services yourself:

```bash
yarn install
yarn dev
```

Useful commands:

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

## Status

Runcell Science is early and moving quickly. The core direction is a practical, hackable workspace for AI-assisted research and development, with a special focus on scientific skills, interactive artifacts, and model-neutral agent sessions.

The near-term goal is not to replace a full lab platform. It is to make the daily research loop feel tighter: ask, run, inspect, revise, and keep the resulting files and context together.

## Vision And Roadmap

Runcell Science is meant to become an open research workbench that teams can shape around their own models, tools, datasets, and scientific domains.

Areas we are especially interested in:

- **More model choices** — broader support for custom providers, local or self-hosted models, OpenAI-compatible endpoints, and richer per-session model routing.
- **More scientific skills** — deeper workflow packs for literature review, data analysis, chemistry, biology, computational notebooks, report writing, and reproducibility checks.
- **Richer interactive artifacts** — more renderers for scientific objects, better artifact provenance, and tighter loops where outputs can be inspected, edited, and sent back into the agent.
- **Desktop app distribution** — the Electron app is now supported; next steps are release hardening, signing, notarization, and update/distribution flow.
- **Connector ecosystem** — more first-party and community-maintained connectors for scientific databases, compute platforms, notebooks, and lab tools.
- **Better customization surface** — easier ways to add skills, artifact renderers, connector definitions, model presets, and project-specific workflows.

The long-term direction is simple: keep the agent experience open, inspectable, and adaptable, while making scientific outputs feel native instead of bolted on.
