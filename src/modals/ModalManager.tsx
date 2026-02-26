import {
  DeviceActionModal,
  DeviceActionSuccessModal,
  DeviceNotFoundModal,
  MultipleDevicesModal,
  ErrorModal,
  OneKeyPinModal,
  TrezorPinModal,
} from "./index";
import {
  HWI_ACTION,
  HWIDevice,
  HWIDeviceType,
  NetworkType,
} from "../helpers/devices";
import { ModalType } from "../hooks/useModalState";

interface ModalsManagerProps {
  openModal: string | null;
  closeModalHandler: () => void;
  deviceType: HWIDeviceType | null;
  currentAction: HWI_ACTION;
  actionType: HWI_ACTION | null;
  network: NetworkType | null;
  accountNumber: number | null;
  psbt: string | null;
  descriptor: string | null;
  miniscriptPolicy: string | null;
  addressIndex: number | null;
  walletName: string | null;
  hmac: string | null;
  expectedAddress: string | null;
  pairingCode: string | null;
  currentDevice: HWIDevice | null;
  errorMessage: string;
  handleConnectResult: (devices: HWIDevice[]) => Promise<void>;
  handleActionSuccess: () => void;
  handleError: (error: string) => void;
  setCurrentAction: (action: HWI_ACTION) => void;
  openModalHandler: (modal: ModalType) => void;
}

const ModalsManager = ({
  openModal,
  closeModalHandler,
  deviceType,
  currentAction,
  actionType,
  network,
  accountNumber,
  psbt,
  descriptor,
  miniscriptPolicy,
  addressIndex,
  walletName,
  hmac,
  expectedAddress,
  pairingCode,
  currentDevice,
  errorMessage,
  handleConnectResult,
  handleActionSuccess,
  handleError,
  setCurrentAction,
  openModalHandler,
}: ModalsManagerProps) => {
  return (
    <>
      <DeviceActionModal
        isOpen={openModal === "deviceAction"}
        onClose={closeModalHandler}
        network={network}
        deviceType={deviceType as HWIDeviceType}
        actionType={currentAction}
        accountNumber={accountNumber}
        psbt={psbt}
        descriptor={descriptor}
        miniscriptPolicy={miniscriptPolicy}
        addressIndex={addressIndex}
        walletName={walletName}
        hmac={hmac}
        expectedAddress={expectedAddress}
        pairingCode={pairingCode}
        onConnectResult={handleConnectResult}
        onActionSuccess={handleActionSuccess}
        onError={handleError}
      />

      <DeviceActionSuccessModal
        isOpen={openModal === "deviceActionSuccess"}
        onClose={closeModalHandler}
        deviceType={deviceType as HWIDeviceType}
        actionType={currentAction}
        onConnectConfirmed={() => {
          if (actionType) {
            setCurrentAction(actionType);
            openModalHandler("deviceAction");
          } else {
            closeModalHandler();
          }
        }}
      />

      <DeviceNotFoundModal
        isOpen={openModal === "notFound"}
        onClose={closeModalHandler}
        deviceType={deviceType as HWIDeviceType}
        onContinue={() => {
          openModalHandler("deviceAction");
        }}
      />

      <MultipleDevicesModal
        isOpen={openModal === "multipleDevices"}
        onClose={closeModalHandler}
        deviceType={deviceType as HWIDeviceType}
        onContinue={() => {
          openModalHandler("deviceAction");
        }}
      />
      <ErrorModal
        isOpen={openModal === "error"}
        onClose={closeModalHandler}
        errorMessage={errorMessage}
        onRetry={() => {
          openModalHandler("deviceAction");
        }}
      />
      <TrezorPinModal
        isOpen={openModal === "pin"}
        deviceType={deviceType as HWIDeviceType}
        network={network}
        onClose={closeModalHandler}
        onSuccess={() => {
          openModalHandler("deviceActionSuccess");
        }}
      />

      <OneKeyPinModal
        isOpen={openModal === "onekeyPin"}
        deviceType={deviceType as HWIDeviceType}
        network={network}
        model={currentDevice?.model ?? null}
        onClose={closeModalHandler}
        onSuccess={() => {
          openModalHandler("deviceActionSuccess");
        }}
      />
    </>
  );
};

export default ModalsManager;
