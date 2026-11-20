// Upgrades view, laid out like the Forever Leveling BiS addon: a slot list on the left with each slot's best item, and
// for the chosen slot what you wear plus the best items grouped by where they come from. Items are scored with the
// viewer's stat weights. Weights, caps and filters are kept per character in browser storage.
import type { ForeverCharacter, ForeverItem, ItemStat, SourceResult } from "../types.js";
import { NO_CAPS, PRESETS, SETUPS, WEIGHT_LABELS, type Caps, type Setup, type WeightKey, type Weights } from "../upgradeWeights.js";

const WOWHEAD_ITEM = (id: number) => `https://www.wowhead.com/forever/item=${id}`;
const MAX_LEVEL = 60;
const QUALITIES = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
const QUALITY_CLASS: Record<string, string> = { COMMON: "q-common", UNCOMMON: "q-uncommon", RARE: "q-rare", EPIC: "q-epic", LEGENDARY: "q-legendary" };
const LOOK_AHEAD = [0, 1, 2, 3, 5, 10];

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One character's inputs. `extra` is hit, expertise and defense from talents and buffs, which gear totals don't show. */
interface Settings {
  preset: string; // a preset id, or "custom" once a weight is edited
  weights: Weights;
  caps: Caps;
  setup: Setup;
  extra: { hit: number; exp: number; defense: number };
  maxQuality: string;
  lookAhead: number;
  hidden: number[];
}

const STORAGE_KEY = "wow-dashboard:upgrades";

function readAll(): Record<string, Settings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
const all = readAll();
const save = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the view still works for this visit
  }
};

function defaults(className: string | null): Settings {
  const preset = PRESETS[className ?? ""]?.[0];
  return {
    preset: preset?.id ?? "custom",
    weights: { ...preset?.weights },
    caps: { ...(preset?.caps ?? NO_CAPS) },
    setup: preset?.setup ?? "shield",
    extra: { hit: 0, exp: 0, defense: 0 },
    maxQuality: "EPIC",
    lookAhead: 0,
    hidden: [],
  };
}

/** Who's looking: the class picks the item list and presets, the gear is what upgrades are measured against. */
export interface UpgradesContext {
  key: string;
  region: string;
  className: string | null;
  level: number;
  gear: ForeverCharacter["gear"];
}
let ctx: UpgradesContext = { key: "", region: "us", className: null, level: 1, gear: null };
// Settings saved before a field existed get its default.
const settings = () => (all[ctx.key] = { ...defaults(ctx.className), ...all[ctx.key] });

// Per-visit choices: the level being looked at (not saved, so it follows the character up), the slot and pane shown.
const levels = new Map<string, number>();
let pane: "bis" | "gear" | "weights" = "bis";
let selectedSlot = "HEAD";
const collapsed = new Set<string>();
let importMessage = "";

const itemLists = new Map<string, ForeverItem[]>();
let itemsState: "loading" | "ready" | string = "loading"; // anything else is an error message
const listKey = () => `${ctx.region}/${ctx.className}`;
const viewLevel = () => levels.get(ctx.key) ?? ctx.level;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** The level an item is for. Many dungeon and raid drops have no requirement; classic's is usually item level − 5. */
const levelOf = (i: ForeverItem) => i.reqLevel || clamp(i.itemLevel - 5, 1, MAX_LEVEL);

// Scoring. Most stats are worth their weight per point. Hit, expertise and defense have caps, so they're scored on the
// whole set's total: an item's score is what it adds to the rest of the set.
interface Totals { hit: number; exp: number; defense: number }
const RANGED = new Set(["RANGED", "RANGEDRIGHT", "THROWN"]);
const CAPPED = new Set<ItemStat>(["hit", "exp", "defense"]);

function linear(item: ForeverItem, w: Weights, offHand: boolean): number {
  let s = 0;
  for (const [k, v] of Object.entries(item.stats) as [ItemStat, number][]) if (!CAPPED.has(k)) s += (w[k as WeightKey] ?? 0) * v;
  // An off-hand weapon only swings for half damage (classic dual-wield penalty); ranged DPS doesn't help in melee.
  if (item.weapon && !RANGED.has(item.inventoryType)) s += (w.dps ?? 0) * item.weapon.dps * (offHand ? 0.5 : 1);
  return s;
}

