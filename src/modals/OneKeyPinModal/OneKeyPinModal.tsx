import { useState } from "react";
import BaseModal from "../BaseModal/BaseModal";
import styles from "./OneKeyPinModal.module.css";
import baseStyles from "../BaseModal/BaseModal.module.css";
import loader from "../../assets/loader.svg";
import ErrorIcon from "../../assets/error-popup-icon.svg";
import hwiService from "../../services/hwiService";
import {
  deviceContent,
  HWI_DEVICES,
  HWIDevice,
  HWIDeviceType,
  NetworkType,
} from "../../helpers/devices";

interface OneKeyPinModalProps {
  isOpen: boolean;
  deviceType: HWIDeviceType;
  network: NetworkType | null;
  model: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

const OneKeyPinModal = ({
  isOpen,
  deviceType,
  network,
  model,
  onClose,
  onSuccess,
}: OneKeyPinModalProps) => {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const showError = (message: string) => {
    setError(message);
    const timer = setTimeout(() => {
      setError("");
    }, 4000);
    return () => clearTimeout(timer);
  };

  const handleUnlocked = async () => {
    if (!network) {
      return showError("Network is not set");
    }

    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const devices = await hwiService.fetchDevices(
        deviceType,
        network.toLowerCase(),
      );
      const unlockedDevice = devices.find(
        (device: HWIDevice) => !device.needs_pin_sent,
      );

      if (!unlockedDevice) {
        return showError(
          "Device is still locked. Please finish PIN entry on your device and retry.",
        );
      }

      await hwiService.setHWIClient(
        unlockedDevice.fingerprint,
        deviceType,
        network.toLowerCase(),
      );
      onSuccess();
    } catch {
      return showError("Failed to verify device unlock. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const deviceName = HWI_DEVICES[deviceType].name;

  const modalContent = {
    image: (
      <img
        src={deviceContent[deviceType].icon}
        alt={deviceName}
        className={`${baseStyles.icon} ${styles.icon}`}
      />
    ),
    title: (
      <h2 className={`${baseStyles.title} ${styles.title}`}>
        Unlock {deviceName} on Device
      </h2>
    ),
    content: (
      <>
        <div className={`${styles.errorContainer} ${error ? styles.show : ""}`}>
          <div className={styles.error}>
            <img src={ErrorIcon} alt="Error" className={styles.errorIcon} />
            <span>{error}</span>
          </div>
        </div>
        <p className={`${baseStyles.text} ${styles.text}`}>
          Please enter your PIN directly on the {deviceName} screen. After the
          device is unlocked, click the button below.
        </p>
        {model && <p className={styles.model}>Model: {model}</p>}
      </>
    ),
    button: (
      <button
        disabled={isLoading}
        onClick={handleUnlocked}
        className={`${baseStyles.continueButton} ${styles.continueButton}`}
      >
        {isLoading ? (
          <img
            src={loader}
            alt="Loading..."
            className={styles.loadingSpinner}
          />
        ) : (
          "I Have Unlocked"
        )}
      </button>
    ),
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} modalContent={modalContent} />
  );
};

export default OneKeyPinModal;
