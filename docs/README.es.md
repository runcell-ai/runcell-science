# Runcell Science

**Un workspace de AI abierto y neutral en modelos para código de investigación, notebooks y artefactos científicos.**

Runcell Science es un workspace open source para investigadores y research engineers que quieren AI coding agents más fáciles de inspeccionar, personalizar y adaptar al trabajo científico.

En lugar de tratar una ejecución de agent como un chat desechable, Runcell mantiene el ciclo de investigación en un solo lugar: el prompt, la actividad de herramientas, los archivos del proyecto, los artefactos generados, la ejecución de notebooks, las preguntas de seguimiento y los archivos que cambió el agent.

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | Español | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## Demo

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## Qué Lo Hace Diferente

Muchas herramientas de AI coding son excelentes generando texto y parches, pero la investigación produce más que texto. Produce notebooks, gráficos, bocetos moleculares, reportes, archivos intermedios, diffs y experimentos en progreso que deben seguir siendo inspeccionables e interactivos.

Runcell Science está diseñado alrededor de esa realidad:

- **Abierto y personalizable** — el workspace, el server, los componentes de UI, los conectores científicos y los renderizadores de artefactos están pensados para inspeccionarse, extenderse y adaptarse.
- **Artefactos interactivos, no adjuntos estáticos** — el trabajo generado puede abrirse junto a la conversación, conservar estado de UI y formar parte del siguiente turno.
- **Skills y superficies científicas** — notebooks, artefactos de química, conectores científicos, archivos generados y renderizadores custom son partes centrales del flujo.
- **Neutral en modelos y runtime** — usa Codex, Claude Code y las opciones de modelo expuestas por esos runtimes, sin quedar encerrado en una sola UI de assistant alojado.
- **Trae tu suscripción existente** — Runcell puede trabajar con la configuración de Codex o Claude Code que ya usas, incluido acceso respaldado por suscripción cuando esas herramientas lo soportan.
- **Un workspace, no solo un chat box** — sessions, prompts, selección de modelo, artefactos, conectores, skills y worktree diffs viven en una sola superficie enfocada.

## Qué Puede Hacer

| Capacidad | Qué te da |
| --- | --- |
| **Agent-backed research sessions** | Inicia y continúa sesiones impulsadas por Codex o Claude Code desde una UI web, con eventos en streaming e historial persistente. |
| **Panel de artefactos interactivos** | Abre archivos generados, redacta artefactos, inspecciona salidas y conserva estado específico del renderer entre actualizaciones de sesión. |
| **Ejecución de notebooks** | Trabaja con notebooks respaldados por Jupyter y permite que los workflows de agent se enfoquen en archivos de notebook específicos. |
| **Worktree diffs** | Revisa qué cambió en el proyecto sin salir de la conversación de investigación. |
| **Science connectors** | Habilita conectores MCP-style incluidos para PubMed, ChEMBL, BioMart, Ensembl, UniProt, AlphaFold, OpenAlex, GTEx, ZINC, CellGuide y más. |
| **Skills-aware prompting** | Muestra skills disponibles en el composer para invocar workflows científicos con más facilidad. |
| **Runtime choice** | Elige el runtime y la configuración de modelo que quieres usar, en vez de organizar tu flujo alrededor de una sola UI de proveedor. |

## Para Quién Es

Runcell Science es para personas cuyo trabajo cruza código, datos, notebooks, papers y resultados generados:

- research engineers que construyen prototipos y pipelines de análisis;
- científicos que iteran sobre notebooks, gráficos, reportes y código de validación;
- estudiantes y equipos técnicos que no quieren dispersar contexto entre terminales y ventanas de chat;
- desarrolladores que construyen AI-assisted scientific tools, renderers o connectors.

## Forma Del Proyecto

Este repositorio es un monorepo TypeScript:

- `apps/web` — el browser workspace.
- `apps/server` — el API server, persistencia de sessions, provider runtimes, gestión de Jupyter e integración MCP.
- `apps/desktop` — la shell de escritorio Electron para distribución empaquetada a usuarios finales.
- `packages/ui` — componentes de UI compartidos para agent sessions y superficies de investigación.
- `packages/science-connectors` — registro de conectores científicos incluidos y tools compatibles con MCP.
- `packages/nbcli` — notebook helper CLI usado por workflows de agent.

Las integraciones runtime actuales son:

- **Codex** mediante una integración JSON-RPC app-server.
- **Claude** mediante Claude Agent SDK.

## Primeros Pasos

Clona el repositorio e inicia el entorno de desarrollo:

```bash
./scripts/dev.sh
```

Después abre la aplicación web:

```text
http://127.0.0.1:27183
```

Las sesiones respaldadas por agents esperan que el runtime correspondiente de Codex o Claude Code esté instalado y autenticado.

Runcell Science ahora también soporta una app de escritorio Electron para usuarios finales que prefieren una aplicación instalable. El desarrollo diario sigue pasando por la web app y el servidor local; la app de escritorio empaqueta esas mismas superficies web y server para distribución.

## Configuración Manual

Si prefieres iniciar los servicios manualmente:

```bash
yarn install
yarn dev
```

Comandos útiles:

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

## Estado Del Proyecto

Runcell Science está en una etapa temprana y evoluciona rápido. La dirección principal es un workspace práctico y hackeable para investigación y desarrollo asistidos por AI, con foco en scientific skills, interactive artifacts y agent sessions neutrales en modelos.

El objetivo a corto plazo no es reemplazar una plataforma completa de laboratorio. Es hacer que el ciclo diario de investigación sea más compacto: preguntar, ejecutar, inspeccionar, revisar y mantener juntos los archivos resultantes y el contexto.

## Visión Y Roadmap

Runcell Science busca convertirse en un research workbench abierto que los equipos puedan moldear alrededor de sus propios modelos, herramientas, datasets y dominios científicos.

Áreas que nos interesan especialmente:

- **Más opciones de modelo** — soporte más amplio para custom providers, modelos locales o self-hosted, OpenAI-compatible endpoints y model routing más rico por sesión.
- **Más scientific skills** — workflow packs más profundos para revisión bibliográfica, análisis de datos, química, biología, notebooks computacionales, escritura de reportes y chequeos de reproducibilidad.
- **Interactive artifacts más ricos** — más renderers para objetos científicos, mejor artifact provenance y loops más estrechos donde las salidas se puedan inspeccionar, editar y enviar de vuelta al agent.
- **Distribución de escritorio** — la app Electron ya está soportada; los siguientes pasos son hardening de release, firma, notarización y flujo de actualización/distribución.
- **Ecosistema de conectores** — más conectores first-party y comunitarios para bases científicas, plataformas de cómputo, notebooks y herramientas de laboratorio.
- **Mejor superficie de personalización** — formas más fáciles de agregar skills, artifact renderers, connector definitions, model presets y workflows específicos del proyecto.

La dirección a largo plazo es simple: mantener la experiencia de agent abierta, inspeccionable y adaptable, mientras los outputs científicos se sienten nativos y no añadidos encima.
