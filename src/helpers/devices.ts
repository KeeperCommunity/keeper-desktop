import bitboxIcon from "../assets/hww/icons/bitbox.svg";
import trezorIcon from "../assets/hww/icons/trezor.svg";
import ledgerIcon from "../assets/hww/icons/ledger.svg";
import onekeyIcon from "../assets/hww/icons/onekey.svg";
import coldcardIcon from "../assets/hww/icons/coldcard.svg";
import jadeIcon from "../assets/hww/icons/jade.svg";
import ledgerIconModal from "../assets/hww/icons-modal/ledger.svg";
import trezorIconModal from "../assets/hww/icons-modal/trezor.svg";
import bitboxIconModal from "../assets/hww/icons-modal/bitbox.svg";
import onekeyIconModal from "../assets/hww/icons-modal/onekey.svg";
import coldcardIconModal from "../assets/hww/icons-modal/coldcard.svg";
import jadeIconModal from "../assets/hww/icons-modal/jade.svg";

type NetworkType = "TESTNET" | "MAINNET";

const HWI_ACTIONS = {
  connect: "connect",
  shareXpubs: "shareXpubs",
  healthCheck: "healthCheck",
  signTx: "signTx",
  registerMultisig: "registerMultisig",
  verifyAddress: "verifyAddress",
};

type HWI_ACTION = keyof typeof HWI_ACTIONS;

const HWI_DEVICES = {
  ledger: {
    icon: ledgerIcon,
    name: "Ledger",
  },
  onekey: {
    icon: onekeyIcon,
    name: "OneKey",
  },
  trezor: {
    icon: trezorIcon,
    name: "Trezor",
  },
  bitbox02: {
    icon: bitboxIcon,
    name: "BitBox02",
  },
  coldcard: {
    icon: coldcardIcon,
    name: "Coldcard",
  },
  jade: {
    icon: jadeIcon,
    name: "Jade",
  },
};

interface HWIDevice {
  device_type: HWIDeviceType;
  model: string;
  path: string;
  needs_pin_sent: boolean;
  needs_passphrase_sent: boolean;
  fingerprint: string | null;
}

interface DeviceContent {
  icon: string;
  content: Record<HWI_ACTION, { text: string; list: string[] }>;
}

type HWIDeviceType = keyof typeof HWI_DEVICES;

