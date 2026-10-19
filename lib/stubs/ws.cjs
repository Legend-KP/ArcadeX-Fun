/**
 * Stand-in for the Node `ws` package.
 * Workers and current Node already expose a global WebSocket. `ws` is only a
 * peer of packages such as isows, and pnpm does not hoist it for OpenNext.
 */
const Socket = globalThis.WebSocket;

function WebSocketShim(address, protocols) {
  const Impl = globalThis.WebSocket;
  if (typeof Impl !== "function") {
    throw new Error("WebSocket is not available in this runtime");
  }
  return new Impl(address, protocols);
}

if (typeof Socket === "function") {
  Object.setPrototypeOf(WebSocketShim, Socket);
  WebSocketShim.prototype = Socket.prototype;
}

WebSocketShim.WebSocket = WebSocketShim;
WebSocketShim.default = WebSocketShim;

module.exports = WebSocketShim;
