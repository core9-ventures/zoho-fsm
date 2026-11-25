import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { rolesApi } from "../../api";
import { useAsync } from "../../data/useAsync";
import { Badge, LoadError, Spinner } from "../../ui/kit";
import { PageHeader, Section } from "../../ui/parts";

/** The company's custom roles and what each may do (read only; roles are edited on the web). */
export function Roles() {
  const { data: roles, error, loading, reload } = useAsync(() => rolesApi.list());
  const [open, setOpen] = useState<string | null>(null);

  if (!roles) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  return (
    <div className="space-y-4">
      <PageHeader title="Roles" subtitle="Custom roles. Edit them on the web portal." />
      {roles.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          No custom roles yet. Admin, Dispatcher and Technician are built in.
        </p>
      )}
      {roles.map((r) => (
        <Section key={r.id}>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{r.name}</p>
              <Badge>{r.baseRole.charAt(0) + r.baseRole.slice(1).toLowerCase()}</Badge>
            </div>
            {r.description && <p className="text-muted-foreground text-sm">{r.description}</p>}
            <p className="text-muted-foreground text-xs">
              {r.memberCount} member{r.memberCount === 1 ? "" : "s"} · {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(open === r.id ? null : r.id)}
            aria-expanded={open === r.id}
            className="flex items-center gap-1.5 text-sm font-medium"
          >
            <ChevronDown className={`size-4 transition-transform ${open === r.id ? "" : "-rotate-90"}`} /> Permissions
          </button>
          {open === r.id && (
            <ul className="grid grid-cols-1 gap-1 text-sm">
              {r.permissions.map((p) => (
                <li key={p} className="text-muted-foreground font-mono text-xs">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}
    </div>
  );
}
