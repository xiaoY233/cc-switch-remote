# 上游 v3.20.1 源码树差异矩阵

基线：上游 v3.20.0 peeled commit `0b5da510168914b251481654a568c3ffacd62cf4`
目标：上游 v3.20.1 peeled commit `3217f72596f2d1c0f879f0a05f83803825d9809f`

该矩阵由标签间 tree diff 与当前 fork 三方合并预演生成。`fork 重叠`表示当前 fork 自共同基线也修改了该文件；`预测冲突`只表示 Git 内容冲突，未冲突文件仍可能需要语义整合。

| 文件 | 状态 | +/− | fork 重叠 | 预测冲突 | 审计责任域 |
| --- | --- | ---: | :---: | :---: | --- |
| `.github/workflows/ci.yml` | M | +28/−3 | 是 | 否 | 构建/发布边界 |
| `CHANGELOG.md` | M | +52/−0 | 是 | 否 | 文档/产品边界 |
| `README.md` | M | +2/−2 | 是 | 是 | 文档/产品边界 |
| `README_DE.md` | M | +2/−2 | 是 | 是 | 文档/产品边界 |
| `README_JA.md` | M | +2/−2 | 是 | 是 | 文档/产品边界 |
| `README_ZH.md` | M | +2/−2 | 是 | 是 | 文档/产品边界 |
| `docs/release-notes/v3.20.1-en.md` | A | +281/−0 | 否 | 否 | 文档/产品边界 |
| `docs/release-notes/v3.20.1-ja.md` | A | +281/−0 | 否 | 否 | 文档/产品边界 |
| `docs/release-notes/v3.20.1-zh.md` | A | +281/−0 | 否 | 否 | 文档/产品边界 |
| `docs/user-manual/en/1-getting-started/1.5-settings.md` | M | +1/−1 | 是 | 否 | 文档/产品边界 |
| `docs/user-manual/en/3-extensions/3.4-sessions.md` | M | +1/−1 | 否 | 否 | 文档/产品边界 |
| `docs/user-manual/ja/1-getting-started/1.5-settings.md` | M | +1/−1 | 是 | 否 | 文档/产品边界 |
| `docs/user-manual/ja/3-extensions/3.4-sessions.md` | M | +1/−1 | 否 | 否 | 文档/产品边界 |
| `docs/user-manual/zh/1-getting-started/1.5-settings.md` | M | +1/−1 | 是 | 否 | 文档/产品边界 |
| `docs/user-manual/zh/3-extensions/3.4-sessions.md` | M | +1/−1 | 否 | 否 | 文档/产品边界 |
| `package.json` | M | +1/−1 | 是 | 否 | 构建/发布边界 |
| `src-tauri/Cargo.lock` | M | +1/−1 | 是 | 是 | 构建/发布边界 |
| `src-tauri/Cargo.toml` | M | +1/−1 | 是 | 是 | 构建/发布边界 |
| `src-tauri/capabilities/default.json` | M | +1/−0 | 否 | 否 | 构建/发布边界 |
| `src-tauri/src/codex_config.rs` | M | +2451/−196 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/commands/auth.rs` | M | +31/−2 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/commands/codex_oauth.rs` | M | +10/−2 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/commands/misc.rs` | M | +94/−0 | 是 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/database/mod.rs` | M | +1/−1 | 是 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/database/schema.rs` | M | +76/−2 | 是 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/lib.rs` | M | +11/−1 | 是 | 否 | 其他 |
| `src-tauri/src/proxy/forwarder.rs` | M | +110/−26 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/proxy/providers/codex.rs` | M | +4/−1 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/proxy/providers/codex_oauth_auth.rs` | M | +1124/−148 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/proxy/switch_lock.rs` | M | +17/−0 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/services/coding_plan.rs` | M | +217/−6 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/services/prompt.rs` | M | +16/−9 | 否 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/services/provider/live.rs` | M | +173/−56 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/services/provider/mod.rs` | M | +375/−170 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/services/proxy.rs` | M | +61/−91 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `src-tauri/src/services/session_usage.rs` | M | +690/−43 | 是 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/services/session_usage_gemini.rs` | M | +15/−7 | 否 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/services/session_usage_grokbuild.rs` | M | +116/−24 | 否 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/services/session_usage_opencode.rs` | M | +4/−3 | 否 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/services/session_usage_pi.rs` | M | +87/−46 | 否 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/session_manager/terminal/mod.rs` | M | +145/−0 | 否 | 否 | 数据库/会话/恢复 |
| `src-tauri/src/settings.rs` | M | +11/−1 | 是 | 否 | 其他 |
| `src-tauri/tauri.conf.json` | M | +1/−1 | 是 | 是 | 构建/发布边界 |
| `src-tauri/tests/provider_service.rs` | M | +443/−8 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `src/components/providers/EditProviderDialog.tsx` | M | +69/−5 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src/components/providers/forms/CodexOAuthSection.tsx` | M | +18/−14 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src/components/providers/forms/hooks/useCodexConfigState.ts` | M | +4/−4 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `src/components/providers/forms/hooks/useManagedAuth.ts` | M | +118/−13 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src/components/settings/SettingsPage.tsx` | M | +6/−0 | 是 | 否 | 前端/目标路由 |
| `src/components/settings/TerminalSettings.tsx` | M | +1/−0 | 否 | 否 | 数据库/会话/恢复 |
| `src/components/usage/UsageDashboard.tsx` | M | +134/−53 | 是 | 是 | 前端/目标路由 |
| `src/config/claudeDesktopProviderPresets.ts` | M | +7/−3 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/claudeProviderPresets.ts` | M | +7/−3 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/codexProviderPresets.ts` | M | +7/−4 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/codingPlanProviders.test.ts` | A | +161/−0 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/codingPlanProviders.ts` | M | +68/−9 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/grokBuildProviderPresets.ts` | M | +7/−4 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/hermesProviderPresets.ts` | M | +3/−3 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/openclawProviderPresets.ts` | M | +3/−3 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/opencodeProviderPresets.ts` | M | +3/−3 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/config/piProviderPresets.ts` | M | +3/−3 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `src/hooks/useProviderActions.ts` | M | +26/−7 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `src/i18n/locales/en.json` | M | +9/−0 | 是 | 否 | 前端/目标路由 |
| `src/i18n/locales/ja.json` | M | +9/−0 | 是 | 否 | 前端/目标路由 |
| `src/i18n/locales/zh-TW.json` | M | +9/−0 | 是 | 否 | 前端/目标路由 |
| `src/i18n/locales/zh.json` | M | +9/−0 | 是 | 否 | 前端/目标路由 |
| `src/lib/api/auth.ts` | M | +14/−1 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src/types.ts` | M | +3/−1 | 是 | 否 | 前端/目标路由 |
| `src/utils/providerConfigUtils.test.ts` | M | +14/−0 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `src/utils/providerConfigUtils.ts` | M | +11/−6 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `tests/components/CodexOAuthSection.test.tsx` | M | +40/−0 | 是 | 是 | Codex/Auth/Provider/Proxy |
| `tests/components/EditProviderDialog.test.tsx` | M | +141/−0 | 是 | 否 | Codex/Auth/Provider/Proxy |
| `tests/hooks/useCodexConfigState.bearer.test.ts` | A | +75/−0 | 否 | 否 | Codex/Auth/Provider/Proxy |
| `tests/hooks/useManagedAuth.test.tsx` | M | +170/−1 | 否 | 否 | Codex/Auth/Provider/Proxy |

## 处理原则

- 四份根 README：保留 fork 内容；上游差异是合作方 referral/推广链接调整，不进入 fork。
- `Cargo.lock`：合并 `Cargo.toml` 后重新生成，不选任一侧。
- `tauri.conf.json`：保留 `CC Switch Remote`、`com.ccswitch.remote`、fork updater endpoint/pubkey 和 deep-link；仅在 release-prep 阶段设置 fork 版本。
- Codex/Auth/Provider/Proxy：以目标安全不变量为准做语义整合，禁止简单 ours/theirs。
- Usage/Settings：保留 target-qualified query key；Remote UI 仅在 Helper capability 支持后展示新增操作。
- Otty、`process:allow-exit`：仅桌面本地能力，不进入 Helper 权限模型。
- Preset：新建 TeamoRouter 使用 `.cn` 与 `.com` fallback；不得改写存量 provider。
- 测试：上游测试合入后增加 local/remote 双路径和真实 Helper 入口验证。
