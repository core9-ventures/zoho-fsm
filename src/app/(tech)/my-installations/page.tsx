import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { InstallationCard } from "../installation-card";
import { Pagination } from "@/components/data-table/pagination";
import { SearchInput } from "@/components/data-table/search-input";
import { Button } from "@/components/ui/button";
import { dbFor, requirePermission, requireRole, requireUser } from "@/lib/auth";
import { installationListQuerySchema, installationsService } from "@/modules/installations";

export const metadata: Metadata = { title: "My installations" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The installations the signed-in technician has recorded, newest first. */
export default async function MyInstallationsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireRole(user, ["TECHNICIAN"]);
  requirePermission(user, "field:view");
  const q = installationListQuerySchema.parse({ pageSize: 15, ...sp });
  const result = await installationsService.list(dbFor(user), user, q);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My installations</h1>
          <p className="text-muted-foreground text-sm">{result.totalCount} recorded by you.</p>
        </div>
        <Button asChild size="sm">
          <Link href="/new-installation">
            <Plus /> New
          </Link>
        </Button>
      </div>

      <SearchInput placeholder="Search vehicle, device ID, company" />

      {result.items.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          {q.search ? "No installation matches your search." : "You have not recorded any installation yet."}
        </p>
      )}

      <ul className="space-y-2">
        {result.items.map((i) => (
          <li key={i.id}>
            <InstallationCard i={i} />
          </li>
        ))}
      </ul>

      <Pagination
        page={q.page}
        pageSize={q.pageSize}
        totalCount={result.totalCount}
        basePath="/my-installations"
        searchParams={sp}
      />
    </div>
  );
}
