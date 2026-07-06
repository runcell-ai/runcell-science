# Open Science

Open Science ist ein local-first Workspace für Forschende, die mit AI coding agents arbeiten möchten, ohne Kontext, Dateien oder Kontrolle über ihr Projekt zu verlieren.

Es bündelt Agent-Unterhaltungen, Projektstatus, erzeugte Artefakte und Folgearbeit in einer fokussierten Oberfläche. Statt zwischen Terminal, Chatfenstern und verstreuten Notizen zu wechseln, bleibt der Forschungsworkflow an einem Ort.

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | Deutsch | [Português](README.pt-BR.md)

## Welches Problem Es Löst

Forschungsarbeit bewegt sich häufig zwischen Code, Daten, Papers, Notebooks und Experimenten. Open Science soll diesen Kreislauf leichter steuerbar machen:

- AI-gestützte Coding Sessions über eine Weboberfläche starten und fortführen.
- Agent-Antworten, Tool-Aktivität und erzeugte Ergebnisse in derselben Session behalten.
- Mit lokalen Projektdateien arbeiten, statt nur auf einen gehosteten Chat-Workflow angewiesen zu sein.
- Agent-Unterstützung für Analysecode, Prototypen, Notebooks, Dokumentation und reproduzierbare Forschung nutzen.

## Für Wen

Open Science richtet sich an Forschende, Research Engineers, Studierende und technische Teams, die eine AI-gestützte Entwicklungsumgebung wollen, die sich eher wie ein Projekt-Workspace anfühlt als wie ein wegwerfbarer Chatverlauf.

Besonders nützlich ist es bei iterativer Arbeit: Datensätze erkunden, Prototypen bauen, Pipelines debuggen, Analysecode schreiben oder eine Idee in ein reproduzierbares Artefakt verwandeln.

## Erste Schritte

Repository klonen und die lokale Entwicklungsumgebung starten:

```bash
./scripts/dev.sh
```

Danach die Web-App öffnen:

```text
http://127.0.0.1:27183
```

Für agent-backed Sessions müssen lokale CLIs wie `codex` oder `claude` installiert und angemeldet sein.

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
yarn typecheck
yarn lint
yarn build
```

## Projektstatus

Open Science ist noch früh und entwickelt sich schnell weiter. Der aktuelle Fokus liegt auf einem praktischen lokalen Workflow für AI-gestützte Forschung und Entwicklung. Die Dokumentation bleibt bewusst leichtgewichtig und für ein internationales Publikum zugänglich.
