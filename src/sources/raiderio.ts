// Raider.IO public API — no key required. Docs: https://raider.io/api
import type { CharacterRef, KeystoneRun, RaiderIOData } from "../types.js";
import { errorMessage, getJson } from "./http.js";
import { upgradeTable } from "./raidbots.js";
import { currentWeek } from "./periods.js";
import { fetchCutoffs } from "./cutoffs.js";

const FIELDS = [
  "gear",
  "guild",
  "raid_progression",
  "mythic_plus_scores_by_season:current",
  "mythic_plus_recent_runs",
  "mythic_plus_best_runs",
  "mythic_plus_weekly_highest_level_runs",
].join(",");

interface RioRun {
  dungeon: string;
  short_name: string;
  mythic_level: number;
  num_keystone_upgrades: number;
  score: number;
  completed_at: string;
  clear_time_ms: number;
  par_time_ms: number;
  role?: string;
  url: string;
}

interface RioProfile {
  name: string;
  race: string;
  class: string;
  active_spec_name: string;
  active_spec_role: string;
  faction: string;
  achievement_points: number;
  thumbnail_url: string;
  profile_url: string;
  last_crawled_at: string;
  guild?: { name: string } | null;
  gear?: {
    item_level_equipped: number;
    items: Record<string, { name: string; item_level: number; item_quality: number; icon: string; bonuses?: number[] }>;
  };
  mythic_plus_scores_by_season?: {
    season: string;
    scores: { all: number; dps: number; healer: number; tank: number } & Record<string, number>; // plus spec_0..spec_3
    segments: { all: { color: string } };
  }[];
  mythic_plus_recent_runs?: RioRun[];
  mythic_plus_best_runs?: RioRun[];
  mythic_plus_weekly_highest_level_runs?: RioRun[];
  raid_progression?: Record<string, {
    summary: string;
    total_bosses: number;
    normal_bosses_killed: number;
    heroic_bosses_killed: number;
    mythic_bosses_killed: number;
  }>;
}

interface Window { starts: Record<string, string>; ends: Record<string, string> }
interface RaidInfo extends Window { slug: string; name: string; encounters: { name: string }[] }

// Midnight. Newer expansions are found by probing upward from here.
const FIRST_EXPANSION_ID = 11;
const SEASON_CACHE_MS = 12 * 60 * 60 * 1000;

interface SeasonInfo {
  raidWindows: Map<string, RaidInfo>;
  seasonWindows: Map<string, Window>;
}

let seasonCache: { at: number; value: Promise<SeasonInfo> } | null = null;

/** Raid and M+ season dates for the newest expansion Raider.IO knows about. */
function seasonInfo(): Promise<SeasonInfo> {
  if (seasonCache && Date.now() - seasonCache.at < SEASON_CACHE_MS) return seasonCache.value;
  const value = (async () => {
    // Raider.IO answers 400 for expansion ids that don't exist yet, so the last one that works is the current one.
    let expansion = FIRST_EXPANSION_ID;
    let raids = (await getJson<{ raids: RaidInfo[] }>(`https://raider.io/api/v1/raiding/static-data?expansion_id=${expansion}`)).raids;
    for (;;) {
      const next = await getJson<{ raids: RaidInfo[] }>(`https://raider.io/api/v1/raiding/static-data?expansion_id=${expansion + 1}`).catch(() => null);
      if (!next?.raids.length) break;
      expansion++;
      raids = next.raids;
    }
    const mplus = await getJson<{ seasons: ({ slug: string } & Window)[] }>(`https://raider.io/api/v1/mythic-plus/static-data?expansion_id=${expansion}`);
    return {
      raidWindows: new Map(raids.map((r) => [r.slug, r])),
      seasonWindows: new Map(mplus.seasons.map((x) => [x.slug, x])),
    };
  })();
  seasonCache = { at: Date.now(), value };
  value.catch(() => (seasonCache = null)); // don't cache failures
  return value;
}

const isActive = (w: Window | undefined, region: string, now = Date.now()) =>
  !!w && new Date(w.starts[region] ?? w.starts.us).getTime() <= now && now < new Date(w.ends[region] ?? w.ends.us).getTime();

