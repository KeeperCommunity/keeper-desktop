use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
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

#[cfg(not(feature = "release"))]
static URL: &str = "https://keeper-channel-dev-8d01fa5233d0.herokuapp.com/";

#[cfg(feature = "release")]
static URL: &str = "https://channel.bitcoinkeeper.app/";

#[derive(Error, Debug)]
pub enum ChannelError {
    #[error("No client available")]
    NoClient,
    #[error("No room set")]
    NoRoom,
    #[error("No encryption key set")]
    NoEncryptionKey,
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

        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

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

        let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(key);

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

        let request_data = data
            .get("requestData")
            .ok_or("Failed to parse message data")?;

        let network = data
            .get("network")
            .ok_or("Failed to parse message network")?;

        let data = if request_data.get("encryptedData").is_some() {
            self.decrypt_data(request_data)
                .map_err(|_| "Failed to decrypt message from channel")?
        } else {
            request_data.clone()
        };

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
