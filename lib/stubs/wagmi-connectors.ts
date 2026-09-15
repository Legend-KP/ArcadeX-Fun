/** Server stub — wallet connectors stay in the browser bundle. */
const stubConnector = () => ({});

export const injected = () => stubConnector;
export const walletConnect = () => stubConnector;
export const coinbaseWallet = () => stubConnector;
export const metaMask = () => stubConnector;
export const safe = () => stubConnector;
