import { useEffect, useState, useSyncExternalStore } from "react";
import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import { discardChange, listOutbox, outboxStatus, retryFailed, type OutboxItem } from "../local/outbox";
import { loadSyncStatus, syncNow, syncStatus } from "../local/sync";
import { Button, Modal } from "../ui/kit";

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(then: number, now = Date.now()): string {
  const min = Math.floor(Math.max(0, now - then) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

const FOREGROUND_SYNC_MS = 5 * 60_000;
/** Opening the app again after this long syncs at once. */
const STALE_MS = 60_000;

/**
 * Keeps the phone data fresh while a technician is signed in: syncs when the app opens, every 5 minutes while it is
 * on screen, when the phone gets its signal back and when the app comes back to the front.
 */
function useAutoSync() {
  useEffect(() => {
    let alive = true;
    void loadSyncStatus().then(() => {
      if (alive) void syncNow();
    });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, FOREGROUND_SYNC_MS);
    const onOnline = () => void syncNow();
    const onVisible = () => {
      const last = syncStatus.get().lastSyncedAt;
      if (document.visibilityState === "visible" && (!last || Date.now() - last > STALE_MS)) void syncNow();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/** A thin bar under the header: when the phone last synced, with a button to sync now. Hidden in the browser preview. */
export function SyncBar() {
  useAutoSync();
  const s = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const out = useSyncExternalStore(outboxStatus.subscribe, outboxStatus.get);
  const [reviewing, setReviewing] = useState(false);
  // Re-draw every 30 seconds so "5 min ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!s.available) return null;

  const waiting = out.pending + out.failed;

  return (
    <>
    {waiting > 0 && (
      <button
        type="button"
        onClick={() => setReviewing(true)}
        className={`flex w-full items-center gap-2 border-b px-4 py-1.5 text-left text-xs font-medium ${
          out.failed > 0 ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-700"
        }`}
      >
        {out.sending ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <CloudOff className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1">
          {out.failed > 0
            ? `${out.failed} change${out.failed === 1 ? "" : "s"} could not be sent. Tap to review.`
            : `${out.pending} change${out.pending === 1 ? "" : "s"} saved on this phone, waiting to be sent.`}
        </span>
      </button>
    )}
    <div className="bg-muted/50 text-muted-foreground flex items-center gap-2 border-b px-4 py-1.5 text-xs">
      {s.offline ? <CloudOff className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate" role="status">
        {s.syncing
          ? "Syncing…"
          : s.error && s.lastSyncedAt
            ? `${s.error} Last synced ${ago(s.lastSyncedAt)}.`
            : s.error
              ? s.error
              : s.lastSyncedAt
                ? `Last synced ${ago(s.lastSyncedAt)}`
                : "Not synced yet"}
      </span>
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={s.syncing}
        aria-label="Sync now"
        className="flex items-center gap-1 rounded-md px-2 py-1 font-medium active:bg-black/10 disabled:opacity-60"
      >
        {s.syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sync
      </button>
    </div>
    <OutboxReview open={reviewing} onClose={() => setReviewing(false)} />
    </>
  );
}

/** The changes that are waiting or were refused, with what the server said and a way to try again or give up. */
function OutboxReview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const out = useSyncExternalStore(outboxStatus.subscribe, outboxStatus.get);
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (open) void listOutbox().then(setItems);
  }, [open, out.pending, out.failed]);
  useEffect(() => {
    if (open && out.pending + out.failed === 0) onClose();
  }, [open, out.pending, out.failed, onClose]);

  return (
    <Modal
      open={open}
      title="Changes on this phone"
      description="These were made without a signal or could not be sent yet."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void retryFailed().then(() => syncNow())} busy={out.sending}>
            Send now
          </Button>
        </>
      }
    >
      <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
        {items.map((i) => (
          <li key={i.seq} className="rounded-md border p-2">
            <p className="font-medium">{i.label}</p>
            <p className={i.status === "failed" ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
              {i.status === "failed" ? `Not accepted: ${i.error ?? "unknown reason"}` : (i.error ?? "Waiting to be sent")}
            </p>
            <button
              type="button"
              className="text-muted-foreground mt-1 text-xs underline"
              onClick={() => void discardChange(i.seq)}
            >
              {i.status === "failed" ? "Give up on this change" : "Delete this change"}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
