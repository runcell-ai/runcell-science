# runcell-science

One-command launcher for [Runcell Science](https://github.com/runcell-ai/runcell-science) — an open, hackable AI research workspace that runs on **your existing Claude Code or Codex** (no extra API keys, no second model bill).

```bash
npx runcell-science
```

This boots the local server, opens the workspace in your browser, and prints the URL. Run it inside a project directory and the agent works there.

## Requirements

- **Node.js 20.19+ or 22.12+**
- A signed-in **Claude Code** or **Codex** CLI on your `PATH`. Runcell reuses that session. If neither is found, the workspace still opens but sessions can't start until you install one:
  - Claude Code — https://claude.com/claude-code
  - Codex — https://developers.openai.com/codex/cli

Notebook execution provisions a local Jupyter runtime on first use (via `uv` or `python3`); it isn't needed just to open the workspace.

## Usage

```
npx runcell-science [options]

  --port <n>     Port to serve on (default: 27183, or the next free port).
  --cwd <path>   Directory the agent operates in (default: current directory).
  --host <addr>  Host to bind (default: 127.0.0.1).
  --no-open      Don't open the browser automatically.
  -v, --version  Print the version.
  -h, --help     Show help.
```

Install globally instead if you prefer:

```bash
npm install -g runcell-science
runcell-science
```

## Data

Sessions, the SQLite database, and logs live under `~/.runcell-science` (override with the `RUNCELL_SCIENCE_HOME` environment variable). Your project files are never copied there — the agent edits them in place in `--cwd`.

## License

[Apache-2.0](https://github.com/runcell-ai/runcell-science/blob/main/LICENSE)
