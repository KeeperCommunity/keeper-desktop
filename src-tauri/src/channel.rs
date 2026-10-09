use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use log::{error, info, warn};
use rust_socketio::client::Client;
use rust_socketio::{ClientBuilder, Event, Payload};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::ops::Drop;
use std::time::Duration;
use tauri::Manager;
use thiserror::Error;
use tokio::time::timeout;

static URL: &str = "https://channel.bitcoinkeeper.app/";

#[derive(Error, Debug)]
pub enum ChannelError {
    #[error("No client available")]
    NoClient,
    #[error("No room set")]
    NoRoom,
    #[error("No encryption key set")]
    NoEncryptionKey,
    #[error("Invalid encryption key")]
    InvalidEncryptionKey,
    #[error("Invalid IV")]
    InvalidIV,
    #[error("Invalid encrypted data")]
    InvalidEncryptedData,
    #[error("Encryption error: {0}")]
    EncryptionError(String),
    #[error("Decryption error: {0}")]
    DecryptionError(String),
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Hex decoding error: {0}")]
    HexError(#[from] hex::FromHexError),
    #[error("UTF-8 conversion error: {0}")]
    Utf8Error(#[from] std::string::FromUtf8Error),
    #[error("Socket.IO error: {0}")]
    SocketIoError(String),
    #[error("Connection timed out")]
    ConnectionTimeout,
}

pub struct Channel {
    pub client: Option<Client>,
    pub room: Option<String>,
    pub encryption_key: Option<String>,
}

impl Channel {
    pub async fn new(app_handle: tauri::AppHandle, timeout_secs: u64) -> Self {
        let client = create_client_with_timeout(app_handle, timeout_secs).await;
        if let Err(e) = &client {
            error!("Error connecting to channel: {}", e);
        }

        Channel {
            client: client.ok(),
            room: None,
            encryption_key: None,
        }
    }

    pub fn new_empty() -> Self {
        Channel {
            client: None,
            room: None,
            encryption_key: None,
        }
    }

    /// Disconnects the Socket.IO client
    pub fn disconnect(&self) -> Result<(), ChannelError> {
        if let Some(client) = &self.client {
            client
                .disconnect()
                .map_err(|e| ChannelError::SocketIoError(e.to_string()))?;
        }
        Ok(())
    }

    /// Emits an event with data to the current room
    ///
    /// If `skip_encryption` is false, the data will be encrypted before sending
    pub fn emit(
        &self,
        event: &str,
        data: serde_json::Value,
        skip_encryption: bool,
        network: Option<&str>,
    ) -> Result<(), ChannelError> {
        let encrypted = if !skip_encryption {
            self.encrypt_data(data)?
        } else {
            serde_json::to_value(data.to_string())?
        };

        if let Some(room) = &self.room {
            if let Some(client) = &self.client {
                let mut data = json!({"room": room, "data": encrypted});
                if let Some(network) = network {
                    data["network"] = serde_json::Value::String(if network == "bitcoin" {
                        "MAINNET".to_string()
                    } else {
                        "TESTNET".to_string()
                    });
                }
                client
                    .emit(event, data)
                    .map_err(|e| ChannelError::SocketIoError(e.to_string()))?;
                Ok(())
            } else {
                Err(ChannelError::NoClient)
            }
        } else {
            Err(ChannelError::NoRoom)
        }
    }

    /// Generates a new encryption key and joins a new room
    ///
    /// Returns the generated encryption key
    pub fn generate_encryption_key(&mut self) -> Result<String, ChannelError> {
        let mut random_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut random_bytes);
        let key = hex::encode(random_bytes);
        let room = hex::encode(Sha256::digest(&key));
        self.encryption_key = Some(key.clone());
        self.room = Some(room.clone());

        self.emit("JOIN_CHANNEL", json!({"room": room}), true, None)?;

        Ok(key)
    }

    /// Encrypts the provided data using AES-256-GCM
    ///
    /// Returns a JSON object containing the iv, encrypted data, and authTag
    fn encrypt_data(&self, data: serde_json::Value) -> Result<serde_json::Value, ChannelError> {
        let encryption_key = self
            .encryption_key
            .as_ref()
            .ok_or(ChannelError::NoEncryptionKey)?;
        let key_bytes = hex::decode(encryption_key)?;

        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|_| ChannelError::InvalidEncryptionKey)?;

        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes); // Use the variable here
        let data = data.to_string();
        let plaintext = data.as_bytes();

