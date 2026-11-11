// Waylaid Crates calculator: which crate turns gold into Merchant's Favor the cheapest, from live auction house prices
// (Blizzard's Forever commodities, per auction house) that the viewer can override. Overrides and settings are kept in
// browser storage.
import type { ForeverAuctionHouse, SourceResult, WaylaidPrices } from "../types.js";
import { COPPER_PER_FAVOR, CRATES, KNOWN_FAVOR, type Crate, type Tier } from "../waylaidCrates.js";

const WOWHEAD_ITEM = (id: number) => `https://www.wowhead.com/forever/item=${id}`;

/** The viewer's inputs. Typed prices override the auction house: copper per unit (materials) or per crate. */
interface Settings {
  prices: Record<number, number>;
  cratePrices: Record<number, number>;
  perkRank: number; // Legacy perk: 5% chance per rank to double a turn-in's Favor
  artisanFavor: number; // white Artisan crate; green pays double
  onlyUsable: boolean;
  ownCrates: boolean; // the crates came from drops, so only the materials cost anything
  houses: Record<string, number>; // chosen auction house per region
}

const STORAGE_KEY = "wow-dashboard:waylaid";
const DEFAULTS: Settings = { prices: {}, cratePrices: {}, perkRank: 0, artisanFavor: 20, onlyUsable: true, ownCrates: false, houses: {} };

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
let settings = loadSettings();
const save = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage blocked: the calculator still works for this visit
  }
};

/** Who's looking: the level hides crates they can't fill, the faction picks the default auction house. */
export interface WaylaidContext { region: string; level: number | null; faction: string | null }
let ctx: WaylaidContext = { region: "us", level: null, faction: null };
const houseLists = new Map<string, ForeverAuctionHouse[]>();
let market: WaylaidPrices | null = null;
let marketState: "loading" | "ready" | string = "loading"; // anything else is an error message

/** "1g 20s 5c", "35s", "80c" or a bare number of gold. Returns copper, or null when blank or unreadable. */
export function parseMoney(text: string): number | null {
  const s = text.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 10000);
  const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*([gsc])/g)];
  if (!parts.length || s.replace(/(\d+(?:\.\d+)?)\s*([gsc])|\s/g, "") !== "") return null;
  return Math.round(parts.reduce((sum, [, n, unit]) => sum + Number(n) * (unit === "g" ? 10000 : unit === "s" ? 100 : 1), 0));
}

export function formatMoney(copper: number): string {
  const sign = copper < 0 ? "−" : "";
  const c = Math.round(Math.abs(copper));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cc = c % 100;
  const out = [g && `${g.toLocaleString()}g`, s && `${s}s`, (cc || (!g && !s)) && `${cc}c`].filter(Boolean).join(" ");
  return sign + out;
}

/** Gold, or profit in green when the 50c per Favor pays back more than the bundle costs. */
const coin = (copper: number) =>
  copper < 0 ? `<span class="money up" title="The silver from the turn-in is more than the bundle costs">+${formatMoney(-copper)} profit</span>` : `<span class="money">${formatMoney(copper)}</span>`;

export const crateFavor = (c: Crate) => (c.tier === "Artisan" ? settings.artisanFavor : KNOWN_FAVOR[c.tier]) * (c.green ? 2 : 1);

/** What buying `qty` of an item costs: your typed price, else the auction house's cheapest listings, walked up. */
interface Cost { cost: number; from: "you" | "ah"; short?: number }
function buy(itemId: number, qty: number, override: number | undefined): Cost | null {
  if (override != null) return { cost: override * qty, from: "you" };
  const ladder = market?.listings[itemId];
  if (!ladder?.length) return null;
  let left = qty, cost = 0;
  for (const [price, n] of ladder) {
    const take = Math.min(left, n);
    cost += take * price;
    left -= take;
    if (!left) break;
  }
  // Fewer listed than a bundle needs: price the rest at the dearest listing and say so.
  return left ? { cost: cost + left * ladder.at(-1)![0], from: "ah", short: qty - left } : { cost, from: "ah" };
}
const cheapestEach = (itemId: number) => market?.listings[itemId]?.[0]?.[0] ?? null;

interface Option { qty: number; item: string; itemId: number; material: Cost; net: number; favor: number; perFavor: number }

/** The crate's own price: nothing if you have it, else your price or the cheapest listing. Null when it can't be had. */
const crateCost = (c: Crate): Cost | null => (settings.ownCrates ? { cost: 0, from: "you" } : buy(c.id, 1, settings.cratePrices[c.id]));

