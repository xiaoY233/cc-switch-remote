# 上游 v3.20.1 更新与 CC Switch Remote 迁移分析

日期：2026-08-29

## 范围与结论

本文将“上次正式版到最新版本”解释为上游正式 Release `v3.20.0 → v3.20.1`。GitHub Release 与上游发布说明定义维护者公开承诺的产品变化，但不保证穷尽实现变化；完整迁移范围以两个正式标签之间的源码树差异为准，提交与 PR 仅用于补充原因。

当前 CC Switch Remote 的产品版本和本地标签已经是 `v3.20.1`，但其上游稳定基线仍是 `v3.20.0`。上游 `v3.20.1` 尚未合入，因此不能把“版本号相同”视为已经同步。建议将上游 `v3.20.1` 合入后的 fork 版本定为 **`v3.20.2`**。

迁移应合入上游 `v3.20.1` 的精确稳定标签，同时保留 fork 的远程管理架构、产品身份、数据目录、更新器和发布链。该范围涉及数据库 schema、Codex 凭证模型、供应商切换、会话扫描及恢复语义，不能采用无审计的直接合并或立即发布。

## 正式 Release 基线

| Release | 状态 | 发布时间（UTC） | 来源 |
| --- | --- | --- | --- |
| `v3.20.0` | 正式版，非 draft/prerelease | 2026-08-18 09:11:14 | [Release](https://github.com/farion1231/cc-switch/releases/tag/v3.20.0) · [API](https://api.github.com/repos/farion1231/cc-switch/releases/tags/v3.20.0) |
| `v3.20.1` | 正式版，非 draft/prerelease | 2026-08-28 | [Release](https://github.com/farion1231/cc-switch/releases/tag/v3.20.1) · [API](https://api.github.com/repos/farion1231/cc-switch/releases/tags/v3.20.1) |

发布内容的主来源为[上游 v3.20.1 中文发布说明](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md)。

## v3.20.1 发布内容

### 新增

1. **会话扫描支持自动/手动模式。** 关闭自动扫描后，只有“立即同步”扫描会话文件；代理接管请求仍实时记账。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L62-L64)
2. **OpenCode Go 订阅用量。** Token Plan 查询支持 5 小时、周、月窗口及重置时间。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L66-L68)
3. **macOS Otty 终端。** 会话恢复、供应商终端和工具命令支持 Otty，并包含 CLI、应用包、Homebrew、PATH 探测与回退。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L70-L74)

### 行为变更

1. **Codex 第三方供应商改为 config-only。** API key 写入供应商 `model_providers` 表的 `experimental_bearer_token`，不再写入 `auth.json`，以兼容 Codex CLI 0.149+。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L78-L82)
2. **TeamoRouter 默认端点迁移。** 新预设使用 `api.teamorouter.cn`，旧 `.com` 端点仅作为可选测速后备；存量供应商 Base URL 不变。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L84-L88)

### 修复

1. 同一 ChatGPT Team workspace 的不同成员不再在 Auth Center 中合并或覆盖 token。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L92-L94)
2. 修复会导致 Codex 0.149 拒绝启动的历史配置形态。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L96-L98)
3. 被拒绝的 Codex 切换不再破坏被拒绝供应商卡的数据。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L100-L102)
4. 供应商编辑在存在异常接管备份时仍会写入 live 配置。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L104-L106)
5. Codex 编辑框从当前卡片的 `config.toml` bearer token 重建密钥，避免显示另一张卡片的 key。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L108-L110)
6. WebDAV、S3 或备份导入的快照未启用 Prompt 时，不再清空手写 Prompt 文件。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L112-L114)
7. 数据库恢复界面的退出操作恢复可用。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L116-L118)
8. 修复 Claude 会话记账的三项正确性问题。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L120-L124)

### 性能

1. Claude 会话日志改用字节游标增量扫描；发布说明中的 12 MB 活跃文件示例由 6.04 秒降至 9.3 毫秒。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L128-L130)
2. Pi 会话去重改用身份索引。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L132-L136)

### 升级约束

