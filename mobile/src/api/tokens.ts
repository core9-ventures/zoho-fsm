/** The sign-in tokens, kept on the phone. (Moves to the Android keystore with the native plugins in Phase 6.) */
export type Tokens = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

const KEY = "fs.tokens";

export function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(t: Tokens) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* storage blocked: the user just has to sign in again next time */
  }
}

export function clearTokens() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
