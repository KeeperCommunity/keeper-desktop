import HardwareSDK from "@onekeyfe/hd-common-connect-sdk";
import { ONEKEY_WEBUSB_FILTER } from "@onekeyfe/hd-shared";
import { HWIDevice } from "../helpers/devices";

type OneKeyNetwork = "bitcoin" | "testnet";

type OneKeySdkResponse<T> = {
  success: boolean;
  payload: T;
};

type OneKeyDeviceInfo = {
  connectId?: string;
  deviceId?: string;
  name?: string;
};

type ActiveOneKeyDevice = {
  connectId: string;
  deviceId: string;
};

type WebUsbApi = {
  getDevices: () => Promise<unknown[]>;
  requestDevice: (options: { filters: unknown[] }) => Promise<unknown>;
};

type NavigatorWithUsb = {
  usb?: WebUsbApi;
};

const NETWORK_TO_COIN = {
  bitcoin: "btc",
  testnet: "test",
} as const;

let initialized = false;
let activeNetwork: OneKeyNetwork = "bitcoin";
let discoveredDevices: OneKeyDeviceInfo[] = [];
let activeDevice: ActiveOneKeyDevice | null = null;

const normalizeNetwork = (
  network: string | null | undefined,
): OneKeyNetwork => {
  if (!network) return "bitcoin";
  return network.toLowerCase() === "mainnet" ||
    network.toLowerCase() === "bitcoin"
    ? "bitcoin"
    : "testnet";
};

const getCoinType = (network: OneKeyNetwork) => (network === "bitcoin" ? 0 : 1);

const formatPath = (purpose: number, coinType: number, account: number) =>
  `m/${purpose}'/${coinType}'/${account}'`;

const toMasterFingerprint = (value: number | string | undefined) => {
  if (value === undefined) return "";
  if (typeof value === "number") {
    return (value >>> 0).toString(16).padStart(8, "0").toUpperCase();
  }
  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return (parsed >>> 0).toString(16).padStart(8, "0").toUpperCase();
  }
  return value.toUpperCase();
};

const assertSuccess = <T>(
  response: OneKeySdkResponse<T>,
  fallbackError: string,
): T => {
  if (!response?.success) {
    throw new Error(
      (response?.payload as { error?: string; message?: string } | undefined)
        ?.error ||
        (response?.payload as { error?: string; message?: string } | undefined)
          ?.message ||
        fallbackError,
    );
  }
  return response.payload;
};

const buildChannelEventData = (
  action: string,
  data: Record<string, unknown>,
) => ({
  event: "CHANNEL_MESSAGE",
  data: {
    responseData: {
      action,
      data,
    },
  },
});

const ensureInitialized = async () => {
  if (initialized) return;
  await HardwareSDK.init({
    env: "desktop-webusb",
    fetchConfig: true,
    debug: false,
  });
  initialized = true;
};

const ensureWebUsbPermission = async () => {
  const usb = (navigator as unknown as NavigatorWithUsb).usb;
  if (!usb?.getDevices || !usb?.requestDevice) {
    throw new Error("WebUSB is not available in this environment");
  }

  const authorizedDevices = await usb.getDevices();
  if (authorizedDevices.length) return;

  try {
    await usb.requestDevice({ filters: ONEKEY_WEBUSB_FILTER as unknown[] });
  } catch (error) {
    throw new Error(
      `OneKey USB authorization failed: ${(error as Error)?.message || String(error)}`,
    );
  }
};

const ensureActiveDevice = async (
  network?: string | null,
  preferredConnectId?: string | null,
) => {
  const resolvedNetwork = normalizeNetwork(network);
  activeNetwork = resolvedNetwork;

  await ensureInitialized();
  await ensureWebUsbPermission();

  if (activeDevice && !preferredConnectId) return activeDevice;

  const payload = assertSuccess(
    (await HardwareSDK.searchDevices()) as OneKeySdkResponse<
      OneKeyDeviceInfo[]
    >,
    "No OneKey device found",
  );
  discoveredDevices = Array.isArray(payload) ? payload : [];

  const selectedDevice =
    discoveredDevices.find((item) => item.connectId === preferredConnectId) ||
    discoveredDevices[0];

  if (!selectedDevice?.connectId) {
    throw new Error("No connected OneKey device available");
  }

  const featurePayload = assertSuccess(
    (await HardwareSDK.getFeatures(
      selectedDevice.connectId,
    )) as OneKeySdkResponse<{
      device_id?: string;
    }>,
    "Unable to read OneKey device features",
  );

  const resolvedDeviceId = featurePayload?.device_id || selectedDevice.deviceId;
  if (!resolvedDeviceId) {
    throw new Error("Unable to resolve OneKey deviceId");
  }

  activeDevice = {
    connectId: selectedDevice.connectId,
    deviceId: resolvedDeviceId,
  };

  return activeDevice;
};

