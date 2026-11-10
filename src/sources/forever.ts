// WoW: Forever, through the Blizzard API's *-forever-{region} namespaces. Uses the same client as blizzard.ts.
// Undocumented so far; what works is collected in https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334
import type { ForeverCharacter, ForeverRuleset } from "../types.js";
import { blizzardGet } from "./blizzard.js";
import { errorMessage } from "./http.js";

const named = (x?: { name?: string } | null) => x?.name ?? null;

interface Summary {
  name: string;
  surname?: string;
  gender?: { name: string };
  ruleset?: { name: string };
  experience?: number;
  level: number;
  race?: { name: string };
  character_class?: { name: string };
  active_spec?: { name: string };
  faction?: { name: string };
  guild?: { name: string };
  active_title?: { display_string: string };
  equipped_item_level?: number;
  achievement_points?: number;
  last_login_timestamp?: number;
}

interface Equipment {
  equipped_items?: { slot: { name: string }; name: string; level?: { value: number }; quality?: { type: string } }[];
}

// Classic-style talent trees: one group per talent build (dual spec), listing only the trees with points spent.
interface Specializations {
  specialization_groups?: {
    is_active: boolean;
    specializations: { specialization_name: string; spent_points: number; talents?: { talent: { name: string }; talent_rank: number }[] }[];
  }[];
}

interface PvpSummary {
  honor_level?: number;
  pvp_rank?: number;
  honorable_kills?: number;
  pvp_map_statistics?: { world_map: { name: string }; match_statistics: { played: number; won: number; lost: number } }[];
}

interface Media {
  assets?: { key: string; value: string }[];
}

type Rated = { value: number };

interface Statistics {
  health: number;
  power: number;
  power_type: { name: string };
  strength: { effective: number };
  agility: { effective: number };
  intellect: { effective: number };
  stamina: { effective: number };
  spirit?: { effective: number };
  armor?: { effective: number };
  defense?: { effective: number };
  attack_power?: number;
  ranged_attack_power?: number;
  spell_power?: number;
  melee_crit: Rated;
  spell_crit?: Rated;
  dodge?: Rated;
  parry?: Rated;
  block?: Rated;
  main_hand_dps?: number;
}

type Tier = { skill_points: number; max_skill_points: number; known_recipes?: unknown[] };
interface Professions {
  primaries?: { profession: { name: string }; tiers?: Tier[] }[];
  secondaries?: { profession: { name: string }; tiers?: Tier[] }[];
}

interface Quests {
  in_progress?: { name: string }[];
}

interface Reputations {
  reputations?: { faction: { name: string }; standing: { tier: number; name: string; value: number; max: number } }[];
}

interface Achievements {
  total_quantity?: number;
  total_points?: number;
  recent_events?: { achievement: { name: string }; timestamp: number }[];
}

type StatLine = { name: string; quantity?: number; description?: string };
interface AchievementStatistics {
  categories?: { name: string; statistics?: StatLine[]; sub_categories?: { statistics?: StatLine[] }[] }[];
}

