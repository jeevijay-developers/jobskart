import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export type PagedResult<T> = { rows: T[]; total: number };

/**
 * The one place "how pagination works" is defined in this codebase: page
 * state, limit/offset math, and total-count tracking, decoupled from how a
 * given page actually fetches its rows (a Supabase `.range()` query, an RPC,
 * or even a slice of an already-loaded array — `fetchPage` hides that).
 *
 * Page state is uncontrolled (internal) by default. Pass `page`/`onPageChange`
 * only when something outside needs to own the page number, e.g. syncing it
 * to the URL — in that mode the caller is responsible for resetting the page
 * on filter changes too, since it already owns that transition.
 */
export function usePaginatedQuery<T>({
  queryKey,
  pageSize,
  fetchPage,
  page: controlledPage,
  onPageChange,
  enabled = true,
}: {
  /** Identifies the current filter set (NOT the page). Changing it resets to page 1 in uncontrolled mode. */
  queryKey: unknown[];
  pageSize: number;
  fetchPage: (range: { page: number; from: number; to: number }) => Promise<PagedResult<T>>;
  page?: number;
  onPageChange?: (page: number) => void;
  enabled?: boolean;
}) {
  const [internalPage, setInternalPage] = useState(1);
  const isControlled = controlledPage !== undefined;
  const page = controlledPage ?? internalPage;
  const setPage = onPageChange ?? setInternalPage;

  const depsKey = JSON.stringify(queryKey);
  const prevDepsKey = useRef(depsKey);
  useEffect(() => {
    if (isControlled) return;
    if (prevDepsKey.current !== depsKey) {
      prevDepsKey.current = depsKey;
      setInternalPage(1);
    }
  }, [depsKey, isControlled]);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [...queryKey, "page", page, pageSize],
    queryFn: () => fetchPage({ page, from, to }),
    placeholderData: keepPreviousData,
    enabled,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    page,
    setPage,
    pageSize,
    rows,
    total,
    totalPages,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}
