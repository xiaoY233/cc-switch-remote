# Remote Feature Parity Matrix

This document tracks how remote management maps to the local CC Switch feature set. Remote features must stay target-aware: local state is not the source of truth for a remote host, and unsupported local-only features should be hidden, disabled, or documented instead of exposed as broken controls.

## Status Terms

- `parity`: remote uses the same user workflow and shared target-aware logic as local.
- `remote-adapted`: remote intentionally differs because the action runs on another host or depends on SSH/helper state.
- `local-only`: feature is tied to the desktop app or the local OS session and should not be remote-managed without a separate design.
- `next`: useful remote capability that is not complete enough to call parity.

## Settings Modules

| Local module | Remote module | Status | Notes |
| --- | --- | --- | --- |
| General: main page app visibility | General | parity | Saved in the selected remote host settings. |
| General: Skills storage location | General | parity | Uses remote helper migration command. |
| General: Skills sync method | General | parity | Saved in remote settings. |
| General: Codex app enhancements | General | parity | Saved in remote settings and applied on the remote host. |
| General: window behavior Claude plugin options | General | remote-adapted | Applies remote Claude Code plugin config and onboarding skip through helper commands. |
| General: language, theme | none | local-only | These control the desktop UI only. |
| General: preferred terminal | none | local-only | Terminal launch is local desktop behavior. |
| Routing: runtime start/stop | Routing | parity | Remote runtime is started/stopped through helper session commands. |
| Routing: app routing toggles | Routing and home page | parity | Uses remote target app routing config; enabling a home-page app route starts the remote routing runtime first when needed. |
| Routing: show route/failover on home page | Routing | parity | Uses remote-specific setting keys so local and remote homepage controls stay independent. |
| Routing: failover queue | Routing | parity | Queue actions run against remote routing state. |
| Routing: automatic failover | Routing | parity | Uses remote provider health and circuit breaker commands. |
| Routing: rectifier and optimizer | Routing | parity | Uses target-aware rectifier panel and remote commands. |
| Routing: global outbound proxy | Routing | remote-adapted | Configures the remote host outbound proxy, not the desktop network proxy. |
| Auth: managed accounts | Auth | parity | AuthCenterPanel is target-aware and calls remote helper auth commands. |
| Advanced: config directories | Advanced | remote-adapted | Tool config dirs are remote settings; CC Switch app config dir requires helper `settings-app-config-dir`. |
| Advanced: import/export | Advanced | parity | Imports/exports the selected remote host state. |
| Advanced: backup and restore | Advanced | parity | Backup list and restore actions target the remote host database. |
| Advanced: WebDAV/S3 cloud sync | Advanced | parity | Sync actions target the remote host state and settings. |
| Advanced: model test config | Advanced | parity | Stream check config and checks are target-aware. |
| Advanced: log config | Advanced | parity | Reads/writes remote log settings through helper settings commands. |
| Usage statistics | Usage | parity | Summary, trends, logs, pricing, and sync actions are target-aware. |
| About: app release/update | local About | local-only | Desktop app update belongs to the local application. The update badge opens the local About settings even when the active management target is remote. |
| About: install conflict diagnostics | Remote | remote-adapted | Remote environment diagnostics live in the Remote tab. |

## Feature Areas

| Feature area | Status | Notes |
| --- | --- | --- |
| Remote host profiles | remote-adapted | Stored locally because they describe SSH connection targets; remote passwords are local connection secrets, not provider secrets. |
| Helper install/update | remote-adapted | Installs GitHub release assets on the remote host. If remote download fails, the desktop app can download and upload through SSH. |
| Helper version/update detection | remote-adapted | UI shows clean app version plus short build hash; comparison uses helper build internally. |
| Providers | parity | CRUD, switch, import, sort, live IDs, and universal providers route through remote commands. |
| Provider secrets | remote-adapted | Secrets stay on the remote host. Redacted values are preserved by shared restore logic. |
| MCP | parity | List, upsert, delete, app toggles, and import aggregation are target-aware. |
| Prompts | parity | CRUD, enable, import, and current prompt file content are target-aware. |
| Skills | parity | Install, uninstall, backups, restore, app toggles, unmanaged scan, app import, repos, update check, and update are target-aware. |
| Sessions | parity | List, view messages, delete, and batch delete are target-aware. Terminal resume remains local-only for now. |
| Hermes memory | parity | Memory, model config, limits, and enabled state are target-aware. |
| OpenClaw | parity | Default model, env, tools, and agents defaults are target-aware. |
| Tool environment lifecycle | parity | Version check, install/update/uninstall, conflict diagnosis, and manual install commands are remote-adapted through shared tool lifecycle logic. |

## Current Next Items

1. Keep local-only proxy takeover and hot-switch hooks out of remote UI paths. Remote app routing must continue to use routing app config and helper runtime commands instead.
2. Keep checking new upstream local settings additions against this matrix during upstream merges.
