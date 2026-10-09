import type { HWIDeviceType, NetworkType } from "../../helpers/devices";

type DeviceAction =
  | "ADD_DEVICE"
  | "HEALTH_CHECK"
  | "SIGN_TX"
  | "REGISTER_MULTISIG"
  | "VERIFY_ADDRESS";

export interface DeviceRequestData {
  action: DeviceAction;
  signerType: string;
  accountNumber?: number | null;
  psbt?: { serializedPSBT: string };
  descriptorString?: string | null;
  miniscriptPolicy?: string | null;
  addressIndex?: number | null;
  walletName?: string | null;
  hmac?: string | null;
  firstExtAdd?: string | null;
  receivingAddress?: string | null;
}

type ValidatedChannelMessage =
  | {
      ok: true;
      kind: "device";
      data: DeviceRequestData;
      deviceType: HWIDeviceType;
      network: NetworkType;
    }
  | {
      ok: true;
      kind: "purchase";
      appId?: string;
      roomId?: string;
    }
  | { ok: false; error: string };

const deviceTypes: Record<HWIDeviceType, true> = {
  ledger: true,
  trezor: true,
  bitbox02: true,
  coldcard: true,
  jade: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isOptionalString = (value: unknown): value is string | null | undefined =>
  value == null || typeof value === "string";

const isOptionalIndex = (value: unknown): value is number | null | undefined =>
  value == null ||
  (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

export const validateChannelMessage = (
  payload: unknown,
): ValidatedChannelMessage => {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return { ok: false, error: "Malformed channel request" };
  }

  const { data } = payload;
  if (data.action === "PURCHASE_SUBS") {
    if (!isOptionalString(data.appId) || !isOptionalString(data.roomId)) {
      return { ok: false, error: "Malformed subscription request" };
    }
    return {
      ok: true,
      kind: "purchase",
      appId: data.appId ?? undefined,
      roomId: data.roomId ?? undefined,
    };
  }

  if (
    data.action !== "ADD_DEVICE" &&
    data.action !== "HEALTH_CHECK" &&
    data.action !== "SIGN_TX" &&
    data.action !== "REGISTER_MULTISIG" &&
    data.action !== "VERIFY_ADDRESS"
  ) {
    return { ok: false, error: "Unsupported action received" };
  }

  if (!hasText(data.signerType)) {
    return { ok: false, error: "Signer type was not provided" };
  }
  const deviceType = data.signerType.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(deviceTypes, deviceType)) {
    return { ok: false, error: "Unsupported signer type received" };
  }
  if (payload.network !== "MAINNET" && payload.network !== "TESTNET") {
    return { ok: false, error: "Unsupported network received" };
  }

  if (
    !isOptionalIndex(data.accountNumber) ||
    !isOptionalIndex(data.addressIndex) ||
    !isOptionalString(data.descriptorString) ||
    !isOptionalString(data.miniscriptPolicy) ||
    !isOptionalString(data.walletName) ||
    !isOptionalString(data.hmac) ||
    !isOptionalString(data.firstExtAdd) ||
    !isOptionalString(data.receivingAddress)
  ) {
    return { ok: false, error: "Malformed device request" };
  }

  if (
    data.action === "SIGN_TX" &&
    (!isRecord(data.psbt) || !hasText(data.psbt.serializedPSBT))
  ) {
    return { ok: false, error: "PSBT was not provided" };
  }
  if (
    data.action === "REGISTER_MULTISIG" &&
    !hasText(data.descriptorString) &&
    !hasText(data.miniscriptPolicy)
  ) {
    return { ok: false, error: "Descriptor or Miniscript policy is required" };
  }
  if (data.action === "REGISTER_MULTISIG" && !hasText(data.firstExtAdd)) {
    return { ok: false, error: "Expected address was not provided" };
  }
  if (
    data.action === "VERIFY_ADDRESS" &&
    !hasText(data.descriptorString) &&
    !(hasText(data.miniscriptPolicy) && typeof data.addressIndex === "number")
  ) {
    return { ok: false, error: "Descriptor or Miniscript policy is required" };
  }
  if (data.action === "VERIFY_ADDRESS" && !hasText(data.receivingAddress)) {
    return { ok: false, error: "Expected address was not provided" };
  }

  return {
    ok: true,
    kind: "device",
    data: data as unknown as DeviceRequestData,
    deviceType: deviceType as HWIDeviceType,
    network: payload.network,
  };
};
