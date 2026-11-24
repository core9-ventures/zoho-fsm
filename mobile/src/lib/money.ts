/** 12500 → "PKR 12,500.00" (the company's currency; plain number when the currency is unknown). */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency || "PKR", currencyDisplay: "code" }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}