        let ciphertext_with_tag = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| ChannelError::EncryptionError(e.to_string()))?;

        let (ciphertext, auth_tag) = ciphertext_with_tag.split_at(ciphertext_with_tag.len() - 16);

        Ok(json!({
            "iv": hex::encode(nonce),
            "encryptedData": hex::encode(ciphertext),
            "authTag": hex::encode(auth_tag)
        }))
    }

    /// Decrypts the provided encrypted data
    ///
    /// Expects a JSON object containing the iv, encrypted data, and authTag
    pub fn decrypt_data(
        &self,
        encrypted: &serde_json::Value,
    ) -> Result<serde_json::Value, ChannelError> {
        let encryption_key = self
            .encryption_key
            .as_ref()
            .ok_or(ChannelError::NoEncryptionKey)?;
        let key_bytes = hex::decode(encryption_key)?;

        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .map_err(|_| ChannelError::InvalidEncryptionKey)?;

        let nonce = hex::decode(encrypted["iv"].as_str().ok_or(ChannelError::InvalidIV)?)?;
        let encrypted_data = hex::decode(
            encrypted["encryptedData"]
                .as_str()
                .ok_or(ChannelError::InvalidEncryptedData)?,
        )?;
        let auth_tag = hex::decode(
            encrypted["authTag"]
                .as_str()
                .ok_or(ChannelError::InvalidEncryptedData)?,
        )?;

        if nonce.len() != 12 {
            return Err(ChannelError::InvalidIV);
        }
        if auth_tag.len() != 16 {
            return Err(ChannelError::InvalidEncryptedData);
        }
        let nonce = Nonce::from_slice(&nonce);

        let mut combined_data = Vec::with_capacity(encrypted_data.len() + auth_tag.len());
        combined_data.extend_from_slice(&encrypted_data);
        combined_data.extend_from_slice(&auth_tag);

        let decrypted_data = cipher
            .decrypt(nonce, combined_data.as_ref())
            .map_err(|e| ChannelError::DecryptionError(e.to_string()))?;

        let decrypted_string = String::from_utf8(decrypted_data)?;

        serde_json::from_str(&decrypted_string).map_err(ChannelError::from)
    }

    pub fn process_channel_message(
        &self,
        message: &serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let data = message
            .as_array()
            .and_then(|arr| arr.first())
            .ok_or("Failed to parse message")?;

        let room = self.room.as_deref().ok_or("No active channel room")?;
        if data.get("room").and_then(|value| value.as_str()) != Some(room) {
            return Err("Message received from inactive room".to_string());
        }

        let request_data = data
            .get("requestData")
            .ok_or("Failed to parse message data")?;

        let network = data
            .get("network")
            .ok_or("Failed to parse message network")?;

        let data = self
            .decrypt_data(request_data)
            .map_err(|_| "Failed to decrypt message from channel")?;

        Ok(json!({ "data": data, "network": network }))
    }
}

impl Drop for Channel {
    fn drop(&mut self) {
        if let Err(e) = self.disconnect() {
            error!("Error disconnecting channel on drop: {}", e);
        }
    }
}

async fn create_client_with_timeout(
    app_handle: tauri::AppHandle,
    timeout_secs: u64,
) -> Result<Client, ChannelError> {
    let client_future = tokio::task::spawn_blocking(move || create_client(app_handle));

    match timeout(Duration::from_secs(timeout_secs), client_future).await {
        Ok(result) => result.map_err(|e| ChannelError::SocketIoError(e.to_string()))?,
        Err(_elapsed) => Err(ChannelError::ConnectionTimeout),
    }
}

