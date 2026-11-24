import { useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, invoicesApi, type InvoiceListItem } from "../../api";
import { ListScreen } from "../../components/ListScreen";
import { useAsync } from "../../data/useAsync";
import { formatDateTime, formatDay, todayLocal } from "../../lib/format";
import { useSession } from "../../session";
import { Badge, Button, Field, LoadError, Modal, Spinner, inputClass } from "../../ui/kit";
import { KV, PageHeader, Row, Section, Stat, useMoney } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "@/modules/invoices/invoices.schema";

const tone = (s: string) => (s === "PAID" ? "green" : s === "OVERDUE" ? "red" : s === "PARTIALLY_PAID" ? "amber" : s === "SENT" ? "blue" : "muted") as "green" | "red" | "amber" | "blue" | "muted";

const FILTER = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PARTIALLY_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
];

/** Invoices with the money summary on top. */
export function Invoices() {
  const money = useMoney();
  const { data: s } = useAsync(() => invoicesApi.summary());
  return (
    <ListScreen<InvoiceListItem>
      title="Invoices"
      subtitle={(n) => `${n} found`}
      searchPlaceholder="Search number or customer"
      filters={[{ key: "status", label: "Status", options: FILTER, initial: "all" }]}
      top={
        s && (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Outstanding" value={money(s.outstanding)} />
            <Stat label="Overdue" value={money(s.overdue)} tone={s.overdue > 0 ? "red" : undefined} />
            <Stat label="Collected, last 30 days" value={money(s.collected30)} tone="green" />
            <Stat label="Open invoices" value={s.openCount} />
          </div>
        )
      }
      fetchPage={(q) => invoicesApi.list(q)}
      itemKey={(i) => i.id}
      empty="No invoices match."
      renderItem={(i) => (
        <Row to={`/invoices/${i.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground font-mono text-xs">{i.number}</span>
            <Badge tone={tone(i.status)}>{INVOICE_STATUS_LABEL[i.status]}</Badge>
          </div>
          <p className="font-medium">{i.customerName}</p>
          <p className="text-muted-foreground text-sm">
            {money(i.total)}
            {i.balance > 0 && i.balance !== i.total ? ` · ${money(i.balance)} due` : ""}
            {i.dueDate ? ` · due ${formatDay(i.dueDate)}` : ""}
          </p>
        </Row>
      )}
    />
  );
}

/** One invoice: customer, lines, totals, payments, and (Admin) recording a payment. */
export function InvoiceDetail() {
  const { id = "" } = useParams();
  const { user } = useSession();
  const toast = useToast();
  const money = useMoney();
  const { data: inv, error, loading, reload } = useAsync(() => invoicesApi.get(id), [id]);

  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(todayLocal());
  const [payError, setPayError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!inv) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  const i = inv;

  function openPay() {
    setAmount(i.balance > 0 ? String(i.balance) : "");
    setMethod("CASH");
    setReference("");
    setPaidAt(todayLocal());
    setPayError("");
    setPayOpen(true);
  }

  async function pay() {
    const n = Number(amount);
    if (!amount.trim() || Number.isNaN(n) || n <= 0) return setPayError("Enter the amount.");
    setBusy(true);
    try {
      await invoicesApi.addPayment(i.id, { amount: n, method, reference: reference.trim(), paidAt });
      toast.success("Payment recorded.");
      setPayOpen(false);
      await reload();
    } catch (e) {
      setPayError(e instanceof ApiError ? (e.fieldErrors.amount?.[0] ?? e.message) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={i.number} subtitle={i.customerName} back={{ to: "/invoices", label: "Invoices" }} />
      <Badge tone={tone(i.status)}>{INVOICE_STATUS_LABEL[i.status]}</Badge>

      {i.canPay && user?.role === "ADMIN" && (
        <Button onClick={openPay}>Record a payment</Button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Total" value={money(i.total)} />
        <Stat label="Paid" value={money(i.amountPaid)} tone="green" />
        <Stat label="Balance" value={money(i.balance)} tone={i.balance > 0 ? "red" : undefined} />
      </div>

      <Section>
        <KV
          rows={[
            ["Issued", formatDay(i.issueDate)],
            ["Due", i.dueDate ? formatDay(i.dueDate) : null],
            ["Work order", i.workOrder?.number],
            ["Phone", i.customer.phone],
            ["Email", i.customer.email],
            ["Address", i.customer.address],
            ["Notes", i.notes],
          ]}
        />
      </Section>

      <Section title="Lines">
        {i.lines.length === 0 && <p className="text-muted-foreground text-sm">No lines.</p>}
        <ul className="space-y-2 text-sm">
          {i.lines.map((l) => (
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
            <span className="tabular-nums">{money(i.subTotal)}</span>
          </div>
          <div className="text-muted-foreground flex justify-between">
            <span>Tax</span>
            <span className="tabular-nums">{money(i.tax)}</span>
          </div>
          {i.discount > 0 && (
            <div className="text-muted-foreground flex justify-between">
              <span>Discount</span>
              <span className="tabular-nums">−{money(i.discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(i.total)}</span>
          </div>
        </div>
      </Section>

      {i.payments.length > 0 && (
        <Section title="Payments">
          <ul className="space-y-2 text-sm">
            {i.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span>
                  {PAYMENT_METHOD_LABEL[p.method as keyof typeof PAYMENT_METHOD_LABEL] ?? p.method}
                  <span className="text-muted-foreground block text-xs">
                    {formatDateTime(p.paidAt)}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Modal
        open={payOpen}
        title="Record a payment"
        onClose={() => !busy && setPayOpen(false)}
        footer={
          <>
            <Button busy={busy} onClick={() => void pay()}>
              Save payment
            </Button>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {payError && (
            <p role="alert" className="text-destructive text-sm">
              {payError}
            </p>
          )}
          <Field label="Amount" htmlFor="pay-amount">
            <input id="pay-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Method" htmlFor="pay-method">
            <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" htmlFor="pay-date">
            <input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Reference (optional)" htmlFor="pay-ref">
            <input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
