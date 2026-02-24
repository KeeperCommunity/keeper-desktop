import styles from "./ConnectScreen.module.css";
import keeperLogo from "../../assets/keeper-logo.svg";
import instructionsIcon from "../../assets/instructions-icon.svg";
import refreshIcon from "../../assets/refresh.svg";

import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import QRCode from "qrcode.react";
import useModalState from "../../hooks/useModalState";
import {
  HWI_ACTION,
  HWIDevice,
  HWIDeviceType,
  NetworkType,
} from "../../helpers/devices";
import ModalsManager from "../../modals/ModalManager";
import SubscriptionsModal from "../../modals/SubscriptionsModal/SubscriptionsModal";
import hwiService from "../../services/hwiService";
import { version } from "../../../package.json";

interface ChannelMessagePayload {
  data: {
    signerType: string;
    action: string;
    accountNumber?: number;
    psbt?: { serializedPSBT: string };
    descriptorString?: string;
    miniscriptPolicy?: string;
    addressIndex?: number;
    walletName?: string;
    hmac?: string;
    firstExtAdd?: string;
    receivingAddress?: string;
    // Subscription data
    appId?: string;
    roomId?: string;
  };
  network: string;
}

const ConnectScreen = () => {
  const { openModal, openModalHandler, closeModalHandler } = useModalState();

  const [deviceType, setDeviceType] = useState<HWIDeviceType | null>(null);
  const [currentAction, setCurrentAction] = useState<HWI_ACTION>("connect");
  const [actionType, setActionType] = useState<HWI_ACTION | null>(null);
  const [network, setNetwork] = useState<NetworkType | null>(null);
  const [accountNumber, setAccountNumber] = useState<number | null>(null);
  const [psbt, setPsbt] = useState<string | null>(null);
  const [descriptor, setDescriptor] = useState<string | null>(null);
  const [miniscriptPolicy, setMiniscriptPolicy] = useState<string | null>(null);
  const [addressIndex, setAddressIndex] = useState<number | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [hmac, setHmac] = useState<string | null>(null);
  const [expectedAddress, setExpectedAddress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  // Subscriptions state variables
  const [isSubscriptionsModalOpen, setSubscriptionsModalOpen] = useState(false);
  const [subscriptionsData, setSubscriptionsData] = useState({});

  const handleConnectResult = async (devices: HWIDevice[]) => {
    setPairingCode(null);
    if (devices.length > 1) {
      openModalHandler("multipleDevices");
    } else if (devices.length === 0) {
      openModalHandler("notFound");
    } else {
      if (deviceType && network) {
        await hwiService.setHWIClient(
          devices[0].fingerprint,
          deviceType,
          network.toLowerCase(),
        );
        if (devices[0].needs_pin_sent) {
          await hwiService.promptPin();
          openModalHandler("pin");
        } else {
          openModalHandler("deviceActionSuccess");
        }
      }
    }
  };

  const handleActionSuccess = () => {
    openModalHandler("deviceActionSuccess");
  };

  const handleError = useCallback(
    (error: string) => {
      setPairingCode(null);

      setErrorMessage(error);
      openModalHandler("error");
    },
    [openModalHandler],
  );

  const { data: channelSecret, refetch: regenerateQR } = useQuery({
    queryKey: ["channelSecret"],
    queryFn: () => invoke<string>("generate_encryption_key"),
    staleTime: 15 * 60 * 1000, // 15 minutes
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const unsubscribe = listen(
      "channel-message",
      async (channelMessage: { payload: ChannelMessagePayload }) => {
        setAccountNumber(null);
        setDescriptor(null);
        setExpectedAddress(null);
        setHmac(null);
        setMiniscriptPolicy(null);
        setPsbt(null);
        setWalletName(null);
        const { data, network } = channelMessage.payload;
        switch (data.action) {
          case "ADD_DEVICE":
            if (data.accountNumber) {
              setAccountNumber(data.accountNumber);
            } else {
              setAccountNumber(0);
            }
            setActionType("shareXpubs");
            break;
          case "HEALTH_CHECK":
            if (data.accountNumber) {
              setAccountNumber(data.accountNumber);
            } else {
              setAccountNumber(0);
            }
            setActionType("healthCheck");
            break;
          case "SIGN_TX":
            setActionType("signTx");
            if (data.psbt) {
              setPsbt(data.psbt.serializedPSBT);
            } else {
              handleError("PSBT was not provided");
            }
            if (data.miniscriptPolicy) {
              setMiniscriptPolicy(data.miniscriptPolicy);
              if (data.walletName) {
                setWalletName(data.walletName.replace(/ /g, "-"));
              } else {
                setWalletName("Vault");
              }
            }
            if (data.hmac) {
              setHmac(data.hmac);
            }
            break;
          case "REGISTER_MULTISIG":
            if (data.signerType?.toLowerCase() === "onekey") {
              handleError("Register multisig is not supported on OneKey");
              return;
            }
            setActionType("registerMultisig");
            if (data.descriptorString) {
              setDescriptor(data.descriptorString.replace(/\*\*/g, "0/0"));
            } else if (data.miniscriptPolicy) {
              setMiniscriptPolicy(data.miniscriptPolicy);
              if (data.walletName) {
                setWalletName(data.walletName.replace(/ /g, "-"));
              } else {
                setWalletName("Vault");
              }
            } else {
              handleError(
                "No descriptor or Miniscript policy was not provided",
              );
            }
            if (data.firstExtAdd) {
              setExpectedAddress(data.firstExtAdd);
            } else {
              handleError("Expected address was not provided");
            }
            break;
          case "VERIFY_ADDRESS":
            setActionType("verifyAddress");
            if (data.descriptorString) {
              setDescriptor(data.descriptorString);
            } else if (
              data.miniscriptPolicy &&
              (data.addressIndex || data.addressIndex === 0)
            ) {
              setMiniscriptPolicy(data.miniscriptPolicy);
              setAddressIndex(data.addressIndex);
              if (data.walletName) {
                setWalletName(data.walletName.replace(/ /g, "-"));
              } else {
                setWalletName("Vault");
              }
            } else {
              handleError("Descriptor or Miniscript policy is required");
            }
            if (data.hmac) {
              setHmac(data.hmac);
            }
            if (data.receivingAddress) {
              setExpectedAddress(data.receivingAddress);
            } else {
              handleError("Expected address was not provided");
            }
            break;
          case "PURCHASE_SUBS":
            setSubscriptionsData({
              appId: data.appId,
              roomId: data.roomId,
            });
            openSubscriptionsModal();
            return;
          default:
            handleError("Unsupported action received");
        }
        setDeviceType(data.signerType.toLowerCase() as HWIDeviceType);
        setNetwork(network as NetworkType);
        setCurrentAction("connect");
        openModalHandler("deviceAction");
      },
    );

    return () => {
      unsubscribe.then((f) => f());
    };
  }, [openModalHandler, handleError]);

  useEffect(() => {
    const unsubscribe = listen(
      "bitbox-pairing-code",
      (event: { payload: string }) => {
        if (event.payload) {
          setPairingCode(event.payload);
        }
      },
    );

    return () => {
      unsubscribe.then((f) => f());
    };
  }, [openModalHandler]);

  const openSubscriptionsModal = () => {
    setSubscriptionsModalOpen(true);
  };

  const closeSubscriptionsModal = () => {
    setSubscriptionsModalOpen(false);
  };

  return (
    <div className={styles.connectScreen}>
      <div className={styles.leftSection}>
        <img src={keeperLogo} alt="Keeper Logo" className={styles.keeperLogo} />
        <h1 className={styles.title}>
          Welcome to Bitcoin
          <br />
          Keeper&apos;s Desktop App
        </h1>
        <div className={styles.instructionsContainer}>
          <h3 className={styles.instructionsTitle}>
            <img
              src={instructionsIcon}
              className={styles.instructionsIcon}
              alt=""
            />
            Instructions:
          </h3>
          <ul className={styles.instructionsList}>
            <li>
              You can add devices, register vaults and sign transactions using
              Keeper&apos;s desktop app.
            </li>
            <li>
              Open the Keeper mobile app to select your desired action, then
              scan the QR code to continue.
            </li>
          </ul>
        </div>
        <div className={styles.note}>
          <h4>Note:</h4>
          <p>
            This QR will give your mobile app the key to establish a secure E2E
            encrypted connection with the desktop app.
          </p>
        </div>
      </div>
      <div className={styles.qrContainer}>
        <div className={styles.qrCode}>
          <QRCode
            value={channelSecret ?? ""}
            size={200}
            bgColor="#2f4f4f"
            fgColor="#fff"
          />
          <p className={styles.scanMe}>Scan Me</p>
          <button
            className={styles.regenerateButton}
            onClick={() => regenerateQR()}
          >
            <img src={refreshIcon} alt="Regenerate QR Code" />
          </button>
        </div>
        <p className={styles.qrNote}>
          Make sure no one is around you when you scan this. You can always
          refresh to get fresh key session.
        </p>
      </div>
      {deviceType && (
        <ModalsManager
          openModal={openModal}
          closeModalHandler={closeModalHandler}
          deviceType={deviceType}
          currentAction={currentAction}
          actionType={actionType}
          network={network}
          accountNumber={accountNumber}
          psbt={psbt}
          descriptor={descriptor}
          miniscriptPolicy={miniscriptPolicy}
          addressIndex={addressIndex}
          walletName={walletName}
          hmac={hmac}
          expectedAddress={expectedAddress}
          errorMessage={errorMessage}
          handleConnectResult={handleConnectResult}
          handleActionSuccess={handleActionSuccess}
          handleError={handleError}
          setCurrentAction={setCurrentAction}
          openModalHandler={openModalHandler}
          pairingCode={pairingCode}
        />
      )}
      <div className={styles.versionTag}>Version {version}</div>
      <SubscriptionsModal
        isOpen={isSubscriptionsModalOpen}
        onClose={closeSubscriptionsModal}
        data={subscriptionsData}
      />
    </div>
  );
};

export default ConnectScreen;
