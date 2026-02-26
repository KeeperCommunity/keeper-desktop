// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod channel;
mod device;
mod hwi;
mod miniscript_hwi;
use async_hwi::AddressScript;
use bitcoin::base64::{engine::general_purpose, Engine as _};
use bitcoin::Address;
use channel::Channel;
use device::get_xpubs;
use hwi::error::Error;
use hwi::implementations::binary_implementation::BinaryHWIImplementation;
use hwi::interface::HWIClient;
use hwi::types::{HWIBinaryExecutor, HWIChain, HWIDevice, HWIDeviceType};
#[cfg(target_os = "linux")]
use log::warn;
use miniscript_hwi::{get_miniscript_device_by_fingerprint, list_devices, Wallet};
use serde_json::{json, Value};
#[cfg(target_os = "linux")]
use std::path::Path;
use std::str::FromStr;
use tauri::api::process::Command;
use tauri::{Manager, State};
use tokio::sync::Mutex;

pub type AppState = Mutex<AppStateInner>;
type HWIAppClient = HWIClient<BinaryHWIImplementation<HWIBinaryExecutorImpl>>;

pub struct HWIClientState {
    hwi: HWIAppClient,
    #[allow(dead_code)]
    device_type: HWIDeviceType,
    fingerprint: Option<String>,
    network: bitcoin::Network,
}

pub struct AppStateInner {
    channel: Channel,
    hwi: Option<HWIClientState>,
}

#[cfg(not(feature = "release"))]
static ENV: &str = "dev";

#[cfg(feature = "release")]
static ENV: &str = "prod";

// ==================== Channel Commands ====================

#[tauri::command]
async fn connect_channel(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut state = state.lock().await;
    if state.channel.client.is_none() {
        let new_channel = Channel::new(app_handle, 30).await;
        if new_channel.client.is_some() {
            state.channel = new_channel;
            Ok(true)
        } else {
            Err("Failed to connect channel".to_string())
        }
    } else {
        Ok(true)
    }
}

