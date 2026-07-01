# @open-science/ui

Private UI package for Open Science.

## Scope

- Owns reusable UI primitives, interaction-only component logic, and design tokens.
- Excludes app-specific data fetching, runtime state, API calls, and product workflows.
- Exposes components through `@open-science/ui` and shared styles through `@open-science/ui/styles.css`.

## Commands

```sh
yarn dev:ui
yarn --cwd packages/ui run typecheck
yarn --cwd packages/ui run build
```

The Gallery runs independently from the app so UI and theme work can happen inside this package.
