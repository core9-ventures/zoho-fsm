import type { SessionUser, TokenResponse } from "@/modules/auth/auth.schema";
import { openUserDb, wipeLocalData } from "../local/db";
import { http, request } from "./http";
import { clearTokens, readTokens, saveTokens } from "./tokens";

export type { SessionUser };

const USER_KEY = "fs.user";

/** The signed-in user as last confirmed by the server, so the app can open without a signal. */
function rememberUser(user: SessionUser) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage blocked: the app then needs a signal to open */
  }
}

function forgetUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

/** Technicians keep their jobs on the phone; the office screens stay online. */
const keepsDataOnPhone = (user: SessionUser) => user.role === "TECHNICIAN";

export const authApi = {
  /** Email + password → tokens are saved on the phone, the signed-in user is returned. */
  async login(email: string, password: string): Promise<SessionUser> {
    const res = await request<TokenResponse>("POST", "/auth/token", { body: { email, password }, auth: false });
    saveTokens(res);
    rememberUser(res.user);
    if (keepsDataOnPhone(res.user)) await openUserDb(res.user.id);
    return res.user;
  },

  /** The signed-in user (used to restore a session when the app opens). */
  async me(): Promise<SessionUser> {
    const user = await http.get<SessionUser>("/auth/me");
    rememberUser(user);
    return user;
  },

  /** The saved user, if the app cannot reach the server when it opens. */
  cachedUser(): SessionUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  },

  /** Opens the phone database of a user whose sign-in was just confirmed (technicians only). */
  async openLocalData(user: SessionUser): Promise<void> {
    if (keepsDataOnPhone(user)) await openUserDb(user.id);
  },

  /** Revokes the refresh token on the server, then forgets the tokens and the saved data on the phone. */
  async logout(): Promise<void> {
    const tokens = readTokens();
    try {
      if (tokens) await http.post("/auth/logout", { refreshToken: tokens.refreshToken });
    } catch {
      /* offline or already expired: signing out on the phone still works */
    } finally {
      clearTokens();
      forgetUser();
      await wipeLocalData();
    }
  },

  hasTokens: () => readTokens() !== null,
};
