import { Navigate, useParams } from "react-router-dom";
import { fieldInstallations } from "../api";
import { useAsync } from "../data/useAsync";
import { LoadError, Spinner } from "../ui/kit";
import { InstallationForm } from "./InstallationForm";

/** /new-installation (a new record) and /new-installation/:id (carry on with one that is on hold). */
export function NewInstallation() {
  const { id } = useParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const [customers, held] = await Promise.all([
      fieldInstallations.options(),
      id ? fieldInstallations.get(id) : Promise.resolve(undefined),
    ]);
    return { customers, held };
  }, [id]);

  if (!data) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  // A finished record is only read, never edited by the technician.
  if (data.held && data.held.status !== "ON_HOLD") return <Navigate to={`/my-installations/${data.held.id}`} replace />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{data.held ? "Continue installation" : "New installation"}</h1>
        <p className="text-muted-foreground text-sm">
          {data.held
            ? "This record is on hold. Finish it and tap Add Record, or put it on hold again."
            : "Record a device installed on a new vehicle."}
        </p>
        {data.held?.holdBy && data.held.holdReason && (
          <p className="mt-2 rounded-md border border-amber-500/60 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            Put on hold by {data.held.holdBy}: {data.held.holdReason}
          </p>
        )}
      </div>
      {/* key: a different record starts a fresh form */}
      <InstallationForm key={data.held?.id ?? "new"} customers={data.customers} held={data.held} />
    </div>
  );
}
