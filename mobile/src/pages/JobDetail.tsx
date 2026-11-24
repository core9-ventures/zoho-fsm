import { useState } from "react";
import { ArrowLeft, MapPin, Phone, Send } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ApiError, FIELD_ACTION_LABEL, fieldJobs, type FieldJobDetail } from "../api";
import { PhotoGrid, type PhotoItem } from "../components/PhotoGrid";
import { useAsync } from "../data/useAsync";
import { GEO_MESSAGE, readPosition } from "../lib/geo";
import { formatDateTime, formatDay } from "../lib/format";
import { STATUS_LABEL, statusTone } from "../lib/status";
import { missingSlotPhotos, slotsFor } from "@/modules/work-orders/evidence";
import { Badge, Button, Field, LoadError, Modal, Spinner, inputClass } from "../ui/kit";
import { useToast } from "../ui/toast";

type Phase = "BEFORE" | "AFTER";

const itemsOf = (files: FieldJobDetail["evidence"]["before"]): PhotoItem[] =>
  files.map((f) => ({
    key: f.id,
    remoteId: f.id,
    slot: f.slot,
    kind: f.kind === "VIDEO" ? "VIDEO" : "PHOTO",
    name: f.fileName,
  }));

/** One job: where, what, the status buttons, checklist, before and after photos, and notes. */
export function JobDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data: job, error, loading, reload } = useAsync(() => fieldJobs.get(id), [id]);

  const [busy, setBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  if (!job) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  const j = job;
  const missing = missingSlotPhotos(j.evidence, j.hasTempSensor);

  /** Runs one change on the server and shows what happened. */
  async function change(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await work();
      if (success) toast.success(success);
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: FieldJobDetail["actions"][number], why?: string) {
    // Where the technician is when the status changes (the dispatcher sees it); skipped when location is off.
    const pos = await readPosition(8_000);
    const location = "fix" in pos ? { latitude: pos.fix.lat, longitude: pos.fix.lng, accuracy: pos.fix.accuracy } : null;
    await change(() => fieldJobs.transition(j.id, { action, reason: why, location }), `${FIELD_ACTION_LABEL[action]}: done.`);
    if ("error" in pos && action === "on-my-way") toast.error(GEO_MESSAGE[pos.error]);
  }

  function pressAction(action: FieldJobDetail["actions"][number]) {
    if (action === "hold") return setHoldOpen(true);
    if (action === "complete") return setCompleteOpen(true);
    void transition(action);
  }

  const photoApi = (phase: Phase) => ({
    onPhoto: async (slot: string | null, file: File) => {
      await fieldJobs.uploadFile(j.id, file, file.name, { phase, slot: slot ?? undefined });
      await reload();
    },
    onRemove: async (item: PhotoItem) => {
      if (!item.remoteId) return;
      await fieldJobs.deleteFile(j.id, item.remoteId);
      await reload();
    },
  });

  const mapHref = j.address
    ? j.address.latitude != null && j.address.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${j.address.latitude},${j.address.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.address.fullAddress)}`
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link to="/my-jobs" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> My jobs
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{j.number}</span>
          <Badge tone={statusTone(j.status)}>{STATUS_LABEL[j.status] ?? j.status}</Badge>
          {(j.priority === "HIGH" || j.priority === "URGENT") && <Badge tone="red">{j.priority === "URGENT" ? "Urgent" : "High"}</Badge>}
        </div>
        <h1 className="text-xl leading-snug font-semibold">{j.title}</h1>
        <p className="text-muted-foreground text-sm">
          {formatDay(j.visit.day)} · {j.visit.startTime}–{j.visit.endTime}
        </p>
      </div>

      {error && <LoadError error={error} onRetry={() => void reload()} />}

      {/* Where and who */}
      <section className="bg-card space-y-3 rounded-xl border p-4 text-sm">
        <div>
          <p className="font-medium">{j.customer.name}</p>
          {j.assetName && <p className="text-muted-foreground">{j.assetName}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {j.customer.phone && (
            <a href={`tel:${j.customer.phone}`} className="flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium">
              <Phone className="size-4" /> Call
            </a>
          )}
          {mapHref && (
            <a href={mapHref} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md border px-3 py-2 font-medium">
              <MapPin className="size-4" /> Open in maps
            </a>
          )}
        </div>
        {j.address && <p className="text-muted-foreground">{j.address.fullAddress}</p>}
        {j.description && <p className="whitespace-pre-wrap">{j.description}</p>}
      </section>

      {/* What the technician can do next */}
      {!j.closed && j.actions.length > 0 && (
        <div className="grid gap-2">
          {j.actions.map((a, n) => (
            <Button key={a} variant={n === 0 ? "primary" : "outline"} busy={busy} onClick={() => pressAction(a)}>
              {FIELD_ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      )}

      {/* Checklist */}
      {j.checklist.length > 0 && (
        <section className="bg-card space-y-2 rounded-xl border p-4">
          <h2 className="font-semibold">
            Checklist{" "}
            <span className="text-muted-foreground text-sm font-normal">
              ({j.checklist.filter((c) => c.isDone).length}/{j.checklist.length})
            </span>
          </h2>
          {j.checklist.map((c) => (
            <label key={c.id} className="flex items-start gap-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={c.isDone}
                disabled={busy || j.closed}
                onChange={(e) => void change(() => fieldJobs.setChecklist(j.id, c.id, e.target.checked))}
                className="mt-0.5 size-5"
              />
              <span className={c.isDone ? "text-muted-foreground line-through" : ""}>{c.text}</span>
            </label>
          ))}
        </section>
      )}

      {/* Before and after proof */}
      <PhotoGrid
        title="Before photos"
        slots={slotsFor(j.hasTempSensor)}
        items={itemsOf(j.evidence.before)}
        other={{ max: 15 }}
        disabled={j.closed}
        hint={missing.before > 0 ? `${missing.before} labeled photo${missing.before === 1 ? "" : "s"} still missing.` : undefined}
        {...photoApi("BEFORE")}
      />
      <PhotoGrid
        title="After photos"
        slots={slotsFor(j.hasTempSensor)}
        items={itemsOf(j.evidence.after)}
        other={{ max: 15 }}
        disabled={j.closed}
        hint={missing.after > 0 ? `${missing.after} labeled photo${missing.after === 1 ? "" : "s"} still missing.` : undefined}
        {...photoApi("AFTER")}
      />

      {/* Notes */}
      <section className="bg-card space-y-3 rounded-xl border p-4">
        <h2 className="font-semibold">Notes</h2>
        {j.notes.length === 0 && <p className="text-muted-foreground text-sm">No notes yet.</p>}
        {j.notes.map((n) => (
          <div key={n.id} className="border-b pb-2 text-sm last:border-0 last:pb-0">
            <p className="whitespace-pre-wrap">{n.text}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {n.mine ? "You" : (n.author ?? "Office")} · {formatDateTime(n.createdAt)}
            </p>
          </div>
        ))}
        {!j.closed && (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!note.trim() || noteBusy) return;
              setNoteBusy(true);
              try {
                await fieldJobs.addNote(j.id, note.trim());
                setNote("");
                await reload();
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Could not save the note.");
              } finally {
                setNoteBusy(false);
              }
            }}
          >
            <textarea
              aria-label="Write a note"
              rows={2}
              maxLength={4000}
              placeholder="Write a note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${inputClass} flex-1`}
            />
            <Button type="submit" busy={noteBusy} disabled={!note.trim()} aria-label="Add note" className="self-end px-3">
              <Send className="size-4" />
            </Button>
          </form>
        )}
      </section>

      {/* Put the job on hold: a reason is required */}
      <Modal
        open={holdOpen}
        title="Put the job on hold"
        description="Tell the office why, for example waiting for a part or the customer is not there."
        onClose={() => !busy && setHoldOpen(false)}
        footer={
          <>
            <Button
              busy={busy}
              onClick={async () => {
                if (!reason.trim()) return setReasonError("Give a reason.");
                setReasonError("");
                await transition("hold", reason.trim());
                setHoldOpen(false);
                setReason("");
              }}
            >
              Put on hold
            </Button>
            <Button variant="outline" onClick={() => setHoldOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="job-hold-reason" error={reasonError}>
          <textarea id="job-hold-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
        </Field>
      </Modal>

      {/* Complete: warn about missing photos first */}
      <Modal
        open={completeOpen}
        title="Complete this job?"
        description={
          missing.before + missing.after > 0
            ? `Photos are still missing: ${missing.before} before and ${missing.after} after. You can complete anyway, or go back and add them.`
            : "The office will be told the job is done."
        }
        onClose={() => !busy && setCompleteOpen(false)}
        footer={
          <>
            <Button
              busy={busy}
              onClick={async () => {
                await transition("complete");
                setCompleteOpen(false);
              }}
            >
              Complete job
            </Button>
            <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={busy}>
              Go back
            </Button>
          </>
        }
      />
    </div>
  );
}
