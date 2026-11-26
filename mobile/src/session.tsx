import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, authApi, onSessionLost, type SessionUser } from "./api";

/** Which set of screens the signed-in user gets. */
export type Role = "TECHNICIAN" | "OFFICE";

type Session = {
  user: SessionUser | null;
  role: Role | null;
  /** True while the app checks, on opening, whether the saved sign-in is still valid. */
  restoring: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/** Admin and Dispatcher use the office screens. Other account types have no mobile screens yet. */
function roleOf(user: SessionUser): Role | null {
  if (user.role === "TECHNICIAN") return "TECHNICIAN";
  if (user.role === "ADMIN" || user.role === "DISPATCHER") return "OFFICE";
  return null;
}

const NOT_SUPPORTED = "This account type cannot use the mobile app yet. Please use the web portal.";

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(authApi.hasTokens());

  // Opening the app with a saved sign-in: confirm it with the server (this also refreshes an expired token).
  useEffect(() => {
    if (!authApi.hasTokens()) return;
    let cancelled = false;
    authApi
      .me()
      .then(async (me) => {
        if (cancelled) return;
        if (roleOf(me)) {
          await authApi.openLocalData(me);
          if (!cancelled) setUser(me);
        } else await authApi.logout();
      })
      .catch(async (e) => {
        // No signal: a technician who signed in before keeps working from the saved data. A lost session is
        // handled by onSessionLost, and any other error leaves the sign-in screen up.
        if (!(e instanceof ApiError && e.isNetwork)) return;
        const saved = authApi.cachedUser();
        if (!saved || saved.role !== "TECHNICIAN" || !authApi.hasTokens()) return;
        await authApi.openLocalData(saved);
        if (!cancelled) setUser(saved);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The refresh token stopped working: back to the sign-in screen.
  useEffect(() => onSessionLost(() => setUser(null)), []);

  const signIn = useCallback(async (email: string, password: string) => {
    const me = await authApi.login(email.trim(), password);
    if (!roleOf(me)) {
      await authApi.logout();
      throw new ApiError(NOT_SUPPORTED, 403);
    }
    setUser(me);
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo<Session>(
    () => ({ user, role: user ? roleOf(user) : null, restoring, signIn, signOut }),
    [user, restoring, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}
