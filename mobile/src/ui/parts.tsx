import type { ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { formatMoney } from "../lib/money";
import { useSession } from "../session";

/** Formats an amount in the signed-in company's currency. */
export function useMoney() {
  const { user } = useSession();
  return (n: number) => formatMoney(n, user?.currency);
}

/** Title of a screen, with an optional back link. */
export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: { to: string; label: string } }) {
  return (
    <div className="space-y-1">
      {back && (
        <Link to={back.to} className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> {back.label}
        </Link>
      )}
      <h1 className="text-xl leading-snug font-semibold">{title}</h1>
      {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
    </div>
  );
}

/** A tappable list card. */
export function Row({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="bg-card active:bg-muted/50 flex items-center gap-3 rounded-xl border p-3">
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}

/** A framed block with an optional heading. */
export function Section({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      {(title || right) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Label and value pairs; empty values are left out. */
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-y-2 text-sm">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** A small figure with a caption (invoice totals, counts). */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "green" }) {
  return (
    <div className="bg-card rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${tone === "red" ? "text-destructive" : tone === "green" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export function mapsLink(address: { latitude: number | null; longitude: number | null; fullAddress?: string | null } | null) {
  if (!address) return null;
  if (address.latitude != null && address.longitude != null)
    return `https://www.google.com/maps/search/?api=1&query=${address.latitude},${address.longitude}`;
  return address.fullAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.fullAddress)}` : null;
}
