import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ApiError } from "../api";

export const inputClass =
  "bg-background w-full rounded-md border px-3 py-2.5 text-base outline-none focus:border-[var(--ring)] disabled:opacity-60 aria-[invalid=true]:border-destructive";

/** A labeled form control with its error message under it. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

type Variant = "primary" | "outline" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground",
  outline: "border bg-card",
  danger: "bg-destructive text-white",
  ghost: "hover:bg-accent",
};

export function Button({
  variant = "primary",
  busy,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${variants[variant]} ${className}`}
      {...rest}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/** A dialog over the screen (hold reason, leave warning, confirmations). */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="bg-card relative w-full max-w-md space-y-4 rounded-t-2xl border p-5 shadow-xl sm:rounded-2xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        {children}
        <div className="flex flex-col gap-2">{footer}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
      <Loader2 className="size-4 animate-spin" /> {label}
    </p>
  );
}

/** A failed load, with a Try again button. */
export function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border p-4 text-center">
      <p role="alert" className="text-destructive text-sm">
        {error.message}
      </p>
      <Button variant="outline" onClick={onRetry} className="mx-auto">
        <RefreshCw className="size-4" /> Try again
      </Button>
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "amber" | "green" | "red" | "blue" }) {
  const tones = {
    muted: "border-border text-muted-foreground",
    amber: "border-amber-500/60 text-amber-600 dark:text-amber-400",
    green: "border-emerald-500/60 text-emerald-600 dark:text-emerald-400",
    red: "border-destructive/60 text-destructive",
    blue: "border-sky-500/60 text-sky-600 dark:text-sky-400",
  };
  return <span className={`inline-block rounded-md border px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