const fetchDevices = async (network: string | null): Promise<HWIDevice[]> => {
  const resolvedNetwork = normalizeNetwork(network);
  activeNetwork = resolvedNetwork;

  await ensureInitialized();
  await ensureWebUsbPermission();

  const payload = assertSuccess(
    (await HardwareSDK.searchDevices()) as OneKeySdkResponse<
      OneKeyDeviceInfo[]
    >,
    "No OneKey device found",
  );

  discoveredDevices = Array.isArray(payload) ? payload : [];

  return discoveredDevices.map((item) => ({
    device_type: "onekey",
    model: item.name || "OneKey",
    path: item.connectId || "",
    needs_pin_sent: false,
    needs_passphrase_sent: false,
    fingerprint: item.connectId || null,
  }));
};

const setHWIClient = async (fingerprint: string | null, network: string) => {
  await ensureActiveDevice(network, fingerprint);
};

const getCurrentNetwork = () => activeNetwork;

const shareXpubs = async (account: number) => {
  const device = await ensureActiveDevice(activeNetwork);
  const coinType = getCoinType(activeNetwork);
  const coin = NETWORK_TO_COIN[activeNetwork];

  const singleSigPath = formatPath(84, coinType, account);
  const multiSigPath = `${formatPath(48, coinType, account)}/2'`;
  const taprootPath = formatPath(86, coinType, account);

  const singleSig = assertSuccess(
    (await HardwareSDK.btcGetPublicKey(device.connectId, device.deviceId, {
      path: singleSigPath,
      coin,
      showOnOneKey: false,
      scriptType: "SPENDWITNESS",
    })) as OneKeySdkResponse<{
      xpub?: string;
      xpubSegwit?: string;
      fingerprint?: number;
    }>,
    "Unable to fetch OneKey single-sig xpub",
  );

  const multiSig = assertSuccess(
    (await HardwareSDK.btcGetPublicKey(device.connectId, device.deviceId, {
      path: multiSigPath,
      coin,
      showOnOneKey: false,
      scriptType: "SPENDMULTISIG",
    })) as OneKeySdkResponse<{
      xpub?: string;
      xpubSegwit?: string;
      fingerprint?: number;
    }>,
    "Unable to fetch OneKey multisig xpub",
  );

  const taproot = assertSuccess(
    (await HardwareSDK.btcGetPublicKey(device.connectId, device.deviceId, {
      path: taprootPath,
      coin,
      showOnOneKey: false,
      scriptType: "SPENDTAPROOT",
    })) as OneKeySdkResponse<{
      xpub?: string;
      xpubSegwit?: string;
      fingerprint?: number;
    }>,
    "Unable to fetch OneKey taproot xpub",
  );

  const masterFingerprint = toMasterFingerprint(
    singleSig.fingerprint || multiSig.fingerprint || taproot.fingerprint,
  );
  if (!masterFingerprint) {
    throw new Error("Unable to resolve OneKey master fingerprint");
  }

  const payload = {
    singleSigPath,
    singleSigXpub: singleSig.xpubSegwit || singleSig.xpub || "",
    multiSigPath,
    multiSigXpub: multiSig.xpubSegwit || multiSig.xpub || "",
    taprootPath,
    taprootXpub: taproot.xpub || taproot.xpubSegwit || "",
    mfp: masterFingerprint,
  };

  if (!payload.singleSigXpub || !payload.multiSigXpub || !payload.taprootXpub) {
    throw new Error("Incomplete OneKey xpub response");
  }

  return buildChannelEventData("ADD_DEVICE", payload);
};

const performHealthCheck = async (account: number) => shareXpubs(account);

const signTx = async (psbt: string) => {
  const device = await ensureActiveDevice(activeNetwork);
  const coin = NETWORK_TO_COIN[activeNetwork];

  const signedPayload = assertSuccess(
    (await HardwareSDK.btcSignPsbt(device.connectId, device.deviceId, {
      psbt,
      coin,
    })) as OneKeySdkResponse<{ psbt?: string }>,
    "OneKey failed to sign PSBT",
  );

  if (!signedPayload?.psbt) {
    throw new Error("OneKey did not return signed PSBT");
  }

  return buildChannelEventData("SIGN_TX", {
    signedSerializedPSBT: signedPayload.psbt,
    hmac: null,
  });
};

const registerMultisig = async () => {
  throw new Error(
    "Register multisig is not yet supported for OneKey on desktop channel",
  );
};

const verifyAddress = async () => {
  throw new Error(
    "Address verification is not yet supported for OneKey on desktop channel",
  );
};

const onekeyService = {
  fetchDevices,
  setHWIClient,
  shareXpubs,
  performHealthCheck,
  signTx,
  registerMultisig,
  verifyAddress,
  getCurrentNetwork,
};

export default onekeyService;
