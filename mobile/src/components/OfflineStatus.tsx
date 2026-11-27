import { useEffect, useState, useSyncExternalStore } from "react";
import { connection } from "../local/connection";
import { LATEST_VERSION } from "../local/migrations";
import { gpsBacklog } from "../local/gps";
import { outboxStatus } from "../local/outbox";
import { syncNow, syncStatus } from "../local/sync";
import { Button } from "../ui/kit";
import { ago } from "./SyncBar";

/**
 * The state of the offline data in plain words, for the technician and for whoever tests the app in the field:
 * is the server reachable, when did the phone last sync, what is still waiting to be sent. Shown in Account.
 */
export function OfflineStatus() {
  const sync = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const out = useSyncExternalStore(outboxStatus.subscribe, outboxStatus.get);
  const reachable = useSyncExternalStore(connection.subscribe, connection.get);
  const [gps, setGps] = useState(0);
  useEffect(() => {
    void gpsBacklog().then(setGps);
  }, [out.pending, sync.lastSyncedAt]);
  if (!sync.available) return null;

  const rows: [string, string][] = [
    ["Server", reachable ? "Reachable" : "Offline"],
    ["Last synced", sync.lastSyncedAt ? ago(sync.lastSyncedAt) : "Never"],
    ["Changes waiting to be sent", String(out.pending)],
    ["Changes not accepted", String(out.failed)],
    ["GPS points waiting", String(gps)],
    ["Phone database version", String(LATEST_VERSION)],
  ];
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">Offline data</h2>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {sync.error && <p className="text-muted-foreground text-xs">{sync.error}</p>}
      <Button variant="outline" className="w-full" busy={sync.syncing || out.sending} onClick={() => void syncNow({ full: true })}>
        Send changes and sync everything
      </Button>
    </div>
  );
}
