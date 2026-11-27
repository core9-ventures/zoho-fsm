import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { clearImageCache } from "./AuthImage";
import { useSession } from "../session";

/** Top bar: the signed-in name and company, and Sign out. Respects the phone's status bar and notch. */
export function Header({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  const { user, signOut } = useSession();
  return (
    <header
      className="bg-card flex items-center gap-1 border-b px-4 pb-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-tight font-semibold">{user?.fullName ?? "FieldServe"}</p>
        <p className="text-muted-foreground truncate text-xs">{user?.companyName ?? "FieldServe"}</p>
      </div>
      {trailing}
      <button
        type="button"
        onClick={() => {
          void signOut().then(clearImageCache);
        }}
        className="hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium"
      >
        <LogOut className="size-4" /> Sign out
      </button>
    </header>
  );
}
