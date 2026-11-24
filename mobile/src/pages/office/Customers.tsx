import { Mail, MapPin, Phone } from "lucide-react";
import { useParams } from "react-router-dom";
import { customersApi, type CustomerListItem } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { useAsync } from "../../data/useAsync";
import { Badge, LoadError, Spinner } from "../../ui/kit";
import { KV, mapsLink, PageHeader, Row, Section } from "../../ui/parts";
import { CUSTOMER_TYPE_LABEL } from "@/modules/customers/customers.schema";

export function Customers() {
  return (
    <ListScreen<CustomerListItem>
      title="Customers"
      subtitle={(n) => `${n} found`}
      searchPlaceholder="Search name, phone, email"
      filters={[
        {
          key: "type",
          label: "Type",
          options: [
            { value: "", label: "All" },
            { value: "BUSINESS", label: "Business" },
            { value: "INDIVIDUAL", label: "Individual" },
          ],
        },
      ]}
      fetchPage={(q) => customersApi.list(q)}
      itemKey={(c) => c.id}
      empty="No customers match."
      renderItem={(c) => (
        <Row to={`/customers/${c.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{c.name}</p>
            <Badge>{CUSTOMER_TYPE_LABEL[c.type]}</Badge>
            {c.openWorkOrders > 0 && <Badge tone="blue">{c.openWorkOrders} open</Badge>}
          </div>
          {c.primaryAddress && <p className="text-muted-foreground truncate text-sm">{c.primaryAddress}</p>}
          <p className="text-muted-foreground text-xs">
            {c.addressCount} site{c.addressCount === 1 ? "" : "s"} · {c.assetCount} asset{c.assetCount === 1 ? "" : "s"}
          </p>
        </Row>
      )}
    />
  );
}

/** One customer: contact, projects and sites (with map links). */
export function CustomerDetail() {
  const { id = "" } = useParams();
  const { data: c, error, loading, reload } = useAsync(() => customersApi.get(id), [id]);
  if (!c) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;

  return (
    <div className="space-y-4">
      <PageHeader title={c.name} subtitle={CUSTOMER_TYPE_LABEL[c.type]} back={{ to: "/customers", label: "Customers" }} />

      <Section title="Contact">
        <KV rows={[["Phone", c.phone], ["Email", c.email], ["Notes", c.notes]]} />
        <div className="flex flex-wrap gap-2">
          {c.phone && (
            <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
              <Phone className="size-4" /> Call
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
              <Mail className="size-4" /> Email
            </a>
          )}
        </div>
      </Section>

      {c.projects.length > 0 && (
        <Section title="Projects">
          <ul className="space-y-2 text-sm">
            {c.projects.map((p) => (
              <li key={p.id}>
                <p className="font-medium">{p.name}</p>
                <p className="text-muted-foreground text-xs">
                  {p.siteCount} site{p.siteCount === 1 ? "" : "s"}
                  {p.description ? ` · ${p.description}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Sites (${c.addresses.length})`}>
        {c.addresses.length === 0 && <p className="text-muted-foreground text-sm">No saved sites.</p>}
        <ul className="space-y-3">
          {c.addresses.map((a) => {
            const map = mapsLink(a);
            return (
              <li key={a.id} className="space-y-1 text-sm">
                <p className="font-medium">{a.label || a.projectName || "Site"}</p>
                <p className="text-muted-foreground">{a.fullAddress}</p>
                {a.projectName && a.label && <p className="text-muted-foreground text-xs">{a.projectName}</p>}
                {map && (
                  <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium underline">
                    <MapPin className="size-3.5" /> Open in maps
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
