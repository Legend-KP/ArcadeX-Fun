/** Minimal server stub so client-only Vara modules can SSR-parse. */
export class TypeRegistry {
  setKnownTypes(_types: unknown): void {}
  register(_types: unknown): void {}
  createType(_type: string, _value?: unknown): never {
    throw new Error("TypeRegistry is not available on the server Worker.");
  }
}
