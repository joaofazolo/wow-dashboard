// Every piece of WoW: Forever gear, with its stats, for the Upgrades view.
//
// Building the list takes thousands of calls: item search (static-forever) only gives ids per armor/weapon type and
// level, so each item's stats, its icon and the profession recipes that craft it are separate calls, at most 60 a second.
// Items only change with a patch, so `npm run items:update` builds the list once into data/forever-items.json, which
// the server loads at start. Without that file it builds the list live on first use (a few minutes).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ForeverItem, ItemStat } from "../types.js";
import { blizzardGet, blizzardGetOrNull } from "./blizzard.js";
import { pool } from "./http.js";
import { craftedGear } from "./foreverProfessions.js";

const staticQuery = (region: string) => `namespace=static-forever-${region}&locale=en_US`;

// Forever gear lists hit, crit and the like as ratings, shown in game as a percentage. Rating per 1%, checked against
// Wowhead's Forever tooltips (Lionheart Helm: 20 hit = 2.0%, 28 crit = 2.0%; Ornate Mithril Pants: 12 dodge = 1.0%;
// Dreadnaught Gauntlets: 15 block = 3.0%; Initiate's Signet of Vigilance: 10 expertise = 1.0%). These are TBC's
// level 60 ratios, so parry (15) and haste (10) assume the same; no item checked had them.
const PERCENT: Record<string, [ItemStat, number]> = {
  HIT_RATING: ["hit", 10],
  CRIT_RATING: ["crit", 14],
  DODGE_RATING: ["dodge", 12],
  PARRY_RATING: ["parry", 15],
  BLOCK_RATING: ["block", 5],
  EXPERTISE_RATING: ["exp", 10],
  HASTE_RATING: ["haste", 10],
};
const POINTS: Record<string, ItemStat> = {
  STRENGTH: "str", AGILITY: "agi", STAMINA: "sta", INTELLECT: "int", SPIRIT: "spi",
  ATTACK_POWER: "ap", RANGED_ATTACK_POWER: "rap", SPELL_POWER: "sp", SPELL_DAMAGE_DONE: "sp", SPELL_HEALING_DONE: "heal",
  MANA_REGENERATION: "mp5", HEALTH_REGEN: "hp5", DEFENSE_SKILL_RATING: "defense", BLOCK_VALUE: "blockValue", EXTRA_ARMOR: "bonusArmor",
};

type Named = { name: string };
const STANDINGS = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
/** The item fields shared by /data/wow/item's preview_item and a character's equipped_items. */
export interface PreviewItem {
  name: string;
  quality?: { type: string };
  inventory_type?: { type: string };
  item_class?: { id: number };
  item_subclass?: Named & { id?: number };
  level?: { value: number };
  armor?: { value: number };
  stats?: { type?: { type: string }; value: number; display?: { display_string: string } }[];
  spells?: { description?: string }[];
  weapon?: { damage?: { min_value: number; max_value: number }; attack_speed?: { value: number }; dps?: { value: number } };
  unique_equipped?: string;
  binding?: { type: string };
  requirements?: Record<string, { display_string?: string; links?: Named[]; value?: Named; faction?: Named; min_reputation_level?: number } | undefined>;
}

export function toForeverItem(id: number, p: PreviewItem): ForeverItem {
  const stats: ForeverItem["stats"] = {};
  const effects: string[] = [];
  const add = (key: ItemStat, v: number) => (stats[key] = +((stats[key] ?? 0) + v).toFixed(2));
  if (p.armor?.value) add("armor", p.armor.value);
  for (const s of p.stats ?? []) {
    const type = s.type?.type ?? "";
    if (PERCENT[type]) add(PERCENT[type][0], s.value / PERCENT[type][1]);
    else if (POINTS[type]) add(POINTS[type], s.value);
    else if (s.display?.display_string) effects.push(s.display.display_string); // resistances, weapon skill…
  }
  for (const sp of p.spells ?? []) if (sp.description) effects.push(sp.description);
  const { level, playable_classes, faction, reputation, ...other } = p.requirements ?? {};
  const w = p.weapon;
  return {
    id,
    name: p.name,
    quality: p.quality?.type ?? "COMMON",
    inventoryType: p.inventory_type?.type ?? "",
    subclass: p.item_subclass?.name ?? "",
    itemClass: p.item_class?.id ?? 0,
    subclassId: p.item_subclass?.id ?? 0,
    icon: null, // a separate call; see buildItemList
    reqLevel: (level as { value?: number } | undefined)?.value ?? 0,
    itemLevel: p.level?.value ?? 0,
    stats,
    weapon: w?.damage && w.attack_speed
      ? { min: w.damage.min_value, max: w.damage.max_value, speed: w.attack_speed.value / 1000, dps: +(w.dps?.value ?? 0).toFixed(1) }
      : null,
    unique: !!p.unique_equipped,
    classes: playable_classes?.links?.map((c) => c.name) ?? null,
    faction: faction?.value?.name ?? null,
    binding: p.binding?.type === "ON_EQUIP" ? "BOE" : p.binding?.type === "ON_ACQUIRE" ? "BOP" : null,
    reputation: reputation?.faction
      ? { faction: reputation.faction.name, standing: STANDINGS[reputation.min_reputation_level ?? 3] ?? "Neutral" }
      : null,
    crafted: null, // filled in per list, from the profession recipes
    requires: Object.values(other).flatMap((r) => (r?.display_string ? [r.display_string] : [])),
    effects,
  };
}

