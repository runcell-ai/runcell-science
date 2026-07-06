# Runcell Science

Runcell Science es un espacio de trabajo local-first para investigadores que quieren usar AI coding agents sin perder contexto, archivos ni control sobre su proyecto.

Reúne conversaciones con agents, estado del proyecto, artefactos generados y trabajo de seguimiento en una interfaz enfocada. En lugar de saltar entre terminales, ventanas de chat y notas dispersas, puedes mantener el flujo de investigación en un solo lugar.

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | Español | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## Qué Problema Resuelve

El trabajo de investigación suele cruzar código, datos, artículos, notebooks y experimentos. Runcell Science está pensado para que ese ciclo sea más fácil de gestionar:

- Inicia y continúa sesiones de programación asistida por AI desde una interfaz web.
- Mantén respuestas del agent, actividad de herramientas y resultados generados dentro de la misma sesión.
- Trabaja con archivos locales del proyecto en vez de depender solo de un flujo de chat alojado.
- Usa ayuda de agents para código de análisis, prototipos, notebooks, documentación y tareas de investigación reproducible.

## Para Quién Es

Runcell Science es para investigadores, research engineers, estudiantes y equipos técnicos que quieren un entorno de desarrollo asistido por AI más parecido a un workspace de proyecto que a un hilo de chat desechable.

Es especialmente útil cuando el trabajo es iterativo: explorar un dataset, construir un prototipo, depurar un pipeline, escribir código de análisis o convertir una idea en un artefacto reproducible.

## Primeros Pasos

Clona el repositorio e inicia el entorno local:

```bash
./scripts/dev.sh
```

Después abre la aplicación web en:

```text
http://127.0.0.1:27183
```

Para ejecutar sesiones respaldadas por agents, necesitas tener instaladas y autenticadas CLIs locales como `codex` o `claude`.

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
yarn typecheck
yarn lint
yarn build
```

## Estado Del Proyecto

Runcell Science está en una etapa temprana y evoluciona rápido. El foco actual es ofrecer un flujo local y práctico para investigación y desarrollo asistidos por AI, con documentación intencionalmente ligera y accesible para una audiencia internacional.
