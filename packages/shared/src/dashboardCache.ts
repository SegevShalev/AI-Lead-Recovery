/**
 * Shared by api (reads/caches) and recovery-worker (invalidates on write) so
 * both sides agree on the keys without duplicating the literals
 * (docs/architecture/service-boundaries.md#redis-usage).
 *
 * The cache entry is versioned: recovery-worker bumps the counter at
 * `dashboardCacheVersionKey` instead of deleting the cached value directly.
 * A dashboard read captures the current version before reading Mongo and
 * writes its result back under that same version — if invalidation bumps
 * the version while that read is in flight, the write lands on an
 * orphaned version nothing looks up again, instead of overwriting the
 * fresher cache entry with stale data.
 */
export function dashboardCacheVersionKey(businessId: string): string {
  return `dashboard:${businessId}:version`;
}

export function dashboardCacheKey(businessId: string, version: string): string {
  return `dashboard:${businessId}:v${version}`;
}
