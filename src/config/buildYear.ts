/* The calendar year a build reports. Split from product.ts so the Vite config
   and the app can share it without the config touching import.meta.env. */

export function buildYearFrom(epoch: string | undefined, now: Date = new Date()): number {
  const seconds = epoch ? Number(epoch) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).getUTCFullYear() : now.getFullYear();
}
