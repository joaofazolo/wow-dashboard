// Weekly reset times per region, from Raider.IO. No key needed.
import { getJson } from "./http.js";

interface Period { start: string; end: string }
interface PeriodsResponse { periods: { region: string; current: Period }[] }

const cache = new Map<string, Period>();

/** Start and end of the current raid/M+ week for a region. Cached until that week ends. */
export async function currentWeek(region: string): Promise<Period> {
  const hit = cache.get(region);
  if (hit && Date.now() < new Date(hit.end).getTime()) return hit;
  const { periods } = await getJson<PeriodsResponse>("https://raider.io/api/v1/periods");
  for (const p of periods) cache.set(p.region, p.current);
  const week = cache.get(region);
  if (!week) throw new Error(`Raider.IO has no weekly period for region "${region}"`);
  return week;
}
