import {
  CHAIN_REGISTRY,
  getDefaultChainSettings,
  mergeChainSettings,
} from "@/lib/chain-registry";
import { firestoreFetch, type FirestoreDocument } from "@/lib/firestore-server";
import type { ChainFeatures, ChainKey } from "@/types";

const SETTINGS_DOC_PATH = "settings/chains";

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
};

function parseField(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  return undefined;
}

function settingsFromDocument(
  doc: FirestoreDocument | null
): Partial<Record<ChainKey, Partial<ChainFeatures>>> {
  if (!doc?.fields) return {};

  const stored: Partial<Record<ChainKey, Partial<ChainFeatures>>> = {};

  for (const entry of CHAIN_REGISTRY) {
    const walletConnect = parseField(
      doc.fields[`${entry.key}_walletConnect`]
    );
    const shopPayments = parseField(doc.fields[`${entry.key}_shopPayments`]);

    if (walletConnect === undefined && shopPayments === undefined) {
      continue;
    }

    stored[entry.key] = {
      ...(walletConnect !== undefined
        ? { walletConnect: walletConnect !== false }
        : {}),
      ...(shopPayments !== undefined
        ? { shopPayments: shopPayments !== false }
        : {}),
    };
  }

  return stored;
}

function settingsToFields(
  settings: Record<ChainKey, ChainFeatures>
): Record<string, boolean> {
  const fields: Record<string, boolean> = {};
  for (const entry of CHAIN_REGISTRY) {
    const features = settings[entry.key];
    fields[`${entry.key}_walletConnect`] = features.walletConnect;
    fields[`${entry.key}_shopPayments`] = features.shopPayments;
  }
  return fields;
}

function encodeFields(
  data: Record<string, string | number | boolean>
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") fields[key] = { stringValue: value };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else if (Number.isInteger(value))
      fields[key] = { integerValue: String(value) };
    else fields[key] = { doubleValue: value };
  }
  return fields;
}

async function fetchSettingsDocument(): Promise<FirestoreDocument | null> {
  const res = await firestoreFetch(SETTINGS_DOC_PATH);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as FirestoreDocument;
}

export async function fetchChainSettingsFromServer(): Promise<
  Record<ChainKey, ChainFeatures>
> {
  const doc = await fetchSettingsDocument();
  return mergeChainSettings(settingsFromDocument(doc));
}

export async function updateChainSettingsOnServer(
  patch: Partial<Record<ChainKey, Partial<ChainFeatures>>>
): Promise<Record<ChainKey, ChainFeatures>> {
  const current = await fetchChainSettingsFromServer();
  const combined = { ...current };

  for (const entry of CHAIN_REGISTRY) {
    const key = entry.key;
    const keyPatch = patch[key];
    if (!keyPatch) continue;
    combined[key] = { ...combined[key], ...keyPatch };
  }

  const next = mergeChainSettings(combined);

  const res = await firestoreFetch(SETTINGS_DOC_PATH, {
    method: "PATCH",
    body: JSON.stringify({
      fields: encodeFields(settingsToFields(next)),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore update failed (${res.status}): ${text}`);
  }

  return next;
}

export { getDefaultChainSettings };