fn create_client(app_handle: tauri::AppHandle) -> Result<Client, ChannelError> {
    ClientBuilder::new(URL)
        .on(Event::Connect, |_, _| {
            info!("Channel connected");
        })
        .on(Event::Error, |err, _| {
            error!("Channel error: {:#?}", err);
        }).on_any({
            move |event, payload, _| {
                match payload {
                    #[allow(deprecated)]
                    Payload::String(str) => warn!("Received unexpected string: {}", str),
                    Payload::Text(text) => {
                        info!("Channel received event: {:?} with message: {:?}", event.as_str(), text);
                        if event.as_str() == "CHANNEL_MESSAGE" {
                            if let Ok(state) = app_handle.state::<crate::AppState>().try_lock() {
                                let text = serde_json::to_value(text).map_err(|_| "Failed to parse message as JSON");
                                if let Ok(text) = text {
                                    match state.channel.process_channel_message(&text) {
                                        Ok(processed_data) => {
                                            if let Err(e) = app_handle.emit_all("channel-message", processed_data) {
                                                error!("Failed to emit channel-message event: {:?}, got error: {:?}", text, e);
                                            }
                                        },
                                        Err(e) => error!("Error processing message: {}", e),
                                    }
                                } else {
                                    error!("Error converting text to JSON: {}", text.err().unwrap());
                                }
                            }
                        }
                    },
                    Payload::Binary(bin_data) => warn!("Received unexpected bytes: {:#?}", bin_data),
                }
            }
        })
        .connect()
        .map_err(|e| ChannelError::SocketIoError(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("fixtures/channel-crypto-vectors.json")).unwrap()
    }

    fn test_channel(key: &str) -> Channel {
        Channel {
            client: None,
            room: Some(hex::encode(Sha256::digest(key))),
            encryption_key: Some(key.to_string()),
        }
    }

    fn request_message(room: &str, request_data: serde_json::Value) -> serde_json::Value {
        json!([{"room": room, "requestData": request_data, "network": "TESTNET"}])
    }

    #[test]
    fn mobile_signing_vector_is_accepted_with_testnet_network() {
        let fixture = fixture();
        let channel = test_channel(fixture["key"].as_str().unwrap());
        let message = request_message(
            channel.room.as_deref().unwrap(),
            fixture["request"]["ciphertext"].clone(),
        );
        assert_eq!(
            channel.process_channel_message(&message).unwrap(),
            json!({"data": fixture["request"]["plaintext"], "network": "TESTNET"})
        );
    }

    #[test]
    fn missing_or_inactive_room_never_reaches_desktop() {
        let fixture = fixture();
        let mut channel = test_channel(fixture["key"].as_str().unwrap());
        let ciphertext = fixture["request"]["ciphertext"].clone();
        let missing_room = json!([{"requestData": ciphertext.clone(), "network": "TESTNET"}]);
        assert!(channel.process_channel_message(&missing_room).is_err());

        let old_room = request_message(&"00".repeat(32), ciphertext.clone());
        assert!(channel.process_channel_message(&old_room).is_err());

        let current_room = request_message(channel.room.as_deref().unwrap(), ciphertext);
        channel.room = None;
        assert!(channel.process_channel_message(&current_room).is_err());
    }

    #[test]
    fn plaintext_or_incomplete_envelope_is_rejected_in_active_room() {
        let fixture = fixture();
        let channel = test_channel(fixture["key"].as_str().unwrap());
        let room = channel.room.as_deref().unwrap();
        let plaintext = request_message(room, fixture["request"]["plaintext"].clone());
        assert!(channel.process_channel_message(&plaintext).is_err());

        let mut incomplete = fixture["request"]["ciphertext"].clone();
        incomplete.as_object_mut().unwrap().remove("authTag");
        assert!(channel
            .process_channel_message(&request_message(room, incomplete))
            .is_err());
    }

    #[test]
    fn rotating_qr_rejects_old_room_and_accepts_new_session() {
        let fixture = fixture();
        let mut channel = test_channel(fixture["key"].as_str().unwrap());
        let old_request = request_message(
            channel.room.as_deref().unwrap(),
            fixture["request"]["ciphertext"].clone(),
        );

        let new_key = "01".repeat(32);
        channel.room = Some(hex::encode(Sha256::digest(&new_key)));
        channel.encryption_key = Some(new_key);
        assert!(channel.process_channel_message(&old_request).is_err());

        let new_ciphertext = channel
            .encrypt_data(fixture["request"]["plaintext"].clone())
            .unwrap();
        let new_request = request_message(channel.room.as_deref().unwrap(), new_ciphertext);
        assert_eq!(
            channel.process_channel_message(&new_request).unwrap(),
            json!({"data": fixture["request"]["plaintext"], "network": "TESTNET"})
        );
    }

    #[test]
    fn desktop_response_keeps_mobile_event_data_response_shape() {
        let fixture = fixture();
        let channel = test_channel(fixture["key"].as_str().unwrap());
        let encrypted = channel
            .encrypt_data(fixture["response"]["plaintext"].clone())
            .unwrap();
        assert_eq!(encrypted["iv"].as_str().unwrap().len(), 24);
        assert_eq!(encrypted["authTag"].as_str().unwrap().len(), 32);
        assert_eq!(
            channel.decrypt_data(&encrypted).unwrap(),
            fixture["response"]["plaintext"]
        );
        assert_eq!(
            channel
                .decrypt_data(&fixture["response"]["ciphertext"])
                .unwrap(),
            fixture["response"]["plaintext"]
        );
    }

    #[test]
    fn malformed_nonce_returns_error_without_panicking() {
        let fixture = fixture();
        let channel = test_channel(fixture["key"].as_str().unwrap());
        for iv in ["", "00", "000102030405060708090a0b0c"] {
            let mut encrypted = fixture["request"]["ciphertext"].clone();
            encrypted["iv"] = json!(iv);
            assert!(matches!(
                channel.decrypt_data(&encrypted),
                Err(ChannelError::InvalidIV)
            ));
        }
    }

    #[test]
    fn malformed_key_returns_error_without_panicking() {
        let fixture = fixture();
        for key in ["", "00", "000102030405060708090a0b0c0d0e0f"] {
            let channel = test_channel(key);
            assert!(matches!(
                channel.decrypt_data(&fixture["request"]["ciphertext"]),
                Err(ChannelError::InvalidEncryptionKey)
            ));
            assert!(matches!(
                channel.encrypt_data(json!({"action": "SIGN_TX"})),
                Err(ChannelError::InvalidEncryptionKey)
            ));
        }
    }

    #[test]
    fn invalid_auth_tag_or_ciphertext_never_returns_signing_data() {
        let fixture = fixture();
        let channel = test_channel(fixture["key"].as_str().unwrap());
        let mut encrypted = fixture["request"]["ciphertext"].clone();
        encrypted["authTag"] = json!("00");
        assert!(matches!(
            channel.decrypt_data(&encrypted),
            Err(ChannelError::InvalidEncryptedData)
        ));
        for field in ["iv", "encryptedData", "authTag"] {
            let mut encrypted = fixture["request"]["ciphertext"].clone();
            let original = encrypted[field].as_str().unwrap();
            let altered = format!(
                "{}{}",
                if original.starts_with('0') { '1' } else { '0' },
                &original[1..]
            );
            encrypted[field] = json!(altered);
            assert!(channel.decrypt_data(&encrypted).is_err());
        }
    }

    #[test]
    fn different_qr_session_cannot_decrypt_request() {
        let fixture = fixture();
        assert!(test_channel(&"01".repeat(32))
            .decrypt_data(&fixture["request"]["ciphertext"])
            .is_err());
    }
}
