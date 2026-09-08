import { useState } from "react";
import hwiService from "../services/hwiService";
import {
  HWI_ACTION,
  HWIDevice,
  HWIDeviceType,
  NetworkType,
} from "../helpers/devices";

interface UseDeviceActionsProps {
  network: NetworkType | null;
  deviceType: HWIDeviceType;
  actionType: HWI_ACTION;
  accountNumber: number | null;
  psbt: string | null;
  descriptor: string | null;
  miniscriptPolicy: string | null;
  addressIndex: number | null;
  walletName: string | null;
  hmac: string | null;
  expectedAddress: string | null;
  onConnectResult: (devices: HWIDevice[]) => void;
  onActionSuccess: () => void;
  onError: (error: string) => void;
}

export const useDeviceActions = ({
  network,
  deviceType,
  actionType,
  accountNumber,
  psbt,
  descriptor,
  miniscriptPolicy,
  addressIndex,
  walletName,
  hmac,
  expectedAddress,
  onConnectResult,
  onActionSuccess,
  onError,
}: UseDeviceActionsProps) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleContinue = async () => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      switch (actionType) {
        case "connect": {
          const devices = await hwiService.fetchDevices(
            deviceType,
            network?.toLowerCase(),
          );
          await onConnectResult(devices);
          break;
        }
        case "shareXpubs":
          await hwiService.shareXpubs(accountNumber ?? 0);
          onActionSuccess();
          break;
        case "healthCheck":
          await hwiService.performHealthCheck(accountNumber ?? 0);
          onActionSuccess();
          break;
        case "signTx":
          if (!psbt) {
            onError("PSBT is required");
            return;
          }
          await hwiService.signTx(psbt, miniscriptPolicy, walletName, hmac);
          onActionSuccess();
          break;
        case "registerMultisig":
          if (deviceType === "onekey") {
            onError("Register multisig is not supported on OneKey");
            return;
          }
          if (!descriptor && !miniscriptPolicy) {
            onError("Descriptor or miniscript policy is required");
            return;
          }
          await hwiService.registerMultisig(
            descriptor,
            miniscriptPolicy,
            walletName,
            expectedAddress ?? "",
          );
          onActionSuccess();
          break;
        case "verifyAddress":
          if (!descriptor && (!miniscriptPolicy || addressIndex === null)) {
            onError("Descriptor or miniscript policy and index are required");
            return;
          }
          await hwiService.verifyAddress(
            descriptor,
            miniscriptPolicy,
            addressIndex,
            walletName,
            hmac,
            expectedAddress ?? "",
          );
          onActionSuccess();
          break;
        default:
          throw new Error("Unsupported action type");
      }
    } catch (error) {
      console.error(`Error performing ${actionType} action:`, error);
      onError((error as any).toString()); // eslint-disable-line @typescript-eslint/no-explicit-any
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, handleContinue };
};
