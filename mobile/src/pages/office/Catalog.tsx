import { catalogApi, type ServiceItemDto } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { Badge } from "../../ui/kit";
import { useMoney } from "../../ui/parts";

/** The price list of services and parts (read only here; Admin edits it on the web). */
export function Catalog() {
  const money = useMoney();
  return (
    <ListScreen<ServiceItemDto>
      title="Catalog"
      subtitle={(n) => `${n} items`}
      searchPlaceholder="Search name or SKU"
      filters={[
        {
          key: "type",
          label: "Type",
          options: [
            { value: "", label: "All" },
            { value: "SERVICE", label: "Services" },
            { value: "PART", label: "Parts" },
          ],
        },
        {
          key: "status",
          label: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "all", label: "Both" },
          ],
          initial: "active",
        },
      ]}
      fetchPage={(q) => catalogApi.list(q)}
      itemKey={(c) => c.id}
      empty="No items match."
      renderItem={(c) => (
        <div className="bg-card space-y-1 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{c.name}</p>
            <Badge>{c.type === "PART" ? "Part" : "Service"}</Badge>
            {!c.isActive && <Badge tone="amber">Inactive</Badge>}
            {c.lowStock && <Badge tone="red">Low stock</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {money(c.unitPrice)}
            {c.taxPercent > 0 ? ` + ${c.taxPercent}% tax` : ""}
            {c.sku ? ` · ${c.sku}` : ""}
            {c.stockQty != null ? ` · ${c.stockQty} in stock` : ""}
          </p>
        </div>
      )}
    />
  );
}