function capped(t: Totals, w: Weights, c: Caps): number {
  return (w.hit ?? 0) * clamp(t.hit, 0, c.hit)
    + (w.exp ?? 0) * clamp(t.exp, 0, c.expSoft) + (w.expSoft ?? 0) * clamp(t.exp - c.expSoft, 0, c.expHard - c.expSoft)
    + (w.defense ?? 0) * clamp(t.defense, 0, c.defense) + (w.defenseCapped ?? 0) * Math.max(0, t.defense - c.defense);
}

const add = (t: Totals, items: (ForeverItem | null)[], sign = 1): Totals =>
  items.reduce((acc, i) => ({
    hit: acc.hit + sign * (i?.stats.hit ?? 0), exp: acc.exp + sign * (i?.stats.exp ?? 0), defense: acc.defense + sign * (i?.stats.defense ?? 0),
  }), t);

// Slots as Blizzard's equipment names them, and the inventory types that fit. Rings and trinkets come in pairs.
interface Slot { type: string; name: string; fits: (s: Setup) => string[]; pair?: string; offHand?: boolean }
const SLOTS: Slot[] = [
  { type: "HEAD", name: "Head", fits: () => ["HEAD"] },
  { type: "NECK", name: "Neck", fits: () => ["NECK"] },
  { type: "SHOULDER", name: "Shoulder", fits: () => ["SHOULDER"] },
  { type: "BACK", name: "Back", fits: () => ["CLOAK"] },
  { type: "CHEST", name: "Chest", fits: () => ["CHEST", "ROBE"] },
  { type: "WRIST", name: "Wrist", fits: () => ["WRIST"] },
  { type: "HANDS", name: "Hands", fits: () => ["HAND"] },
  { type: "WAIST", name: "Waist", fits: () => ["WAIST"] },
  { type: "LEGS", name: "Legs", fits: () => ["LEGS"] },
  { type: "FEET", name: "Feet", fits: () => ["FEET"] },
  { type: "FINGER_1", name: "Finger 1", fits: () => ["FINGER"], pair: "FINGER_2" },
  { type: "FINGER_2", name: "Finger 2", fits: () => ["FINGER"], pair: "FINGER_1" },
  { type: "TRINKET_1", name: "Trinket 1", fits: () => ["TRINKET"], pair: "TRINKET_2" },
  { type: "TRINKET_2", name: "Trinket 2", fits: () => ["TRINKET"], pair: "TRINKET_1" },
  { type: "MAIN_HAND", name: "Main Hand", fits: (s) => SETUPS[s].mainHand },
  { type: "OFF_HAND", name: "Off Hand", fits: (s) => SETUPS[s].offHand, offHand: true },
  { type: "RANGED", name: "Ranged", fits: () => [...RANGED] },
];

