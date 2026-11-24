import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { fieldInstallations, type InstallationListItem } from "../api";
import { InstallationCard } from "../components/InstallationCard";
import { useAsync } from "../data/useAsync";
import { Button, LoadError, Spinner } from "../ui/kit";

const PAGE = 20;

/** Every installation the technician has completed, newest first. */
export function MyInstallations() {
  const [extra, setExtra] = useState<InstallationListItem[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const first = useAsync(() => fieldInstallations.list({ page: 1, pageSize: PAGE, status: "COMPLETED" }));

  if (!first.data) return first.loading ? <Spinner /> : first.error ? <LoadError error={first.error} onRetry={() => void first.reload()} /> : null;

  const items = [...first.data.items, ...extra];
  const total = first.data.totalCount;

  async function loadMore() {
    setMore(true);
    try {
      const next = await fieldInstallations.list({ page: page + 1, pageSize: PAGE, status: "COMPLETED" });
      setExtra((e) => [...e, ...next.items]);
      setPage((p) => p + 1);
    } finally {
      setMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/my-jobs" className="text-muted-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> My jobs
        </Link>
        <h1 className="text-xl font-semibold">Completed installations</h1>
        <p className="text-muted-foreground text-sm">{total} in total</p>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          You have not recorded any installation yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <InstallationCard i={i} />
            </li>
          ))}
        </ul>
      )}
      {items.length < total && (
        <Button variant="outline" onClick={() => void loadMore()} disabled={more} className="w-full">
          {more && <Loader2 className="size-4 animate-spin" />} Show more
        </Button>
      )}
    </div>
  );
}
