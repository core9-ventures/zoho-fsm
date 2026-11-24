import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import type { PagedResult } from "../api";
import { usePaged } from "../data/usePaged";
import { Button, LoadError, Spinner, inputClass } from "../ui/kit";
import { PageHeader } from "../ui/parts";

export type FilterDef = {
  /** The query name the server expects, e.g. "status". */
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** The option selected at first ("" = no filter). */
  initial?: string;
};

type Props<T> = {
  title: string;
  subtitle?: (total: number) => string;
  /** Loads one page. `q` holds the search text and the selected filters. */
  fetchPage: (q: { page: number; pageSize: number; search?: string; [filter: string]: string | number | undefined }) => Promise<PagedResult<T>>;
  filters?: FilterDef[];
  searchPlaceholder?: string;
  renderItem: (item: T) => ReactNode;
  itemKey: (item: T) => string;
  empty?: string;
  /** Shown above the search box (summary figures). */
  top?: ReactNode;
  /** Change this number to load the list again (after something in it was changed). */
  version?: number;
};

const PAGE_SIZE = 20;

/** A searchable, filterable list with "Show more". The office screens (work orders, customers, ...) share it. */
export function ListScreen<T>({ title, subtitle, fetchPage, filters = [], searchPlaceholder = "Search", renderItem, itemKey, empty = "Nothing found.", top, version = 0 }: Props<T>) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map((f) => [f.key, f.initial ?? ""])),
  );

  // Search as you type, but wait a moment so every key press is not a request.
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const filterKey = JSON.stringify(selected);
  const { items, total, loading, loadingMore, error, more, reload, hasMore } = usePaged<T>(
    (page) => fetchPage({ page, pageSize: PAGE_SIZE, search: search || undefined, ...selected }),
    [search, filterKey, version],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={title} subtitle={subtitle && !loading && !error ? subtitle(total) : undefined} />
      {top}

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className={`${inputClass} pl-9`}
        />
      </div>

      {filters.map((f) => (
        <div key={f.key} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label={f.label}>
          {f.options.map((o) => {
            const on = (selected[f.key] ?? "") === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setSelected((s) => ({ ...s, [f.key]: o.value }))}
                aria-pressed={on}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "bg-primary text-primary-foreground border-transparent" : "bg-card"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ))}

      {loading && items.length === 0 ? (
        <Spinner />
      ) : error && items.length === 0 ? (
        <LoadError error={error} onRetry={() => void reload()} />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">{empty}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={itemKey(it)}>{renderItem(it)}</li>
            ))}
          </ul>
          {error && <LoadError error={error} onRetry={() => void more()} />}
          {hasMore && (
            <Button variant="outline" onClick={() => void more()} disabled={loadingMore} className="w-full">
              {loadingMore && <Loader2 className="size-4 animate-spin" />} Show more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
