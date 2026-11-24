import { Loader2, RefreshCw } from "lucide-react";
import { authApi } from "../api";
import { API_BASE_URL } from "../config";
import { useAsync } from "../data/useAsync";
import { useSession } from "../session";

/** Who is signed in (read from the server) and the server the app is connected to. */
export function Account() {
  const { signOut } = useSession();
  const { data: me, error, loading, reload } = useAsync(() => authApi.me());

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Account</h1>

      <div className="bg-card rounded-xl border p-4">
        {loading && !me && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {error && (
          <div className="space-y-2">
            <p role="alert" className="text-destructive text-sm">
              {error.message}
            </p>
            <button
              type="button"
              onClick={() => void reload()}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              <RefreshCw className="size-4" /> Try again
            </button>
          </div>
        )}
        {me && (
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{me.fullName}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{me.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{me.role.charAt(0) + me.role.slice(1).toLowerCase()}</dd>
            <dt className="text-muted-foreground">Company</dt>
            <dd>{me.companyName ?? "—"}</dd>
            <dt className="text-muted-foreground">Server</dt>
            <dd className="text-xs break-all">{API_BASE_URL}</dd>
          </dl>
        )}
      </div>

      <button
        type="button"
        onClick={() => void signOut()}
        className="w-full rounded-md border px-4 py-2.5 text-sm font-medium"
      >
        Sign out
      </button>
    </div>
  );
}
