import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type PagedResult } from "../api";

/**
 * A list that loads page by page ("Show more"). It starts again from page 1 whenever `deps` change (a new
 * search or filter), and ignores a late answer to an earlier request.
 */
export function usePaged<T>(fetchPage: (page: number) => Promise<PagedResult<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useRef(0);

  const first = useCallback(async () => {
    const mine = ++run.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage(1);
      if (mine !== run.current) return;
      setItems(res.items);
      setTotal(res.totalCount);
      setPage(1);
    } catch (e) {
      if (mine === run.current) setError(e instanceof ApiError ? e : new ApiError("Something went wrong. Please try again.", 0));
    } finally {
      if (mine === run.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void first();
  }, [first]);

  const more = useCallback(async () => {
    const mine = run.current;
    setLoadingMore(true);
    try {
      const res = await fetchPage(page + 1);
      if (mine !== run.current) return;
      setItems((list) => [...list, ...res.items]);
      setPage((p) => p + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("Something went wrong. Please try again.", 0));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ...deps]);

  return { items, total, loading, loadingMore, error, more, reload: first, hasMore: items.length < total };
}