/** Every bundle with a price, cheapest per Favor first. The crate's own price and the silver it pays back count too. */
function crateOptions(c: Crate, crate: Cost): Option[] {
  const base = crateFavor(c);
  const favor = base * (1 + settings.perkRank * 0.05); // the perk's average: a 5/10/15% chance of double Favor
  const extra = crate.cost - base * COPPER_PER_FAVOR;
  return c.bundles
    .flatMap(([qty, item, itemId]) => {
      const material = buy(itemId, qty, settings.prices[itemId]);
      if (!material) return [];
      const net = material.cost + extra;
      return [{ qty, item, itemId, material, net, favor, perFavor: net / favor }];
    })
    .sort((a, b) => a.perFavor - b.perFavor);
}

const ahTag = (x: Cost) => (x.from === "you" ? ` <span class="muted small" title="Your price, not the auction house's">(yours)</span>` : "");

function ranking(): string {
  if (marketState === "loading" && !Object.keys(settings.prices).length) return `<p class="loading">Loading auction house prices…</p>`;
  const usable = (c: Crate) => !settings.onlyUsable || ctx.level == null || c.level <= ctx.level;
  const rows = CRATES.filter(usable).map((c) => {
    const crate = crateCost(c);
    return { c, crate, options: crate ? crateOptions(c, crate) : [] };
  });
  const priced = rows.filter((r) => r.options.length).sort((a, b) => a.options[0].perFavor - b.options[0].perFavor);
  const noCrate = rows.filter((r) => !r.crate).map((r) => r.c.name);
  const noBundle = rows.filter((r) => r.crate && !r.options.length).map((r) => r.c.name);
  const missing = [
    noCrate.length ? `No crate listed (tick "I already have the crates" if you have them): ${noCrate.join(", ")}.` : "",
    noBundle.length ? `No bundle material listed: ${noBundle.join(", ")}.` : "",
  ].filter(Boolean).map((t) => `<p class="notice">${t}</p>`).join("");
  if (!priced.length) {
    return `<p class="notice">Nothing to rank yet: ${market ? "this auction house lists none of the crates or their materials, so pick another or type prices below" : "type prices below"}.</p>${missing}`;
  }
  const best = priced[0].options[0];
  const body = priced.map(({ c, crate, options }, i) => {
    const [top, ...rest] = options;
    const estimated = c.tier === "Artisan" ? ` <span class="muted small" title="Artisan Favor isn't confirmed yet; change the guess above">(est.)</span>` : "";
    const each = top.material.cost / top.qty;
    return `<tr class="${i === 0 ? "best" : ""}">
      <td class="num muted">${i + 1}</td>
      <td><a href="${WOWHEAD_ITEM(c.id)}" target="_blank" rel="noopener" class="${c.green ? "q-uncommon" : "q-common"}">${c.name}</a>
        <div class="muted small">level ${c.level}${settings.ownCrates ? "" : ` · crate ${formatMoney(crate!.cost)}${ahTag(crate!)}`}</div></td>
      <td>${top.qty}× <a href="${WOWHEAD_ITEM(top.itemId)}" target="_blank" rel="noopener">${top.item}</a>
        <span class="muted small">${formatMoney(each)} each${ahTag(top.material)}</span>
        ${top.material.short != null ? `<div class="small warn">only ${top.material.short} listed</div>` : ""}
        ${rest.length ? `<div class="muted small">then ${rest.map((o) => `${o.qty}× ${o.item} ${o.perFavor < 0 ? "profit" : `${formatMoney(o.perFavor)}/Favor`}`).join(" · ")}</div>` : ""}</td>
      <td class="num">${coin(top.net)}</td>
      <td class="num">${+top.favor.toFixed(2)}${estimated}</td>
      <td class="num strong">${coin(top.perFavor)}</td>
    </tr>`;
  }).join("");
  return `<p class="waylaid-summary">Cheapest: <strong>${priced[0].c.name}</strong> with ${best.qty}× ${best.item}, at ${best.perFavor < 0 ? coin(best.perFavor) : `${coin(best.perFavor)} per Favor`}.</p>
    <div class="scroll"><table class="waylaid">
      <tr><th class="num">#</th><th>Crate</th><th>Cheapest bundle <span class="muted small">(others: per Favor)</span></th><th class="num">Net cost</th><th class="num">Favor</th><th class="num">Per Favor</th></tr>
      ${body}
    </table></div>
    ${missing}`;
}