// What each class can wear (classic rules), by item subclass. Armor: 0 misc (rings, necks, trinkets, held in off-hand),
// 1 cloth (cloaks too), 2 leather, 3 mail, 4 plate, 6 shield, 7 libram, 8 idol, 9 totem. Weapons: 0/1 axes, 2 bows,
// 3 guns, 4/5 maces, 6 polearms, 7/8 swords, 10 staves, 13 fist, 15 daggers, 16 thrown, 18 crossbows, 19 wands.
const GEAR: Record<string, { armor: number[]; weapons: number[] }> = {
  Warrior: { armor: [0, 1, 2, 3, 4, 6], weapons: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18] },
  Paladin: { armor: [0, 1, 2, 3, 4, 6, 7], weapons: [0, 1, 4, 5, 6, 7, 8] },
  Hunter: { armor: [0, 1, 2, 3], weapons: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18] },
  Rogue: { armor: [0, 1, 2], weapons: [2, 3, 4, 7, 13, 15, 16, 18] },
  Priest: { armor: [0, 1], weapons: [4, 10, 15, 19] },
  Shaman: { armor: [0, 1, 2, 3, 6, 9], weapons: [0, 1, 4, 5, 10, 13, 15] },
  Mage: { armor: [0, 1], weapons: [7, 10, 15, 19] },
  Warlock: { armor: [0, 1], weapons: [7, 10, 15, 19] },
  Druid: { armor: [0, 1, 2, 8], weapons: [4, 5, 10, 13, 15] },
};
export const gearClasses = Object.keys(GEAR);
const ARMOR = [...new Set(Object.values(GEAR).flatMap((g) => g.armor))];
const WEAPONS = [...new Set(Object.values(GEAR).flatMap((g) => g.weapons))];

const SKIPPED_SLOTS = new Set(["BODY", "TABARD", "NON_EQUIP", "BAG", "QUIVER", "AMMO"]);
// Developer items left in the data ("Test Random Chest", +100 Strength) and unused placeholders.
const JUNK = /\btest\b|^monster - |^deprecated|^\[ph\]|^old /i;

interface SearchHit { id: number; quality: { type: string }; inventory_type: { type: string }; item_class: { id: number }; item_subclass: { id: number } }
interface SearchPage { pageCount: number; resultCountCapped?: boolean; results: { data: SearchHit }[] }

/** One armor or weapon type's items between two required levels. Search stops at 1,000 results, so a full range is halved until it fits. */
async function search(region: string, filter: string, from: number, to: number): Promise<SearchHit[]> {
  const page = await blizzardGet<SearchPage>(region,
    `/data/wow/search/item?${staticQuery(region)}&${filter}&required_level=[${from},${to}]&_pageSize=1000`);
  if (page.resultCountCapped && from < to) {
    const mid = Math.floor((from + to) / 2);
    return [...(await search(region, filter, from, mid)), ...(await search(region, filter, mid + 1, to))];
  }
  if (page.resultCountCapped) console.warn(`Forever item search capped at level ${from} for ${filter}; some items are missing`);
  return page.results.map((r) => r.data);
}

// While building, item details and icons are kept on disk, so a build that fails partway resumes where it stopped.
// Bump VERSION when ForeverItem's stored fields change, so details saved by an older build are fetched again.
const VERSION = 2;
type Saved<T> = { version: number; savedAt: number; items: Record<number, T> };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const cacheFile = (name: string) => join(tmpdir(), "wow-dashboard", name);

async function readSaved<T>(name: string): Promise<Saved<T>> {
  const fresh = { version: VERSION, savedAt: Date.now(), items: {} };
  try {
    const saved = JSON.parse(await readFile(cacheFile(name), "utf8")) as Saved<T>;
    return saved.version === VERSION && Date.now() - saved.savedAt < WEEK_MS ? saved : fresh;
  } catch {
    return fresh;
  }
}

async function writeSaved(name: string, saved: Saved<unknown>) {
  try {
    await mkdir(join(tmpdir(), "wow-dashboard"), { recursive: true });
    await writeFile(cacheFile(name), JSON.stringify(saved));
  } catch (err) {
    console.warn(`Couldn't save ${name}: ${err}`); // only a cache
  }
}