const deviceContent: Record<HWIDeviceType, DeviceContent> = {
  ledger: {
    icon: ledgerIconModal,
    content: {
      connect: {
        text: "Your mobile app is trying to connect to your Ledger. Please connect your Ledger to your computer via USB, unlock it with your PIN and open the BTC app on it.",
        list: [],
      },
      shareXpubs: {
        text: "Keep your Ledger connected to the computer until the operation is completed.",
        list: [],
      },
      healthCheck: {
        text: "Your Mobile app is trying to perform a health check. Keep your Ledger connected to the computer until the operation is completed.",
        list: [
          "Health check ensures the device holds the keys registered in the mobile app",
        ],
      },
      signTx: {
        text: "Please sign the transaction by approving it on your Ledger.",
        list: [
          "Make sure to verify the address and the amount appearing on the screen of your Ledger device are correct.",
          "Only trust the information displayed on your Ledger's screen, and only approve it if it matches the expected details.",
        ],
      },
      registerMultisig: {
        text: "Please approve the registration of the multisig on the connected Ledger device.",
        list: [
          "Make sure to verify the public keys and multisig details shown on the Ledger screen match the expected public keys of your cosigners and multisig details.",
        ],
      },
      verifyAddress: {
        text: "Clicking below will display the address on your Ledger device, make sure to read it carefully and verify that it matches the address on your Keeper mobile app.",
        list: [
          "Only use the address from Keeper mobile app if it matches the address displayed on your Ledger.",
          "In case the address on your Ledger is different than the address on the Keeper mobile app please contact support immediately.",
        ],
      },
    },
  },
  onekey: {
    icon: onekeyIconModal,
    content: {
      connect: {
        text: "Your mobile app is trying to connect to your OneKey. Please connect your OneKey to your computer via USB, unlock it, and open the Bitcoin app on the device.",
        list: [],
      },
      shareXpubs: {
        text: "Keep your OneKey connected to the computer until setup is completed.",
        list: [],
      },
      healthCheck: {
        text: "Your Mobile app is trying to perform a health check. Keep your OneKey connected to the computer until the operation is completed.",
        list: [
          "Health check ensures the device holds the keys registered in the mobile app",
        ],
      },
      signTx: {
        text: "Please sign the transaction by approving it on your OneKey.",
        list: [
          "Make sure to verify the address and amount shown on your OneKey screen.",
          "Only approve the request if the OneKey screen matches the expected details in Keeper.",
        ],
      },
      registerMultisig: {
        text: "Operation not supported on OneKey",
        list: [],
      },
      verifyAddress: {
        text: "Clicking below will display the address on your OneKey device, make sure to read it carefully and verify that it matches the address on your Keeper mobile app.",
        list: [
          "Only use the address from Keeper mobile app if it matches the address displayed on your OneKey.",
          "In case the address on your OneKey is different than the address on the Keeper mobile app please contact support immediately.",
        ],
      },
    },
  },
  trezor: {
    icon: trezorIconModal,
    content: {
      connect: {
        text: "Your mobile app is trying to connect to Trezor. Please connect your Trezor to your computer (for Trezor Model T you should first unlock it with your PIN) to continue with Keeper Desktop app.",
        list: [],
      },
      shareXpubs: {
        text: "Keep your Trezor connected to the computer until the operation is completed.",
        list: [],
      },
      healthCheck: {
        text: "Your Mobile app is trying to perform a health check. Keep your Trezor connected to the computer until the operation is completed.",
        list: [
          "Health check ensures the device holds the keys registered in the mobile app",
        ],
      },
      signTx: {
        text: "Please sign the transaction by approving it on your Trezor.",
        list: [
          "Make sure to verify the address and the amount appearing on the screen of your Trezor device are correct.",
          "Only trust the information displayed on your Trezor's screen, and only approve it if it matches the expected details.",
        ],
      },
      registerMultisig: {
        text: "Operation not supported on Trezor",
        list: [],
      },
      verifyAddress: {
        text: "Clicking below will display the address on your Trezor device, make sure to read it carefully and verify that it matches the address on your Keeper mobile app.",
        list: [
          "Only use the address from Keeper mobile app if it matches the address displayed on your Trezor.",
          "In case the address on your Trezor is different than the address on the Keeper mobile app please contact support immediately.",
        ],
      },
    },
  },
  bitbox02: {
    icon: bitboxIconModal,
    content: {
      connect: {
        text: "Your mobile app is trying to connect to BitBox02. Please connect your BitBox02 to the computer to continue with Keeper Desktop app. If your device is locked you will need to unlock it after clicking Continue.",
        list: [],
      },
      shareXpubs: {
        text: "Keep your BitBox02 connected to the computer until the operation is completed.",
        list: [],
      },
      healthCheck: {
        text: "Your Mobile app is trying to perform a health check. Keep your BitBox02 connected to the computer until the operation is completed.",
        list: [
          "Health check ensures the device holds the keys registered in the mobile app",
        ],
      },
      signTx: {
        text: "Please sign the transaction by approving it on your BitBox02.",
        list: [
          "Make sure to verify the address and the amount appearing on the screen of your BitBox02 device are correct.",
          "Only trust the information displayed on your BitBox02's screen, and only approve it if it matches the expected details.",
        ],
      },
      registerMultisig: {
        text: "Please approve the registration of the multisig on the connected BitBox02 device.",
        list: [
          "Make sure to verify the public keys and multisig details shown on the BitBox02 screen match the expected public keys of your cosigners and multisig details.",
        ],
      },
      verifyAddress: {
        text: "Clicking below will display the address on your BitBox02 device, make sure to read it carefully and verify that it matches the address on your Keeper mobile app.",
        list: [
          "Only use the address from Keeper mobile app if it matches the address displayed on your BitBox02.",
          "In case the address on your BitBox02 is different than the address on the Keeper mobile app please contact support immediately.",
        ],
      },
    },
  },
  coldcard: {
    icon: coldcardIconModal,
    content: {
      connect: {
        text: "Your mobile app is trying to connect to Coldcard. Please connect your Coldcard to the computer and unlock it with your PIN to continue with Keeper Desktop app",
        list: [],
      },
      shareXpubs: {
        text: "Keep your Coldcard connected to the computer until the operation is completed.",
        list: [],
      },
      healthCheck: {
        text: "Your Mobile app is trying to perform a health check. Keep your Coldcard connected to the computer until the operation is completed.",
        list: [
          "Health check ensures the device holds the keys registered in the mobile app",
        ],
      },
      signTx: {
        text: "Please sign the transaction by approving it on your Coldcard.",
        list: [
          "Make sure to verify the address and the amount appearing on the screen of your Coldcard device are correct.",
          "Only trust the information displayed on your Coldcard's screen, and only approve it if it matches the expected details.",
        ],
      },
      registerMultisig: {
        text: "Operation not supported on Coldcard via USB, please register the multisig via SD card or QR.",
        list: [],
      },
      verifyAddress: {
        text: "Clicking below will display the address on your Coldcard device, make sure to read it carefully and verify that it matches the address on your Keeper mobile app.",
        list: [
          "Only use the address from Keeper mobile app if it matches the address displayed on your Coldcard.",
          "In case the address on your Coldcard is different than the address on the Keeper mobile app please contact support immediately.",
        ],
      },
    },
  },
  jade: {
    icon: jadeIconModal,
    content: {
      connect: {
        text: "Your mobile app is trying to connect to Jade. Please connect your Jade to the computer and unlock it with your PIN to continue with Keeper Desktop app",
        list: [],
      },
      shareXpubs: {
        text: "Keep your Jade connected to the computer until the operation is completed.",
        list: [],
      },
      healthCheck: {
        text: "Your Mobile app is trying to perform a health check. Keep your Jade connected to the computer until the operation is completed.",
        list: [
          "Health check ensures the device holds the keys registered in the mobile app",
        ],
      },
      signTx: {
        text: "Please sign the transaction by approving it on your Jade.",
        list: [
          "Make sure to verify the address and the amount appearing on the screen of your Jade device are correct.",
          "Only trust the information displayed on your Jade's screen, and only approve it if it matches the expected details.",
        ],
      },
      registerMultisig: {
        text: "Please approve the registration of the multisig on the connected Jade device.",
        list: [
          "Make sure to verify the public keys and multisig details shown on the Jade screen match the expected public keys of your cosigners and multisig details.",
        ],
      },
      verifyAddress: {
        text: "Clicking below will display the address on your Jade device, make sure to read it carefully and verify that it matches the address on your Keeper mobile app.",
        list: [
          "Only use the address from Keeper mobile app if it matches the address displayed on your Jade.",
          "In case the address on your Jade is different than the address on the Keeper mobile app please contact support immediately.",
        ],
      },
    },
  },
};

export {
  HWI_DEVICES,
  HWI_ACTIONS,
  deviceContent,
  type HWI_ACTION,
  type HWIDeviceType,
  type HWIDevice,
  type NetworkType,
};
