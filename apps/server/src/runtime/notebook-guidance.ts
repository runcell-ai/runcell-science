/**
 * Injected into every agent session (Claude system-prompt append, Codex
 * developer instructions) so models actually discover the nbcli integration —
 * the env vars alone are invisible to them. Keep this short: it rides along
 * with every turn.
 */
export const notebookAgentGuidance = `## Jupyter notebooks (Open Science)

This workspace has a Jupyter integration with one shared kernel per notebook.

- For data analysis or exploration, work in .ipynb notebook files. Do not write throwaway analysis scripts, and do not run notebooks yourself via jupyter/nbclient/nbconvert.
- Flow: create or edit the notebook file first (keep existing cell ids stable; give new cells unique ids), then execute through the app CLI so outputs persist into the file and the user sees them live:
  - node "$OPEN_SCIENCE_NBCLI" exec-cell --notebook <path> --cell <cell-id>
  - node "$OPEN_SCIENCE_NBCLI" exec-code --notebook <path> "<code>" (quick check, not persisted)
  - node "$OPEN_SCIENCE_NBCLI" status (diagnose the environment)
- The kernel is shared with the user's notebook panel: variables you define stay live for the user and vice versa. Do not restart the kernel unless asked.

If $OPEN_SCIENCE_NBCLI is unset, this integration is unavailable — say so and fall back to normal tools.`
