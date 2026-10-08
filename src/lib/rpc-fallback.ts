/**
 * Calls `primary`; if it reports an error (or rejects/throws, e.g. a network
 * failure), calls `fallback` instead and returns its result. Used so the
 * candidate feed keeps working on the V1 RPC whenever the routed RPC is missing
 * (not migrated yet) or failing. A rejection from `fallback` propagates: there
 * is nothing left to fall back to.
 */
export async function rpcWithFallback<R extends { error: { message: string } | null }>(
  primary: () => PromiseLike<R>,
  fallback: () => PromiseLike<R>,
  onFallback?: (message: string) => void,
): Promise<R> {
  let first: R;
  try {
    first = await primary();
  } catch (e) {
    onFallback?.(e instanceof Error ? e.message : String(e));
    return await fallback();
  }
  if (!first.error) return first;
  onFallback?.(first.error.message);
  return await fallback();
}
