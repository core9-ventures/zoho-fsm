import { CalendarCheck, ChevronRight, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { fieldInstallations, fieldJobs, type FieldJob } from "../api";
import { InstallationCard } from "../components/InstallationCard";
import { useAsync } from "../data/useAsync";
import { dayLabel } from "../lib/format";
import { STATUS_LABEL, statusTone } from "../lib/status";
import { Badge, LoadError, Spinner } from "../ui/kit";

export function JobCard({ job }: { job: FieldJob }) {
  return (
    <Link to={`/my-jobs/${job.workOrderId}`} className="bg-card active:bg-muted/50 flex items-start gap-3 rounded-xl border p-3">
      <div className="w-14 shrink-0 text-center">
        <p className="text-base leading-tight font-semibold">{job.startTime}</p>
        <p className="text-muted-foreground text-xs">{job.endTime}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{job.number}</span>
          <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
          {(job.priority === "HIGH" || job.priority === "URGENT") && <Badge tone="red">{job.priority === "URGENT" ? "Urgent" : "High"}</Badge>}
        </div>
        <p className="leading-snug font-medium">{job.title}</p>
        <p className="text-muted-foreground text-sm">{job.customerName}</p>
        {job.siteLabel && (
          <p className="text-muted-foreground flex items-start gap-1 text-xs">
            <MapPin className="mt-0.5 size-3 shrink-0" />
            <span className="line-clamp-2">{job.siteLabel}</span>
          </p>
        )}
      </div>
      <ChevronRight className="text-muted-foreground mt-1 size-5 shrink-0" />
    </Link>
  );
}

/** The technician's home: today's jobs, then unfinished (held) installations, then the latest completed ones. */
export function MyJobs() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [jobs, completed, held] = await Promise.all([
      fieldJobs.list(),
      fieldInstallations.list({ pageSize: 5, status: "COMPLETED" }),
      fieldInstallations.list({ pageSize: 50, status: "ON_HOLD" }),
    ]);
    return { jobs, completed, held };
  });

  if (!data) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  const { today, jobs } = data.jobs;
  const finished = (j: FieldJob) => j.status === "COMPLETED" || j.status === "CLOSED" || j.status === "CANCELLED";
  const open = jobs.filter((j) => !finished(j));
  const carried = open.filter((j) => j.day < today);
  const upcoming = open.filter((j) => j.day >= today);
  const done = jobs.filter(finished).reverse();
  const days = [...new Set(upcoming.map((j) => j.day))];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">My jobs</h1>
        <p className="text-muted-foreground text-sm">
          {open.length === 0
            ? "Nothing assigned right now."
            : `${upcoming.filter((j) => j.day === today).length} today · ${open.length} open in total`}
        </p>
      </div>
      {error && <LoadError error={error} onRetry={() => void reload()} />}

      {jobs.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border py-10 text-center text-sm">
          <CalendarCheck className="size-8" />
          Your dispatcher has not assigned you any jobs yet.
        </div>
      )}

      {carried.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-destructive text-sm font-semibold">Carried over</h2>
          {carried.map((j) => (
            <JobCard key={j.workOrderId} job={j} />
          ))}
        </section>
      )}

      {days.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-semibold">{dayLabel(day, today)}</h2>
          {upcoming
            .filter((j) => j.day === day)
            .map((j) => (
              <JobCard key={j.workOrderId} job={j} />
            ))}
        </section>
      ))}

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-semibold">History</h2>
          {done.map((j) => (
            <JobCard key={j.workOrderId} job={j} />
          ))}
        </section>
      )}

      {data.held.items.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400">On hold ({data.held.totalCount})</h2>
          <p className="text-muted-foreground text-xs">Unfinished installations. Tap one to carry on.</p>
          <ul className="space-y-2">
            {data.held.items.map((i) => (
              <li key={i.id}>
                <InstallationCard i={i} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold">
            Completed installations{data.completed.totalCount > 0 ? ` (${data.completed.totalCount})` : ""}
          </h2>
          {data.completed.totalCount > data.completed.items.length && (
            <Link to="/my-installations" className="text-sm font-medium underline">
              See all
            </Link>
          )}
        </div>
        {data.completed.items.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            You have not recorded any installation yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.completed.items.map((i) => (
              <li key={i.id}>
                <InstallationCard i={i} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
