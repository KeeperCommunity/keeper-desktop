import HardwareSDK from "@onekeyfe/hd-common-connect-sdk";
import { ONEKEY_WEBUSB_FILTER } from "@onekeyfe/hd-shared";
import { HWIDevice } from "../helpers/devices";

type OneKeyNetwork = "bitcoin" | "testnet";
type OneKeyCoin = "btc" | "test";
type OneKeyScriptType =
  | "SPENDADDRESS"
  | "SPENDMULTISIG"
  | "SPENDWITNESS"
  | "SPENDP2SHWITNESS"
  | "SPENDTAPROOT";

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
  masterFingerprint: string;
};

type WebUsbApi = {
  getDevices: () => Promise<unknown[]>;
  requestDevice: (options: { filters: unknown[] }) => Promise<unknown>;
};

type NavigatorWithUsb = {
  usb?: WebUsbApi;
};

type DescriptorKeyOrigin = {
  fingerprint: string;
  basePath: string;
  xpub: string;
  suffixSegments: string[];
};

type ResolvedDerivation = {
  path: string;
  addressN: number[];
};

type OneKeyMultisigPubkey = {
  node: string;
  address_n: number[];
};

type OneKeyAddressRequest = {
  path: string;
  coin: OneKeyCoin;
  showOnOneKey: boolean;
  scriptType: OneKeyScriptType;
  multisig?: {
    m: number;
    signatures: string[];
    pubkeys: OneKeyMultisigPubkey[];
  };
};

const HARDENED_OFFSET = 0x80000000;

const NETWORK_TO_COIN = {
  bitcoin: "btc",
  testnet: "test",
} as const;

const KEY_ORIGIN_REGEX =
  /\[([A-Fa-f0-9]{8})(\/[0-9hH'/]+)\]([1-9A-HJ-NP-Za-km-z]+)((?:\/(?:<\d+;\d+>|\*|\d+['hH]?))*)/g;

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

