import type { SessionUser, TokenResponse } from "@/modules/auth/auth.schema";
import { http, request } from "./http";
import { clearTokens, readTokens, saveTokens } from "./tokens";

export type { SessionUser };

export const authApi = {
  /** Email + password → tokens are saved on the phone, the signed-in user is returned. */
  async login(email: string, password: string): Promise<SessionUser> {
    const res = await request<TokenResponse>("POST", "/auth/token", { body: { email, password }, auth: false });
    saveTokens(res);
    return res.user;
  },

  /** The signed-in user (used to restore a session when the app opens). */
  me: () => http.get<SessionUser>("/auth/me"),

  /** Revokes the refresh token on the server, then forgets the tokens on the phone. */
  async logout(): Promise<void> {
    const tokens = readTokens();
    try {
      if (tokens) await http.post("/auth/logout", { refreshToken: tokens.refreshToken });
    } catch {
      /* offline or already expired: signing out on the phone still works */
    } finally {
      clearTokens();
    }
  },

  hasTokens: () => readTokens() !== null,
};