function priceInputs(): string {
  const tiers: Tier[] = ["Apprentice", "Journeyman", "Expert", "Artisan"];
  const value = (copper: number | undefined) => (copper != null ? formatMoney(copper) : "");
  const hint = (id: number, none: string) => {
    if (!market) return none;
    const p = cheapestEach(id);
    return p != null ? `AH ${formatMoney(p)}` : "not listed";
  };
  return tiers.map((tier) => {
    const crates = CRATES.filter((c) => c.tier === tier);
    const locked = ctx.level != null && crates[0].level > ctx.level;
    return `<details class="waylaid-tier" ${locked ? "" : "open"}><summary>${tier} crates <span class="muted small">level ${crates[0].level}+${tier === "Artisan" ? " · Favor estimated" : ""}</span></summary>
      <div class="waylaid-crates">${crates.map((c) => `<fieldset>
        <legend class="${c.green ? "q-uncommon" : "q-common"}">${c.name} <span class="muted small">${crateFavor(c)} Favor</span></legend>
        ${c.bundles.map(([qty, item, id]) => `<label><span>${qty}× <a href="${WOWHEAD_ITEM(id)}" target="_blank" rel="noopener">${item}</a></span>
          <input data-price-item="${id}" value="${value(settings.prices[id])}" placeholder="${hint(id, "each")}" inputmode="decimal" aria-label="Price of one ${item}" /></label>`).join("")}
        <label class="muted"><span>The crate itself</span>
          <input data-price-crate="${c.id}" value="${value(settings.cratePrices[c.id])}" placeholder="${hint(c.id, "price")}" inputmode="decimal" aria-label="Price of ${c.name}" /></label>
      </fieldset>`).join("")}</div>
    </details>`;
  }).join("");
}

/** The house to price from: the viewer's pick for this region, else the first of their faction's. */
function chosenHouse(): number | null {
  const houses = houseLists.get(ctx.region);
  if (!houses?.length) return null;
  const saved = settings.houses[ctx.region];
  if (houses.some((h) => h.id === saved)) return saved;
  const faction = ctx.faction;
  return (faction ? houses.find((h) => h.name.startsWith(faction)) : undefined)?.id ?? houses[0].id;
}

function marketBar(): string {
  const houses = houseLists.get(ctx.region);
  const house = chosenHouse();
  const status = marketState === "loading" ? `<span class="muted small">Loading prices…</span>`
    : marketState === "ready" && market && !Object.keys(market.listings).length ? `<span class="notice small">This auction house has nothing listed right now; pick another.</span>`
    : marketState === "ready" && market ? `<span class="muted small">Prices from ${new Date(market.fetchedAt).toLocaleTimeString()}</span>`
    : `<span class="notice err small">Auction house unavailable: ${marketState}. Typed prices still work.</span>`;
  const options = (houses ?? []).map((h) => `<option value="${h.id}" ${h.id === house ? "selected" : ""}>${h.name} ${h.id}</option>`).join("");
  return `<div class="waylaid-settings">
    ${houses ? `<label>Auction house <select data-waylaid="house">${options}</select></label>` : ""}
    <button type="button" data-waylaid-reload ${marketState === "loading" ? "disabled" : ""}>Reload prices</button>
    ${status}
  </div>`;
}

function waylaidSection(): string {
  return `<section class="wide waylaid-page">
    <h3>Waylaid Crates <span>cheapest Merchant's Favor</span></h3>
    <p class="notice">Fill a Waylaid Crate with any one of its bundles, then hand the sealed crate to Dokimi (west of the Crossroads, Horde) or Marcy Baker (Three Corners, Alliance) for Merchant's Favor plus 50c per Favor, which is counted here.
      Your first crate also gives a Shipping Label quest worth 50 Favor. Prices are the auction house's cheapest listings, enough to fill one bundle; type a price below to use your own instead (<code>1g 20s</code>, <code>35s</code>, <code>80c</code> or a number of gold).</p>
    <div class="waylaid-market">${marketBar()}</div>
    <div class="waylaid-settings">
      <label><input type="checkbox" data-waylaid="ownCrates" ${settings.ownCrates ? "checked" : ""} /> I already have the crates</label>
      <label><input type="checkbox" data-waylaid="onlyUsable" ${settings.onlyUsable ? "checked" : ""} /> Only crates I can fill${ctx.level != null ? ` (level ${ctx.level})` : ""}</label>
      <label>Legacy double-Favor perk <select data-waylaid="perkRank">${[0, 1, 2, 3].map((r) => `<option value="${r}" ${settings.perkRank === r ? "selected" : ""}>${r ? `rank ${r} (${r * 5}%)` : "none"}</option>`).join("")}</select></label>
      <label title="Not confirmed yet. Green Artisan crates pay double.">Artisan crate Favor (guess) <input type="number" min="1" step="1" data-waylaid="artisanFavor" value="${settings.artisanFavor}" /></label>
      <button type="button" data-waylaid-clear>Clear my prices</button>
    </div>
    <div class="waylaid-ranking">${ranking()}</div>
    <h4>Prices</h4>
    ${priceInputs()}
  </section>`;
}

