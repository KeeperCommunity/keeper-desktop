import { invoke } from "@tauri-apps/api/tauri";
import { HWIDevice, HWIDeviceType } from "../helpers/devices";
import onekeyService from "./onekeyService";

interface Result<T> {
  Ok: T;
  Err: string;
}

const emptyTrezorDevice: HWIDevice = {
  device_type: "trezor",
  needs_pin_sent: true,
  model: "",
  path: "",
  needs_passphrase_sent: false,
  fingerprint: null,
};

let currentDeviceType: string | null = null;

const emitToChannel = async (eventData: unknown) => {
  if (currentDeviceType === "onekey") {
    await invoke<void>("emit_to_channel_with_network", {
      eventData,
      network: onekeyService.getCurrentNetwork(),
    });
    return;
  }
  await invoke<void>("emit_to_channel", { eventData });
};

const hwiService = {
  fetchDevices: async (
    deviceType: HWIDeviceType | null = null,
    network: string | null = null,
  ): Promise<HWIDevice[]> => {
    if (deviceType === "onekey") {
      return onekeyService.fetchDevices(network);
    }

    if (network === "mainnet") {
      network = "bitcoin";
    }
    const devices = await invoke<Result<HWIDevice>[]>(
      deviceType === "bitbox02" ? "async_hwi_enumerate" : "hwi_enumerate",
      {
        network,
      },
    );
    const updatedDevices = devices.map((device) =>
      device.Err && device.Err.includes("Trezor is locked")
        ? { Ok: emptyTrezorDevice }
        : device,
    );
    return updatedDevices
      .filter(
        (device) =>
          !deviceType || (device.Ok && device.Ok.device_type === deviceType),
      )
      .map((device) => ({
        ...device.Ok,
        device_type: device.Ok.device_type.toLowerCase() as HWIDeviceType,
      }));
  },

  setHWIClient: async (
    fingerprint: string | null,
    deviceType: string,
    network: string,
  ): Promise<void> => {
    currentDeviceType = deviceType;

    if (deviceType === "onekey") {
      await onekeyService.setHWIClient(fingerprint, network);
      return;
    }

    if (network === "mainnet") {
      network = "bitcoin";
    }
    await invoke<void>("set_hwi_client", { fingerprint, deviceType, network });
  },

  shareXpubs: async (account: number): Promise<void> => {
    const eventData =
      currentDeviceType === "onekey"
        ? await onekeyService.shareXpubs(account)
        : await invoke("hwi_get_xpubs", { account });

    await emitToChannel(eventData);
  },

  performHealthCheck: async (account: number): Promise<void> => {
    const eventData =
      currentDeviceType === "onekey"
        ? await onekeyService.performHealthCheck(account)
        : await invoke<void>("hwi_healthcheck", { account });

    await emitToChannel(eventData);
  },

  signTx: async (
    psbt: string,
    policy: string | null,
    walletName: string | null,
    hmac: string | null,
  ): Promise<void> => {
    const eventData =
      currentDeviceType === "onekey"
        ? await onekeyService.signTx(psbt)
        : await invoke<void>("hwi_sign_tx", {
            psbt,
            policy,
            walletName,
            hmac,
          });

    await emitToChannel(eventData);
  },

  registerMultisig: async (
    descriptor: string | null,
    policy: string | null,
    walletName: string | null,
    expectedAddress: string,
  ): Promise<void> => {
    if (currentDeviceType === "onekey") {
      throw new Error("Operation not supported on OneKey");
    }

    const eventData = await invoke<void>("hwi_register_multisig", {
      descriptor,
      policy,
      walletName,
      expectedAddress,
    });

    await emitToChannel(eventData);
  },

  verifyAddress: async (
    descriptor: string | null,
    policy: string | null,
    index: number | null,
    walletName: string | null,
    hmac: string | null,
    expectedAddress: string,
  ): Promise<void> => {
    const eventData =
      currentDeviceType === "onekey"
        ? await onekeyService.verifyAddress(
            descriptor,
            policy,
            index,
            walletName,
            hmac,
            expectedAddress,
          )
        : await invoke<void>("hwi_verify_address", {
            descriptor,
            policy,
            index,
            walletName,
            hmac,
            expectedAddress,
          });

    await emitToChannel(eventData);
  },

  promptPin: async (): Promise<void> => {
    if (currentDeviceType === "onekey") {
      return;
    }
    await invoke<void>("hwi_prompt_pin");
  },

  sendPin: async (pin: string): Promise<void> => {
    if (currentDeviceType === "onekey") {
      return;
    }
    await invoke<void>("hwi_send_pin", { pin });
  },
};

export default hwiService;
