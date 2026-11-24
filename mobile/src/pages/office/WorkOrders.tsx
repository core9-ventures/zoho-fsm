import { workOrdersApi, type WorkOrderListItem } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { formatDay } from "../../lib/format";
import { priorityBadge, STATUS_LABEL, statusTone } from "../../lib/status";
import { Badge } from "../../ui/kit";
import { Row } from "../../ui/parts";

const FILTER = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "NEW", label: "New" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "ON_HOLD", label: "On hold" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CLOSED", label: "Closed" },
  { value: "", label: "All" },
];

export function WorkOrderRow({ w }: { w: WorkOrderListItem }) {
  const p = priorityBadge(w.priority);
  return (
    <Row to={`/work-orders/${w.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground font-mono text-xs">{w.number}</span>
        <Badge tone={statusTone(w.status)}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
        {p && <Badge tone={p.tone}>{p.label}</Badge>}
        {w.overdue && <Badge tone="red">Overdue</Badge>}
      </div>
      <p className="leading-snug font-medium">{w.title}</p>
      <p className="text-muted-foreground text-sm">{[w.customerName, w.siteLabel].filter(Boolean).join(" · ")}</p>
      {w.dueDate && <p className="text-muted-foreground text-xs">Due {formatDay(w.dueDate.slice(0, 10))}</p>}
    </Row>
  );
}

export function WorkOrders() {
  return (
    <ListScreen<WorkOrderListItem>
      title="Work orders"
      subtitle={(n) => `${n} found`}
      searchPlaceholder="Search number, title, customer"
      filters={[{ key: "status", label: "Status", options: FILTER, initial: "open" }]}
      fetchPage={(q) => workOrdersApi.list(q)}
      itemKey={(w) => w.id}
      renderItem={(w) => <WorkOrderRow w={w} />}
      empty="No work orders match."
    />
  );
}
