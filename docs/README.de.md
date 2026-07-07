# Runcell Science

**Ein offener, modellneutraler AI Workspace für Forschungscode, Notebooks und wissenschaftliche Artefakte.**

Runcell Science ist ein Open-Source-Workspace für Forschende und Research Engineers, die AI coding agents besser prüfen, anpassen und auf wissenschaftliche Arbeit zuschneiden möchten.

Statt einen Agent-Lauf wie einen wegwerfbaren Chat zu behandeln, hält Runcell den Forschungszyklus an einem Ort: Prompt, Tool-Aktivität, Projektdateien, erzeugte Artefakte, Notebook-Ausführung, Folgefragen und die Dateien, die der Agent geändert hat.

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | Deutsch | [Português](README.pt-BR.md)

## Demo

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## Was Anders Ist

Viele AI-coding Tools sind sehr gut darin, Text und Patches zu erzeugen. Forschungsarbeit erzeugt aber mehr als Text: Notebooks, Plots, Molekülskizzen, Berichte, Zwischendateien, Diffs und unfertige Experimente, die weiterhin prüfbar und interaktiv bleiben müssen.

Runcell Science ist für diese Realität gebaut:

- **Offen und anpassbar** — Workspace, Server, UI-Komponenten, wissenschaftliche Connectors und Artefakt-Renderer sind darauf ausgelegt, geprüft, erweitert und angepasst zu werden.
- **Interaktive Artefakte statt statischer Anhänge** — erzeugte Arbeit kann neben der Unterhaltung geöffnet werden, UI-Zustand behalten und Teil des nächsten Agent-Schritts werden.
- **Wissenschaftliche Skills und Oberflächen** — Notebooks, Chemie-Artefakte, wissenschaftliche Connectors, erzeugte Dateien und eigene Renderer sind zentrale Bestandteile des Workflows.
- **Modell- und runtime-neutral** — nutze Codex, Claude Code und die Modelloptionen, die diese Runtimes bereitstellen, statt in einer einzelnen gehosteten Assistant-UI festzustecken.
- **Bestehende Subscriptions nutzen** — Runcell kann mit deinem vorhandenen Codex- oder Claude-Code-Setup arbeiten, einschließlich subscription-backed access, sofern diese Tools ihn unterstützen.
- **Ein Workspace, nicht nur eine Chatbox** — Sessions, Prompts, Modellauswahl, Artefakte, Connectors, Skills und Worktree-Diffs leben in einer fokussierten Oberfläche.

## Was Es Kann

| Fähigkeit | Nutzen |
| --- | --- |
| **Agent-backed research sessions** | Codex- oder Claude-Code-gestützte Sessions über eine Web-UI starten und fortführen, mit Streaming-Events und persistenter History. |
| **Interaktives Artefakt-Panel** | Erzeugte Dateien öffnen, Artefakte entwerfen, Outputs prüfen und renderer-spezifischen Zustand über Session-Updates hinweg behalten. |
| **Notebook-Ausführung** | Mit Jupyter-backed Notebooks arbeiten und Agent-Workflows auf bestimmte Notebook-Dateien fokussieren. |
| **Worktree-Diffs** | Änderungen im Projekt prüfen, ohne die Forschungsunterhaltung zu verlassen. |
| **Science Connectors** | Gebündelte MCP-style Connectors für PubMed, ChEMBL, BioMart, Ensembl, UniProt, AlphaFold, OpenAlex, GTEx, ZINC, CellGuide und mehr aktivieren. |
| **Skills-aware prompting** | Verfügbare Skills im Composer anzeigen, damit wissenschaftliche Workflows direkter aufgerufen werden können. |
| **Runtime choice** | Runtime und Modellkonfiguration selbst wählen, statt den Workflow an eine einzelne Anbieter-UI anzupassen. |

## Für Wen

Runcell Science richtet sich an Menschen, deren Arbeit zwischen Code, Daten, Notebooks, Papers und erzeugten Ergebnissen wechselt:

