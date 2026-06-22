use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

use crate::provider::Provider;

pub const REDACTED_SECRET_SENTINEL: &str = "[redacted]";

pub fn redact_provider_map_secret_values(value: &mut Value) {
    match value {
        Value::Object(providers) => {
            for provider in providers.values_mut() {
                redact_secret_values(provider);
            }
        }
        _ => redact_secret_values(value),
    }
}

pub fn redact_secret_values(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if is_secret_key(key) {
                    *child = Value::String(REDACTED_SECRET_SENTINEL.to_string());
                } else {
                    redact_secret_values(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_secret_values(item);
            }
        }
        _ => {}
    }
}

pub fn restore_redacted_secret_values(
    existing_provider: &Provider,
    provider: &mut Provider,
) -> Result<(), serde_json::Error> {
    restore_redacted_secret_values_for(existing_provider, provider)
}

pub fn restore_redacted_secret_values_for<T>(
    existing: &T,
    incoming: &mut T,
) -> Result<(), serde_json::Error>
where
    T: Serialize + DeserializeOwned,
{
    let existing = serde_json::to_value(existing)?;
    let mut incoming_value = serde_json::to_value(&incoming)?;
    merge_redacted_secret_values(&existing, &mut incoming_value);
    *incoming = serde_json::from_value(incoming_value)?;
    Ok(())
}

fn merge_redacted_secret_values(existing: &Value, incoming: &mut Value) {
    match (existing, incoming) {
        (Value::Object(existing_map), Value::Object(incoming_map)) => {
            for (key, incoming_child) in incoming_map.iter_mut() {
                if is_secret_key(key) && is_redacted_sentinel(incoming_child) {
                    if let Some(existing_child) = existing_map.get(key) {
                        *incoming_child = existing_child.clone();
                    }
                } else if let Some(existing_child) = existing_map.get(key) {
                    merge_redacted_secret_values(existing_child, incoming_child);
                }
            }
        }
        (Value::Array(existing_items), Value::Array(incoming_items)) => {
            for (existing_child, incoming_child) in existing_items.iter().zip(incoming_items) {
                merge_redacted_secret_values(existing_child, incoming_child);
            }
        }
        _ => {}
    }
}

fn is_secret_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized == "key"
        || normalized.contains("api_key")
        || normalized.contains("apikey")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("credential")
}

fn is_redacted_sentinel(value: &Value) -> bool {
    value.as_str() == Some(REDACTED_SECRET_SENTINEL)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn provider_output_redacts_nested_secret_values() {
        let mut value = json!({
            "provider": {
                "settingsConfig": {
                    "env": {
                        "ANTHROPIC_AUTH_TOKEN": "sk-secret",
                        "ANTHROPIC_BASE_URL": "https://example.com",
                        "OPENAI_API_KEY": "sk-openai"
                    }
                },
                "meta": {
                    "usage_script": {
                        "accessToken": "user-token",
                        "baseUrl": "https://usage.example.com"
                    }
                }
            }
        });

        redact_secret_values(&mut value);

        assert_eq!(
            value["provider"]["settingsConfig"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            REDACTED_SECRET_SENTINEL
        );
        assert_eq!(
            value["provider"]["settingsConfig"]["env"]["OPENAI_API_KEY"],
            REDACTED_SECRET_SENTINEL
        );
        assert_eq!(
            value["provider"]["meta"]["usage_script"]["accessToken"],
            REDACTED_SECRET_SENTINEL
        );
        assert_eq!(
            value["provider"]["settingsConfig"]["env"]["ANTHROPIC_BASE_URL"],
            "https://example.com"
        );
    }

    #[test]
    fn provider_map_redaction_does_not_treat_provider_ids_as_secret_keys() {
        let mut value = json!({
            "secret-provider": {
                "id": "secret-provider",
                "settingsConfig": {
                    "env": {
                        "ANTHROPIC_AUTH_TOKEN": "sk-secret",
                        "ANTHROPIC_BASE_URL": "https://example.com"
                    }
                }
            }
        });

        redact_provider_map_secret_values(&mut value);

        assert_eq!(value["secret-provider"]["id"], "secret-provider");
        assert_eq!(
            value["secret-provider"]["settingsConfig"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            REDACTED_SECRET_SENTINEL
        );
        assert_eq!(
            value["secret-provider"]["settingsConfig"]["env"]["ANTHROPIC_BASE_URL"],
            "https://example.com"
        );
    }

    #[derive(Debug, serde::Deserialize, serde::Serialize, PartialEq)]
    struct UniversalLike {
        #[serde(rename = "apiKey")]
        api_key: String,
        base_url: String,
    }

    #[test]
    fn generic_restore_preserves_redacted_universal_provider_api_key() {
        let existing = UniversalLike {
            api_key: "sk-existing".to_string(),
            base_url: "https://old.example.com".to_string(),
        };
        let mut incoming = UniversalLike {
            api_key: REDACTED_SECRET_SENTINEL.to_string(),
            base_url: "https://new.example.com".to_string(),
        };

        restore_redacted_secret_values_for(&existing, &mut incoming)
            .expect("restore redacted universal provider secret");

        assert_eq!(incoming.api_key, "sk-existing");
        assert_eq!(incoming.base_url, "https://new.example.com");
    }
}
