use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use tauri_plugin_store::StoreExt;

use crate::error::AppError;

/// Store 中的键名
const STORE_KEY_APP_CONFIG_DIR: &str = "app_config_dir_override";

/// 缓存当前的 app_config_dir 覆盖路径，避免存储 AppHandle
static APP_CONFIG_DIR_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

fn override_cache() -> &'static RwLock<Option<PathBuf>> {
    APP_CONFIG_DIR_OVERRIDE.get_or_init(|| RwLock::new(None))
}

fn update_cached_override(value: Option<PathBuf>) {
    if let Ok(mut guard) = override_cache().write() {
        *guard = value;
    }
}

/// 获取缓存中的 app_config_dir 覆盖路径
pub fn get_app_config_dir_override() -> Option<PathBuf> {
    override_cache().read().ok()?.clone()
}

/// CLI/helper builds do not have a Tauri AppHandle available. In desktop builds
/// this is only used by JSON CLI tests and accidental helper-style invocations;
/// the real desktop app continues to persist through `set_app_config_dir_to_store`.
pub fn set_app_config_dir_override_for_cli(path: Option<&str>) -> Result<(), AppError> {
    let value = match path.map(str::trim) {
        Some(trimmed) if !trimmed.is_empty() && trimmed != "-" => {
            let path = crate::config::validate_app_config_dir_override(&resolve_path(trimmed))?;
            fs::create_dir_all(&path).map_err(|e| AppError::io(&path, e))?;
            Some(path)
        }
        _ => None,
    };
    update_cached_override(value);
    Ok(())
}

fn read_override_from_store(app: &tauri::AppHandle) -> Option<PathBuf> {
    let store = match app.store_builder("app_paths.json").build() {
        Ok(store) => store,
        Err(e) => {
            log::warn!("无法创建 Store: {e}");
            return None;
        }
    };

    match store.get(STORE_KEY_APP_CONFIG_DIR) {
        Some(Value::String(path_str)) => {
            let path_str = path_str.trim();
            if path_str.is_empty() {
                return None;
            }

            let path =
                match crate::config::validate_app_config_dir_override(&resolve_path(path_str)) {
                    Ok(path) => path,
                    Err(error) => {
                        log::warn!("拒绝不安全的 app_config_dir Store 覆盖: {error}");
                        return None;
                    }
                };

            if !path.exists() {
                log::warn!(
                    "Store 中配置的 app_config_dir 不存在: {path:?}\n\
                     将使用默认路径。"
                );
                return None;
            }

            log::info!("使用 Store 中的 app_config_dir: {path:?}");
            Some(path)
        }
        Some(_) => {
            log::warn!("Store 中的 {STORE_KEY_APP_CONFIG_DIR} 类型不正确，应为字符串");
            None
        }
        None => None,
    }
}

/// 从 Store 刷新 app_config_dir 覆盖值并更新缓存
pub fn refresh_app_config_dir_override(app: &tauri::AppHandle) -> Option<PathBuf> {
    let value = read_override_from_store(app);
    update_cached_override(value.clone());
    value
}

/// 写入 app_config_dir 到 Tauri Store
pub fn set_app_config_dir_to_store(
    app: &tauri::AppHandle,
    path: Option<&str>,
) -> Result<(), AppError> {
    let store = app
        .store_builder("app_paths.json")
        .build()
        .map_err(|e| AppError::Message(format!("创建 Store 失败: {e}")))?;

    match path {
        Some(p) => {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                let validated =
                    crate::config::validate_app_config_dir_override(&resolve_path(trimmed))?;
                let normalized = validated.to_string_lossy().to_string();
                store.set(STORE_KEY_APP_CONFIG_DIR, Value::String(normalized.clone()));
                log::info!("已将 app_config_dir 写入 Store: {normalized}");
            } else {
                store.delete(STORE_KEY_APP_CONFIG_DIR);
                log::info!("已从 Store 中删除 app_config_dir 配置");
            }
        }
        None => {
            store.delete(STORE_KEY_APP_CONFIG_DIR);
            log::info!("已从 Store 中删除 app_config_dir 配置");
        }
    }

    store
        .save()
        .map_err(|e| AppError::Message(format!("保存 Store 失败: {e}")))?;

    refresh_app_config_dir_override(app);
    Ok(())
}

/// 解析路径，支持 ~ 开头的相对路径
fn resolve_path(raw: &str) -> PathBuf {
    if raw == "~" {
        return crate::config::get_home_dir();
    } else if let Some(stripped) = raw.strip_prefix("~/") {
        return crate::config::get_home_dir().join(stripped);
    } else if let Some(stripped) = raw.strip_prefix("~\\") {
        return crate::config::get_home_dir().join(stripped);
    }

    PathBuf::from(raw)
}

/// 从旧的 settings.json 迁移 app_config_dir 到 Store
pub fn migrate_app_config_dir_from_settings(app: &tauri::AppHandle) -> Result<(), AppError> {
    // app_config_dir 已从 settings.json 移除，此函数保留但不再执行迁移
    // 如果用户在旧版本设置过 app_config_dir，需要在 Store 中手动配置
    log::info!("app_config_dir 迁移功能已移除，请在设置中重新配置");

    let _ = refresh_app_config_dir_override(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use serial_test::serial;

    struct TestHomeGuard(Option<std::ffi::OsString>);

    impl TestHomeGuard {
        fn set(path: &std::path::Path) -> Self {
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", path);
            Self(previous)
        }
    }

    impl Drop for TestHomeGuard {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
        }
    }

    #[test]
    #[serial]
    fn rejects_upstream_app_config_directory_and_children() {
        let home = tempfile::tempdir().expect("temporary home");
        let _guard = TestHomeGuard::set(home.path());
        let upstream = home.path().join(".cc-switch");
        std::fs::create_dir_all(&upstream).expect("create upstream directory");

        assert!(crate::config::validate_app_config_dir_override(&upstream).is_err());
        assert!(crate::config::validate_app_config_dir_override(&upstream.join("nested")).is_err());
        assert!(crate::config::validate_app_config_dir_override(
            &home.path().join(".cc-switch-remote")
        )
        .is_ok());
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn rejects_symlink_alias_to_upstream_app_config_directory() {
        use std::os::unix::fs::symlink;

        let home = tempfile::tempdir().expect("temporary home");
        let _guard = TestHomeGuard::set(home.path());
        let upstream = home.path().join(".cc-switch");
        std::fs::create_dir_all(&upstream).expect("create upstream directory");
        let alias = home.path().join("remote-alias");
        symlink(&upstream, &alias).expect("create symlink alias");

        assert!(crate::config::validate_app_config_dir_override(&alias).is_err());
        assert!(crate::config::validate_app_config_dir_override(&alias.join("nested")).is_err());
    }
}
