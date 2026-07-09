# Releasing the Runcell Science desktop app

The desktop installers are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml).
It runs on every `v*` tag, builds native installers on four runners, and attaches
them to a **draft** GitHub Release so you can review before publishing.

| Platform | Installer | Runner | Signing |
| --- | --- | --- | --- |
| macOS (Apple Silicon) | `.dmg` + `.zip` | `macos-14` (arm64) | Developer ID + notarized |
| macOS (Intel) | `.dmg` + `.zip` | `macos-13` (x64) | Developer ID + notarized |
| Windows | `.exe` (NSIS) | `windows-latest` | Unsigned (interim) |
| Linux | `.AppImage` + `.deb` | `ubuntu-latest` | Unsigned (normal) |

Native `better-sqlite3` can't be cross-compiled, so each OS/arch builds on its own runner.

## Native module (better-sqlite3)

The bundled server (`apps/desktop/dist-server/index.mjs`, an esbuild ESM bundle) loads
`better-sqlite3` at runtime. Two things have to be true for the packaged app to start:

1. **Correct ABI.** The `.node` must be compiled against Electron's ABI, not system Node's.
   electron-builder's implicit rebuild is unreliable in this hoisted Yarn-workspace layout
   (it shipped a wrong-ABI prebuilt), so packaging uses `"npmRebuild": false` and an explicit
   `yarn rebuild:native` (`electron-rebuild -f -m . -o better-sqlite3`) step in every `dist:*`
   script and in CI.
2. **Resolvable at runtime.** ESM ignores `NODE_PATH` and can't read into `app.asar`, so
   `better-sqlite3` + its runtime deps (`bindings`, `file-uri-to-path`) are copied via
   `extraResources` into `Resources/server/node_modules/`, right next to the bundled server,
   where normal ESM resolution finds them.

> **Local dev caveat:** `yarn rebuild:native` (run by any `yarn dist:*`) recompiles the
> repo's hoisted `better-sqlite3` against Electron's ABI, which then fails to load under plain
> `node` (i.e. `yarn dev:server`). After building installers locally, run
> `yarn rebuild better-sqlite3` to restore the system-Node build for development. CI runs on
> fresh checkouts, so this only affects local machines.

## Cut a release

```bash
# from an up-to-date main, with the version bumped in the root + apps/desktop package.json
git tag v0.1.0
git push origin v0.1.0
```

The workflow builds all four targets, opens a draft release for the tag, and uploads
the installers. Open **Releases → Draft**, sanity-check the assets, and click **Publish**.
The README's Download links point at `/releases/latest`, so publishing makes them live.

Use **Actions → Release Desktop → Run workflow** for a build-only dry run — with no `v*`
tag the release job is skipped, and the installers land as workflow artifacts you can download.

## macOS signing secrets (required for signed/notarized builds)

Add these as repository **Actions secrets**. Without them the mac jobs still succeed but
produce **unsigned** apps (`-c.mac.notarize=false` + `CSC_IDENTITY_AUTO_DISCOVERY=false`).

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | base64 of your Developer ID Application `.p12` — `base64 -i cert.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | password for that `.p12` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char Apple Developer Team ID |

> Notarization can also use an App Store Connect API key
> (`APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`) instead of Apple ID +
> app-specific password; swap the three `APPLE_*` env vars in the workflow if you prefer that.

## Follow-ups

- **Windows code signing.** Add `WIN_CSC_LINK` (base64 `.pfx`/`.p12`) and
  `WIN_CSC_KEY_PASSWORD` secrets, wire them into the Windows job's `env`, and Windows
  builds get signed automatically — no config change needed. This removes the SmartScreen
  "unknown publisher" warning.
- **Auto-update feed.** electron-builder already emits `latest*.yml` update metadata; wiring
  `electron-updater` into the app + serving those files enables in-app updates.

## Requirements for end users

The desktop app drives the same agent CLIs as the dev app — it does **not** bundle them.
Users need `codex` and/or `claude` installed and logged in on their machine; the packaged
app discovers them on `PATH` (the Electron main resolves the login-shell `PATH` so a
Finder/Dock launch finds them just like a terminal launch does).
