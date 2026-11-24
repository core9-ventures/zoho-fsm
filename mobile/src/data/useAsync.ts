import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";

type State<T> = { data: T | null; error: ApiError | null; loading: boolean };

/**
 * Runs a data-layer call when the screen opens (and again on `reload`), with loading and error states.
 * A late answer from an earlier call is ignored.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const run = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const mine = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await load();
      if (mine === run.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (mine === run.current) {
        setState((s) => ({
          data: s.data,
          error: e instanceof ApiError ? e : new ApiError("Something went wrong. Please try again.", 0),
          loading: false,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