const toRun = (r: RioRun): KeystoneRun => ({
  dungeon: r.dungeon,
  shortName: r.short_name,
  level: r.mythic_level,
  upgrades: r.num_keystone_upgrades,
  score: r.score,
  completedAt: r.completed_at,
  clearTimeMs: r.clear_time_ms,
  parTimeMs: r.par_time_ms,
  role: r.role ?? null,
  url: r.url,
});

export async function fetchRaiderIO(ref: CharacterRef): Promise<RaiderIOData> {
  const params = new URLSearchParams({ region: ref.region, realm: ref.realm, name: ref.name, fields: FIELDS });
  const [p, info, upgrades, week] = await Promise.all([
    getJson<RioProfile>(`https://raider.io/api/v1/characters/profile?${params}`),
    seasonInfo().catch((err) => {
      console.warn(`Raider.IO season data unavailable, showing all raids and runs: ${errorMessage(err)}`);
      return null;
    }),
    upgradeTable().catch((err) => {
      console.warn(`Raidbots upgrade data unavailable, gear won't be marked: ${errorMessage(err)}`);
      return null;
    }),
    currentWeek(ref.region).catch((err) => {
      console.warn(`Raider.IO weekly periods unavailable: ${errorMessage(err)}`);
      return null;
    }),
  ]);
  const season = p.mythic_plus_scores_by_season?.[0];
  const cutoffs = season
    ? await fetchCutoffs(ref.region, season.season, p.class, season.scores).catch((err) => {
        console.warn(`Raider.IO season cutoffs unavailable: ${errorMessage(err)}`);
        return null;
      })
    : null;

  // Keep only the current season: raids open right now, and runs completed since the M+ season started.
  const seasonWindow = season && info?.seasonWindows.get(season.season);
  const seasonStart = seasonWindow ? new Date(seasonWindow.starts[ref.region] ?? seasonWindow.starts.us).getTime() : 0;
  const inSeason = (r: RioRun) => new Date(r.completed_at).getTime() >= seasonStart;
  const currentRaid = (slug: string) => !info || isActive(info.raidWindows.get(slug), ref.region);

  return {
    name: p.name,
    race: p.race,
    className: p.class,
    spec: p.active_spec_name,
    role: p.active_spec_role,
    faction: p.faction,
    guild: p.guild?.name ?? null,
    thumbnailUrl: p.thumbnail_url,
    profileUrl: p.profile_url,
    achievementPoints: p.achievement_points,
    itemLevel: p.gear?.item_level_equipped ?? 0,
    lastCrawledAt: p.last_crawled_at,
    mythicPlus: season
      ? {
          season: season.season,
          score: season.scores.all,
          color: season.segments.all.color,
          roleScores: { dps: season.scores.dps, healer: season.scores.healer, tank: season.scores.tank },
        }
      : null,
    recentRuns: (p.mythic_plus_recent_runs ?? []).filter(inSeason).map(toRun),
    bestRuns: (p.mythic_plus_best_runs ?? []).filter(inSeason).map(toRun),
    weeklyRuns: (p.mythic_plus_weekly_highest_level_runs ?? []).map(toRun).sort((a, b) => b.level - a.level),
    week,
    cutoffs,
    raids: Object.entries(p.raid_progression ?? {}).filter(([slug]) => currentRaid(slug)).map(([slug, r]) => ({
      slug,
      name: info?.raidWindows.get(slug)?.name ?? slug.replace(/-/g, " "),
      bosses: info?.raidWindows.get(slug)?.encounters.map((e) => e.name) ?? [],
      summary: r.summary,
      totalBosses: r.total_bosses,
      normal: r.normal_bosses_killed,
      heroic: r.heroic_bosses_killed,
      mythic: r.mythic_bosses_killed,
    })),
    gear: Object.entries(p.gear?.items ?? {}).map(([slot, i]) => ({
      slot,
      name: i.name,
      itemLevel: i.item_level,
      quality: i.item_quality,
      icon: i.icon,
      upgrade: (i.bonuses ?? []).map((b) => upgrades?.byBonusId.get(b)).find(Boolean) ?? null,
    })),
    seasonMaxItemLevel: upgrades?.seasonMaxItemLevel ?? null,
  };
}
