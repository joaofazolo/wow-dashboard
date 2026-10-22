// Blizzard World of Warcraft Profile API. Needs a client from https://develop.battle.net/access/clients
// Docs: https://develop.battle.net/documentation/world-of-warcraft/profile-apis
import type { BlizzardData, CharacterRef, LegacyLockout, RaidDifficulty, RaidKill, RaidLockout } from "../types.js";
import { clientCredentials, errorMessage, getJson } from "./http.js";
import { currentWeek } from "./periods.js";

const { BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET } = process.env;

const getToken =
  BLIZZARD_CLIENT_ID && BLIZZARD_CLIENT_SECRET
    ? clientCredentials("https://oauth.battle.net/token", BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET)
    : null;

export const blizzardEnabled = getToken !== null;

const realmIndexes = new Map<string, Promise<Map<string, string>>>();

/**
 * Blizzard's slug for a realm however it was typed ("Area52", "Area 52" or "area-52" all give "area-52").
 * Uses the region's realm list, cached for the life of the server; falls back to the input without a key.
 */
export async function realmSlug(region: string, realm: string): Promise<string> {
  if (!getToken) return realm;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  let index = realmIndexes.get(region);
  if (!index) {
    index = (async () => {
      const data = await getJson<{ realms: { name: string; slug: string }[] }>(
        `https://${region}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-${region}&locale=en_US`,
        { headers: { Authorization: `Bearer ${await getToken!()}` } },
      );
      return new Map(data.realms.flatMap((r) => [[squash(r.slug), r.slug], [squash(r.name), r.slug]]));
    })();
    realmIndexes.set(region, index);
    index.catch(() => realmIndexes.delete(region)); // retry next time
  }
  return (await index.catch(() => null))?.get(squash(realm)) ?? realm;
}

interface Summary {
  level: number;
  active_title?: { display_string: string };
  average_item_level: number;
  equipped_item_level: number;
  last_login_timestamp: number;
}

interface Media {
  assets?: { key: string; value: string }[];
}

interface Stats {
  health: number;
  power: number;
  power_type: { name: string };
  strength: { effective: number };
  agility: { effective: number };
  intellect: { effective: number };
  stamina: { effective: number };
  spell_crit: { value: number };
  melee_crit: { value: number };
  spell_haste: { value: number };
  melee_haste: { value: number };
  mastery: { value: number };
  versatility_damage_done_bonus: number;
}

interface RaidEncounters {
  expansions?: {
    expansion: { id: number; name: string };
    instances: {
      instance: { id: number; name: string };
      modes: {
        difficulty: { type: string; name: string };
        progress: { total_count: number; encounters: { encounter: { id: number; name: string }; last_kill_timestamp: number }[] };
      }[];
    }[];
  }[];
}

// Blizzard lists this season's raids twice: under their expansion and under this pseudo-expansion.
const CURRENT_SEASON_EXPANSION_ID = 505;

const DIFFICULTY_RANK: Record<RaidDifficulty, number> = { LFR: 0, NORMAL: 1, HEROIC: 2, MYTHIC: 3 };

/** Bosses killed this week in the newest expansion's raids. A boss counts once, at the highest difficulty killed. */
function weeklyKills(data: RaidEncounters, weekStart: number): RaidKill[] {
  const latest = [...(data.expansions ?? [])].filter((e) => e.expansion.id !== CURRENT_SEASON_EXPANSION_ID).sort((a, b) => b.expansion.id - a.expansion.id)[0];
  const best = new Map<number, RaidKill>();
  for (const { instance, modes } of latest?.instances ?? []) {
    for (const mode of modes) {
      const difficulty = mode.difficulty.type as RaidDifficulty;
      if (!(difficulty in DIFFICULTY_RANK)) continue;
      for (const e of mode.progress.encounters) {
        if (e.last_kill_timestamp < weekStart) continue;
        const prev = best.get(e.encounter.id);
        if (prev && DIFFICULTY_RANK[prev.difficulty] >= DIFFICULTY_RANK[difficulty]) continue;
        best.set(e.encounter.id, { raid: instance.name, boss: e.encounter.name, difficulty, killedAt: new Date(e.last_kill_timestamp).toISOString() });
      }
    }
  }
  return [...best.values()].sort((a, b) => DIFFICULTY_RANK[b.difficulty] - DIFFICULTY_RANK[a.difficulty]);
}

/** Bosses killed since the reset, per raid and difficulty, in the newest expansion. That's the character's lockout. */
function lockouts(data: RaidEncounters, weekStart: number): RaidLockout[] {
  const latest = [...(data.expansions ?? [])].filter((e) => e.expansion.id !== CURRENT_SEASON_EXPANSION_ID).sort((a, b) => b.expansion.id - a.expansion.id)[0];
  return (latest?.instances ?? []).flatMap(({ instance, modes }) =>
    modes
      .filter((m) => m.difficulty.type in DIFFICULTY_RANK)
      .map((m) => ({
        raid: instance.name,
        difficulty: m.difficulty.type as RaidDifficulty,
        killed: m.progress.encounters.filter((e) => e.last_kill_timestamp >= weekStart).map((e) => e.encounter.name),
      }))
      .filter((l) => l.killed.length));
}