/** The whole view; loadWaylaid fills in the auction house prices once it's on the page. */
export function waylaidView(context: WaylaidContext): string {
  if (context.region !== ctx.region) market = null;
  ctx = context;
  return `<div class="grid">${waylaidSection()}</div>`;
}

const redraw = () => {
  const page = document.querySelector<HTMLElement>(".waylaid-page");
  if (page) page.outerHTML = waylaidSection();
};
const rerank = () => {
  const ranked = document.querySelector<HTMLElement>(".waylaid-ranking");
  if (ranked) ranked.innerHTML = ranking();
};

let loadToken = 0;

/** Fetches the region's auction houses (once) and the chosen house's prices, then redraws the view. */
export async function loadWaylaid(refresh = false) {
  const token = ++loadToken;
  const { region } = ctx;
  marketState = "loading";
  const bar = document.querySelector(".waylaid-market");
  if (bar) bar.innerHTML = marketBar();
  try {
    if (!houseLists.has(region)) {
      const res = await fetch(`/api/forever/auction-houses?region=${region}`);
      if (!res.ok) throw new Error(await res.text());
      const houses = (await res.json()) as SourceResult<ForeverAuctionHouse[]>;
      if (houses.status !== "ok") throw new Error(houses.status === "error" ? houses.error : houses.reason);
      houseLists.set(region, houses.data);
    }
    const house = chosenHouse();
    if (house == null) throw new Error("no auction houses listed");
    const res = await fetch(`/api/forever/waylaid-prices?region=${region}&house=${house}${refresh ? "&refresh" : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const prices = (await res.json()) as SourceResult<WaylaidPrices>;
    if (prices.status !== "ok") throw new Error(prices.status === "error" ? prices.error : prices.reason);
    if (token !== loadToken) return;
    market = prices.data;
    marketState = "ready";
  } catch (err) {
    if (token !== loadToken) return;
    market = null;
    marketState = err instanceof Error ? err.message : String(err);
  }
  redraw();
}

/** Wires the view's inputs once; they're delegated from the page root so re-rendered views keep working. */
export function setupWaylaid(root: HTMLElement) {
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.closest(".waylaid-page")) return;
    if (el.dataset.priceItem || el.dataset.priceCrate) {
      const copper = parseMoney(el.value);
      const store = el.dataset.priceItem ? settings.prices : settings.cratePrices;
      const id = Number(el.dataset.priceItem ?? el.dataset.priceCrate);
      el.classList.toggle("invalid", !!el.value.trim() && copper == null);
      if (copper == null) delete store[id];
      else store[id] = copper;
    } else if (el.dataset.waylaid === "onlyUsable") settings.onlyUsable = el.checked;
    else if (el.dataset.waylaid === "ownCrates") settings.ownCrates = el.checked;
    else if (el.dataset.waylaid === "perkRank") settings.perkRank = Number(el.value);
    else return;
    save();
    rerank();
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.closest(".waylaid-page")) return;
    if (el.dataset.waylaid === "house") {
      settings.houses[ctx.region] = Number(el.value);
      save();
      loadWaylaid();
    } else if (el.dataset.waylaid === "artisanFavor") {
      // The Artisan guess also shows in the price legends, so it redraws the whole section, once the box is left.
      settings.artisanFavor = Math.max(1, Number(el.value) || DEFAULTS.artisanFavor);
      save();
      redraw();
    }
  });
  // Tidy each price into "1g 20s 5c" when leaving the box.
  root.addEventListener("focusout", (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.closest(".waylaid-page") || !(el.dataset.priceItem || el.dataset.priceCrate)) return;
    const copper = parseMoney(el.value);
    if (copper != null) el.value = formatMoney(copper);
  });
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("button[data-waylaid-reload]")) return void loadWaylaid(true);
    if (!target.closest("button[data-waylaid-clear]") || !confirm("Clear every price you've typed? The auction house prices stay.")) return;
    settings = { ...settings, prices: {}, cratePrices: {} };
    save();
    redraw();
  });
}
