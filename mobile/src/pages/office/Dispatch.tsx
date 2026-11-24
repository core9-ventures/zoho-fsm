import { useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, dispatchApi, type Board } from "../../api";
import { useAsync } from "../../data/useAsync";
import { formatDay } from "../../lib/format";
import { priorityBadge, STATUS_LABEL, statusTone } from "../../lib/status";
import { Badge, Button, Field, LoadError, Modal, Spinner, inputClass } from "../../ui/kit";
import { PageHeader, Section } from "../../ui/parts";
import { useToast } from "../../ui/toast";

type Unscheduled = Board["unscheduled"][number];

const shift = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
const minutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The day's schedule: each technician's visits, and the work orders that still need a technician. */
export function Dispatch() {
  const toast = useToast();
  const [date, setDate] = useState<string | undefined>(undefined);
  const { data: board, error, loading, reload } = useAsync(() => dispatchApi.board(date), [date]);

  const [target, setTarget] = useState<Unscheduled | null>(null);
  const [tech, setTech] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("60");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!board) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  const b = board;

  function openSchedule(j: Unscheduled) {
    setTarget(j);
    setTech(b.technicians.find((t) => t.working)?.id ?? b.technicians[0]?.id ?? "");
    setStart(`${b.date}T09:00`);
    setDuration("60");
    setFormError("");
  }

  async function schedule() {
    if (!target) return;
    if (!tech) return setFormError("Choose a technician.");
    if (!start) return setFormError("Choose the start date and time.");
    const mins = Number(duration);
    if (!Number.isInteger(mins)) return setFormError("Enter the duration in whole minutes.");
    setBusy(true);
    try {
      await dispatchApi.schedule(target.id, { technicianId: tech, start, durationMin: mins });
      toast.success(`${target.number} scheduled.`);
      setTarget(null);
      await reload();
    } catch (e) {
      setFormError(e instanceof ApiError ? (e.fieldErrors.start?.[0] ?? e.fieldErrors.durationMin?.[0] ?? e.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function unschedule(workOrderId: string, number: string) {
    setBusy(true);
    try {
      await dispatchApi.unschedule(workOrderId);
      toast.success(`${number} is unscheduled.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Dispatch" subtitle={b.date === b.today ? `Today · ${formatDay(b.date)}` : formatDay(b.date)} />

      <div className="flex items-center gap-2">
        <Button variant="outline" aria-label="Previous day" onClick={() => setDate(shift(b.date, -1))} className="px-3">
          <ChevronLeft className="size-4" />
        </Button>
        <input type="date" aria-label="Day" value={b.date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputClass} flex-1`} />
        <Button variant="outline" aria-label="Next day" onClick={() => setDate(shift(b.date, 1))} className="px-3">
          <ChevronRight className="size-4" />
        </Button>
        {b.date !== b.today && (
          <Button variant="outline" onClick={() => setDate(b.today)}>
            Today
          </Button>
        )}
      </div>
      {error && <LoadError error={error} onRetry={() => void reload()} />}

      {b.technicians.length === 0 && <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">No technicians yet.</p>}

      {b.technicians.map((t) => (
        <Section
          key={t.id}
          title={t.name}
          right={
            <span className="text-muted-foreground text-xs">
              {t.working ? `${t.workStart}–${t.workEnd}` : "Not working"} · {t.appointments.length} visit{t.appointments.length === 1 ? "" : "s"}
            </span>
          }
        >
          {t.appointments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {[...t.appointments]
                .sort((x, y) => x.startMin - y.startMin)
                .map((a) => {
                  const p = priorityBadge(a.priority);
                  return (
                    <li key={a.id} className="flex items-start gap-3 rounded-lg border p-2.5">
                      <div className="w-14 shrink-0 text-center">
                        <p className="font-semibold">{minutes(a.startMin)}</p>
                        <p className="text-muted-foreground text-xs">{minutes(a.endMin)}</p>
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link to={`/work-orders/${a.workOrderId}`} className="font-mono text-xs underline">
                            {a.number}
                          </Link>
                          <Badge tone={statusTone(a.workOrderStatus)}>{STATUS_LABEL[a.workOrderStatus] ?? a.workOrderStatus}</Badge>
                          {p && <Badge tone={p.tone}>{p.label}</Badge>}
                        </div>
                        <p className="text-sm leading-snug font-medium">{a.title}</p>
                        <p className="text-muted-foreground text-xs">{[a.customerName, a.siteLabel].filter(Boolean).join(" · ")}</p>
                        {(a.workOrderStatus === "SCHEDULED" || a.workOrderStatus === "DISPATCHED") && (
                          <button type="button" disabled={busy} onClick={() => void unschedule(a.workOrderId, a.number)} className="text-destructive pt-1 text-xs font-medium underline">
                            Unschedule
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </Section>
      ))}

      <Section title={`Unscheduled (${b.unscheduled.length})`}>
        {b.unscheduled.length === 0 ? (
          <p className="text-muted-foreground text-sm">Every open work order has a technician.</p>
        ) : (
          <ul className="space-y-2">
            {b.unscheduled.map((j) => {
              const p = priorityBadge(j.priority);
              return (
                <li key={j.id} className="space-y-1 rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link to={`/work-orders/${j.id}`} className="font-mono text-xs underline">
                      {j.number}
                    </Link>
                    {p && <Badge tone={p.tone}>{p.label}</Badge>}
                    {j.overdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  <p className="text-sm leading-snug font-medium">{j.title}</p>
                  <p className="text-muted-foreground text-xs">{[j.customerName, j.siteLabel].filter(Boolean).join(" · ")}</p>
                  <Button variant="outline" onClick={() => openSchedule(j)} className="mt-1 w-full py-2">
                    <CalendarClock className="size-4" /> Schedule
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Modal
        open={target !== null}
        title={target ? `Schedule ${target.number}` : ""}
        description={target?.title}
        onClose={() => !busy && setTarget(null)}
        footer={
          <>
            <Button busy={busy} onClick={() => void schedule()}>
              Schedule
            </Button>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && (
            <p role="alert" className="text-destructive text-sm">
              {formError}
            </p>
          )}
          <Field label="Technician" htmlFor="sch-tech">
            <select id="sch-tech" value={tech} onChange={(e) => setTech(e.target.value)} className={inputClass}>
              {b.technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.working ? "" : " (not working this day)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start" htmlFor="sch-start">
            <input id="sch-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Duration (minutes)" htmlFor="sch-dur">
            <input id="sch-dur" type="number" inputMode="numeric" min={15} max={720} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