// Raid boss lists never change, so they're cached for the life of the server.
const journalCache = new Map<string, Promise<{ id: number; name: string }[]>>();

function journalBosses(region: string, instanceId: number, token: string): Promise<{ id: number; name: string }[]> {
  const key = `${region}/${instanceId}`;
  let bosses = journalCache.get(key);
  if (!bosses) {
    bosses = getJson<{ encounters?: { id: number; name: string }[] }>(
      `https://${region}.api.blizzard.com/data/wow/journal-instance/${instanceId}?namespace=static-${region}&locale=en_US`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).then((d) => d.encounters ?? []);
    journalCache.set(key, bosses);
    bosses.catch(() => journalCache.delete(key));
  }
  return bosses;
}

/** Lockouts in every expansion except the newest one (and the "Current Season" duplicate), with each raid's full boss list. */
async function legacyLockouts(data: RaidEncounters, weekStart: number, region: string, token: string): Promise<LegacyLockout[]> {
  const expansions = [...(data.expansions ?? [])]
    .filter((e) => e.expansion.id !== CURRENT_SEASON_EXPANSION_ID)
    .sort((a, b) => b.expansion.id - a.expansion.id)
    .slice(1);
  const saved = expansions.flatMap(({ expansion, instances }) =>
    instances.flatMap(({ instance, modes }) =>
      modes
        .map((m) => ({ expansion, instance, mode: m, kills: m.progress.encounters.filter((e) => e.last_kill_timestamp >= weekStart) }))
        .filter((x) => x.kills.length)));

  return Promise.all(saved.map(async ({ expansion, instance, mode, kills }) => {
    const killedIds = new Set(kills.map((k) => k.encounter.id));
    const journal = await journalBosses(region, instance.id, token).catch(() => []);
    return {
      expansion: expansion.name,
      raid: instance.name,
      difficulty: mode.difficulty.name,
      killed: kills.map((k) => k.encounter.name),
      totalBosses: mode.progress.total_count,
      bosses: journal.map((b) => ({ name: b.name, killed: killedIds.has(b.id) })),
    };
  }));
}

export async function fetchBlizzard(ref: CharacterRef): Promise<BlizzardData> {
  if (!getToken) throw new Error("Blizzard API is not configured");
  const token = await getToken();
  const base = `https://${ref.region}.api.blizzard.com/profile/wow/character/${await realmSlug(ref.region, ref.realm)}/${encodeURIComponent(ref.name.toLowerCase())}`;
  const query = `namespace=profile-${ref.region}&locale=en_US`;
  const get = <T>(path: string) => getJson<T>(`${base}${path}?${query}`, { headers: { Authorization: `Bearer ${token}` } });

  const [summary, media, stats, raids, week] = await Promise.all([
    get<Summary>(""),
    get<Media>("/character-media").catch(() => null),
    get<Stats>("/statistics").catch(() => null),
    get<RaidEncounters>("/encounters/raids").catch((err) => {
      console.warn(`Blizzard raid encounters unavailable: ${errorMessage(err)}`);
      return null;
    }),
    currentWeek(ref.region).catch(() => null),
  ]);

  const asset = (key: string) => media?.assets?.find((a) => a.key === key)?.value ?? null;

  let statBlock: BlizzardData["stats"] = null;
  if (stats) {
    // Show whichever primary stat the character actually uses.
    const primary = [
      { name: "Strength", value: stats.strength.effective },
      { name: "Agility", value: stats.agility.effective },
      { name: "Intellect", value: stats.intellect.effective },
    ].sort((a, b) => b.value - a.value)[0];
    statBlock = {
      health: stats.health,
      power: stats.power,
      powerType: stats.power_type.name,
      primary,
      stamina: stats.stamina.effective,
      crit: Math.max(stats.spell_crit.value, stats.melee_crit.value),
      haste: Math.max(stats.spell_haste.value, stats.melee_haste.value),
      mastery: stats.mastery.value,
      versatility: stats.versatility_damage_done_bonus,
    };
  }

  return {
    level: summary.level,
    title: summary.active_title?.display_string.replace("{name}", ref.name) ?? null,
    averageItemLevel: summary.average_item_level,
    equippedItemLevel: summary.equipped_item_level,
    lastLogin: new Date(summary.last_login_timestamp).toISOString(),
    renderUrl: asset("main-raw") ?? asset("main"),
    insetUrl: asset("inset"),
    stats: statBlock,
    weeklyRaidKills: raids && week ? weeklyKills(raids, new Date(week.start).getTime()) : null,
    raidLockouts: raids && week ? lockouts(raids, new Date(week.start).getTime()) : null,
    legacyLockouts: raids && week ? await legacyLockouts(raids, new Date(week.start).getTime(), ref.region, token) : null,
  };
}
