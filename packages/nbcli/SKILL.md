---
name: notebook-analysis
description: Shared-kernel Jupyter notebook workflow for data analysis and exploration.
---

# Notebook Analysis

Use this skill for data analysis or exploratory computation in an Open Science workspace.

Prefer `.ipynb` notebooks for analysis. Do not create throwaway analysis scripts when a notebook can hold the work and outputs.

Expected flow:

1. Inspect existing cells with:

```sh
node "$OPEN_SCIENCE_NBCLI" cells --notebook <path>
```

2. Create or edit the notebook file first.
3. Keep existing cell `id` values stable.
4. Give new cells fresh unique `id` values.
5. Run persistent cells with:

```sh
node "$OPEN_SCIENCE_NBCLI" exec-cell --notebook <path> --cell <cell-id>
```

6. Read back persisted output, including plots extracted to files, with:

```sh
node "$OPEN_SCIENCE_NBCLI" read-cell --notebook <path> --cell <cell-id>
```

7. Use quick non-persistent checks with:

```sh
node "$OPEN_SCIENCE_NBCLI" exec-code --notebook <path> "<code>"
```

8. Diagnose setup with:

```sh
node "$OPEN_SCIENCE_NBCLI" status
```

The kernel is shared with the user's notebook panel. Variables you define stay live for the user, and variables they define are live for you. Do not restart the kernel unless asked.

This requires `OPEN_SCIENCE_NBCLI` and `OPEN_SCIENCE_API_URL`. They are present inside the Open Science app. If either is absent, say so and fall back to normal tools.