/** Fetches what `saved` lacks for `ids`; a failed call leaves the id out, so the next build tries it again. */
async function fill<T>(region: string, name: string, saved: Saved<T>, ids: number[], load: (id: number) => Promise<T>): Promise<boolean> {
  const missing = ids.filter((id) => !(id in saved.items));
  if (!missing.length) return true;
  const got = await pool(missing, (id) => load(id).catch((): undefined => undefined));
  missing.forEach((id, i) => got[i] !== undefined && (saved.items[id] = got[i]));
  await writeSaved(`${name}-${region}.json`, saved);
  return !got.includes(undefined);
}

export interface ItemList { generatedAt: string; region: string; items: ForeverItem[] }

/** Builds the full list from the API. `complete` is false when some calls failed; building again fills the gaps. */
export async function buildItemList(region: string, log: (msg: string) => void = () => {}): Promise<ItemList & { complete: boolean }> {
  const filters = [...ARMOR.map((s) => `item_class.id=4&item_subclass.id=${s}`), ...WEAPONS.map((s) => `item_class.id=2&item_subclass.id=${s}`)];
  log(`Searching ${filters.length} armor and weapon types…`);
  const hits = (await pool(filters, (f) => search(region, f, 0, 60), 4)).flat()
    .filter((h) => h.quality.type !== "POOR" && !SKIPPED_SLOTS.has(h.inventory_type.type))
    .sort((a, b) => a.id - b.id);

  const details = await readSaved<ForeverItem | null>(`forever-items-${region}.json`);
  log(`${hits.length} items, ${hits.filter((h) => !(h.id in details.items)).length} to fetch…`);
  const detailsDone = await fill(region, "forever-items", details, hits.map((h) => h.id), (id) =>
    blizzardGetOrNull<{ preview_item?: PreviewItem }>(region, `/data/wow/item/${id}?${staticQuery(region)}`)
      .then((doc) => (doc?.preview_item ? toForeverItem(id, doc.preview_item) : null)));

  log("Crafted gear from the profession recipes…");
  const crafted = await craftedGear(region);

  // Some items exist twice under different ids with the same name and stats; the older id is the one Wowhead knows.
  const seen = new Set<string>();
  const items = hits.flatMap((h) => {
    const item = details.items[h.id];
    if (!item || JUNK.test(item.name)) return [];
    const same = JSON.stringify([item.name, item.stats, item.weapon]);
    if (seen.has(same)) return [];
    seen.add(same);
    return [{ ...item, itemClass: h.item_class.id, subclassId: h.item_subclass.id, crafted: crafted.items.get(item.id) ?? null }];
  });

  const icons = await readSaved<string | null>(`forever-icons-${region}.json`);
  log(`Icons, ${items.filter((i) => !(i.id in icons.items)).length} to fetch…`);
  const iconsDone = await fill(region, "forever-icons", icons, items.map((i) => i.id), (id) =>
    blizzardGetOrNull<{ assets?: { key: string; value: string }[] }>(region, `/data/wow/media/item/${id}?${staticQuery(region)}`)
      .then((m) => m?.assets?.find((a) => a.key === "icon")?.value ?? null));

  return {
    generatedAt: new Date().toISOString(),
    region,
    items: items.map((i) => ({ ...i, icon: icons.items[i.id] ?? null })),
    complete: detailsDone && iconsDone && crafted.complete,
  };
}

export const BUNDLED_ITEMS = fileURLToPath(new URL("../../data/forever-items.json", import.meta.url));

/** One item per line, so an update's diff shows which items changed. */
export const itemListJson = (list: ItemList) =>
  `{"generatedAt":${JSON.stringify(list.generatedAt)},"region":${JSON.stringify(list.region)},"items":[\n${list.items.map((i) => JSON.stringify(i)).join(",\n")}\n]}\n`;

// The bundled list serves every region: items are the same everywhere (US and EU differed in 8 of 5,464 when checked).
let bundled: Promise<ForeverItem[] | null> | null = null;
const live = new Map<string, Promise<ForeverItem[]>>();

function allItems(region: string): Promise<ForeverItem[]> {
  bundled ??= readFile(BUNDLED_ITEMS, "utf8").then((t) => (JSON.parse(t) as ItemList).items, () => null);
  return bundled.then((items) => {
    if (items) return items;
    let hit = live.get(region);
    if (!hit) {
      console.warn("data/forever-items.json is missing (run npm run items:update); building the item list live");
      hit = buildItemList(region).then((list) => {
        if (!list.complete) live.delete(region); // keep what loaded for now, try the rest next time
        return list.items;
      });
      live.set(region, hit);
      hit.catch(() => live.delete(region));
    }
    return hit;
  });
}

/** All gear `className` can wear (quality common and up), with stats. */
export async function fetchForeverItems(region: string, className: string): Promise<ForeverItem[]> {
  const gear = GEAR[className];
  if (!gear) throw new Error(`Unknown class ${className}`);
  return (await allItems(region)).filter((i) =>
    (i.itemClass === 4 ? gear.armor : gear.weapons).includes(i.subclassId) && (!i.classes || i.classes.includes(className)));
}
