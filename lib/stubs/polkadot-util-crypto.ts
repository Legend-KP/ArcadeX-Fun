/** Server stub — avoids embedding @polkadot/util-crypto wasm in the Worker. */
export function signatureVerify(
  _message: string,
  _signature: string,
  _address: string
): { isValid: boolean } {
  return { isValid: false };
}

export function decodeAddress(_address: string): Uint8Array {
  throw new Error("Vara address decoding is not available in this deployment.");
}
