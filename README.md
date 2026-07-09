# Runcell Science

**An open scientific workspace that runs on the Claude Code or Codex you already use.**

Runcell Science wraps the AI coding agent you already run — **Codex** or **Claude Code** — and gives it notebooks it can execute, scientific databases it can query, and interactive artifacts you can inspect, all in one focused surface. It reuses your existing agent setup (including subscription-backed access where those tools support it), so there are no new API keys or model subscriptions to manage.

Instead of treating an agent run as a disposable chat, Runcell keeps the whole research loop in one place: the prompt, tool activity, project files, generated artifacts, notebook execution, follow-up questions, and the files the agent changed. Its science layer is **23 implemented, smoke-tested MCP connectors (60 tools)** — real executable tools, not markdown placeholders.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Runtimes: Codex · Claude Code](https://img.shields.io/badge/runtimes-Codex%20%C2%B7%20Claude%20Code-6f42c1.svg)](#quick-start)
[![Desktop: Electron](https://img.shields.io/badge/desktop-Electron-2ea44f.svg)](#desktop-app)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**[Quick Start](#quick-start)** · **[Why Runcell](#why-runcell-science)** · **[Connectors](#executable-scientific-workflows)** · **[What it can do](#what-it-can-do)** · **[Roadmap](#roadmap)**

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

English | [简体中文](docs/README.zh-CN.md) | [日本語](docs/README.ja.md) | [Español](docs/README.es.md) | [Français](docs/README.fr.md) | [Deutsch](docs/README.de.md) | [Português](docs/README.pt-BR.md)

## Quick Start

You already have the one prerequisite: a signed-in **Claude Code** or **Codex** on your machine. Runcell reuses that session — no extra keys to configure, no second model bill.

```bash
npx runcell-science
```

Run it inside your project directory. It starts the local workspace, opens it in your browser, and prints the URL (**http://127.0.0.1:27183**) — no repo to clone. Prefer a global install? `npm install -g runcell-science`, then run `runcell-science`.

**Your first five minutes:**

1. Start a research session and pick your runtime — Codex or Claude Code.
2. Enable a science connector — for example **PubMed** or **ChEMBL** — from the connector panel.
3. Ask the agent to pull a few papers or compounds, then run the analysis in a **notebook** cell backed by a shared Jupyter kernel.
4. Open the generated figure in the artifact panel, inspect it, and carry the result straight into your next question.

> **Don't have Claude Code or Codex yet?** Install one first (a few minutes) and sign in, then run the command above. Runcell works with the access those tools already give you, including subscription-backed access where supported.

> **Working on Runcell itself?** Clone the repo and run the dev stack with live reload:
> ```bash
> git clone https://github.com/runcell-ai/runcell-science
> cd runcell-science
> ./scripts/dev.sh
> ```

> **Prefer a one-click app?** [Download the desktop installer](https://github.com/runcell-ai/runcell-science/releases/latest) for macOS, Windows, or Linux — no terminal required. It still drives your local Codex / Claude Code, so keep one signed in. See [Desktop App](#desktop-app).

## See It In Action

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## Why Runcell Science

Most AI coding tools are excellent at producing text and patches, but research work produces more than text. It produces notebooks, plots, molecule sketches, reports, intermediate files, diffs, and half-finished experiments that need to stay inspectable and interactive.

Runcell Science is built around that reality:

- **Bring your own agent — and your own subscription.** Runcell runs on Codex or Claude Code instead of locking you into one hosted assistant, and reuses the access you already pay for rather than asking for another API key or model plan.
- **Scientific skills that actually execute.** Not prompt packs — MCP-compatible connectors you enable per project, a Jupyter-backed notebook skill, and interactive chemistry artifacts the agent can call and you can inspect.
- **Interactive artifacts, not static attachments.** Generated work opens beside the conversation, keeps UI state, and becomes part of the next turn.
- **Open and inspectable end to end.** The workspace, server, UI components, scientific connectors, and artifact renderers are all designed to be read, extended, and adapted.
- **A workspace, not a chat box.** Sessions, prompts, model choice, artifacts, connectors, skills, and worktree diffs live in one focused surface.

## Executable Scientific Workflows

Runcell Science prioritizes executable scientific workflows over raw skill
count. Its science layer is built around tools that agents can call, notebooks
they can execute, files they can preserve, and artifacts users can inspect.

Today the bundled science connector registry includes **23 implemented
MCP-compatible connectors** with **60 declared tools**. These connectors are
project-scoped, include upstream source metadata, and are covered by smoke tests
that exercise real tool calls.

| Area | Connectors |
| --- | --- |
| Literature and trials | PubMed, bioRxiv/medRxiv, ClinicalTrials.gov, OpenAlex, Europe PMC |
| Genes, proteins, and genomes | BioMart, Ensembl, MyGene.info, EBI OLS, QuickGO, UniProt, InterPro, RCSB PDB, AlphaFold DB, UCSC Genome Browser |
| Variants, expression, and omics | ClinVar, dbSNP, GWAS Catalog, GTEx, GEO, PRIDE, ENCODE, JASPAR, RNAcentral, Cell Ontology, CELLxGENE |
| Chemistry and drug discovery | ChEMBL, PubChem, ChEBI, KEGG, ZINC, interactive Ketcher chemistry artifacts |
| Funding, regulatory, and cancer resources | NIH RePORTER, openFDA, Drugs@FDA, cBioPortal |

The notebook workflow is backed by a shared Jupyter kernel and a CLI skill that
can inspect cells, execute cells, persist outputs, and extract plot media.
Chemistry workflows include an interactive Ketcher artifact surface rather than
only text instructions for drawing molecules.

This is intentionally different from markdown-only skill definitions. Prompt
guidance is useful, but Runcell's core scientific skills are designed to bind
agent work to real APIs, project files, notebooks, interactive artifacts, and
repeatable tool outputs. The practical test is not how many skill names exist,
but whether a workflow can query a database, run code, preserve evidence, and
carry inspectable results into the next research turn.

For implementation details, see
[`packages/science-connectors`](packages/science-connectors),
[`packages/nbcli`](packages/nbcli), and the
[science connector smoke tests](packages/science-connectors/test/smoke.test.ts).

## What It Can Do

| Capability | What it gives you |
| --- | --- |
| **Agent-backed research sessions** | Start and continue Codex or Claude Code-powered sessions from a browser UI, with streamed events and persistent history. |
| **Interactive artifact panel** | Open generated files, draft artifacts, inspect outputs, and keep artifact-specific renderer state across session updates. |
| **Notebook execution skill** | Work with Jupyter-backed `.ipynb` notebooks through `notebook-analysis`: agents can inspect cells, execute persistent cells, read saved outputs, and share the same kernel state as the user-facing notebook panel. |
| **Worktree diffs** | Review what changed in the project without leaving the research conversation. |
| **Science connectors** | Enable bundled MCP-compatible connectors for PubMed, ChEMBL, BioMart, Ensembl, UniProt, AlphaFold, OpenAlex, GTEx, ZINC, CellGuide, and more. These are implemented tools, not placeholder descriptions. |
| **Skills-aware prompting** | Surface available skills in the composer so scientific workflows can be invoked more directly. |
| **Runtime choice** | Pick the runtime and model configuration you want instead of building your workflow around a single vendor UI. |

## Built For

Runcell Science is for people whose work moves between code, data, notebooks, papers, and generated outputs:

- research engineers building prototypes and analysis pipelines;
- scientists iterating on notebooks, plots, reports, and validation code;
- students and technical teams who want agent help without scattering context across terminals and chat windows;
- developers building AI-assisted scientific tools, renderers, or connectors.

## Desktop App

Runcell ships an Electron desktop shell (`@runcell-science/desktop`) that wraps the same web and server surfaces into a one-click app — no Node, terminal, or repo clone required.

**[⬇ Download the latest release](https://github.com/runcell-ai/runcell-science/releases/latest)**

| Platform | Installer |
| --- | --- |
| macOS (Apple Silicon) | `Runcell-Science-<version>-mac-arm64.dmg` |
| macOS (Intel) | `Runcell-Science-<version>-mac-x64.dmg` |
| Windows | `Runcell-Science-<version>-win-x64.exe` |
| Linux | `Runcell-Science-<version>-linux-x64.AppImage` · `…-linux-x64.deb` |

**Prerequisite:** the desktop app drives the same agent CLIs as the rest of Runcell, so keep **Codex** and/or **Claude Code** installed and signed in — the app finds them on your `PATH` automatically.

First-launch notes:

- **macOS** builds are signed and notarized — open the `.dmg` and drag the app to Applications.
- **Windows** installers aren't code-signed yet, so SmartScreen shows an "unknown publisher" prompt — click **More info → Run anyway**. (Signing is a near-term follow-up.)
- **Linux** `.AppImage` — `chmod +x Runcell-Science-*.AppImage`, then run it; or install the `.deb` with `sudo apt install ./Runcell-Science-*.deb`.

Prefer to build from source? `yarn dist:desktop` produces installers in `apps/desktop/release/`. Releases are cut by pushing a `v*` tag — see [docs/desktop-release.md](docs/desktop-release.md). Day-to-day development still runs through the web app and local server.

## Project Shape

This repository is a TypeScript monorepo:

- `apps/web` — the browser workspace.
- `apps/server` — the API server, session persistence, provider runtimes, Jupyter management, and MCP integration.
- `apps/desktop` — the Electron desktop shell for packaged end-user distribution.
- `packages/cli` — the published `runcell-science` launcher (`npx runcell-science`) that bundles the server + web app.
- `packages/ui` — shared UI components for agent sessions and research surfaces.
- `packages/science-connectors` — bundled scientific connector registry and MCP-compatible tools.
- `packages/nbcli` — notebook helper CLI used by agent workflows.

The current runtime integrations are:

- **Codex** through a JSON-RPC app-server integration.
- **Claude** through the Claude Agent SDK.

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

## Roadmap

Runcell Science is meant to become an open research workbench that teams can shape around their own models, tools, datasets, and scientific domains.

**Highest priority — lowering the barrier to first use:**

- **✅ One-command launch (npm / npx).** Shipped — `npx runcell-science` boots the workspace without cloning the repo.
- **✅ Downloadable desktop app.** Signed + notarized macOS installers and Windows/Linux builds are published to [GitHub Releases](https://github.com/runcell-ai/runcell-science/releases/latest) on every tag, so non-developers can install and run Runcell in one step. Remaining: Windows code signing and an in-app auto-update feed.

**Beyond that:**

- **More model choices** — broader support for custom providers, local or self-hosted models, OpenAI-compatible endpoints, and richer per-session model routing.
- **More scientific workflow skills** — higher-level literature review, data analysis, chemistry, biology, report writing, and reproducibility workflows built on top of the real notebook, artifact, and connector tools already in the app.
- **Richer interactive artifacts** — more renderers for scientific objects, better artifact provenance, and tighter loops where outputs can be inspected, edited, and sent back into the agent.
- **Connector ecosystem** — more first-party and community-maintained connectors for scientific databases, compute platforms, notebooks, and lab tools.
- **Better customization surface** — easier ways to add skills, artifact renderers, connector definitions, model presets, and project-specific workflows.

The long-term direction is simple: keep the agent experience open, inspectable, and adaptable, while making scientific outputs feel native instead of bolted on.

## Contributing

Issues and pull requests are welcome. Please run `yarn typecheck` and `yarn lint` before opening a PR.

## License

[Apache 2.0](LICENSE).
