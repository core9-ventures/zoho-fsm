import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Toast = { id: number; kind: "success" | "error"; text: string };
type Api = { success: (text: string) => void; error: (text: string) => void };

const ToastContext = createContext<Api | null>(null);
let next = 1;

/** Small messages at the top of the screen (saved, or something went wrong). They disappear by themselves. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = next++;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const api = useMemo<Api>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
              t.kind === "error"
                ? "border-destructive/50 bg-card text-destructive"
                : "bg-card border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {t.kind === "error" ? (
              <XCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const t = useContext(ToastContext);
  if (!t) throw new Error("useToast must be used inside ToastProvider");
  return t;
}