const normalizeScript = (value: string) =>
  value.replace(/#.*$/, "").replace(/\s+/g, "").trim();

const parsePathSegment = (segment: string) => {
  const trimmed = segment.trim();
  const hardened = /['hH]$/.test(trimmed);
  const numericPart = trimmed.replace(/['hH]/g, "");

  if (!/^\d+$/.test(numericPart)) {
    throw new Error(`Invalid derivation segment: ${segment}`);
  }

  const value = Number.parseInt(numericPart, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`Invalid derivation segment value: ${segment}`);
  }

  return {
    display: `${value}${hardened ? "'" : ""}`,
    numeric: hardened ? value + HARDENED_OFFSET : value,
  };
};

const resolveSuffixSegment = (segment: string, index: number) => {
  if (segment === "*") {
    return { display: `${index}`, numeric: index };
  }

  const branchMatch = segment.match(/^<(\d+);(\d+)>$/);
  if (branchMatch) {
    const externalBranch = Number.parseInt(branchMatch[1], 10);
    return { display: `${externalBranch}`, numeric: externalBranch };
  }

  return parsePathSegment(segment);
};

const resolveDerivation = (
  keyOrigin: DescriptorKeyOrigin,
  index: number,
): ResolvedDerivation => {
  const resolvedSuffix = keyOrigin.suffixSegments.map((segment) =>
    resolveSuffixSegment(segment, index),
  );

  const suffixPath = resolvedSuffix.length
    ? `/${resolvedSuffix.map((segment) => segment.display).join("/")}`
    : "";

  return {
    path: `m${keyOrigin.basePath}${suffixPath}`,
    addressN: resolvedSuffix.map((segment) => segment.numeric),
  };
};

const parseDescriptorKeys = (script: string): DescriptorKeyOrigin[] => {
  const matches = script.matchAll(KEY_ORIGIN_REGEX);
  const keys: DescriptorKeyOrigin[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const fingerprint = match[1].toUpperCase();
    const rawBasePath = match[2];
    const xpub = match[3];
    const suffixRaw = match[4] || "";
    const suffixSegments = suffixRaw
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    const normalizedBasePathSegments = rawBasePath
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => parsePathSegment(segment).display);
    const basePath = `/${normalizedBasePathSegments.join("/")}`;

    const dedupeKey = `${fingerprint}:${basePath}:${xpub}:${suffixSegments.join("/")}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    keys.push({
      fingerprint,
      basePath,
      xpub,
      suffixSegments,
    });
  }

  return keys;
};

const getMultisigThreshold = (script: string): number | null => {
  const sortedMultiMatch = script.match(/(?:^|[,(])sortedmulti\((\d+),/i);
  if (sortedMultiMatch) {
    return Number.parseInt(sortedMultiMatch[1], 10);
  }

  const multiMatch = script.match(/(?:^|[,(])multi\((\d+),/i);
  if (multiMatch) {
    return Number.parseInt(multiMatch[1], 10);
  }

  const simpleThreshMatch = script.match(
    /^wsh\(thresh\((\d+),(pk\([^()]+\))(,pk\([^()]+\))*\)\)$/i,
  );
  if (simpleThreshMatch) {
    return Number.parseInt(simpleThreshMatch[1], 10);
  }

  return null;
};

const isComplexMiniscript = (script: string) => {
  const indicators = [
    "after(",
    "and_",
    "or_",
    "older(",
    "sha256(",
    "hash256(",
    "ripemd160(",
    "hash160(",
  ];
  return indicators.some((indicator) => script.includes(indicator));
};

const detectScriptType = (
  script: string,
): {
  scriptType: OneKeyScriptType;
  multisigThreshold: number | null;
} => {
  const multisigThreshold = getMultisigThreshold(script);
  if (multisigThreshold !== null) {
    return {
      scriptType: "SPENDMULTISIG",
      multisigThreshold,
    };
  }

  if (script.startsWith("wpkh(")) {
    return { scriptType: "SPENDWITNESS", multisigThreshold: null };
  }

  if (script.startsWith("sh(wpkh(")) {
    return { scriptType: "SPENDP2SHWITNESS", multisigThreshold: null };
  }

  if (script.startsWith("tr(")) {
    return { scriptType: "SPENDTAPROOT", multisigThreshold: null };
  }

  if (script.startsWith("pkh(")) {
    return { scriptType: "SPENDADDRESS", multisigThreshold: null };
  }

  if (isComplexMiniscript(script)) {
    throw new Error(
      "OneKey desktop channel does not yet support timelock or nested miniscript policies",
    );
  }

  throw new Error("Unsupported descriptor/policy for OneKey address display");
};

const buildAddressRequest = ({
  script,
  index,
  coin,
  masterFingerprint,
}: {
  script: string;
  index: number;
  coin: OneKeyCoin;
  masterFingerprint: string;
}): OneKeyAddressRequest => {
  const normalizedScript = normalizeScript(script);
  const keys = parseDescriptorKeys(normalizedScript);
  if (!keys.length) {
    throw new Error("No key origin found in descriptor/policy");
  }

  const { scriptType, multisigThreshold } = detectScriptType(normalizedScript);

  const currentKey =
    keys.find((key) => key.fingerprint === masterFingerprint) ||
    (keys.length === 1 ? keys[0] : null);

  if (!currentKey) {
    throw new Error("Unable to match OneKey fingerprint in descriptor/policy");
  }

  const currentPath = resolveDerivation(currentKey, index);

  if (scriptType === "SPENDMULTISIG") {
    const threshold = multisigThreshold ?? 0;
    if (threshold <= 0 || threshold > keys.length) {
      throw new Error("Invalid multisig threshold in descriptor/policy");
    }

    const pubkeys = keys.map((key) => {
      const resolved = resolveDerivation(key, index);
      return {
        node: key.xpub,
        address_n: resolved.addressN,
      };
    });

    return {
      path: currentPath.path,
      coin,
      showOnOneKey: true,
      scriptType,
      multisig: {
        m: threshold,
        signatures: new Array(pubkeys.length).fill(""),
        pubkeys,
      },
    };
  }

  return {
    path: currentPath.path,
    coin,
    showOnOneKey: true,
    scriptType,
  };
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

const resolveDeviceMasterFingerprint = async (
  connectId: string,
  deviceId: string,
  network: OneKeyNetwork,
) => {
  const accountPath = formatPath(84, getCoinType(network), 0);
  const coin = NETWORK_TO_COIN[network];

  const payload = assertSuccess(
    (await HardwareSDK.btcGetPublicKey(connectId, deviceId, {
      path: accountPath,
      coin,
      showOnOneKey: false,
      scriptType: "SPENDWITNESS",
    })) as OneKeySdkResponse<{ fingerprint?: number | string }>,
    "Unable to read OneKey master fingerprint",
  );

  const masterFingerprint = toMasterFingerprint(payload.fingerprint);
  if (!masterFingerprint) {
    throw new Error("Unable to resolve OneKey master fingerprint");
  }

  return masterFingerprint;
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

  const masterFingerprint = await resolveDeviceMasterFingerprint(
    selectedDevice.connectId,
    resolvedDeviceId,
    resolvedNetwork,
  );

  activeDevice = {
    connectId: selectedDevice.connectId,
    deviceId: resolvedDeviceId,
    masterFingerprint,
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

  if (activeDevice) {
    activeDevice.masterFingerprint = masterFingerprint;
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

const showAddressOnDevice = async ({
  script,
  index,
  expectedAddress,
}: {
  script: string;
  index: number;
  expectedAddress: string;
}) => {
  const device = await ensureActiveDevice(activeNetwork);
  const coin = NETWORK_TO_COIN[activeNetwork];

  const request = buildAddressRequest({
    script,
    index,
    coin,
    masterFingerprint: device.masterFingerprint,
  });

  const addressPayload = assertSuccess(
    (await HardwareSDK.btcGetAddress(
      device.connectId,
      device.deviceId,
      request,
    )) as OneKeySdkResponse<{ address?: string }>,
    "OneKey failed to display address",
  );

  if (!addressPayload?.address) {
    throw new Error("OneKey did not return address");
  }

  if (
    expectedAddress &&
    addressPayload.address.toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    throw new Error(
      "Address received from device does not match the expected address",
    );
  }

  return addressPayload.address;
};

const registerMultisig = async (
  descriptor: string | null,
  policy: string | null,
  _walletName: string | null,
  expectedAddress: string,
) => {
  const script = descriptor || policy;
  if (!script) {
    throw new Error("Either descriptor or policy must be provided");
  }

  const address = await showAddressOnDevice({
    script,
    index: 0,
    expectedAddress,
  });

  return buildChannelEventData("REGISTER_MULTISIG", {
    address,
    hmac: null,
  });
};

const verifyAddress = async (
  descriptor: string | null,
  policy: string | null,
  index: number | null,
  _walletName: string | null,
  hmac: string | null,
  expectedAddress: string,
) => {
  const script = descriptor || policy;
  if (!script) {
    throw new Error("Either descriptor or policy must be provided");
  }

  const address = await showAddressOnDevice({
    script,
    index: index ?? 0,
    expectedAddress,
  });

  return buildChannelEventData("VERIFY_ADDRESS", {
    address,
    hmac: hmac ?? null,
  });
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