- Research Engineers, die Prototypen und Analyse-Pipelines bauen;
- Wissenschaftlerinnen und Wissenschaftler, die an Notebooks, Plots, Reports und Validierungscode iterieren;
- Studierende und technische Teams, die Kontext nicht über Terminals und Chatfenster verstreuen möchten;
- Entwicklerinnen und Entwickler, die AI-assisted scientific tools, Renderer oder Connectors bauen.

## Projektstruktur

Dieses Repository ist ein TypeScript-Monorepo:

- `apps/web` — der Browser-Workspace.
- `apps/server` — API-Server, Session-Persistenz, Provider-Runtimes, Jupyter-Management und MCP-Integration.
- `apps/desktop` — die Electron-Desktop-Shell für die paketierte Distribution an Endnutzer.
- `packages/ui` — geteilte UI-Komponenten für Agent-Sessions und Forschungsoberflächen.
- `packages/science-connectors` — gebündelte wissenschaftliche Connector Registry und MCP-compatible tools.
- `packages/nbcli` — Notebook helper CLI für Agent-Workflows.

Aktuelle Runtime-Integrationen:

- **Codex** über eine JSON-RPC app-server integration.
- **Claude** über das Claude Agent SDK.

## Erste Schritte

Repository klonen und die Entwicklungsumgebung starten:

```bash
./scripts/dev.sh
```

Danach die Web-App öffnen:

```text
http://127.0.0.1:27183
```

Agent-backed Sessions erwarten, dass die passende Codex- oder Claude-Code-Runtime installiert und angemeldet ist.

Runcell Science unterstützt jetzt auch eine Electron-Desktop-App für Endnutzer, die eine installierbare Anwendung bevorzugen. Die tägliche Entwicklung läuft weiterhin über Web-App und lokalen Server; die Desktop-App verpackt dieselben Web- und Server-Oberflächen für die Distribution.

## Manuelles Setup

Wenn du die Dienste selbst starten möchtest:

```bash
yarn install
yarn dev
```

Nützliche Befehle:

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

## Projektstatus

Runcell Science ist noch früh und entwickelt sich schnell weiter. Die Richtung ist ein praktischer, hackbarer Workspace für AI-gestützte Forschung und Entwicklung, mit Fokus auf scientific skills, interactive artifacts und model-neutral agent sessions.

Das kurzfristige Ziel ist nicht, eine vollständige Laborplattform zu ersetzen. Es geht darum, den täglichen Forschungszyklus enger zu machen: fragen, ausführen, prüfen, überarbeiten und die resultierenden Dateien mit dem Kontext zusammenhalten.

## Vision Und Roadmap

Runcell Science soll ein offener Research Workbench werden, den Teams um ihre eigenen Modelle, Tools, Datensätze und wissenschaftlichen Domänen herum formen können.

Bereiche, die uns besonders interessieren:

- **Mehr Modelloptionen** — breitere Unterstützung für custom providers, lokale oder self-hosted models, OpenAI-compatible endpoints und reichhaltigeres per-session model routing.
- **Mehr scientific skills** — tiefere Workflow-Packs für Literaturrecherche, Datenanalyse, Chemie, Biologie, computational notebooks, Berichtserstellung und Reproduzierbarkeitschecks.
- **Reichere interactive artifacts** — mehr Renderer für wissenschaftliche Objekte, bessere artifact provenance und engere Schleifen, in denen Outputs geprüft, editiert und an den Agent zurückgegeben werden können.
- **Desktop-App-Distribution** — die Electron-App wird jetzt unterstützt; nächste Schritte sind Release-Härtung, Signierung, Notarisierung und Update-/Distributionsfluss.
- **Connector ecosystem** — mehr first-party und community-maintained connectors für wissenschaftliche Datenbanken, Compute-Plattformen, Notebooks und Labortools.
- **Bessere Anpassungsoberfläche** — Skills, artifact renderers, connector definitions, model presets und projektspezifische Workflows einfacher hinzufügen.

Die langfristige Richtung ist einfach: Die Agent-Erfahrung offen, prüfbar und anpassbar halten, während wissenschaftliche Outputs sich nativ anfühlen statt nachträglich angeklebt.
