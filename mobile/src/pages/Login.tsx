import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { ApiError } from "../api";
import { API_BASE_URL } from "../config";
import { useSession } from "../session";

/** Email + password sign-in against the FieldServe server. */
export function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    if (!email.trim()) next.email = "Enter your email address.";
    if (!password) next.password = "Enter your password.";
    setFieldErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) if (msgs[0]) fields[k] = msgs[0];
        setFieldErrors(fields);
        setError(err.status === 400 && Object.keys(fields).length > 0 ? null : err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex h-full flex-col justify-center gap-6 overflow-y-auto p-6"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">FieldServe</h1>
        <p className="text-muted-foreground mt-1 text-sm">Sign in to continue.</p>
      </div>

      <form onSubmit={submit} noValidate className="bg-card space-y-4 rounded-xl border p-4">
        {error && (
          <p role="alert" className="border-destructive/50 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
            className="bg-background w-full rounded-md border px-3 py-2.5 text-base outline-none focus:border-[var(--ring)]"
          />
          {fieldErrors.email && <p className="text-destructive text-sm">{fieldErrors.email}</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              className="bg-background w-full rounded-md border py-2.5 pr-11 pl-3 text-base outline-none focus:border-[var(--ring)]"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="text-muted-foreground absolute inset-y-0 right-0 px-3"
            >
              {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          {fieldErrors.password && <p className="text-destructive text-sm">{fieldErrors.password}</p>}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />} Sign in
        </button>
      </form>

      <p className="text-muted-foreground text-center text-xs break-all">Server: {API_BASE_URL}</p>
    </div>
  );
}
