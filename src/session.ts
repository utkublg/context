// A stateless signed cookie: "<userId>.<sessionVersion>.<expiresAtSeconds>.<hmac>". No session
// table needed — the caller compares sessionVersion against the DB to support revocation.

const COOKIE = "__Host-context-session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookie(secret: string, userId: string, sessionVersion: number): Promise<string> {
  const payload = `${userId}.${sessionVersion}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  const value = `${payload}.${await hmac(secret, payload)}`;
  return `${COOKIE}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export const clearSessionCookie = `${COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;

export async function readSession(
  secret: string,
  request: Request
): Promise<{ userId: string; sessionVersion: number } | null> {
  const raw = request.headers
    .get("Cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [userId, sessionVersion, exp, sig] = raw.split(".");
  if (!userId || !sessionVersion || !exp || !sig) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!timingSafeEqual(sig, await hmac(secret, `${userId}.${sessionVersion}.${exp}`))) return null;
  return { userId, sessionVersion: Number(sessionVersion) };
}
