/**
 * Shared by api (reads/caches) and recovery-worker (invalidates on write) so
 * both sides agree on the key without duplicating the literal
 * (docs/architecture/service-boundaries.md#redis-usage).
 */
export function dashboardCacheKey(businessId: string): string {
  return `dashboard:${businessId}`;
}
