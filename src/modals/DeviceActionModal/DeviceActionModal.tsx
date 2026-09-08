import BaseModal from "../BaseModal/BaseModal";
import {
  deviceContent,
  HWI_ACTION,
  HWI_DEVICES,
  HWIDevice,
  HWIDeviceType,
  NetworkType,
} from "../../helpers/devices";
import styles from "./DeviceActionModal.module.css";
import baseStyles from "../BaseModal/BaseModal.module.css";
import loader from "../../assets/loader.svg";
import verifyAddressIcon from "../../assets/verify-address-icon.svg";
import { useDeviceActions } from "../../hooks/useDeviceActions";
import { useMemo } from "react";

interface DeviceActionModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  pairingCode: string | null;
  onConnectResult: (devices: HWIDevice[]) => void;
  onActionSuccess: () => void;
  onError: (error: string) => void;
}

const getActionTitle = (deviceType: HWIDeviceType, actionType: HWI_ACTION) => {
  if (actionType === "registerMultisig" && deviceType === "onekey") {
    return "Unsupported Action";
  }

  switch (actionType) {
    case "connect":
      return `Connect ${HWI_DEVICES[deviceType].name}`;
    case "shareXpubs":
      return `Setting up ${HWI_DEVICES[deviceType].name}`;
    case "healthCheck":
      return `${HWI_DEVICES[deviceType].name} Health Check`;
    case "signTx":
      return "Sign Transaction";
    case "registerMultisig":
      return `Register Multisig on ${HWI_DEVICES[deviceType].name}`;
    case "verifyAddress":
      return `Verify Address on your ${HWI_DEVICES[deviceType].name}`;
  }
};

const DeviceActionModal = ({
  isOpen,
  onClose,
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
  pairingCode,
  onConnectResult,
  onActionSuccess,
  onError,
}: DeviceActionModalProps) => {
  const { isLoading, handleContinue } = useDeviceActions({
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
  });

  const content = deviceContent[deviceType];
  const isVerifyAddress = actionType === "verifyAddress";
  const iconSrc = isVerifyAddress ? verifyAddressIcon : content.icon;

  const modalContent = useMemo(() => {
    const actionContent = content.content[actionType] ?? {
      text: "Operation not supported on this device",
      list: [],
    };
    const iconStyle = isVerifyAddress
      ? { width: "173px", height: "137px", marginBottom: "-20px" }
      : {};

    const textContent =
      miniscriptPolicy &&
      deviceType === "coldcard" &&
      actionType === "registerMultisig"
        ? "Please approve the registration of the wallet on the connected Coldcard device"
        : actionContent.text;

    const listContent =
      miniscriptPolicy &&
      deviceType === "coldcard" &&
      actionType === "registerMultisig"
        ? [
            "Make sure to verify the public keys and wallet details shown on the Coldcard screen match the expected public keys of your cosigners and wallet details.",
          ]
        : actionContent.list;

    const hasListItems = listContent.length > 0;

    return {
      image: (
        <img
          src={iconSrc}
          alt={`${deviceType} icon`}
          className={`${baseStyles.icon} ${styles.icon}`}
          style={iconStyle}
        />
      ),
      title: (
        <h2
          className={`${baseStyles.title} ${styles.title}`}
          style={{
            textAlign: hasListItems ? "left" : "center",
            marginLeft: hasListItems ? "25px" : "0px",
          }}
        >
          {getActionTitle(deviceType, actionType)}
        </h2>
      ),
      content: (
        <p
          className={`${baseStyles.text} ${styles.text}`}
          style={{
            textAlign: hasListItems ? "left" : "center",
            marginLeft: hasListItems ? "25px" : "7%",
          }}
        >
          {pairingCode ? (
            <div style={{ margin: "20px 0", textAlign: "center" }}>
              {pairingCode === "SUCCESS" ? (
                <p>
                  Pairing completed successfully.
                  <br />
                  Please wait for the loading to complete.
                </p>
              ) : (
                <>
                  <h4 style={{ color: "#333", fontSize: 16, marginBottom: 14 }}>
                    Pairing Code:
                  </h4>
                  <strong style={{ color: "#000" }}>
                    {pairingCode?.slice(0, 11)}
                    <br />
                    {pairingCode?.slice(11)}
                  </strong>
                  <p style={{ marginTop: 20 }}>
                    Please confirm this code on your BitBox02
                  </p>
                </>
              )}
            </div>
          ) : (
            textContent
          )}
          <ul>
            {listContent.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </p>
      ),
      button: (
        <button
          className={`${baseStyles.continueButton} ${styles.continueButton}`}
          onClick={handleContinue}
          disabled={isLoading}
        >
          {isLoading ? (
            <img
              src={loader}
              alt="Loading..."
              className={styles.loadingSpinner}
            />
          ) : (
            "Continue"
          )}
        </button>
      ),
    };
  }, [
    deviceType,
    actionType,
    pairingCode,
    isLoading,
    handleContinue,
    content,
    iconSrc,
    isVerifyAddress,
    miniscriptPolicy,
  ]);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} modalContent={modalContent} />
  );
};

export default DeviceActionModal;
