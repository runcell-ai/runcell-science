# @open-science/ui

Private UI package for Open Science. It implements **Manuscript**, the project's design language.

## Manuscript design language

Built for scientists and researchers: the interface should feel like a well-set
journal page paired with a precise lab instrument.

- **Ink on paper.** A warm paper ground with warm near-black ink in light mode;
  dark mode is a warm "archive" charcoal, not a blue-black. All colors are
  OKLCH tokens defined in `src/styles.css` (`:root` and `.dark`).
- **Three type voices.** A transitional serif (Charter/Cambria stack, no
  webfont downloads) for titles, the system sans for interface copy, and
  monospace for paths, data, and diffs. Exposed as `--font-serif`,
  `--font-sans`, `--font-mono`.
- **One accent.** A deep viridian (`--primary`) carries selection, focus, and
  running state. Semantic colors (`--success`, `--warning`, `--destructive`)
  stay muted and are reserved for status.
- **Quiet status.** Statuses render as a colored dot plus a word
  (`StatusPill`), never a loud badge. Metadata labels are small-caps
  letter-spaced overlines.
- **Hierarchy by weight, not boxes.** Messages read like manuscript passages;
  tool activity is a compact run log on a hairline rail; approval requests are
  the one intentionally loud moment in the timeline.

Never hardcode colors in component CSS — use the tokens so both themes hold.

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
