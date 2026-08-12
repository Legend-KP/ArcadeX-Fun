export async function verifyBasePlaySignIn(params: {
  txHash: string;
  gameId: string;
}): Promise<{ ok: true; purpose: string; reused: boolean }> {
  const res = await fetch("/api/tx-hub/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(params),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    purpose?: string;
    reused?: boolean;
    error?: string;
    code?: string;
  };

  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Could not verify Base play sign-in.");
  }

  return {
    ok: true,
    purpose: data.purpose ?? "",
    reused: Boolean(data.reused),
  };
}
