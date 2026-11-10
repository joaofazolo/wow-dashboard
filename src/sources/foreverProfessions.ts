// A WoW: Forever character's professions: skill, the recipes it knows and the ones it's missing (with how to learn them).
// Recipes and items are static, so they're cached for the life of the server.
import type { ForeverProfessions, ProfessionProgress, ProfessionRecipe } from "../types.js";
import { blizzardGet, blizzardGetOrNull as fetchOrNull } from "./blizzard.js";
import { pool } from "./http.js";

// The item subclass of each profession's recipe items (item class 9), and the prefix they carry ("Plans: Green Iron Boots").
const RECIPE_ITEMS: Record<string, { subclass: number; prefix: string }> = {
  Leatherworking: { subclass: 1, prefix: "Pattern: " },
  Tailoring: { subclass: 2, prefix: "Pattern: " },
  Engineering: { subclass: 3, prefix: "Schematic: " },
  Blacksmithing: { subclass: 4, prefix: "Plans: " },
  Cooking: { subclass: 5, prefix: "Recipe: " },
  Alchemy: { subclass: 6, prefix: "Recipe: " },
  "First Aid": { subclass: 7, prefix: "Manual: " },
  Enchanting: { subclass: 8, prefix: "Formula: " },
};

/** Caches a promise per key; failures are dropped so the next request retries. */
function memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

const staticQuery = (region: string) => `namespace=static-forever-${region}&locale=en_US`;

interface Recipe {
  id: number;
  name: string;
  crafted_item?: { id: number; name: string };
  reagents?: { reagent: { id: number; name: string }; quantity: number }[];
  crafted_quantity?: { value?: number; minimum?: number };
}

const tierCache = new Map<string, Promise<{ id: number; name: string; category: string }[]>>();
const recipeCache = new Map<string, Promise<Recipe | null>>();
const itemCache = new Map<string, Promise<{ preview_item?: { requirements?: { skill?: { level: number } } } } | null>>();
const recipeItemCache = new Map<string, Promise<Map<string, number>>>();

/** Every recipe of a profession tier, with the category it's listed under. */
function tierRecipes(region: string, professionId: number, tierId: number) {
  return memo(tierCache, `${region}/${professionId}/${tierId}`, async () => {
    const tier = await blizzardGet<{ categories?: { name: string; recipes: { id: number; name: string }[] }[] }>(
      region, `/data/wow/profession/${professionId}/skill-tier/${tierId}?${staticQuery(region)}`);
    return (tier.categories ?? []).flatMap((c) => c.recipes.map((r) => ({ id: r.id, name: r.name, category: c.name })));
  });
}

const recipe = (region: string, id: number) => memo(recipeCache, `${region}/${id}`, () => fetchOrNull<Recipe>(region, `/data/wow/recipe/${id}?${staticQuery(region)}`));
const item = (region: string, id: number) => memo(itemCache, `${region}/${id}`, () => fetchOrNull(region, `/data/wow/item/${id}?${staticQuery(region)}`));

/** Recipe items of one profession by the recipe they teach ("Green Iron Boots" → id of "Plans: Green Iron Boots"). */
function recipeItems(region: string, profession: string) {
  const kind = RECIPE_ITEMS[profession];
  return memo(recipeItemCache, `${region}/${profession}`, async () => {
    const byRecipe = new Map<string, number>();
    if (!kind) return byRecipe;
    for (let page = 1; ; page++) {
      const res = await blizzardGet<{ pageCount: number; results: { data: { id: number; name: { en_US?: string } } }[] }>(region,
        `/data/wow/search/item?${staticQuery(region)}&item_class.id=9&item_subclass.id=${kind.subclass}&_pageSize=1000&_page=${page}`);
      for (const { data } of res.results) {
        const name = data.name.en_US ?? "";
        if (name.startsWith(kind.prefix)) byRecipe.set(name.slice(kind.prefix.length).toLowerCase(), data.id);
      }
      if (page >= res.pageCount) break;
    }
    return byRecipe;
  });
}

interface ProfileProfessions {
  primaries?: ProfileProfession[];
  secondaries?: ProfileProfession[];
}
interface ProfileProfession {
  profession: { id: number; name: string };
  tiers?: { tier: { id: number }; skill_points: number; max_skill_points: number; known_recipes?: { id: number }[] }[];
}

export async function fetchForeverProfessions(region: string, name: string): Promise<ForeverProfessions> {
  const professions = await blizzardGet<ProfileProfessions>(region,
    `/profile/wow/character/${encodeURIComponent(name.toLowerCase())}/professions?namespace=profile-forever-${region}&locale=en_US`);

  const all = [...(professions.primaries ?? []).map((p) => ({ p, secondary: false })), ...(professions.secondaries ?? []).map((p) => ({ p, secondary: true }))];
  const out = await Promise.all(all.map(async ({ p, secondary }): Promise<ProfessionProgress> => {
    const tier = p.tiers?.[0]; // classic professions have one tier
    const empty = { name: p.profession.name, skill: tier?.skill_points ?? 0, max: tier?.max_skill_points ?? 0, secondary, known: [], missing: [] };
    if (!tier) return empty;
    const knownIds = new Set((tier.known_recipes ?? []).map((r) => r.id));
    const [list, teachers] = await Promise.all([tierRecipes(region, p.profession.id, tier.tier.id), recipeItems(region, p.profession.name)]);
    const details = await pool(list, (r) => recipe(region, r.id).catch(() => null));

    const toRecipe = (r: { id: number; name: string; category: string }, d: Recipe | null): ProfessionRecipe => ({
      id: r.id,
      name: d?.name ?? r.name,
      category: r.category,
      crafted: d?.crafted_item
        ? { id: d.crafted_item.id, name: d.crafted_item.name, quantity: d.crafted_quantity?.value ?? d.crafted_quantity?.minimum ?? 1 }
        : null,
      reagents: (d?.reagents ?? []).map((x) => ({ id: x.reagent.id, name: x.reagent.name, quantity: x.quantity })),
      learnFrom: null,
    });

    const rows = list.map((r, i) => ({ r, d: details[i] }));
    const known = rows.filter(({ r }) => knownIds.has(r.id)).map(({ r, d }) => toRecipe(r, d));
    const missing = await pool(rows.filter(({ r }) => !knownIds.has(r.id)), async ({ r, d }) => {
      const out = toRecipe(r, d);
      const teacherId = teachers.get(r.name.toLowerCase());
      if (teacherId) {
        const doc = await item(region, teacherId).catch(() => null);
        out.learnFrom = { itemId: teacherId, name: `${RECIPE_ITEMS[p.profession.name].prefix}${r.name}`, skill: doc?.preview_item?.requirements?.skill?.level ?? null };
      }
      return out;
    });

    // Missing recipes by the skill they need, lowest first; ones the API has no skill for go last.
    const need = (r: ProfessionRecipe) => r.learnFrom?.skill ?? Infinity;
    return { ...empty, known, missing: missing.sort((a, b) => need(a) - need(b)) };
  }));

  return { professions: out };
}
