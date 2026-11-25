import { useState } from "react";
import { ApiError, settingsApi, type CompanyDto } from "../../api";
import { useAsync } from "../../data/useAsync";
import { Button, Field, LoadError, Spinner, inputClass } from "../../ui/kit";
import { PageHeader } from "../../ui/parts";
import { useToast } from "../../ui/toast";
import { companySettingsSchema } from "@/modules/companies/companies.schema";

type Errors = Record<string, string>;

/** Time zones the phone knows about (falls back to the current one). */
const zones = (current: string): string[] => {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return all.includes(current) ? all : [current, ...all];
  } catch {
    return [current];
  }
};

/** The company's profile and regional settings (Admin). */
export function Settings() {
  const { data: company, error, loading, reload } = useAsync(() => settingsApi.get());
  if (!company) return loading ? <Spinner /> : error ? <LoadError error={error} onRetry={() => void reload()} /> : null;
  // key: a fresh form each time the saved settings change
  return <SettingsForm key={company.name + company.timeZone + company.currency + company.taxPercent} company={company} onSaved={reload} />;
}

function SettingsForm({ company: c, onSaved }: { company: CompanyDto; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState(c.name);
  const [email, setEmail] = useState(c.email ?? "");
  const [phone, setPhone] = useState(c.phone ?? "");
  const [address, setAddress] = useState(c.address ?? "");
  const [logoUrl, setLogoUrl] = useState(c.logoUrl ?? "");
  const [timeZone, setTimeZone] = useState(c.timeZone);
  const [currency, setCurrency] = useState(c.currency);
  const [taxPercent, setTaxPercent] = useState(String(c.taxPercent));
  const [signature, setSignature] = useState(c.requireSignatureOnComplete);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = companySettingsSchema.safeParse({
      name,
      email,
      phone,
      address,
      logoUrl,
      timeZone,
      currency: currency.trim().toUpperCase(),
      taxPercent: taxPercent.trim() === "" ? NaN : Number(taxPercent),
      requireSignatureOnComplete: signature,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      toast.error("Check the fields marked in red.");
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await settingsApi.update(parsed.data);
      toast.success("Settings saved.");
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const next: Errors = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) if (msgs[0]) next[k] = msgs[0];
        setErrors(next);
        toast.error(err.message);
      } else toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <PageHeader title="Settings" subtitle="Company profile and regional settings." />

      <section className="bg-card space-y-4 rounded-xl border p-4">
        <Field label="Company name" htmlFor="s-name" error={errors.name}>
          <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} className={inputClass} />
        </Field>
        <Field label="Email" htmlFor="s-email" error={errors.email}>
          <input id="s-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} className={inputClass} />
        </Field>
        <Field label="Phone" htmlFor="s-phone" error={errors.phone}>
          <input id="s-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Address" htmlFor="s-address" error={errors.address}>
          <textarea id="s-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Logo address (URL)" htmlFor="s-logo" error={errors.logoUrl}>
          <input id="s-logo" type="url" inputMode="url" autoCapitalize="none" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} aria-invalid={!!errors.logoUrl} className={inputClass} />
        </Field>
      </section>

      <section className="bg-card space-y-4 rounded-xl border p-4">
        <Field label="Time zone" htmlFor="s-tz" error={errors.timeZone}>
          <select id="s-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={inputClass}>
            {zones(c.timeZone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency" htmlFor="s-cur" error={errors.currency} hint="Three letters, like PKR or USD.">
          <input id="s-cur" value={currency} maxLength={3} autoCapitalize="characters" onChange={(e) => setCurrency(e.target.value)} aria-invalid={!!errors.currency} className={inputClass} />
        </Field>
        <Field label="Default tax (%)" htmlFor="s-tax" error={errors.taxPercent}>
          <input id="s-tax" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} aria-invalid={!!errors.taxPercent} className={inputClass} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={signature} onChange={(e) => setSignature(e.target.checked)} className="mt-0.5 size-5" />
          <span>
            Ask for the customer's signature before a technician completes a job
            {errors.requireSignatureOnComplete && <span className="text-destructive block">{errors.requireSignatureOnComplete}</span>}
          </span>
        </label>
      </section>

      <Button type="submit" busy={busy} className="w-full">
        Save settings
      </Button>
    </form>
  );
}
