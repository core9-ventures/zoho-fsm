import { useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, estimatesApi, type EstimateListItem } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { useAsync } from "../../data/useAsync";
import { formatDay } from "../../lib/format";
import { Badge, Button, LoadError, Spinner } from "../../ui/kit";
import { KV, PageHeader, Row, Section, useMoney } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { ESTIMATE_STATUS_LABEL, ESTIMATE_STATUSES, ESTIMATE_TRANSITIONS } from "@/modules/estimates/estimates.schema";

const tone = (s: string) => (s === "APPROVED" ? "green" : s === "REJECTED" ? "red" : s === "SENT" ? "blue" : "muted") as "green" | "red" | "blue" | "muted";

export function Estimates() {
  const money = useMoney();
  return (
    <ListScreen<EstimateListItem>
      title="Estimates"
      subtitle={(n) => `${n} found`}
      searchPlaceholder="Search number or customer"
      filters={[
        {
          key: "status",
          label: "Status",
          options: [{ value: "all", label: "All" }, ...ESTIMATE_STATUSES.map((s) => ({ value: s, label: ESTIMATE_STATUS_LABEL[s] }))],
          initial: "all",
        },
      ]}
      fetchPage={(q) => estimatesApi.list(q)}
      itemKey={(e) => e.id}
      empty="No estimates match."
      renderItem={(e) => (
        <Row to={`/estimates/${e.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">{e.number}</span>
            <Badge tone={tone(e.status)}>{ESTIMATE_STATUS_LABEL[e.status]}</Badge>
            {e.expired && <Badge tone="red">Expired</Badge>}
          </div>
          <p className="font-medium">{e.customerName}</p>
          <p className="text-muted-foreground text-sm">
            {money(e.total)}
            {e.validUntil ? ` · valid until ${formatDay(e.validUntil)}` : ""}
          </p>
        </Row>
      )}
    />
  );
}

/** One estimate: lines and totals, and the status buttons (send, approve, reject). */
export function EstimateDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const money = useMoney();
  const { data: e, error, loading, reload } = useAsync(() => estimatesApi.get(id), [id]);
  const [busy, setBusy] = useState(false);
  if (!e) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  const est = e;

  // The same transitions the server enforces (shared with it).
  const LABEL: Record<string, string> = { SENT: "Mark as sent", APPROVED: "Mark approved", REJECTED: "Mark rejected", DRAFT: "Back to draft" };
  const next = ESTIMATE_TRANSITIONS[est.status].map((status, n) => ({ status, label: LABEL[status] ?? status, primary: n === 0 }));

  async function change(status: string) {
    setBusy(true);
    try {
      await estimatesApi.changeStatus(est.id, status);
      toast.success("Estimate updated.");
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={est.number} subtitle={est.customerName} back={{ to: "/estimates", label: "Estimates" }} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={tone(est.status)}>{ESTIMATE_STATUS_LABEL[est.status]}</Badge>
        {est.expired && <Badge tone="red">Expired</Badge>}
      </div>

      {next.length > 0 && (
        <div className="grid gap-2">
          {next.map((n) => (
            <Button key={n.status} variant={n.primary ? "primary" : "outline"} busy={busy} onClick={() => void change(n.status)}>
              {n.label}
            </Button>
          ))}
        </div>
      )}

      <Section>
        <KV
          rows={[
            ["Site", est.siteLabel],
            ["Valid until", est.validUntil ? formatDay(est.validUntil) : null],
            ["Request", est.requestNumber],
            ["Work order", est.workOrder?.number],
            ["Notes", est.notes],
          ]}
        />
      </Section>

      <Section title="Lines">
        {est.lines.length === 0 && <p className="text-muted-foreground text-sm">No lines.</p>}
        <ul className="space-y-2 text-sm">
          {est.lines.map((l) => (
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
            <span className="tabular-nums">{money(est.subTotal)}</span>
          </div>
          <div className="text-muted-foreground flex justify-between">
            <span>Tax</span>
            <span className="tabular-nums">{money(est.tax)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(est.total)}</span>
          </div>
        </div>
      </Section>
    </div>
  );
}