#[tauri::command]
fn disconnect_channel(state: State<'_, AppState>) -> Result<(), String> {
    let state = state.try_lock().map_err(|e| e.to_string())?;
    state.channel.disconnect().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_channel_secret(state: State<'_, AppState>) -> Result<String, String> {
    let state = state.try_lock().map_err(|e| e.to_string())?;
    Ok(state.channel.encryption_key.clone().unwrap_or_default())
}

#[tauri::command]
fn generate_encryption_key(state: State<'_, AppState>) -> Result<String, String> {
    let mut state = state.try_lock().map_err(|e| e.to_string())?;
    state
        .channel
        .generate_encryption_key()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn emit_to_channel(state: State<'_, AppState>, event_data: Value) -> Result<(), String> {
    let state = state.try_lock().map_err(|e| e.to_string())?;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;
    state
        .channel
        .emit(
            "CHANNEL_MESSAGE",
            event_data,
            false,
            Some(&hwi_state.network.to_string()),
        )
        .map_err(|e| e.to_string())
}

// ==================== HWI Commands ====================

#[tauri::command]
async fn hwi_enumerate(
    _: State<'_, AppState>,
    network: Option<bitcoin::Network>,
) -> Result<Vec<Result<HWIDevice, String>>, String> {
    HWIAppClient::enumerate(network.map(HWIChain::from))
        .map(|devices| {
            devices
                .into_iter()
                .map(|device| device.map_err(|e| e.to_string()))
                .collect()
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn async_hwi_enumerate(
    app_handle: tauri::AppHandle,
    _: State<'_, AppState>,
    network: Option<bitcoin::Network>,
) -> Result<Vec<Result<HWIDevice, String>>, String> {
    let devices = list_devices(
        network.unwrap_or(bitcoin::Network::Bitcoin),
        Some(Wallet {
            name: Some(&"none".to_string()), // Needed in case other devices which aren't the BB02 and require wallet name are connected
            policy: Some(&"none".to_string()), // Needed in case other devices which aren't the BB02 and require wallet policy are connected
            hmac: None,
        }),
        Some(app_handle),
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut hwi_devices = Vec::new();
    for device in devices {
        let fingerprint = device
            .get_master_fingerprint()
            .await
            .map_err(|e| e.to_string())?;
        hwi_devices.push(Ok(HWIDevice {
            device_type: HWIDeviceType::from(device.device_kind().to_string().as_str()),
            model: "".to_string(),
            path: "".to_string(),
            needs_pin_sent: false,
            needs_passphrase_sent: false,
            fingerprint: Some(fingerprint),
        }));
    }

    Ok(hwi_devices)
}

#[tauri::command]
fn set_hwi_client(
    state: State<'_, AppState>,
    fingerprint: Option<String>,
    device_type: HWIDeviceType,
    network: bitcoin::Network,
) -> Result<(), String> {
    let mut state = state.try_lock().map_err(|e| e.to_string())?;
    let client = HWIAppClient::find_device(
        None,
        Some(device_type.clone()),
        fingerprint.as_deref(),
        false,
        network,
    )
    .map_err(|e| e.to_string())?;
    state.hwi = Some(HWIClientState {
        hwi: client,
        device_type,
        fingerprint,
        network,
    });
    Ok(())
}

#[tauri::command]
async fn hwi_get_xpubs(state: State<'_, AppState>, account: usize) -> Result<Value, String> {
    let state = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;
    let xpub_data = get_xpubs(hwi_state, account).map_err(|e| e.to_string())?;

    Ok(json!({
        "event": "CHANNEL_MESSAGE",
        "data": {
            "responseData": {
                "action": "ADD_DEVICE",
                "data": xpub_data
            }
        }
    }))
}

#[tauri::command]
async fn hwi_healthcheck(state: State<'_, AppState>, account: usize) -> Result<Value, String> {
    let state = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;
    let xpub_data = get_xpubs(hwi_state, account).map_err(|e| e.to_string())?;

    Ok(json!({
        "event": "CHANNEL_MESSAGE",
        "data": {
            "responseData": {
                "action": "HEALTH_CHECK",
                "data": xpub_data
            }
        }
    }))
}

#[tauri::command]
async fn hwi_sign_tx(
    state: State<'_, AppState>,
    psbt: String,
    policy: Option<String>,
    wallet_name: Option<String>,
    hmac: Option<String>,
) -> Result<Value, String> {
    let state = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;

    let mut res_hmac = hmac.clone();

    let signed_psbt = if let Some(policy) = policy {
        // Miniscript policy path
        let mut device = get_miniscript_device_by_fingerprint(
            hwi_state.network,
            hwi_state.fingerprint.as_deref(),
            &policy,
            wallet_name.as_ref(),
            hmac.as_ref(),
        )
        .await?;

        let mut psbt_obj = bitcoin::Psbt::from_str(&psbt).map_err(|e| e.to_string())?;

        if hwi_state.device_type != HWIDeviceType::Coldcard {
            let is_registered = device
                .is_wallet_registered(&wallet_name.clone().unwrap_or_default(), &policy)
                .await
                .map_err(|e| e.to_string())?;

            if !is_registered {
                res_hmac = Some(hex::encode(
                    device
                        .register_wallet(
                            &wallet_name.clone().ok_or("Wallet name not provided")?,
                            &policy,
                        )
                        .await
                        .map_err(|e| e.to_string())?
                        .unwrap_or_default(),
                ));

                if res_hmac.is_some() && !res_hmac.clone().unwrap().is_empty() {
                    // Drop current device to free up the connection
                    drop(device);

                    // re-fetch the device with the new HMAC
                    device = get_miniscript_device_by_fingerprint(
                        hwi_state.network,
                        hwi_state.fingerprint.as_deref(),
                        &policy,
                        wallet_name.as_ref(),
                        res_hmac.as_ref(),
                    )
                    .await?;
                }
            }
        } else {
            // Coldcard change verification gives an error when xpubs are included for Miniscript scheme
            psbt_obj.xpub.clear();
        }

        device
            .sign_tx(&mut psbt_obj)
            .await
            .map_err(|e| e.to_string())?;
        psbt_obj.to_string()
    } else {
        general_purpose::STANDARD.encode(
            hwi_state
                .hwi
                .sign_tx(&bitcoin::Psbt::from_str(&psbt).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
                .serialize(),
        )
    };

    Ok(json!({
        "event": "CHANNEL_MESSAGE",
        "data": {
            "responseData": {
                "action": "SIGN_TX",
                "data": {
                    "signedSerializedPSBT": signed_psbt,
                    "hmac": res_hmac
                }
            }
        }
    }))
}

#[tauri::command]
async fn hwi_register_multisig(
    state: State<'_, AppState>,
    descriptor: Option<String>,
    policy: Option<String>,
    wallet_name: Option<String>,
    expected_address: String,
) -> Result<Value, String> {
    let state = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;

    let mut final_address = expected_address.clone();

    let mut res_hmac: Option<String> = None;

    if let Some(descriptor) = descriptor {
        // Descriptor path
        let address = hwi_state
            .hwi
            .display_address_with_desc(&descriptor)
            .map_err(|e| e.to_string())?;
        if address.address != Address::from_str(&expected_address).map_err(|e| e.to_string())? {
            return Err(
                "Address received from device does not match the expected address".to_string(),
            );
        }
        final_address = address.address.assume_checked().to_string().clone();
    } else if let Some(policy) = policy {
        // Miniscript policy path
        let device = get_miniscript_device_by_fingerprint(
            hwi_state.network,
            hwi_state.fingerprint.as_deref(),
            &policy,
            wallet_name.as_ref(),
            None,
        )
        .await?;

        res_hmac = Some(hex::encode(
            device
                .register_wallet(&wallet_name.ok_or("Wallet name not provided")?, &policy)
                .await
                .map_err(|e| e.to_string())?
                .unwrap_or_default(),
        ));
    } else {
        return Err("Either descriptor or policy must be provided".to_string());
    }

    Ok(json!({
        "event": "CHANNEL_MESSAGE",
        "data": {
            "responseData": {
                "action": "REGISTER_MULTISIG",
                "data": {
                    "address": final_address,
                    "hmac": res_hmac
                }
            }
        }
    }))
}

#[tauri::command]
async fn hwi_verify_address(
    state: State<'_, AppState>,
    descriptor: Option<String>,
    policy: Option<String>,
    index: Option<usize>,
    wallet_name: Option<String>,
    hmac: Option<String>,
    expected_address: String,
) -> Result<Value, String> {
    let state = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;

    let mut final_address = expected_address.clone();

    let mut res_hmac = hmac.clone();

    if let Some(descriptor) = descriptor {
        // Descriptor path
        let address = hwi_state
            .hwi
            .display_address_with_desc(&descriptor)
            .map_err(|e| e.to_string())?;
        if address.address != Address::from_str(&expected_address).map_err(|e| e.to_string())? {
            return Err(
                "Address received from device does not match the expected address".to_string(),
            );
        }
        final_address = address.address.assume_checked().to_string().clone();
    } else if let Some(policy) = policy {
        // Miniscript policy path
        let mut device = get_miniscript_device_by_fingerprint(
            hwi_state.network,
            hwi_state.fingerprint.as_deref(),
            &policy,
            wallet_name.as_ref(),
            hmac.as_ref(),
        )
        .await?;

        if hwi_state.device_type != HWIDeviceType::Coldcard {
            let is_registered = device
                .is_wallet_registered(&wallet_name.clone().unwrap_or_default(), &policy)
                .await
                .map_err(|e| e.to_string())?;

            if !is_registered {
                res_hmac = Some(hex::encode(
                    device
                        .register_wallet(
                            &wallet_name.clone().ok_or("Wallet name not provided")?,
                            &policy,
                        )
                        .await
                        .map_err(|e| e.to_string())?
                        .unwrap_or_default(),
                ));

                if res_hmac.is_some() && !res_hmac.clone().unwrap().is_empty() {
                    // Drop current device to free up the connection
                    drop(device);

                    // re-fetch the device with the new HMAC
                    device = get_miniscript_device_by_fingerprint(
                        hwi_state.network,
                        hwi_state.fingerprint.as_deref(),
                        &policy,
                        wallet_name.as_ref(),
                        res_hmac.as_ref(),
                    )
                    .await?;
                }
            }
        }

        device
            .display_address(&AddressScript::Miniscript {
                index: index
                    .ok_or("Index must be provided")?
                    .try_into()
                    .map_err(|_| "Index conversion failed".to_string())?,
                change: false,
            })
            .await
            .map_err(|e| e.to_string())?;
    } else {
        return Err("Either descriptor or policy must be provided".to_string());
    }

    Ok(json!({
        "event": "CHANNEL_MESSAGE",
        "data": {
            "responseData": {
                "action": "VERIFY_ADDRESS",
                "data": {
                    "address": final_address,
                    "hmac": res_hmac
                }
            }
        }
    }))
}

#[tauri::command]
async fn hwi_prompt_pin(state: State<'_, AppState>) -> Result<(), String> {
    let state = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;
    hwi_state.hwi.prompt_pin().map_err(|e| e.to_string())
}

#[tauri::command]
async fn hwi_send_pin(state: State<'_, AppState>, pin: String) -> Result<(), String> {
    let state: tokio::sync::MutexGuard<'_, AppStateInner> = state.lock().await;
    let hwi_state = state.hwi.as_ref().ok_or("HWI client not initialized")?;
    hwi_state.hwi.send_pin(&pin).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn check_udev_rules() -> Result<bool, String> {
    let udev_file = Path::new("/etc/udev/rules.d/51-coinkite.rules");
    Ok(udev_file.exists())
}

#[tauri::command]
fn get_environment() -> String {
    ENV.into()
}

fn main() {
    env_logger::init();
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                if !check_udev_rules().unwrap_or(false) {
                    warn!("udev rules are not installed. Trying to install them.");
                    let result = HWIAppClient::install_udev_rules(None, None);
                    if result.is_err() {
                        warn!("Failed to install udev rules: {}", result.err().unwrap());
                    }
                }
            }
            let app_state = AppStateInner {
                channel: Channel::new_empty(),
                hwi: None,
            };
            app.manage(Mutex::new(app_state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_channel,
            disconnect_channel,
            get_channel_secret,
            generate_encryption_key,
            hwi_enumerate,
            set_hwi_client,
            hwi_get_xpubs,
            hwi_healthcheck,
            hwi_sign_tx,
            hwi_register_multisig,
            hwi_verify_address,
            emit_to_channel,
            hwi_send_pin,
            hwi_prompt_pin,
            async_hwi_enumerate,
            get_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct HWIBinaryExecutorImpl;

impl HWIBinaryExecutor for HWIBinaryExecutorImpl {
    fn execute_command(args: Vec<String>) -> Result<String, Error> {
        let mut args = args;

        args.insert(0, "--emulators".to_string());

        let output = Command::new_sidecar("hwi")
            .map_err(|e| Error::Hwi(format!("Failed to create sidecar command: {}", e), None))?
            .args(args)
            .output()
            .map_err(|e| Error::Hwi(format!("Failed to execute command: {}", e), None))?;

        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(Error::Hwi(output.stderr, None))
        }
    }
}
