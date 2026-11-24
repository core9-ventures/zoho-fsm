import { useParams } from "react-router-dom";
import { assetsApi, type AssetDto } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { useAsync } from "../../data/useAsync";
import { formatDay } from "../../lib/format";
import { Badge, LoadError, Spinner } from "../../ui/kit";
import { KV, PageHeader, Row, Section } from "../../ui/parts";
import { ASSET_STATUS_LABEL, ASSET_STATUSES, WARRANTY_LABEL } from "@/modules/assets/assets.schema";

const warrantyTone = (w: string) => (w === "active" ? "green" : w === "expiring" ? "amber" : w === "expired" ? "red" : "muted") as "green" | "amber" | "red" | "muted";

export function Assets() {
  return (
    <ListScreen<AssetDto>
      title="Assets"
      subtitle={(n) => `${n} found`}
      searchPlaceholder="Search name, serial, customer"
      filters={[
        {
          key: "status",
          label: "Status",
          options: [{ value: "", label: "All" }, ...ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABEL[s] }))],
        },
        {
          key: "warranty",
          label: "Warranty",
          options: [
            { value: "", label: "Any warranty" },
            { value: "active", label: "Active" },
            { value: "expiring", label: "Expiring" },
            { value: "expired", label: "Expired" },
          ],
        },
      ]}
      fetchPage={(q) => assetsApi.list(q)}
      itemKey={(a) => a.id}
      empty="No assets match."
      renderItem={(a) => (
        <Row to={`/assets/${a.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{a.name}</p>
            <Badge tone={a.status === "ACTIVE" ? "green" : a.status === "IN_REPAIR" ? "amber" : "muted"}>{ASSET_STATUS_LABEL[a.status]}</Badge>
            {a.warranty !== "none" && <Badge tone={warrantyTone(a.warranty)}>{WARRANTY_LABEL[a.warranty]}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">{[a.customerName, a.siteLabel].filter(Boolean).join(" · ")}</p>
          <p className="text-muted-foreground text-xs">{[a.brand, a.model, a.serialNo].filter(Boolean).join(" · ")}</p>
        </Row>
      )}
    />
  );
}

export function AssetDetail() {
  const { id = "" } = useParams();
  const { data: a, error, loading, reload } = useAsync(() => assetsApi.get(id), [id]);
  if (!a) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  return (
    <div className="space-y-4">
      <PageHeader title={a.name} subtitle={a.customerName} back={{ to: "/assets", label: "Assets" }} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={a.status === "ACTIVE" ? "green" : a.status === "IN_REPAIR" ? "amber" : "muted"}>{ASSET_STATUS_LABEL[a.status]}</Badge>
        {a.warranty !== "none" && <Badge tone={warrantyTone(a.warranty)}>Warranty: {WARRANTY_LABEL[a.warranty].toLowerCase()}</Badge>}
      </div>
      <Section>
        <KV
          rows={[
            ["Site", a.siteLabel],
            ["Category", a.category],
            ["Brand", a.brand],
            ["Model", a.model],
            ["Serial no.", a.serialNo],
            ["Installed", a.installDate ? formatDay(a.installDate) : null],
            ["Warranty ends", a.warrantyEndDate ? formatDay(a.warrantyEndDate) : null],
            ["Last service", a.lastServiceAt ? formatDay(a.lastServiceAt.slice(0, 10)) : null],
            ["Work orders", String(a.workOrderCount)],
          ]}
        />
      </Section>
    </div>
  );
}
