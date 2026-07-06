# Runcell Science

Runcell Science is a local-first workspace for researchers who want to work with AI coding agents without losing context, files, or control.

It brings agent conversations, project state, generated artifacts, and follow-up work into one focused interface. Instead of jumping between terminals, chat windows, and scattered notes, you can keep the research workflow in a single place.

English | [简体中文](docs/README.zh-CN.md) | [日本語](docs/README.ja.md) | [Español](docs/README.es.md) | [Français](docs/README.fr.md) | [Deutsch](docs/README.de.md) | [Português](docs/README.pt-BR.md)

## What It Helps With

Research work often moves across code, data, papers, notebooks, and experiments. Runcell Science is designed to make that loop easier to manage:

- Start and continue AI-assisted coding sessions from a browser UI.
- Keep agent replies, tool activity, and generated work attached to the same session.
- Work with local project files instead of sending everything through a hosted-only workflow.
- Use agent help for analysis code, prototypes, notebooks, documentation, and reproducible research tasks.

## Who It Is For

Runcell Science is for researchers, research engineers, students, and technical teams who want an AI-assisted development environment that feels closer to a project workspace than a disposable chat thread.

It is especially useful when the work is iterative: exploring a dataset, building a prototype, debugging a pipeline, writing analysis code, or turning an idea into a reproducible artifact.

## Getting Started

Clone the repository and start the local development environment:

```bash
./scripts/dev.sh
```

Then open the web app at:

```text
http://127.0.0.1:27183
```

The app expects local agent CLIs such as `codex` or `claude` to be installed and signed in if you want to run agent-backed sessions.

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
yarn typecheck
yarn lint
yarn build
```

## Project Status

Runcell Science is early and evolving quickly. The current focus is a practical local workflow for agent-assisted research and development, with documentation kept intentionally lightweight and accessible for an international audience.
