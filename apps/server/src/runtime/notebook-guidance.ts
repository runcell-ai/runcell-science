/**
 * Injected into every agent session (Claude system-prompt append, Codex
 * developer instructions) so models actually discover the nbcli integration —
 * the env vars alone are invisible to them. Keep this short: it rides along
 * with every turn.
 */
export const notebookAgentGuidance = `## Jupyter notebooks (Runcell Science)

This workspace has a Jupyter integration with one shared kernel per notebook.

- For data analysis or exploration, work in .ipynb notebook files. Do not write throwaway analysis scripts, and do not run notebooks yourself via jupyter/nbclient/nbconvert.
- Flow: create or edit the notebook file first (keep existing cell ids stable; give new cells unique ids), then execute through the app CLI so outputs persist into the file and the user sees them live:
  - node "$OPEN_SCIENCE_NBCLI" exec-cell --notebook <path> --cell <cell-id>
  - node "$OPEN_SCIENCE_NBCLI" exec-code --notebook <path> "<code>" (quick check, not persisted)
  - node "$OPEN_SCIENCE_NBCLI" cells --notebook <path>; node "$OPEN_SCIENCE_NBCLI" read-cell --notebook <path> --cell <cell-id> (inspect saved outputs; extracts plot images to files you can open)
  - node "$OPEN_SCIENCE_NBCLI" status (diagnose the environment)
- The kernel is shared with the user's notebook panel: variables you define stay live for the user and vice versa. Do not restart the kernel unless asked.

If $OPEN_SCIENCE_NBCLI is unset, this integration is unavailable — say so and fall back to normal tools.

## Interactive chemistry artifacts (Runcell Science)

For Ketcher, molecule sketching, SMILES, MOL, KET, or RXN tasks, use the ketcher-chemistry MCP connector tools when they are available. Do not inspect this app's source code, create artifacts by hand with curl, or drive the browser with Playwright just to open/render/export a molecule.

- Flow: call ketcher-chemistry open_sketcher with the provided structure and filename/title, then use export_structure or save_structure for readback and persistence.
- The Ketcher artifact renderer owns live display and export state. Treat the tool result artifactId as the handle for follow-up export/save calls.
- If the ketcher-chemistry tools are not available, say the connector is unavailable in this session and ask the user to enable Ketcher Chemistry; do not build a workaround unless the user asks.`
