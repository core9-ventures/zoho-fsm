import { useState } from "react";
import { MapPin, Phone, Send } from "lucide-react";
import { useParams } from "react-router-dom";
import { ApiError, workOrdersApi } from "../../api";
import { AuthImage } from "../../components/AuthImage";
import { useAsync } from "../../data/useAsync";
import { formatDateTime } from "../../lib/format";
import { priorityBadge, STATUS_LABEL, statusTone } from "../../lib/status";
import { useSession } from "../../session";
import { Badge, Button, Field, LoadError, Modal, Spinner, inputClass } from "../../ui/kit";
import { KV, mapsLink, PageHeader, Section, useMoney } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { SLOT_LABEL } from "@/modules/work-orders/evidence";
import { nextStatuses, REASON_REQUIRED, STATUS_TEXT, transitionLabel } from "@/modules/work-orders/work-order-status";

type Status = Parameters<typeof transitionLabel>[0];

/** One work order: the job, its status buttons, lines and totals, photos, notes and history. */
export function WorkOrderDetail() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const toast = useToast();
  const money = useMoney();
  const { data: w, error, loading, reload } = useAsync(() => workOrdersApi.get(id), [id]);

  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Status | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);

  if (!w) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  const job = w;
  const moves = nextStatuses(job.status as Status, user?.role ?? "");
  const p = priorityBadge(job.priority);
  const map = mapsLink(job.address);

  async function move(to: Status, why?: string) {
    setBusy(true);
    try {
      await workOrdersApi.changeStatus(job.id, to, why);
      toast.success(`Work order is now ${STATUS_TEXT[to]}.`);
      setPending(null);
      setReason("");
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function press(to: Status) {
    if (REASON_REQUIRED(job.status as Status, to)) {
      setReasonError("");
      setPending(to);
    } else void move(to);
  }

  const shots = (label: string, files: typeof job.evidence.before) =>
    files.length > 0 && (
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{label}</p>
        <div className="grid grid-cols-3 gap-2">
          {files.map((f) => (
            <div key={f.id} className="space-y-1">
              {f.kind === "VIDEO" ? (
                <p className="bg-muted text-muted-foreground flex aspect-square items-center justify-center rounded-md text-xs">Video</p>
              ) : (
                <AuthImage id={f.id} className="aspect-square w-full rounded-md object-cover" />
              )}
              <p className="text-muted-foreground truncate text-[11px]">{f.slot ? (SLOT_LABEL[f.slot] ?? f.slot) : "Other"}</p>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PageHeader title={job.title} back={{ to: "/work-orders", label: "Work orders" }} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{job.number}</span>
          <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
          {p && <Badge tone={p.tone}>{p.label}</Badge>}
          {job.overdue && <Badge tone="red">Overdue</Badge>}
        </div>
      </div>

      {moves.length > 0 && (
        <div className="grid gap-2">
          {moves.map((to, n) => (
            <Button key={to} variant={n === 0 ? "primary" : "outline"} busy={busy} onClick={() => press(to)}>
              {transitionLabel(job.status as Status, to)}
            </Button>
          ))}
        </div>
      )}

      <Section>
        <KV
          rows={[
            ["Customer", job.customerName],
            ["Site", job.address?.fullAddress ?? job.siteLabel],
            ["Asset", job.assetName],
            ["Due", job.dueDate ? formatDateTime(job.dueDate) : null],
            ["Purchase order", job.purchaseOrder],
            ["Request", job.request?.number],
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {job.customerPhone && (
            <a href={`tel:${job.customerPhone}`} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
              <Phone className="size-4" /> Call
            </a>
          )}
          {map && (
            <a href={map} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
              <MapPin className="size-4" /> Open in maps
            </a>
          )}
        </div>
        {job.description && <p className="text-sm whitespace-pre-wrap">{job.description}</p>}
      </Section>

      {job.checklist.length > 0 && (
        <Section title={`Checklist (${job.checklist.filter((c) => c.isDone).length}/${job.checklist.length})`}>
          <ul className="space-y-1.5 text-sm">
            {job.checklist.map((c) => (
              <li key={c.id} className={c.isDone ? "text-muted-foreground line-through" : ""}>
                {c.isDone ? "✓ " : "○ "}
                {c.text}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {job.lines.length > 0 && (
        <Section title="Parts and services">
          <ul className="space-y-2 text-sm">
            {job.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span>
                  {l.description} <span className="text-muted-foreground">× {l.qty}</span>
                </span>
                <span className="shrink-0 tabular-nums">{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t pt-2 text-sm">
            <div className="text-muted-foreground flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{money(job.totals.subTotal)}</span>
            </div>
            <div className="text-muted-foreground flex justify-between">
              <span>Tax</span>
              <span className="tabular-nums">{money(job.totals.tax)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(job.totals.total)}</span>
            </div>
          </div>
        </Section>
      )}

      {(job.evidence.before.length > 0 || job.evidence.after.length > 0) && (
        <Section title="Photos">
          {shots("Before", job.evidence.before)}
          {shots("After", job.evidence.after)}
        </Section>
      )}

      <Section title="Notes">
        {job.notes.length === 0 && <p className="text-muted-foreground text-sm">No notes yet.</p>}
        {job.notes.map((n) => (
          <div key={n.id} className="border-b pb-2 text-sm last:border-0 last:pb-0">
            <p className="whitespace-pre-wrap">{n.text}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {n.author ?? "—"} · {formatDateTime(n.createdAt)}
              {n.isInternal && " · internal"}
            </p>
          </div>
        ))}
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim() || noteBusy) return;
            setNoteBusy(true);
            try {
              await workOrdersApi.addNote(job.id, note.trim(), internal);
              setNote("");
              await reload();
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not save the note.");
            } finally {
              setNoteBusy(false);
            }
          }}
        >
          <div className="flex gap-2">
            <textarea aria-label="Write a note" rows={2} maxLength={4000} placeholder="Write a note…" value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} flex-1`} />
            <Button type="submit" busy={noteBusy} disabled={!note.trim()} aria-label="Add note" className="self-end px-3">
              <Send className="size-4" />
            </Button>
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4" /> Internal (the technician does not see it)
          </label>
        </form>
      </Section>

      {job.timeline.length > 0 && (
        <Section title="History">
          <ul className="space-y-2 text-sm">
            {job.timeline.map((t) => (
              <li key={t.id}>
                <p>
                  {t.fromStatus ? `${STATUS_LABEL[t.fromStatus] ?? t.fromStatus} → ` : ""}
                  <span className="font-medium">{STATUS_LABEL[t.toStatus] ?? t.toStatus}</span>
                </p>
                <p className="text-muted-foreground text-xs">
                  {t.by ?? "System"} · {formatDateTime(t.at)}
                  {t.reason ? ` · ${t.reason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* A reason is required for some changes (hold, cancel, rework, reopen) */}
      <Modal
        open={pending !== null}
        title={pending ? transitionLabel(job.status as Status, pending) : ""}
        description="Tell us why. The reason is shown in the work order history."
        onClose={() => !busy && setPending(null)}
        footer={
          <>
            <Button
              busy={busy}
              onClick={() => {
                if (!reason.trim()) return setReasonError("Please give a reason for this change.");
                if (pending) void move(pending, reason.trim());
              }}
            >
              Confirm
            </Button>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="wo-reason" error={reasonError}>
          <textarea id="wo-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </Field>
      </Modal>
    </div>
  );
}
