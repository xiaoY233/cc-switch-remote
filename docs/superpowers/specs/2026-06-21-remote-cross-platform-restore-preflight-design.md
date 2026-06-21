# Remote Cross-Platform Restore Preflight Design

## Context

CC Switch SQL backups export the SQLite database, including provider
`settings_config` payloads. For Codex providers this payload can contain a full
`config.toml` snapshot. When a backup created on macOS is restored onto a Linux
remote host, that snapshot can carry macOS-only values such as `/Users/...`,
`/Applications/...`, Codex Desktop plugin paths, `notify`, `node_repl`, desktop
preferences, and local app runtime environment variables.

Upstream CC Switch currently does not provide a general cross-platform TOML
migration layer. Related upstream issues focus on preserving user-owned Codex
`config.toml` sections during live rewrites, but not on converting macOS live
config into Linux-compatible remote config.

This project should avoid changing upstream-local backup, WebDAV sync, provider
storage, or Codex live write semantics. Those areas are high churn upstream
integration points. The remote fork should add a remote-only preflight and
optional cleanup layer instead.

## Goals

- Prevent accidental remote Linux restores that write macOS or Windows local
  paths into remote Codex live config.
- Keep local SQL backup/restore behavior compatible with upstream.
- Keep local WebDAV/S3 sync behavior compatible with upstream.
- Keep provider storage schema unchanged.
- Make remote restore/sync risks visible before mutation.
- Allow the user to choose between exact restore and portable provider restore.
- Reuse shared parsing helpers where practical, but keep the new behavior behind
  remote import/restore adapters.

## Non-Goals

- Do not redesign the SQL backup format.
- Do not change local import/export semantics.
- Do not change local WebDAV/S3 sync semantics.
- Do not change the global Codex provider storage model.
- Do not implement a full upstream-style TOML merge engine for all local live
  writes.
- Do not silently delete user-owned config without a user-visible preview.

## Proposed Approach

Add a remote restore preflight layer that inspects SQL/provider payloads before
remote import and classifies Codex TOML fields. The same preflight must run for
remote WebDAV/S3 pull flows because those flows also transport provider rows
through SQL snapshots.

The scanner should identify obvious local-only markers:

- macOS paths: `/Users/`, `/Applications/`, `.app/Contents/`
- Windows paths: `C:\Users\`, `\\wsl.localhost\`
- Codex Desktop runtime entries: `notify`, `mcp_servers.node_repl`,
  `CODEX_CLI_PATH`, `CODEX_HOME`, `NODE_REPL_*`, `BROWSER_USE_*`
- local proxy URLs: `127.0.0.1:<port>`, `localhost:<port>` when they point to a
  local route provider
- desktop/UI-only tables: `desktop`, `plugins`, `features` when present inside
  a provider snapshot

The remote UI should present a preview with:

- affected app and provider
- source: SQL file, WebDAV pull, S3 pull, or remote-to-remote restore
- TOML path, for example `codex.providers.newapi.config.notify`
- risk type, for example `macos_path`, `codex_desktop_runtime`, or
  `local_proxy_url`
- suggested action: keep, skip, or regenerate on remote

## Restore Modes

### Exact Restore

Import the SQL as-is and run the normal post-import sync.

This is useful when the source and target are the same OS/user layout or when
the user intentionally wants a byte-for-byte restore. The UI must show warnings
when local-only markers are detected.

### Portable Provider Restore

Before sending the restore payload to the remote helper, create a remote-only
transformed SQL or command payload that removes known local-only Codex TOML
sections from provider `settings_config.config`.

For Codex, preserve:

- `model_provider`
- `model`
- `model_reasoning_effort` and other model behavior fields that are not
  obviously desktop/runtime specific
- active `[model_providers.<id>]`
- provider auth or provider-scoped bearer token behavior already supported by
  existing logic
- HTTP/SSE MCP entries that do not depend on local executable paths

For Codex, skip by default:

- `notify`
- `[desktop]`
- `[plugins]`
- `[features]` entries known to be Codex Desktop local UI/plugin state
- stdio MCP entries whose `command` is an absolute local path from another OS
- env values that contain foreign absolute paths

Skipped fields must be included in the restore report.

## Architecture

Add a small remote adapter module rather than modifying local import/export:

- `remote_restore_preflight`: pure parsing and classification.
- `remote_restore_plan`: converts scanner findings into user-visible choices.
- remote command/UI integration: calls preflight before SQL import, WebDAV pull,
  S3 pull, or remote restore and sends the selected mode to the helper.

The helper should not advertise a destructive cleanup capability until the
scanner and transformation behavior have tests.

## Data Flow

1. User selects remote restore/import, WebDAV pull, or S3 pull.
2. App loads SQL backup content locally or receives a SQL payload from the sync
   service.
3. Preflight parses backup SQL enough to inspect provider rows.
4. Scanner extracts provider `settings_config.config` TOML text for Codex.
5. UI displays warnings and restore mode choices.
6. User chooses exact or portable restore.
7. Exact restore sends SQL unchanged.
8. Portable restore transforms only remote-bound provider payloads, then sends
   the transformed payload to the remote helper.
9. Helper imports using existing shared database import logic.
10. Post-import sync runs existing shared provider-to-live logic on the remote.

## Error Handling

- TOML parse failure should not block exact restore. It should block portable
  cleanup for that provider and show a clear warning.
- SQL parse/extraction failure should fall back to exact restore with a warning
  rather than mutate blindly.
- Portable restore must produce a before/after report for changed providers.
- If remote import fails, the existing database safety backup and failure
  preserving behavior remain authoritative.

## Tests

Focused tests should cover:

- macOS Codex `notify` and Codex Desktop app bundle paths are detected.
- Linux restore keeps provider route fields while skipping macOS-only runtime
  fields in portable mode.
- HTTP MCP server entries are retained.
- stdio MCP entries with foreign absolute commands are skipped.
- exact restore leaves SQL unchanged.
- malformed TOML produces a warning and prevents only portable cleanup for that
  provider.
- remote adapter tests prove local import/export APIs remain unchanged.
- remote WebDAV/S3 pull tests prove the same preflight runs before remote-bound
  sync import, while local WebDAV/S3 sync APIs remain unchanged.

## Review Notes

This design deliberately does not solve upstream local live rewrite behavior.
If upstream later merges a Codex TOML merge engine, this remote preflight should
be rechecked and may be reduced to warnings plus target-specific cleanup.