/** Looks up a character by "Name-Surname" (Forever names are unique per region, so there's no realm). */
export async function fetchForeverCharacter(region: string, name: string): Promise<ForeverCharacter> {
  const base = `/profile/wow/character/${encodeURIComponent(name.toLowerCase())}`;
  const get = <T>(path: string) => blizzardGet<T>(region, `${base}${path}?namespace=profile-forever-${region}&locale=en_US`);
  // The extras fail independently (e.g. media only renders hours after a new character logs out).
  const optional = <T>(path: string) =>
    get<T>(path).catch((err) => {
      console.warn(`Forever ${path || "profile"} unavailable for ${name}: ${errorMessage(err)}`);
      return null;
    });

  const [summary, equipment, specs, pvp, media, stats, professions, quests, completed, reputations, achievements, lifetime, transmogs] = await Promise.all([
    get<Summary>(""),
    optional<Equipment>("/equipment"),
    optional<Specializations>("/specializations"),
    optional<PvpSummary>("/pvp-summary"),
    optional<Media>("/character-media"),
    optional<Statistics>("/statistics"),
    optional<Professions>("/professions"),
    optional<Quests>("/quests"),
    optional<{ quests?: unknown[] }>("/quests/completed"),
    optional<Reputations>("/reputations"),
    optional<Achievements>("/achievements"),
    optional<AchievementStatistics>("/achievements/statistics"),
    optional<{ slots?: { appearances?: unknown[] }[] }>("/collections/transmogs"),
  ]);

  const asset = (key: string) => media?.assets?.find((a) => a.key === key)?.value ?? null;
  const builds = specs?.specialization_groups?.map((g) => ({
    active: g.is_active,
    trees: g.specializations
      .map((t) => ({ name: t.specialization_name, points: t.spent_points, talents: (t.talents ?? []).map((x) => ({ name: x.talent.name, rank: x.talent_rank })) }))
      .sort((a, b) => b.points - a.points),
  })) ?? null;
  // The profile's active_spec is empty in Forever; the spec is the active build's tree with the most points.
  const activeSpec = named(summary.active_spec) ?? builds?.find((b) => b.active)?.trees[0]?.name ?? null;

  return {
    name: summary.name,
    level: summary.level,
    race: named(summary.race),
    className: named(summary.character_class),
    spec: activeSpec,
    faction: named(summary.faction),
    guild: named(summary.guild),
    title: summary.active_title?.display_string.replace("{name}", summary.name) ?? null,
    equippedItemLevel: summary.equipped_item_level ?? null,
    achievementPoints: summary.achievement_points ?? null,
    lastLogin: summary.last_login_timestamp ? new Date(summary.last_login_timestamp).toISOString() : null,
    insetUrl: asset("inset") ?? asset("avatar"),
    gear: equipment?.equipped_items?.map((i) => ({ slot: i.slot.name, name: i.name, itemLevel: i.level?.value ?? null, quality: i.quality?.type ?? null })) ?? null,
    builds,
    pvp: pvp
      ? {
          honorLevel: pvp.honor_level ?? null,
          honorableKills: pvp.honorable_kills ?? null,
          rank: pvp.pvp_rank ?? null,
          maps: (pvp.pvp_map_statistics ?? []).map((m) => ({ name: m.world_map.name, ...m.match_statistics })),
        }
      : null,
    surname: summary.surname ?? null,
    gender: named(summary.gender),
    ruleset: named(summary.ruleset),
    experience: summary.experience ?? null,
    renderUrl: asset("main-raw"),
    stats: stats
      ? {
          health: stats.health,
          power: stats.power,
          powerType: stats.power_type.name,
          strength: stats.strength.effective,
          agility: stats.agility.effective,
          stamina: stats.stamina.effective,
          intellect: stats.intellect.effective,
          spirit: stats.spirit?.effective ?? null,
          armor: stats.armor?.effective ?? 0,
          attackPower: stats.attack_power ?? null,
          rangedAttackPower: stats.ranged_attack_power ?? null,
          spellPower: stats.spell_power ?? null,
          defense: stats.defense?.effective ?? null,
          crit: stats.melee_crit.value,
          spellCrit: stats.spell_crit?.value ?? null,
          dodge: stats.dodge?.value ?? 0,
          parry: stats.parry?.value ?? 0,
          block: stats.block?.value ?? 0,
          mainHandDps: stats.main_hand_dps ?? null,
        }
      : null,
    professions: professions
      ? [...(professions.primaries ?? []).map((p) => ({ p, secondary: false })), ...(professions.secondaries ?? []).map((p) => ({ p, secondary: true }))]
          .map(({ p, secondary }) => {
            // Classic professions have a single tier.
            const t = p.tiers?.[0];
            return { name: p.profession.name, skill: t?.skill_points ?? 0, max: t?.max_skill_points ?? 0, recipes: t?.known_recipes?.length ?? 0, secondary };
          })
      : null,
    quests: quests ? { inProgress: (quests.in_progress ?? []).map((q) => q.name), completed: completed?.quests?.length ?? null } : null,
    reputations: reputations?.reputations
      ?.map((r) => ({ faction: r.faction.name, standing: r.standing.name, tier: r.standing.tier, value: r.standing.value, max: r.standing.max }))
      .sort((a, b) => b.tier - a.tier || b.value / (b.max || 1) - a.value / (a.max || 1)) ?? null,
    achievements: achievements
      ? {
          count: achievements.total_quantity ?? 0,
          points: achievements.total_points ?? 0,
          recent: (achievements.recent_events ?? []).map((e) => ({ name: e.achievement.name, at: new Date(e.timestamp).toISOString() })),
        }
      : null,
    lifetime: lifetime?.categories
      ?.map((c) => ({
        category: c.name,
        stats: [...(c.statistics ?? []), ...(c.sub_categories ?? []).flatMap((sc) => sc.statistics ?? [])]
          .map((st) => ({ name: st.name, value: st.quantity != null ? st.quantity.toLocaleString("en-US") : st.description ?? "" }))
          .filter((st) => st.value && st.value !== "0"),
      }))
      .filter((c) => c.stats.length) ?? null,
    transmogs: transmogs?.slots ? transmogs.slots.reduce((n, sl) => n + (sl.appearances?.length ?? 0), 0) : null,
  };
}

/** Every ruleset in the region with its server status. */
export async function fetchForeverRulesets(region: string): Promise<ForeverRuleset[]> {
  const query = `namespace=dynamic-forever-${region}&locale=en_US`;
  const index = await blizzardGet<{ rulesets: { id: number }[] }>(region, `/data/wow/ruleset/index?${query}`);
  const rulesets = await Promise.all(index.rulesets.map((r) =>
    blizzardGet<{ id: number; name: string; status?: { type: string; name: string } }>(region, `/data/wow/ruleset/${r.id}?${query}`)));
  return rulesets
    .map((r) => ({ id: r.id, name: r.name, status: r.status?.name ?? "Unknown", up: r.status?.type === "UP" }))
    .sort((a, b) => a.id - b.id);
}