- 数据库 schema 从 **v17 升至 v18**，为会话同步增加字节游标和尾部指纹；升级前自动备份，降级必须恢复备份。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L140-L142)
- 既有 Codex OAuth 托管账号需要逐一重新登录。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L144-L146)
- Codex `<0.48` 无法读取 config-only token，应先升级 Codex。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L148-L150)
- 默认关闭“非接管切换时保留官方登录”时，切换到第三方供应商会删除 `auth.json`，不会再用 API key 覆盖它。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L152-L154)
- 无 provider 表承载 key，或依赖 `requires_openai_auth` / 裸 `openai_base_url` 借用官方登录的卡片，会被拒绝切换。[来源](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L156-L158)
- 旧配置重写、日志外部改写、历史串 key、恢复语义、统一供应商 live 写入、TeamoRouter 存量配置及 OpenCode Go 默认启用范围的兼容说明见[发布说明 L160–L184](https://github.com/farion1231/cc-switch/blob/v3.20.1/docs/release-notes/v3.20.1-zh.md#L160-L184)。

## 当前 fork 基线与迁移规模

本地仓库审计结果：

- fork `HEAD` 与本地 `v3.20.1` 指向 `369fe941`；该 fork 版本以**上游 v3.20.0** 为稳定基线。
- 上游 v3.20.0 peeled commit `0b5da510` 已是 fork `HEAD` 的祖先。
- 上游 v3.20.1 tag object 为 `4a104215`，peeled commit 为 `3217f725`；该 commit 尚不是 fork `HEAD` 的祖先。
- 精确上游范围修改 74 个文件；其中 43 个也被 fork 从共同基线修改过。三方合并预演得到 18 个冲突文件。
- 当前 fork schema 为 17；上游 v3.20.1 schema 为 18。
- 用户未提交的 `docs/release-notes/v3.20.1-remote-zh.md` 是 fork v3.20.1 的历史发布说明，必须原样保留；它正确记录了该 fork 版本的上游基线是 v3.20.0。

完整的 74 文件清单、增删规模、fork 重叠和预测冲突见 [`upstream-v3.20.1-file-matrix.md`](./upstream-v3.20.1-file-matrix.md)。可执行迁移步骤见 [`2026-08-29-upstream-v3.20.1-migration.md`](../superpowers/plans/2026-08-29-upstream-v3.20.1-migration.md)。

### 源码树审计补充发现

以下实现契约未被 Release 摘要完整表达：

1. **迁移前备份是 best-effort。** 上游备份失败只记录 warning，随后仍升级到 schema 18；这不能保证降级所需备份。fork 应改为备份失败即中止 schema 升级，并保留原数据库。
2. **自动扫描开关只控制桌面 GUI 后台轮询。** “立即同步”、本地 CLI 和 Remote Helper 的显式 `usage sync-session` 不受该开关限制；远端开关不能被解释为停止桌面的后台任务。
3. **Claude cursor 格式同时改变。** 新状态将 `last_line_offset` 归零，以最后完整换行后的字节位置作为 `last_byte_offset`，并保存尾部指纹。重写或截断时选择永久跳过可疑区间，优先避免 rollup 双计；这是可能漏计的有意取舍。
4. **mtime 不变的外部改写仍有盲区。** 当文件 mtime 没有增长时，上游会提前返回，不校验尾部指纹；保留 mtime 的 restore/copy 可能静默跳过变化，需增加回归测试或改为同时检查 size/fingerprint。
5. **OAuth 身份模型不再等同于 workspace。** 本地 account id、OIDC subject 和 ChatGPT workspace id 分离；旧记录无法证明个人 subject 时进入 quarantine，并通过 targeted re-login 保留 provider binding。
6. **OAuth 登录增加并发失效语义。** device flow 带目标 account、login epoch 和取消/过期检查；晚到的旧授权不得覆盖更新登录。quota/models 查询必须先从本地 account 映射 workspace。
7. **Codex live 状态成为多文件事务。** `auth.json`、`config.toml`、模型 catalog 和 managed marker 共同参与 snapshot/rollback；同账户的新 refresh generation 必须保留，跨账户回滚必须恢复原账户。
8. **第三方切换增加 fail-closed 预检。** 无可承载 key 的 provider table、借用官方 OAuth 的 `requires_openai_auth`、裸 `openai_base_url` 等旧形态会在 current pointer 变化前被拒绝；`openai` 内建 ID 使用精确大小写匹配。
9. **手动同步 UI 没有显示 deferred 数量。** 半行或读取中断只影响 toast 级别，用户看不到具体 deferred 文件数；迁移时应让结果完整表达 imported、errors 和 deferred 三个正交结果。
10. **自动合并不等于低风险。** `proxy/providers/codex_oauth_auth.rs`、`services/proxy.rs`、`database/schema.rs`、`services/session_usage*.rs`、`commands/auth.rs`、`src-tauri/src/lib.rs` 和 CI capability 文件虽不一定冲突，仍改变身份、事务、数据格式或桌面权限，必须人工审计。

主要冲突集中在：

- fork 身份和发布配置：四份根 README、`Cargo.toml`、`Cargo.lock`、`tauri.conf.json`；
- Codex/Auth：`codex_config.rs`、`useManagedAuth.ts`、`CodexOAuthSection.tsx`、`auth.ts`；
- Provider/Proxy：`provider/mod.rs`、`provider/live.rs`、`proxy/forwarder.rs`；
- Usage：`UsageDashboard.tsx`；
- 相关测试。

## 功能迁移分类

| 上游功能 | fork 分类 | 迁移要求 | 风险 |
| --- | --- | --- | --- |
| schema v18、字节游标、Pi 去重 | parity，共享 Rust | 桌面和 Helper 复用同一 schema/session service；每个目标迁移自己的数据库 | 高 |
| 手动会话扫描 | remote-adapted | Remote Usage 通过选中 profile 的 Helper 显式执行同步；查询键包含 target，并要求 `usage-manual-session-sync` capability | 高 |
| 后台自动会话扫描 | local-only | 依赖桌面后台生命周期，不在远程设置中展示或写入远程主机 | 中 |
| Codex config-only token | parity + remote-adapted | 共享 Provider/Codex 服务；远端 key 只写远端 `config.toml`，不得落入本地数据库或 `auth.json` | 高 |
| Team workspace 多成员身份 | parity + remote-adapted | 共享 `CodexOAuthManager`；远端账号列表、默认账号和绑定只取选中目标 | 高 |
| 被拒绝切换保持卡片状态 | parity | 本地与远端失败均保留原 provider、live 配置和运行中路由 | 高 |
| 供应商编辑/live 写修复 | parity | 保留 fork 的切换锁、回滚和远程 Helper 长会话 | 高 |
| Prompt 恢复保护 | parity | 本地和远端 restore 均不得删除未受管 Prompt；失败保持旧状态 | 中 |
| OpenCode Go 用量 | parity + remote-adapted | 共享 coding-plan 服务；远端查询和凭证留在远端 | 中 |
| 数据库恢复页退出权限 | local-only 桌面修复 | 合入 `process:allow-exit`，并从无 `AppState` 的恢复模式验证 | 中 |
| Otty | local-only | 仅本地终端设置与启动流程展示；远端 UI 不暴露本机终端副作用 | 低 |
| TeamoRouter 新预设 | parity | 只改变新建预设；不得改写存量远端或本地 Base URL | 低 |

## 推荐迁移方案

### 1. 建立隔离基线

1. 保留当前工作区和用户未提交文件，在独立 worktree 创建迁移分支。
2. 记录 `v3.20.1` fork 已知良好状态的 README object IDs、产品名、Cargo 包和二进制名、Tauri identifier、数据目录、deep-link、updater endpoint/pubkey、仓库 URL、资产名及 Helper tag。
3. 运行迁移前的前端、Rust、Helper 和脚本基线检查；基线失败必须先单独处理。

### 2. 以 peeled commit 合入稳定标签

本地 `v3.20.1` 标签已由 fork 使用，不能用该短标签名代表上游。应核对远端 tag object `4a104215` 与 peeled commit `3217f725`，将后者放入明确的 namespaced ref，再以 `--no-ff --no-commit` 合并。禁止夹带上游 `main` 在该标签之后的提交。

合并提交中保留当前 fork 版本元数据和全部 fork 边界；功能适配完成后再用独立 release-prep 提交统一升级到 `3.20.2`。

### 3. 按责任边界解决冲突

1. **身份/发布文件：** 根 README 保持与 fork v3.20.1 一致；上游四份 README 的变化是合作方 referral/推广链接调整，不进入 fork。Tauri、Cargo、工作流和脚本保留 CC Switch Remote 标识、双二进制、数据隔离、更新器、签名与 Helper 发布链。
2. **Codex/Auth：** 先合入 config-only 与 Team 成员身份模型，再把本地/远端路由接回 `ManagementTarget → authApi/remoteApi → Tauri/Helper → shared Rust service`。不得在 Helper 增加独立凭证业务逻辑。
3. **Provider/Proxy：** 保留切换锁、事务回滚、OAuth manager 共享、运行中 remote runtime 和命令级失败不拆 Helper session 的保证。
4. **Usage/Database：** 合入 v17→v18 迁移和字节游标后，更新备份/恢复、云同步、Helper 数据库和 target-qualified Usage 刷新。
5. **Prompt/恢复：** 将“不删除未受管 Prompt”落实到共享恢复路径，覆盖本地、远端、WebDAV 与 S3。
6. **Settings/UI：** 自动扫描开关和 OpenCode Go 用量复用本地模块结构；远端使用 target-aware 变体。Otty 和恢复页退出保持 local-only。

### 4. 远程漂移审计

逐条追踪 Provider、Auth Center、Usage、Prompt/Restore 的可见控件到最终写入目标：

1. 组件和嵌套弹窗接收 `target`；
2. query key 包含 target identity；
3. remote target 调用 `remoteApi` 并携带选中 profile/secret；
4. remote target 不调用本地 `invoke(...)`、本地 OAuth、浏览器、终端、live 配置或数据迁移；
5. Helper 命令复用共享 Rust 服务且仅在实现后公布 capability；
6. 失败保留远端旧状态和可用长会话；成功后只刷新对应目标。

### 5. 数据迁移与回退

1. 使用隔离的 v17 fixture 分别验证桌面数据库和 Helper 数据库迁移到 v18；确认 `last_byte_offset`、`last_tail_fingerprint` 和存量 NULL 游标转换语义。
2. 将迁移前备份从 best-effort 改为 fail-closed：备份创建或可读性验证失败时不改变 `user_version` 和表结构。每台远端主机独立备份，不能用本地数据库替代远端状态。
3. 开发构建继续使用独立数据目录，不得触碰已安装 fork 的 v17 数据库。
4. 回退只能恢复 v17 备份，不能让旧二进制直接打开 v18 数据库。
5. 对当前已安装 fork v3.20.1 验证正常 About 更新路径和数据库恢复更新路径，再验证重启后 schema 18。

### 6. 版本与发布

功能和迁移验证完成后，将以下版本统一为 `3.20.2`：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- fork release notes 与 GitHub tag

不得覆盖现有 fork `v3.20.1` 标签，也不得把上游同名 tag 直接推送到 fork。新发布说明应指明“fork v3.20.2，稳定基线 upstream v3.20.1”。

## 最小验证矩阵

### 前端与目标路由

- Codex 编辑、config-only bearer、Auth Center 多账号、拒绝切换回滚；
- remote target 调用 Helper，local target 保持原 Tauri API，remote target 不触发本地 OAuth/终端/live 配置；
- Usage 自动扫描设置、手动同步、target-qualified query key；
- Prompt/Backup/WebDAV/S3 恢复不删除未受管 Prompt；
- Otty 仅出现在本地设置；
- `pnpm typecheck` 与受影响 Vitest 套件。

### Rust 与 Helper

- v17→v18 schema fixture、备份失败不迁移、mtime 不变的外部改写、截断/外改日志、字节游标续扫、Pi 去重；
- Provider/Codex config-only 写入、历史配置归一化、失败回滚、Team workspace 多成员；
- 本地与 Helper 共用服务的回归测试；
- `ok: true` 无 `data` 的单位操作和命令级错误保持 Helper session；
- `cargo fmt --check --manifest-path src-tauri/Cargo.toml`；
- `cargo test --manifest-path src-tauri/Cargo.toml --lib cli::tests::`；
- `cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote-helper --no-default-features --features proxy-runtime`。

### fork 配置与发布链

- 对 fork `v3.20.1` 做机械配置 diff；所有差异必须是已记录的上游功能、适配或 `3.20.2` 版本变更；
- 扫描 `src`、`src-tauri`、`scripts`、`.github` 中的上游仓库 URL、错误 alias、updater endpoint 和 Helper repo；
- 验证 `latest.json`、资产 URL、签名 key id、更新器公钥、About 更新和恢复更新指向 fork；
- 验证各平台现有有效资产不因单平台失败而被无故重建。

## 发布门禁

满足以下条件前不得发布：

- 精确上游 v3.20.1 peeled commit 是候选分支祖先，且没有标签后的上游提交；
- 18 个预期冲突和 43 个重叠文件均完成代码级审计；
- fork 身份、README、数据目录、updater、签名和 Helper 发布链未漂移；
- 当前已安装 fork v3.20.1 能通过正常路径升级；schema 不兼容场景能通过恢复页升级并退出；
- 本地与远端 v17→v18、Codex 重登、config-only 和失败保持行为均有证据；
- 远端真实 SSH 验证若无法执行，必须明确列为未验证风险，不能用 mock 冒充。

## 备选方案

- **Cherry-pick 部分修复：不推荐。** 该 Release 的 Codex、Provider、Proxy、Usage 和 schema 变化相互耦合；选择性移植容易遗漏兼容与回滚语义，也会增加后续上游合并成本。
- **将 fork 标为 `3.20.1-remote.1`：不推荐。** SemVer 预发布版本低于已安装的稳定 `3.20.1`，不能形成可靠的更新路径。
- **直接复用 fork `v3.20.1` 标签：禁止。** 同一仓库标签不可同时表示 fork 旧发布和上游新基线，会破坏可追溯性与更新器判断。
- **等待后续上游版本：可作为延期选择。** 只有在无法完成 schema、Codex 凭证和远端真实验证时才应延期；延期期间不得宣称已经同步 v3.20.1。