/** Where an item comes from, as far as Blizzard's data tells: a profession, a reputation vendor, or how it binds. */
const GROUPS = ["Drops & quests", "Crafted", "BoE", "Reputation"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_COLOR: Record<Group, string> = { "Drops & quests": "#e8b83a", Crafted: "#3fb950", BoE: "#58a6ff", Reputation: "#f0883e" };
function groupOf(i: ForeverItem): Group {
  if (i.crafted) return "Crafted";
  if (i.reputation) return "Reputation";
  return i.binding === "BOE" ? "BoE" : "Drops & quests";
}
const STANDING_COLOR: Record<string, string> = { Friendly: "#3fb950", Honored: "#3fb950", Revered: "#f85149", Exalted: "#a371f7" };
function sourceText(i: ForeverItem): string {
  if (i.crafted) return `${esc(i.crafted.profession)} ${i.crafted.skill ?? "(trainer)"}`;
  if (i.reputation) return `${esc(i.reputation.faction)} (<span style="color:${STANDING_COLOR[i.reputation.standing] ?? "inherit"}">${esc(i.reputation.standing)}</span>)`;
  return i.binding === "BOE" ? "Drop or auction house" : "Drop or quest reward";
}

interface Scored { item: ForeverItem; score: number; gain: number }
interface SlotResult { slot: Slot; worn: ForeverItem | null; wornName: string; wornScore: number; fromList: boolean; best: Scored | null; candidates: Scored[] }

function wornItems(byId: Map<number, ForeverItem>) {
  const out = new Map<string, { item: ForeverItem | null; name: string; fromList: boolean }>();
  for (const g of ctx.gear ?? []) {
    // The equipment call has the worn item's own stats (random suffix included); crafted info and icon are only in the list.
    const listed = byId.get(g.id);
    const item = g.item ? { ...g.item, crafted: listed?.crafted ?? null, icon: listed?.icon ?? null } : listed ?? null;
    out.set(g.slotType, { item, name: g.name, fromList: !g.item && !!item });
  }
  return out;
}

/** Every slot scored: what's worn, and each usable item's score and gain over it. */
function score(items: ForeverItem[]): SlotResult[] {
  const s = settings();
  const maxLevel = viewLevel() + s.lookAhead;
  const byId = new Map(items.map((i) => [i.id, i]));
  const worn = wornItems(byId);
  const totals = add({ ...s.extra }, [...worn.values()].map((w) => w.item));
  const hidden = new Set(s.hidden);
  const maxQ = QUALITIES.indexOf(s.maxQuality);

  return SLOTS.flatMap((slot): SlotResult[] => {
    const fits = new Set(slot.fits(s.setup));
    if (!fits.size) return [];
    const w = worn.get(slot.type);
    const partner = slot.pair ? worn.get(slot.pair)?.item : null;

    // An item's score is what it adds to the rest of the set; a two-hander replaces the off hand too.
    const place = (item: ForeverItem): Scored => {
      const out = [w?.item ?? null];
      if (item.inventoryType === "TWOHWEAPON") out.push(worn.get("OFF_HAND")?.item ?? null);
      const rest = add(totals, out, -1);
      const outScore = out.reduce((sum, o) => sum + (o ? linear(o, s.weights, !!slot.offHand) : 0), 0)
        + capped(totals, s.weights, s.caps) - capped(rest, s.weights, s.caps);
      const sc = linear(item, s.weights, !!slot.offHand) + capped(add(rest, [item]), s.weights, s.caps) - capped(rest, s.weights, s.caps);
      return { item, score: sc, gain: sc - outScore };
    };
    const wornScore = w?.item ? place(w.item).score : 0;
    const candidates = items
      .filter((i) => fits.has(i.inventoryType) && i.id !== w?.item?.id && !hidden.has(i.id) && !(i.unique && i.id === partner?.id)
        && QUALITIES.includes(i.quality) && QUALITIES.indexOf(i.quality) <= maxQ && levelOf(i) <= maxLevel)
      .map(place)
      .sort((a, b) => b.score - a.score);
    const top = candidates[0];
    return [{ slot, worn: w?.item ?? null, wornName: w?.name ?? "", wornScore, fromList: !!w?.fromList, best: top && top.gain > 0.05 ? top : null, candidates }];
  });
}

const icon = (i: ForeverItem | null | undefined) =>
  i?.icon ? `<img class="bis-icon" src="${esc(i.icon)}" alt="" loading="lazy" />` : `<span class="bis-icon blank"></span>`;

const itemName = (i: ForeverItem) =>
  `<a href="${WOWHEAD_ITEM(i.id)}" target="_blank" rel="noopener" class="${QUALITY_CLASS[i.quality] ?? ""}">${esc(i.name)}</a>`;
const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
const gainBadge = (g: number) => `<span class="bis-gain ${g > 0.05 ? "up" : "down"}">${g > 0 ? "+" : ""}${fmt(g)}</span>`;

const STAT_SHORT: Record<ItemStat, string> = {
  str: "Str", agi: "Agi", sta: "Sta", int: "Int", spi: "Spi", ap: "AP", rap: "RAP", sp: "SP", heal: "Healing", mp5: "MP5", hp5: "HP5",
  crit: "Crit", hit: "Hit", exp: "Expertise", haste: "Haste", dodge: "Dodge", parry: "Parry", block: "Block",
  defense: "Defense", blockValue: "Block Value", armor: "Armor", bonusArmor: "Bonus Armor",
};
const PERCENT = new Set<ItemStat>(["crit", "hit", "exp", "haste", "dodge", "parry", "block"]);

function statLine(i: ForeverItem): string {
  const parts = (Object.keys(STAT_SHORT) as ItemStat[]).filter((k) => i.stats[k] && k !== "armor")
    .map((k) => `+${i.stats[k]}${PERCENT.has(k) ? "%" : ""} ${STAT_SHORT[k]}`);
  if (i.weapon) parts.unshift(`${i.weapon.dps} DPS`);
  return parts.join(", ");
}

function itemDetails(i: ForeverItem): string {
  const stats = statLine(i);
  const notes = [...i.requires, ...i.effects];
  const level = i.reqLevel ? `level ${i.reqLevel}` : `<span title="No level requirement; item level ${i.itemLevel}">~level ${levelOf(i)}</span>`;
  return `${esc(i.subclass)} · ${level}${stats ? ` · ${esc(stats)}` : ""}`
    + (notes.length ? ` · <span class="warn" title="${esc(notes.join("\n"))}">${i.effects.length ? "effects not scored" : "requirements"}</span>` : "");
}

function itemRow(rank: number | null, i: ForeverItem, score: number, gain: number | null): string {
  return `<div class="bis-row">
    <span class="bis-rank">${rank ?? ""}</span>${icon(i)}
    <span class="bis-name">${itemName(i)}<span class="bis-sub">${itemDetails(i)}</span></span>
    <span class="bis-source">${sourceText(i)}</span>
    <span class="bis-num">${gain == null ? "" : gainBadge(gain)}</span>
    <span class="bis-num">${fmt(score)}</span>
    ${rank != null ? `<button type="button" class="bis-hide" data-upgrade-hide="${i.id}" title="Hide this item (can't get it, won't use it)" aria-label="Hide ${esc(i.name)}">×</button>` : `<span></span>`}
  </div>`;
}

function slotList(rows: SlotResult[]): string {
  return `<nav class="bis-slots" aria-label="Slots">${rows.map((r) => {
    const best = r.best?.item ?? r.worn;
    const wearingBest = r.worn && !r.best;
    return `<button type="button" data-upgrade-slot="${r.slot.type}" aria-pressed="${pane === "bis" && r.slot.type === selectedSlot}">
      ${icon(best)}<span class="bis-slot-name">${r.slot.name}</span>
      <span class="bis-slot-item ${best ? QUALITY_CLASS[best.quality] ?? "" : "muted"}">${wearingBest ? `<span class="up" title="You're wearing the best">✓</span> ` : ""}${best ? esc(best.name) : "—"}</span>
    </button>`;
  }).join("")}</nav>`;
}

function slotDetail(r: SlotResult): string {
  const s = settings();
  const equipped = r.worn
    ? itemRow(null, r.worn, r.wornScore, null)
    : `<div class="bis-row"><span class="bis-rank"></span>${icon(null)}<span class="bis-name muted">${r.wornName ? esc(r.wornName) : "empty"}</span></div>`;
  const groups = GROUPS.map((g) => {
    const list = r.candidates.filter((c) => groupOf(c.item) === g);
    if (!list.length) return "";
    const open = !collapsed.has(g);
    return `<div class="bis-group">
      <h4 style="--group:${GROUP_COLOR[g]}"><span>${g}</span> <span class="muted">${list.length > 4 ? `top 4 of ${list.length}` : list.length} usable</span>
        <button type="button" class="bis-toggle" data-upgrade-group="${g}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${g}">${open ? "−" : "+"}</button></h4>
      ${open ? list.slice(0, 4).map((c, i) => itemRow(i + 1, c.item, c.score, c.gain)).join("") : ""}
    </div>`;
  }).join("");
  return `<div class="bis-detail">
    <div class="bis-group"><h4 style="--group:var(--muted)"><span>Equipped</span></h4>${equipped}
      ${r.fromList ? `<p class="bis-note">The API left this item's stats out, so its base stats are used: a random suffix isn't counted.</p>` : ""}</div>
    ${groups || `<p class="notice">Nothing fits this slot up to level ${viewLevel() + s.lookAhead} with these filters.</p>`}
  </div>`;
}

const BRACKETS = [
  { min: 0.999, label: "BiS", color: "#ff8000" },
  { min: 0.85, label: "85%+", color: "#a335ee" },
  { min: 0.5, label: "50%+", color: "#0070dd" },
];
const bracket = (ratio: number) => BRACKETS.find((b) => ratio >= b.min)?.color ?? "var(--border)";

function myGear(rows: SlotResult[]): string {
  const bestOf = (r: SlotResult) => Math.max(r.wornScore, r.best?.score ?? 0);
  const total = rows.reduce((sum, r) => sum + r.wornScore, 0);
  const best = rows.reduce((sum, r) => sum + bestOf(r), 0);
  const pct = best > 0 ? Math.max(0, total / best) : 1;
  return `<div class="bis-detail">
    <div class="bis-progress"><span class="bis-bar"><span style="width:${(pct * 100).toFixed(0)}%"></span></span>
      <strong>${(pct * 100).toFixed(0)}%</strong> <span class="muted">of best in slot at level ${viewLevel() + settings().lookAhead}</span>
      <span class="bis-legend">${BRACKETS.map((b) => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join("")}</span></div>
    ${rows.map((r) => {
      const ratio = bestOf(r) > 0 ? Math.max(0, r.wornScore / bestOf(r)) : r.worn ? 1 : 0;
      return `<div class="bis-row gear" style="--bracket:${r.worn ? bracket(ratio) : "transparent"}">
        <span class="bis-slot-name">${r.slot.name}</span>${icon(r.worn)}
        <span class="bis-name">${r.worn ? itemName(r.worn) : `<span class="muted">${r.wornName ? esc(r.wornName) : "empty"}</span>`}</span>
        <span class="bis-num muted" title="Share of the best item's score for this slot">${r.worn ? `${(ratio * 100).toFixed(0)}%` : ""}</span>
        <span class="bis-num">${r.worn ? fmt(r.wornScore) : ""}</span>
      </div>`;
    }).join("")}
  </div>`;
}

function weightsPane(): string {
  const s = settings();
  const presets = PRESETS[ctx.className ?? ""] ?? [];
  const preset = presets.find((p) => p.id === s.preset);
  const field = (attr: string, value: number, label: string) =>
    `<label><span>${label}</span><input type="number" step="any" ${attr} value="${value}" /></label>`;
  return `<div class="bis-detail bis-weights">
    <p class="bis-weights-head"><span class="bis-class">${esc(ctx.className)}</span> ${esc(preset?.name ?? "Custom")} <span class="muted">· ${SETUPS[s.setup].name}</span></p>
    <p class="muted small">What one point of each stat is worth (one 1% for percentage stats), with 1 Attack Power = 1. ${presets.length
      ? `The presets come from <a href="https://www.wowhead.com/forever/guide/classes/warrior/protection/stat-priority-pve-tank" target="_blank" rel="noopener">Wowhead's Protection Warrior stat guide</a>.`
      : `There's no preset for ${esc(ctx.className)} yet: type weights or import them below.`} Editing a weight makes it a custom profile for this character.</p>
    <div class="bis-weight-grid">${WEIGHT_LABELS.map(([k, label]) => field(`data-upgrade-weight="${k}"`, s.weights[k] ?? 0, label)).join("")}</div>
    <h4>Caps</h4>
    <p class="muted small">Past these, hit and expertise stop counting and defense counts at its "over cap" weight. Defense is your bonus over the base 5 per level.</p>
    <div class="bis-weight-grid">
      ${field(`data-upgrade-cap="hit"`, s.caps.hit, "Hit cap %")}
      ${field(`data-upgrade-cap="expSoft"`, s.caps.expSoft, "Expertise soft cap %")}
      ${field(`data-upgrade-cap="expHard"`, s.caps.expHard, "Expertise hard cap %")}
      ${field(`data-upgrade-cap="defense"`, s.caps.defense, "Defense cap (bonus)")}
    </div>
    <h4>From talents and buffs</h4>
    <p class="muted small">Gear totals don't include these, e.g. Anticipation's defense or Precision's hit.</p>
    <div class="bis-weight-grid">
      ${field(`data-upgrade-extra="hit"`, s.extra.hit, "Hit %")}
      ${field(`data-upgrade-extra="exp"`, s.extra.exp, "Expertise %")}
      ${field(`data-upgrade-extra="defense"`, s.extra.defense, "Defense")}
    </div>
    <h4>Import</h4>
    <p class="muted small">Paste a stat weight export from the Forever Leveling BiS addon (Stat weights › Export; it starts with <code>FLB1:</code>) or a Pawn string.</p>
    <textarea class="bis-import" rows="3" spellcheck="false" placeholder="FLB1:WARRIOR,protection,shield;60;str=2.5,agi=2.1,…"></textarea>
    <div class="bis-buttons">
      <button type="button" data-upgrade-import>Import</button>
      ${presets.length ? `<button type="button" data-upgrade-reset>Reset to ${esc((preset ?? presets[0]).name)}</button>` : ""}
      ${importMessage ? `<span class="small ${importMessage.startsWith("Imported") ? "up" : "warn"}">${esc(importMessage)}</span>` : ""}
    </div>
  </div>`;
}

// The addon's export ("FLB1:CLASS,spec,setup;level;key=value,…;profile") and Pawn's ("( Pawn: v1: "Name": Strength=2.5, … )").
// Keys the view has no stat for (ratings, school spell power, weapon speed) are skipped.
const FLB_KEYS: Record<string, WeightKey[]> = {
  str: ["str"], agi: ["agi"], sta: ["sta"], int: ["int"], spi: ["spi"], atkpwr: ["ap"], rgdatkpwr: ["rap"], splpwr: ["sp"],
  splheal: ["heal"], manargn: ["mp5"], healthrgn: ["hp5"], critPct: ["crit"], hitPct: ["hit"], expPct: ["exp", "expSoft"],
  hastePct: ["haste"], dodgePct: ["dodge"], parryPct: ["parry"], blockPct: ["block"], defrtng: ["defense", "defenseCapped"],
  block: ["blockValue"], armor: ["armor"], armorbonus: ["bonusArmor"], dps: ["dps"],
};
const PAWN_KEYS: Record<string, WeightKey[]> = {
  strength: ["str"], agility: ["agi"], stamina: ["sta"], intellect: ["int"], spirit: ["spi"], ap: ["ap"], rap: ["rap"],
  spelldamage: ["sp"], healing: ["heal"], mp5: ["mp5"], hp5: ["hp5"], critrating: ["crit"], hitrating: ["hit"],
  expertiserating: ["exp", "expSoft"], hasterating: ["haste"], dodgerating: ["dodge"], parryrating: ["parry"], blockrating: ["block"],
  defenserating: ["defense", "defenseCapped"], blockvalue: ["blockValue"], armor: ["armor"], bonusarmor: ["bonusArmor"], dps: ["dps"],
};

function parseWeights(text: string): Weights | null {
  const pawn = /Pawn:/i.test(text);
  const out: Weights = {};
  for (const [, key, value] of text.matchAll(/([A-Za-z]+)\s*=\s*(-?[\d.]+)/g)) {
    for (const k of (pawn ? PAWN_KEYS[key.toLowerCase()] : FLB_KEYS[key]) ?? []) out[k] = Number(value);
  }
  return Object.keys(out).length ? out : null;
}

function frame(): string {
  const s = settings();
  const presets = PRESETS[ctx.className ?? ""] ?? [];
  const items = itemLists.get(listKey());
  const select = (name: string, label: string, options: [string, string][], value: string) =>
    `<label><span>${label}</span><select data-upgrade="${name}">${options.map(([v, t]) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  const paneButton = (id: typeof pane, label: string) => `<button type="button" data-upgrade-pane="${id}" aria-pressed="${pane === id}">${label}</button>`;

  let body: string;
  if (!items) {
    body = itemsState === "loading"
      ? `<p class="loading">Loading every item a ${esc(ctx.className)} can wear…</p>`
      : `<p class="notice err">Item list unavailable: ${esc(itemsState)}</p>`;
  } else if (!ctx.gear) {
    body = `<p class="notice">Equipment unavailable, so there's nothing to compare with.</p>`;
  } else {
    const rows = score(items);
    if (!rows.some((r) => r.slot.type === selectedSlot)) selectedSlot = rows[0].slot.type;
    const right = pane === "weights" ? weightsPane()
      : !Object.values(s.weights).some((v) => v) ? `<div class="bis-detail"><p class="notice">Every weight is 0: set some under Stat weights to rank items.</p></div>`
      : pane === "gear" ? myGear(rows)
      : slotDetail(rows.find((r) => r.slot.type === selectedSlot)!);
    body = `<div class="bis-main">${slotList(rows)}${right}</div>
      ${s.hidden.length ? `<p class="bis-note">${s.hidden.length} hidden item${s.hidden.length > 1 ? "s" : ""}. <button type="button" class="link-button" data-upgrade-unhide>Show them again</button></p>` : ""}`;
  }

  return `<section class="wide bis-frame">
    <header class="bis-title"><h3>Best in Slot</h3>
      <div class="bis-panes">${paneButton("bis", "Best in slot")}${paneButton("gear", "My gear")}${paneButton("weights", "Stat weights")}</div></header>
    <div class="bis-selectors">
      <label><span>Class</span><output>${esc(ctx.className)}</output></label>
      ${select("preset", "Weights", [...presets.map((p): [string, string] => [p.id, p.name]), ["custom", "Custom"]], s.preset)}
      ${select("level", "Level", Array.from({ length: MAX_LEVEL }, (_, i): [string, string] => [String(i + 1), i + 1 === ctx.level ? `${i + 1} (you)` : String(i + 1)]), String(viewLevel()))}
      ${select("setup", "Weapons", (Object.keys(SETUPS) as Setup[]).map((k): [string, string] => [k, SETUPS[k].name]), s.setup)}
      ${select("lookAhead", "Look ahead", LOOK_AHEAD.map((n): [string, string] => [String(n), n ? `+${n} level${n > 1 ? "s" : ""}` : "None"]), String(s.lookAhead))}
      ${select("quality", "Up to", QUALITIES.slice(1).map((q): [string, string] => [q, q[0] + q.slice(1).toLowerCase()]), s.maxQuality)}
    </div>
    ${body}
    <p class="bis-note">Scores are in Attack Power from your stat weights; the green number is the gain over what you wear. Blizzard's data doesn't say which boss or quest gives an item, so items are grouped by what it does say (profession, reputation, binding) and link to Wowhead for the rest.</p>
  </section>`;
}

/** The whole view; loadUpgrades fills in the item list once it's on the page. */
export function upgradesView(context: UpgradesContext): string {
  ctx = context;
  importMessage = "";
  return `<div class="grid">${frame()}</div>`;
}

function redraw() {
  const el = document.querySelector<HTMLElement>(".bis-frame");
  if (!el) return;
  el.outerHTML = frame();
}

/** After a weight changes: redraw the slot list only, so the box being typed in keeps focus. */
function refreshSlots() {
  const items = itemLists.get(listKey());
  const nav = document.querySelector<HTMLElement>(".bis-frame .bis-slots");
  if (!items || !nav || !ctx.gear) return;
  nav.outerHTML = slotList(score(items));
}

let loadToken = 0;

/** Fetches the class's item list (slow once per server run; the browser keeps it while the page is open). */
export async function loadUpgrades() {
  const key = listKey();
  if (itemLists.has(key)) return redraw();
  const token = ++loadToken;
  itemsState = "loading";
  try {
    const res = await fetch(`/api/forever/items?region=${ctx.region}&class=${encodeURIComponent(ctx.className ?? "")}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as SourceResult<ForeverItem[]>;
    if (data.status !== "ok") throw new Error(data.status === "error" ? data.error : data.reason);
    itemLists.set(key, data.data);
    if (token !== loadToken) return;
    itemsState = "ready";
  } catch (err) {
    if (token !== loadToken) return;
    itemsState = err instanceof Error ? err.message : String(err);
  }
  if (listKey() === key) redraw();
}

function applyPreset(s: Settings, id: string) {
  const preset = PRESETS[ctx.className ?? ""]?.find((p) => p.id === id);
  if (preset) Object.assign(s, { preset: preset.id, weights: { ...preset.weights }, caps: { ...preset.caps }, setup: preset.setup });
  else s.preset = "custom";
}

/** Wires the view's inputs once; they're delegated from the page root so re-rendered views keep working. */
export function setupUpgrades(root: HTMLElement) {
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.closest(".bis-frame") || el.tagName !== "INPUT") return;
    const s = settings();
    const n = Number(el.value);
    if (el.dataset.upgradeWeight) {
      s.weights[el.dataset.upgradeWeight as WeightKey] = Number.isFinite(n) ? n : 0;
      s.preset = "custom";
      const select = document.querySelector<HTMLSelectElement>(".bis-frame select[data-upgrade=preset]");
      if (select) select.value = "custom";
    } else if (el.dataset.upgradeCap) {
      if (!Number.isFinite(n) || n < 0) return;
      s.caps[el.dataset.upgradeCap as keyof Caps] = n;
    } else if (el.dataset.upgradeExtra) {
      s.extra[el.dataset.upgradeExtra as keyof Settings["extra"]] = Number.isFinite(n) ? n : 0;
    } else return;
    save();
    refreshSlots();
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (!el.closest(".bis-frame") || el.tagName !== "SELECT") return;
    const s = settings();
    const field = el.dataset.upgrade;
    if (field === "preset") applyPreset(s, el.value);
    else if (field === "setup") s.setup = el.value as Setup;
    else if (field === "quality") s.maxQuality = el.value;
    else if (field === "lookAhead") s.lookAhead = Number(el.value);
    else if (field === "level") levels.set(ctx.key, Number(el.value));
    else return;
    save();
    redraw();
  });
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".bis-frame")) return;
    const s = settings();
    const hit = (attr: string) => target.closest<HTMLElement>(`[${attr}]`);
    const paneButton = hit("data-upgrade-pane"), slot = hit("data-upgrade-slot"), group = hit("data-upgrade-group"), hide = hit("data-upgrade-hide");
    if (paneButton) pane = paneButton.dataset.upgradePane as typeof pane;
    else if (slot) {
      selectedSlot = slot.dataset.upgradeSlot!;
      pane = "bis";
    } else if (group) {
      const g = group.dataset.upgradeGroup!;
      if (!collapsed.delete(g)) collapsed.add(g);
    } else if (hide) s.hidden.push(Number(hide.dataset.upgradeHide));
    else if (hit("data-upgrade-unhide")) s.hidden = [];
    else if (hit("data-upgrade-reset")) {
      const presets = PRESETS[ctx.className ?? ""] ?? [];
      applyPreset(s, (presets.find((p) => p.id === s.preset) ?? presets[0])?.id ?? "");
      importMessage = "";
    } else if (hit("data-upgrade-import")) {
      const text = document.querySelector<HTMLTextAreaElement>(".bis-frame .bis-import")?.value ?? "";
      const weights = parseWeights(text);
      if (weights) {
        Object.assign(s, { preset: "custom", weights });
        const setup = /^FLB\d*:[^,]*,[^,]*,(\w+)/.exec(text.trim())?.[1];
        if (setup && setup in SETUPS) s.setup = setup as Setup;
        importMessage = `Imported ${Object.keys(weights).length} weights.`;
      } else importMessage = "No weights found in that text.";
    } else return;
    save();
    redraw();
  });
}
