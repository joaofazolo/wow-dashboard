export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

/** OAuth2 client-credentials flow with an in-memory token cache. Used by Blizzard and Warcraft Logs. */
export function clientCredentials(tokenUrl: string, clientId: string, clientSecret: string) {
  let cached: { token: string; expiresAt: number } | null = null;

  return async function getToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    const data = await getJson<{ access_token: string; expires_in: number }>(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    // Refresh a minute early so we never send an expired token.
    cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
    return cached.token;
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
