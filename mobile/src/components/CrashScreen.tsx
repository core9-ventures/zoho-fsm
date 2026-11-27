import { useRouteError } from "react-router-dom";

/**
 * Shown instead of React's default error page when a screen crashes. The technician gets a plain message and a button
 * to reopen the app (their saved data and queued changes are untouched); the technical lines below are for the
 * person fixing it: the message, the screen address and the first lines of the stack.
 */
export function CrashScreen() {
  const error = useRouteError();
  const e = error instanceof Error ? error : new Error(String(error));
  const lines = (e.stack ?? "").split("\n").slice(0, 8).join("\n");
  return (
    <div className="bg-background text-foreground flex min-h-full flex-col gap-3 p-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">
        Your saved data and any changes waiting to be sent are safe. Tap the button to open the app again.
      </p>
      <button
        type="button"
        className="bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium"
        onClick={() => window.location.assign("/")}
      >
        Reopen the app
      </button>
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">Details for support</summary>
        <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 break-words whitespace-pre-wrap">
          {`${e.name}: ${e.message}\nat ${window.location.pathname}\n${lines}`}
        </pre>
      </details>
    </div>
  );
}
