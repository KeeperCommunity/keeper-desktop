use async_hwi::{
    bitbox::{api::runtime, BitBox02, ConfigError, NoiseConfig, NoiseConfigData, PairingBitbox02},
    coldcard,
    jade::{self, Jade},
    ledger::{HidApi, Ledger, LedgerSimulator, TransportHID},
    specter::{Specter, SpecterSimulator},
    HWI,
};
use bitcoin::{base64, hashes::hex::FromHex, Network};
use std::{
    error::Error,
    path::{Path, PathBuf},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use tauri::Manager;

pub struct Wallet<'a> {
    pub name: Option<&'a String>,
    pub policy: Option<&'a String>,
    pub hmac: Option<&'a String>,
}

pub const DEFAULT_FILE_NAME: &str = "bitbox02.json";

pub struct PersistedBitboxNoiseConfig {
    file_path: PathBuf,
}

impl async_hwi::bitbox::api::Threading for PersistedBitboxNoiseConfig {}

impl PersistedBitboxNoiseConfig {
    /// Creates a new persisting noise config, which stores the pairing information in "bitbox02.json"
    /// in the provided directory.
    pub fn new(global_datadir: &Path) -> PersistedBitboxNoiseConfig {
        PersistedBitboxNoiseConfig {
            file_path: global_datadir.join(DEFAULT_FILE_NAME),
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AppNoiseStaticKeypair {
    pub private: String,
    pub public: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EnhancedBitboxSettings {
    pub noise_config: NoiseConfigData,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EnhancedSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitbox: Option<EnhancedBitboxSettings>,
    #[serde(rename = "appNoiseStaticKeypair")]
    pub app_noise_static_keypair: AppNoiseStaticKeypair,
    #[serde(rename = "deviceNoiseStaticPubkeys")]
    pub device_noise_static_pubkeys: Vec<String>,
}

impl NoiseConfig for PersistedBitboxNoiseConfig {
    fn read_config(&self) -> Result<NoiseConfigData, async_hwi::bitbox::api::ConfigError> {
        if !self.file_path.exists() {
            return Ok(NoiseConfigData::default());
        }

        let mut file =
            std::fs::File::open(&self.file_path).map_err(|e| ConfigError(e.to_string()))?;

        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| ConfigError(e.to_string()))?;

        let settings = serde_json::from_str::<EnhancedSettings>(&contents)
            .map_err(|e| ConfigError(e.to_string()))?;

        // Decode private key and device pubkeys from base64
        let app_static_privkey = base64::engine::general_purpose::STANDARD
            .decode(&settings.app_noise_static_keypair.private)
            .map_err(|e| ConfigError(e.to_string()))?;
        let device_static_pubkeys = settings
            .device_noise_static_pubkeys
            .iter()
            .map(|key| {
                base64::engine::general_purpose::STANDARD
                    .decode(key)
                    .map_err(|e| ConfigError(e.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(NoiseConfigData {
            app_static_privkey: Some(
                app_static_privkey
                    .try_into()
                    .map_err(|_| ConfigError("Invalid private key length".to_string()))?,
            ),
            device_static_pubkeys,
        })
    }

    fn store_config(&self, conf: &NoiseConfigData) -> Result<(), ConfigError> {
        let priv_key = conf.app_static_privkey.as_ref();
        let pub_keys = &conf.device_static_pubkeys;

        if let (Some(priv_key), Some(pub_keys)) = (priv_key, Some(pub_keys)) {
            // Derive public key from private key
            let secret = x25519_dalek::StaticSecret::from(*priv_key);
            let pub_key = x25519_dalek::PublicKey::from(&secret);
            let public_key = pub_key.as_bytes();

            // Create the enhanced settings structure
            let enhanced_settings = EnhancedSettings {
                bitbox: None,
                app_noise_static_keypair: AppNoiseStaticKeypair {
                    private: base64::engine::general_purpose::STANDARD.encode(priv_key),
                    public: base64::engine::general_purpose::STANDARD.encode(public_key),
                },
                device_noise_static_pubkeys: pub_keys
                    .iter()
                    .map(|key| base64::engine::general_purpose::STANDARD.encode(key))
                    .collect(),
            };

            // Serialize and write to file (using to_string instead of to_string_pretty)
            let data = serde_json::to_string(&enhanced_settings)
                .map_err(|e| ConfigError(e.to_string()))?;

            // Create directory if it doesn't exist
            if let Some(parent) = self.file_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| ConfigError(e.to_string()))?;
            }

            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&self.file_path)
                .map_err(|e| ConfigError(e.to_string()))?;

            file.write_all(data.as_bytes())
                .map_err(|e| ConfigError(e.to_string()))
        } else {
            Err(ConfigError(
                "Missing required noise configuration data".to_string(),
            ))
        }
    }
}

fn get_bitbox_data_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    let app_data_dir = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(std::env::var("HOME").unwrap()).join(".config"));

    #[cfg(target_os = "macos")]
    let app_data_dir = PathBuf::from(std::env::var("HOME").unwrap())
        .join("Library")
        .join("Application Support");

    #[cfg(target_os = "windows")]
    let app_data_dir = PathBuf::from(std::env::var("APPDATA").unwrap());

    app_data_dir.join("bitbox").join("bitbox02")
}

pub async fn list_devices(
    network: Network,
    wallet: Option<Wallet<'_>>,
    app_handle: Option<tauri::AppHandle>,
) -> Result<Vec<Box<dyn HWI + Send>>, Box<dyn Error>> {
    let mut hws = Vec::new();

    if let Ok(device) = SpecterSimulator::try_connect().await {
        hws.push(device.into());
    }

    if let Ok(devices) = Specter::enumerate().await {
        for device in devices {
            hws.push(device.into());
        }
    }

    match jade::SerialTransport::enumerate_potential_ports() {
        Ok(ports) => {
            for port in ports {
                match jade::SerialTransport::new(port) {
                    Ok(transport) => {
                        let mut device = Jade::new(transport).with_network(network);
                        if let Ok(info) = device.get_info().await {
                            if info.jade_state == jade::api::JadeState::Locked {
                                if let Err(e) = device.auth().await {
                                    eprintln!("auth {:?}", e);
                                    continue;
                                }
                            }

                            // Check network compatibility
                            if (network == Network::Bitcoin
                                && info.jade_networks != jade::api::JadeNetworks::Main
                                && info.jade_networks != jade::api::JadeNetworks::All)
                                || (network != Network::Bitcoin
                                    && info.jade_networks == jade::api::JadeNetworks::Main)
                            {
                                continue; // Skip incompatible network configurations
                            }

                            device = device.with_wallet(
                                wallet
                                    .as_ref()
                                    .and_then(|w| w.name.as_ref())
                                    .ok_or::<Box<dyn Error>>("jade requires a wallet name".into())?
                                    .to_string(),
                            );

                            hws.push(device.into());
                        }
                    }
                    Err(e) => eprintln!("Failed to connect to Jade device: {:?}", e),
                }
            }
        }
        Err(e) => eprintln!("Error enumerating Jade devices: {:?}", e),
    }

    if let Ok(device) = LedgerSimulator::try_connect().await {
        hws.push(device.into());
    }

    let api = Box::new(HidApi::new().unwrap());

    for device_info in api.device_list() {
        if async_hwi::bitbox::is_bitbox02(device_info) {
            if let Ok(device) = device_info.open_device(&api) {
                let data_dir = get_bitbox_data_dir();

                if let Ok(device) = PairingBitbox02::<runtime::TokioRuntime>::connect(
                    device,
                    Some(Box::new(PersistedBitboxNoiseConfig::new(&data_dir))),
                )
                .await
                {
                    let pairing_code = device.pairing_code();
                    if let (Some(code), Some(handle)) = (pairing_code.clone(), &app_handle) {
                        handle
                            .emit_all("bitbox-pairing-code", code)
                            .unwrap_or_else(|e| eprintln!("Failed to emit pairing code: {}", e));
                    }

                    if let Ok(device) = device.wait_confirm().await {
                        if let (true, Some(handle)) = (pairing_code.is_some(), app_handle.as_ref())
                        {
                            handle
                                .emit_all("bitbox-pairing-code", "SUCCESS")
                                .unwrap_or_else(|e| {
                                    eprintln!("Failed to emit pairing success: {}", e)
                                });
                        }
                        let mut bb02 = BitBox02::from(device).with_network(network);
                        if let Some(policy) = wallet.as_ref().and_then(|w| w.policy) {
                            bb02 = bb02.with_policy(policy)?;
                        }
                        hws.push(bb02.into());
                    }
                }
            }
        }
        if device_info.vendor_id() == coldcard::api::COINKITE_VID
            && device_info.product_id() == coldcard::api::CKCC_PID
        {
            if let Some(sn) = device_info.serial_number() {
                if let Ok((cc, _)) = coldcard::api::Coldcard::open(&api, sn, None) {
                    let mut hw = coldcard::Coldcard::from(cc);
                    if let Some(ref wallet) = wallet {
                        hw = hw.with_wallet_name(
                            wallet
                                .name
                                .ok_or::<Box<dyn Error>>("coldcard requires a wallet name".into())?
                                .to_string(),
                        );
                    }
                    hws.push(hw.into())
                }
            }
        }
    }

    for detected in Ledger::<TransportHID>::enumerate(&api) {
        if let Ok(mut device) = Ledger::<TransportHID>::connect(&api, detected) {
            if let Some(ref wallet) = wallet {
                let hmac = if let Some(s) = wallet.hmac {
                    let mut h = [b'\0'; 32];
                    h.copy_from_slice(&Vec::from_hex(s)?);
                    Some(h)
                } else {
                    None
                };
                device = device.with_wallet(
                    wallet
                        .name
                        .ok_or::<Box<dyn Error>>("ledger requires a wallet name".into())?,
                    wallet
                        .policy
                        .ok_or::<Box<dyn Error>>("ledger requires a wallet policy".into())?,
                    hmac,
                )?;
            }
            hws.push(device.into());
        }
    }

    Ok(hws)
}

pub async fn get_miniscript_device_by_fingerprint(
    network: bitcoin::Network,
    fingerprint: Option<&str>,
    policy: &String,
    wallet_name: Option<&String>,
    hmac: Option<&String>,
) -> Result<Box<dyn async_hwi::HWI + Send>, String> {
    let devices = list_devices(
        network,
        Some(Wallet {
            name: wallet_name,
            policy: Some(policy),
            hmac,
        }),
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    for device in devices {
        if let Some(fg) = fingerprint {
            if fg.to_uppercase()
                != device
                    .get_master_fingerprint()
                    .await
                    .map_err(|e| e.to_string())?
                    .to_string()
                    .to_uppercase()
            {
                continue;
            }
        }
        return Ok(device);
    }
    Err("No matching device found".to_string())
}
