import type { Metadata } from "next";
import Link from "next/link";
import { ClickableRow } from "./clickable-row";
import { PutOnHoldButton } from "./put-on-hold-button";
import { Pagination } from "@/components/data-table/pagination";
import { SearchInput } from "@/components/data-table/search-input";
import { UrlSelect } from "@/components/data-table/url-select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dbFor, requirePagePermission, requireRole, requireUser } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { installationListQuerySchema, installationsService } from "@/modules/installations";

export const metadata: Metadata = { title: "Installations" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function InstallationsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireUser();
  requireRole(user, ["ADMIN", "DISPATCHER"]);
  requirePagePermission(user, "/installations");
  const db = dbFor(user);
  const q = installationListQuerySchema.parse(sp);
  const [result, customers] = await Promise.all([
    installationsService.list(db, user, q),
    installationsService.customerOptions(db),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Installations</h1>
        <p className="text-muted-foreground text-sm">Devices technicians installed on new vehicles.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput placeholder="Search vehicle, device ID, location, company" />
        <UrlSelect
          param="customerId"
          label="Company"
          allLabel="Any company"
          options={customers.map((c) => ({ value: c.id, label: c.name }))}
        />
        <UrlSelect
          param="status"
          label="Status"
          allLabel="Any status"
          options={[
            { value: "COMPLETED", label: "Completed" },
            { value: "ON_HOLD", label: "On hold" },
          ]}
        />
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead>Company</TableHead>
              <TableHead className="hidden md:table-cell">Device</TableHead>
              <TableHead className="hidden lg:table-cell">Location</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="hidden md:table-cell">Technician</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Photos</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground py-10 text-center">
                  No installations yet.
                </TableCell>
              </TableRow>
            )}
            {result.items.map((i) => (
              <ClickableRow key={i.id} href={`/installations/${i.id}`}>
                <TableCell>
                  <Link href={`/installations/${i.id}`} className="font-medium hover:underline">
                    {i.vehicleNo || "(no vehicle no.)"}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">{i.customerName}</TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {i.deviceType}
                  <p className="text-muted-foreground font-mono text-xs">{i.deviceId}</p>
                </TableCell>
                <TableCell className="text-muted-foreground hidden max-w-56 truncate text-sm lg:table-cell">
                  {i.location}
                </TableCell>
                <TableCell className="text-sm">{formatDay(i.installDate)}</TableCell>
                <TableCell className="text-muted-foreground hidden text-sm md:table-cell">
                  {i.createdBy ?? "—"}
                </TableCell>
                <TableCell>
                  {i.status === "ON_HOLD" ? (
                    <div>
                      <Badge variant="outline" className="border-amber-500/60 text-amber-600">
                        On hold
                      </Badge>
                      {i.holdBy && <p className="text-muted-foreground mt-1 text-xs">by {i.holdBy}</p>}
                    </div>
                  ) : (
                    <Badge variant="secondary">Completed</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {i.fileCount === 0 ? (
                    <span className="text-muted-foreground text-xs">None</span>
                  ) : (
                    <Link href={`/installations/${i.id}`} className="flex items-center gap-1">
                      {i.thumbs.map((t) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={t}
                          src={`/api/v1/attachments/${t}?inline=1&thumb=1`}
                          alt=""
                          className="size-10 rounded border object-cover"
                        />
                      ))}
                      {i.fileCount > i.thumbs.length && (
                        <span className="text-muted-foreground text-xs">+{i.fileCount - i.thumbs.length}</span>
                      )}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  {i.status === "COMPLETED" && <PutOnHoldButton id={i.id} vehicleNo={i.vehicleNo} />}
                </TableCell>
              </ClickableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Pagination
        page={q.page}
        pageSize={q.pageSize}
        totalCount={result.totalCount}
        basePath="/installations"
        searchParams={sp}
      />
    </div>
  );
}
