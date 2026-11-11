// WoW: Forever auction houses, for the Waylaid Crate calculator's prices.
// Houses hang off a ruleset (/data/wow/ruleset/{id}/auctions/, the trailing slash is required), but every ruleset
// lists the same houses with the same auctions, so the region's first ruleset stands in for all of them. Crates and
// trade goods are commodities: one unit price per listing, in the house's /commodities list.
import type { ForeverAuctionHouse, WaylaidPrices } from "../types.js";
import { WAYLAID_ITEM_IDS } from "../waylaidCrates.js";
import { blizzardGet } from "./blizzard.js";

/** How many units of each item to keep, cheapest first. A bundle needs at most 45; the rest shows the price climbing. */
const KEEP_UNITS = 400;

const dynamic = (region: string) => `namespace=dynamic-forever-${region}&locale=en_US`;

async function firstRuleset(region: string): Promise<number> {
  const index = await blizzardGet<{ rulesets: { id: number }[] }>(region, `/data/wow/ruleset/index?${dynamic(region)}`);
  const id = index.rulesets.map((r) => r.id).sort((a, b) => a - b)[0];
  if (id == null) throw new Error(`No WoW: Forever rulesets in ${region.toUpperCase()}`);
  return id;
}

export async function fetchForeverAuctionHouses(region: string): Promise<ForeverAuctionHouse[]> {
  const ruleset = await firstRuleset(region);
  const index = await blizzardGet<{ auctions: { id: number; name: string }[] }>(region, `/data/wow/ruleset/${ruleset}/auctions/?${dynamic(region)}`);
  return index.auctions.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.id - b.id);
}

/** The cheapest listings of every Waylaid crate and material in one house. The full list is ~60k listings (several MB). */
export async function fetchWaylaidPrices(region: string, houseId: number): Promise<WaylaidPrices> {
  const ruleset = await firstRuleset(region);
  const res = await blizzardGet<{ auctions?: { item: { id: number }; quantity: number; unit_price: number }[] }>(
    region, `/data/wow/ruleset/${ruleset}/auctions/${houseId}/commodities?${dynamic(region)}`);
  const wanted = new Set(WAYLAID_ITEM_IDS);
  const byItem = new Map<number, [number, number][]>();
  for (const a of res.auctions ?? []) {
    if (!wanted.has(a.item.id)) continue;
    let list = byItem.get(a.item.id);
    if (!list) byItem.set(a.item.id, (list = []));
    list.push([a.unit_price, a.quantity]);
  }
  const listings: WaylaidPrices["listings"] = {};
  for (const [id, list] of byItem) {
    list.sort((a, b) => a[0] - b[0]);
    // Merge listings at the same price and stop once there's plenty.
    const kept: [number, number][] = [];
    let units = 0;
    for (const [price, qty] of list) {
      const last = kept.at(-1);
      if (last?.[0] === price) last[1] += qty;
      else kept.push([price, qty]);
      units += qty;
      if (units >= KEEP_UNITS) break;
    }
    listings[id] = kept;
  }
  return { houseId, fetchedAt: new Date().toISOString(), listings };
}
