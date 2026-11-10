// WoW: Forever Legacy Points. Each Legacy Challenge is an account-wide achievement whose reward is "Earn 1 Legacy Point",
// so earned points and progress come from the character's achievements. Which perks a character has spent its points on
// isn't in the API.
import type { ForeverLegacy, LegacyChallenge } from "../types.js";
import { blizzardGet, blizzardGetOrNull as getOrNull } from "./blizzard.js";
import { pool } from "./http.js";

const PER_CHARACTER_CAP = 16;
// Not in the API; from the in-game Legacy panel (see https://classicwowforever.com/legacy/).
const REWARDS = [
  { points: 15, name: "Replica Ironforge Air Rifle", kind: "Toy" },
  { points: 25, name: "Spectral Bear Cub", kind: "Pet" },
  { points: 40, name: "Spectral Bear Tabard", kind: "Tabard" },
  { points: 55, name: "Reins of the Spectral Bear", kind: "Mount" },
];
// The in-game order of the Legacy categories.
const CATEGORY_ORDER = ["Classes", "Tradeskills", "Dungeons", "Raids", "Player vs. Player", "Adventure"];

interface Criteria {
  id: number;
  description?: string;
  amount?: number;
  show_progress_bar?: boolean;
  faction?: { type: string };
  child_criteria?: Criteria[];
}

interface Achievement {
  id: number;
  name: string;
  description: string;
  category: { id: number; name: string };
  reward_description?: string;
  criteria?: Criteria;
}

interface Entry {
  name: string;
  description: string;
  category: string;
  subcategory: string | null;
  /** Every id this challenge appears under: Blizzard lists most of them twice. Lowest first. */
  ids: number[];
  criteria: Criteria | null;
  icon: string | null;
}

const catalogs = new Map<string, Promise<Entry[]>>();

/** Every Legacy Challenge, from the achievement categories. Static, so it's cached for the life of the server. */
function catalog(region: string): Promise<Entry[]> {
  let hit = catalogs.get(region);
  if (!hit) {
    hit = (async () => {
      const q = `namespace=static-forever-${region}&locale=en_US`;
      const index = await blizzardGet<{ categories: { id: number }[] }>(region, `/data/wow/achievement-category/index?${q}`);
      const categories = await pool(index.categories, (c) =>
        getOrNull<{ id: number; name: string; parent_category?: { name: string }; achievements?: { id: number }[] }>(region, `/data/wow/achievement-category/${c.id}?${q}`));
      const place = new Map<number, { category: string; subcategory: string | null }>();
      for (const c of categories) for (const a of c?.achievements ?? []) {
        place.set(a.id, c!.parent_category ? { category: c!.parent_category.name, subcategory: c!.name } : { category: c!.name, subcategory: null });
      }
      const details = await pool([...place.keys()], (id) => getOrNull<Achievement>(region, `/data/wow/achievement/${id}?${q}`));
      const byName = new Map<string, Entry>();
      for (const a of details.filter((a): a is Achievement => !!a && /legacy point/i.test(a.reward_description ?? "")).sort((x, y) => x.id - y.id)) {
        const seen = byName.get(a.name);
        if (seen) seen.ids.push(a.id);
        else byName.set(a.name, { name: a.name, description: a.description, ...place.get(a.id)!, ids: [a.id], criteria: a.criteria ?? null, icon: null });
      }
      const entries = [...byName.values()];
      await pool(entries, async (e) => {
        const media = await getOrNull<{ assets?: { value: string }[] }>(region, `/data/wow/media/achievement/${e.ids[0]}?${q}`).catch(() => null);
        e.icon = media?.assets?.[0]?.value ?? null;
      });
      return entries;
    })();
    catalogs.set(region, hit);
    hit.catch(() => catalogs.delete(region));
  }
  return hit;
}

interface CharacterAchievement {
  id: number;
  completed_timestamp?: number;
  criteria?: { id: number; amount?: number; is_completed?: boolean; child_criteria?: { id: number; amount?: number; is_completed?: boolean }[] };
}

export async function fetchForeverLegacy(region: string, name: string): Promise<ForeverLegacy> {
  const base = `/profile/wow/character/${encodeURIComponent(name.toLowerCase())}`;
  const profile = `namespace=profile-forever-${region}&locale=en_US`;
  const [entries, summary, achievements] = await Promise.all([
    catalog(region),
    blizzardGet<{ level: number; character_class: { name: string }; faction?: { type: string } }>(region, `${base}?${profile}`),
    blizzardGet<{ achievements?: CharacterAchievement[] }>(region, `${base}/achievements?${profile}`),
  ]);
  const mine = new Map((achievements.achievements ?? []).map((a) => [a.id, a]));

  const challenges = entries.map((e): LegacyChallenge => {
    const own = e.ids.map((id) => mine.get(id)).filter((a): a is CharacterAchievement => !!a);
    const done = own.find((a) => a.completed_timestamp);
    const tracked = new Map(own.flatMap((a) => [a.criteria, ...(a.criteria?.child_criteria ?? [])]).filter((c) => !!c).map((c) => [c!.id, c!]));
    // Faction-specific steps (the battleground reputations) only count for the character's side.
    const children = (e.criteria?.child_criteria ?? []).filter((c) => !c.faction || !summary.faction || c.faction.type === summary.faction.type);

    let progress: LegacyChallenge["progress"] = null;
    const level = /Reach level (\d+) for the first time on an? (.+)\./.exec(e.description);
    if (level) {
      // Class levels: show this character's progress when it's that class.
      if (level[2] === summary.character_class.name) progress = { kind: "bar", value: Math.min(summary.level, +level[1]), max: +level[1], label: `Level ${summary.level} ${level[2]}` };
    } else if (children.length === 1 && (children[0].amount ?? 0) > 1) {
      const c = children[0];
      progress = { kind: "bar", value: Math.min(tracked.get(c.id)?.amount ?? 0, c.amount!), max: c.amount!, label: c.description ?? "" };
    } else if (children.length > 1) {
      progress = { kind: "steps", steps: children.map((c) => ({ label: c.description ?? "", done: !!tracked.get(c.id)?.is_completed })) };
    }

    return {
      name: e.name,
      description: e.description,
      category: e.category,
      subcategory: e.subcategory,
      icon: e.icon,
      completedAt: done?.completed_timestamp ? new Date(done.completed_timestamp).toISOString() : null,
      progress,
    };
  }).sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  return {
    earned: challenges.filter((c) => c.completedAt).length,
    total: challenges.length,
    perCharacterCap: PER_CHARACTER_CAP,
    rewards: REWARDS,
    challenges,
  };
}
