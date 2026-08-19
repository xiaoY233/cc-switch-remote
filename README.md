<div align="center">

# CC Switch Remote

### Local and remote management for Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw and Hermes Agent

[![Version](https://img.shields.io/github/v/release/xiaoY233/cc-switch-remote?color=blue&label=version)](https://github.com/xiaoY233/cc-switch-remote/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/xiaoY233/cc-switch-remote/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Downloads](https://img.shields.io/github/downloads/xiaoY233/cc-switch-remote/total)](https://github.com/xiaoY233/cc-switch-remote/releases/latest)

CC Switch Remote is a remote-management focused fork of CC Switch. It keeps the upstream local desktop experience while adding an independent remote target mode backed by a Rust CLI helper installed on each server.

[Download](https://github.com/xiaoY233/cc-switch-remote/releases/latest) | [Changelog](CHANGELOG.md) | [User Manual](docs/user-manual/en/README.md) | [中文文档](README_ZH.md)

![CC Switch Remote desktop screenshot](assets/screenshots/cc-switch-remote-hero-zh.png)

</div>


## Project Direction


- `main` is the CC Switch Remote product branch and is used for application releases.
- `upstream-main` mirrors `farion1231/cc-switch/main` and is used only as the upstream sync baseline.
- Local and remote management are separate targets. Local state remains on the desktop machine; remote state remains on the selected server.
- Remote operations are executed through SSH commands that call a pure Rust helper binary and return stable JSON.
- The desktop app stores remote connection profiles and cached health metadata. Provider secrets, MCP data, prompts, skills and tool configuration stay on the remote host unless the user explicitly imports or exports them.

## What It Manages

CC Switch Remote provides a single desktop UI for managing multiple AI coding tools:

- Provider presets and provider switching for Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build, OpenCode, OpenClaw and Hermes Agent
- MCP server management
- Prompt and instruction file management
- Skill management and synchronization
- Import and export workflows
- Tool environment checks
- Local proxy and failover features for local desktop use
- Remote health checks and helper installation

## Remote Management

Remote management is designed as a separate execution target rather than a mirror of local state.

1. Add a remote server profile from the remote server manager.
2. Install or update the remote helper from GitHub release assets.
3. Switch the target selector from local to the remote server.
4. Use supported pages through the same desktop shell. Remote commands run on the selected server and operate on that server's own CC Switch data.

The remote helper is published separately from the desktop application:

- Helper release tag: [`remote-helper-latest`](https://github.com/xiaoY233/cc-switch-remote/releases/tag/remote-helper-latest)
- Asset prefix: `cc-switch-remote-helper-*`
- Supported helper targets: Linux x86_64, Linux arm64 and macOS universal
- Build mode: pure CLI Rust binary, built without Tauri desktop GTK/WebKit dependencies

Remote feature parity is explicit:

- Tracked in [`docs/remote-feature-parity.md`](docs/remote-feature-parity.md)
- Supported or actively targeted: providers, routing, authentication, usage statistics, MCP, prompts, skills, sessions, Hermes memory, OpenClaw, import/export, backups, cloud sync, tool environment checks and health checks
- Local-only unless a remote-safe equivalent is designed: tray controls, desktop deep links, desktop app updates, local callback/deeplink OAuth flows, local terminal launch, local UI language/theme and local proxy takeover. Device-code OAuth flows can be remote-managed because the browser only approves a code while the remote helper owns the polling and token storage.

## Download

Get the latest desktop application from the [Releases](https://github.com/xiaoY233/cc-switch-remote/releases/latest) page.

### Windows

- `CC-Switch-Remote-v{version}-Windows.msi`
- `CC-Switch-Remote-v{version}-Windows-Portable.zip`

### macOS

- `CC-Switch-Remote-v{version}-macOS.dmg`
- `CC-Switch-Remote-v{version}-macOS.zip`

### Linux

- `CC-Switch-Remote-v{version}-Linux-x86_64.AppImage`
- `CC-Switch-Remote-v{version}-Linux-arm64.AppImage`
- `CC-Switch-Remote-v{version}-Linux-x86_64.deb`
- `CC-Switch-Remote-v{version}-Linux-arm64.deb`
- `CC-Switch-Remote-v{version}-Linux-x86_64.rpm`
- `CC-Switch-Remote-v{version}-Linux-arm64.rpm`

## Data Model

Local data is stored in the desktop user's CC Switch data directory:

- Database: `~/.cc-switch/cc-switch.db`
- Settings: `~/.cc-switch/settings.json`
- Backups: `~/.cc-switch/backups/`
- Skills: `~/.cc-switch/skills/`

Remote data is stored on the remote host and managed by the helper. The desktop app does not treat local data as the source of truth for a remote server.

## Release Model

Desktop application releases and remote helper releases are intentionally separate:

- App release: tag-driven workflow using `v*` tags
- Helper release: `Remote Helper Artifacts` workflow publishing to `remote-helper-latest`
- Updater metadata: `latest.json` is generated by `scripts/assemble-tauri-latest-json.mjs`
- Release repair: `Release Maintenance` can sign an existing Windows MSI and refresh `latest.json` without rebuilding every platform

When preparing a full version, publish both:

1. Push the version bump and release workflow changes to `main`.
2. Ensure `remote-helper-latest` points to the final release commit.
3. Push the `v{version}` tag for the desktop application.
4. Verify GitHub release assets and `latest.json`.

For release validation and repair:

- Use the `Release` workflow `platform` input to validate only one platform before pushing a formal tag.
- Use `Release Maintenance` with `sign-windows-msi-and-refresh-latest` when an existing release needs Windows updater metadata repaired.
- Use `Release Maintenance` with `refresh-latest-json` when all updater signatures already exist and only metadata needs regeneration.
- Maintenance metadata refresh uses GitHub release asset names plus `.sig` files, so it does not download AppImage, DMG, ZIP, DEB or RPM packages.
- `latest.json` generation fails if a required updater platform is missing or if an updater artifact has no `.sig`.

## Development

### Requirements

- Node.js 20+
- pnpm
- Rust stable
- Tauri 2

### Common Commands

```bash
pnpm install
pnpm dev
pnpm exec tsc --noEmit
pnpm build
pnpm tauri build
```

### Rust Checks

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote-helper --no-default-features
```

### Remote-Focused Tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml remote::tests
cargo test --manifest-path src-tauri/Cargo.toml --test remote_ssh
```

## Repository Layout

```text
src/                         React frontend
src/components/remote/        Remote target UI
src/components/settings/      Local and remote settings surfaces
src/lib/api/                  Tauri API wrappers
src-tauri/src/commands/       Tauri command layer
src-tauri/src/remote/         SSH and remote helper integration
src-tauri/src/cli/            Rust helper CLI entrypoints
src-tauri/src/services/       Core service logic reused by app and helper
.github/workflows/            App and helper release workflows
```

## Upstream Sync

This project is not intended as an upstream PR branch. The goal is to keep CC Switch Remote as a product branch while periodically syncing upstream features through `upstream-main`.

Keep remote-specific code isolated behind remote adapters, helper commands and remote UI shells so upstream local feature updates remain mergeable.

## License

MIT
