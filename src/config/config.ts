import { invoke } from "@tauri-apps/api/tauri";

async function getEnvironment() {
  try {
    const environment = await invoke<string>("get_environment");
    return environment;
  } catch (error) {
    console.error("Failed to get environment:", error);
    return "dev"; // Default to dev if there's an error
  }
}

async function getConfig() {
  const environment = await getEnvironment();
  const config = environment === "prod" ? prodConfig : devConfig;
  return config;
}

const devConfig = {
  relay: "https://bithyve-dev-relay.el.r.appspot.com",
  subscriptions: {
    btcPayUrl:
      "https://testnet.demo.btcpayserver.org/apps/QgBFbiANLMnEgbrAGBwMEYaaYFP/pos",
  },
};

const prodConfig = {
  relay: "https://relay.bitcoinkeeper.app/",
  subscriptions: {
    btcPayUrl:
      "https://btcpay0.voltageapp.io/apps/3REVa49pm5EwCt6nArFztmHKzd7L/pos",
  },
};

// Export a promise that resolves to the configuration
export { getConfig };
