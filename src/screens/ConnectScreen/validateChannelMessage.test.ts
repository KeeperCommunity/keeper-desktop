import assert from "node:assert/strict";
import test from "node:test";
import { validateChannelMessage } from "./validateChannelMessage";

const deviceRequest = (
  data: Record<string, unknown>,
  network: unknown = "TESTNET",
) => ({
  data: { action: "ADD_DEVICE", signerType: "LEDGER", ...data },
  network,
});

test("accepts a valid device request and keeps its normalized routing fields", () => {
  const result = validateChannelMessage(deviceRequest({ accountNumber: 0 }));
  assert.equal(result.ok, true);
  if (result.ok && result.kind === "device") {
    assert.equal(result.deviceType, "ledger");
    assert.equal(result.network, "TESTNET");
    assert.equal(result.data.action, "ADD_DEVICE");
  } else {
    assert.fail("Expected a device request");
  }
});

test("keeps subscription requests independent of device fields", () => {
  assert.deepEqual(
    validateChannelMessage({
      data: { action: "PURCHASE_SUBS", appId: "app", roomId: "room" },
    }),
    { ok: true, kind: "purchase", appId: "app", roomId: "room" },
  );
});

test("rejects missing transaction data before it can become a device action", () => {
  assert.deepEqual(
    validateChannelMessage(deviceRequest({ action: "SIGN_TX" })),
    {
      ok: false,
      error: "PSBT was not provided",
    },
  );
});

test("accepts the mobile signing shape with nullable optional fields", () => {
  const result = validateChannelMessage(
    deviceRequest({
      action: "SIGN_TX",
      psbt: { serializedPSBT: "cHNidP8=" },
      miniscriptPolicy: null,
      walletName: null,
      hmac: null,
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.kind, "device");
});

test("rejects incomplete registration and address verification requests", () => {
  for (const data of [
    { action: "REGISTER_MULTISIG", firstExtAdd: "address" },
    { action: "REGISTER_MULTISIG", descriptorString: "descriptor" },
    {
      action: "VERIFY_ADDRESS",
      miniscriptPolicy: "policy",
      receivingAddress: "address",
    },
    { action: "VERIFY_ADDRESS", descriptorString: "descriptor" },
  ]) {
    assert.equal(validateChannelMessage(deviceRequest(data)).ok, false);
  }
});

test("accepts valid registration and address verification requests", () => {
  for (const data of [
    {
      action: "REGISTER_MULTISIG",
      descriptorString: "descriptor",
      miniscriptPolicy: null,
      firstExtAdd: "address",
    },
    {
      action: "VERIFY_ADDRESS",
      descriptorString: null,
      miniscriptPolicy: "policy",
      addressIndex: 0,
      receivingAddress: "address",
      hmac: null,
    },
  ]) {
    const result = validateChannelMessage(deviceRequest(data));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.kind, "device");
  }
});

test("rejects unsupported actions and malformed signer or network", () => {
  for (const request of [
    deviceRequest({ action: "UNKNOWN" }),
    deviceRequest({ signerType: null }),
    deviceRequest({ signerType: "UNKNOWN" }),
    deviceRequest({}, "SIGNET"),
    { data: null, network: "TESTNET" },
  ]) {
    assert.equal(validateChannelMessage(request).ok, false);
  }
});
