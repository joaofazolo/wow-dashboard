// Raidbots' static game data, used to decode the upgrade track hidden in an item's bonus IDs (e.g. "Myth 2/6").
// Raider.IO only gives the raw bonus IDs. No key needed.
import { getJson } from "./http.js";

const BONUSES_URL = "https://www.raidbots.com/static/data/live/bonuses.json";
const CACHE_MS = 12 * 60 * 60 * 1000;

interface RawUpgrade {
  group: number;
  level: number;
  max: number;
  name?: string;
  itemLevel?: number;
  seasonId?: number;
}

export interface UpgradeStep {
  track: string;
  level: number;
  max: number;
  maxItemLevel: number;
}

export interface UpgradeTable {
  byBonusId: Map<number, UpgradeStep>;
  /** Highest item level any upgrade track reaches this season. */
  seasonMaxItemLevel: number;
}

let cache: { at: number; value: Promise<UpgradeTable> } | null = null;

export function upgradeTable(): Promise<UpgradeTable> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = (async () => {
    const raw = await getJson<Record<string, { id: number; upgrade?: RawUpgrade }>>(BONUSES_URL);
    const steps = Object.values(raw)
      .map((b) => ({ bonusId: b.id, u: b.upgrade }))
      .filter((x): x is { bonusId: number; u: Required<RawUpgrade> } => !!x.u?.name && x.u.itemLevel != null && x.u.seasonId != null);

    // Only the newest season's tracks matter; older seasons reuse the same track names at lower item levels.
    const season = Math.max(...steps.map((s) => s.u.seasonId));
    const current = steps.filter((s) => s.u.seasonId === season);

    const groupMax = new Map<number, number>();
    for (const { u } of current) groupMax.set(u.group, Math.max(groupMax.get(u.group) ?? 0, u.itemLevel));

    return {
      byBonusId: new Map(current.map(({ bonusId, u }) => [bonusId, { track: u.name, level: u.level, max: u.max, maxItemLevel: groupMax.get(u.group)! }])),
      seasonMaxItemLevel: Math.max(...groupMax.values()),
    };
  })();
  cache = { at: Date.now(), value };
  value.catch(() => (cache = null)); // don't cache failures
  return value;
}
