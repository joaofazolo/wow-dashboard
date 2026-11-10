// WoW: Forever talent tree layouts per class (Forever's trees differ from classic's, so they come from the API).
// Each class has three spec trees laid out like the in-game frame: 4 columns, a row per tier, prerequisites as arrows.
import type { TalentTree } from "../types.js";
import { blizzardGet, blizzardGetOrNull } from "./blizzard.js";
import { pool } from "./http.js";

interface Node {
  id: number;
  display_row: number;
  display_col: number;
  locked_by?: number[];
  ranks: { rank: number; tooltip?: { talent: { id: number; name: string }; spell_tooltip?: { spell: { id: number }; description?: string } } }[];
}

const trees = new Map<string, Promise<TalentTree[]>>();

/** The three talent trees of a class, cached for the life of the server (talent layouts are static). */
export function classTalentTrees(region: string, className: string): Promise<TalentTree[]> {
  const key = `${region}/${className}`;
  let hit = trees.get(key);
  if (!hit) {
    hit = (async () => {
      const q = `namespace=static-forever-${region}&locale=en_US`;
      const index = await blizzardGet<{ class_talent_trees: { name: string; key: { href: string } }[] }>(region, `/data/wow/talent-tree/index?${q}`);
      const classTree = index.class_talent_trees.find((t) => t.name === className);
      if (!classTree) return [];
      // The links carry the versioned namespace; only the path and query matter here.
      const path = (href: string) => { const u = new URL(href); return `${u.pathname}${u.search}&locale=en_US`; };
      const cls = await blizzardGet<{ spec_talent_trees: { name: string; key: { href: string } }[] }>(region, path(classTree.key.href));

      return Promise.all(cls.spec_talent_trees.map(async (t): Promise<TalentTree> => {
        const tree = await blizzardGet<{ spec_talent_nodes: Node[]; playable_specialization?: { id: number } }>(region, path(t.key.href));
        const nodes = tree.spec_talent_nodes;
        // Each tree sits in its own 4 columns of the class grid (Arms 1–4, Fury 7–10, …); shift them to 0–3.
        const firstCol = Math.min(...nodes.map((n) => n.display_col));
        const [icons, specIcon] = await Promise.all([
          pool(nodes, async (n) => {
            const spell = n.ranks[0]?.tooltip?.spell_tooltip?.spell.id;
            const media = spell ? await blizzardGetOrNull<{ assets?: { value: string }[] }>(region, `/data/wow/media/spell/${spell}?${q}`).catch(() => null) : null;
            return media?.assets?.[0]?.value ?? null;
          }),
          tree.playable_specialization
            ? blizzardGetOrNull<{ assets?: { value: string }[] }>(region, `/data/wow/media/playable-specialization/${tree.playable_specialization.id}?${q}`).then((m) => m?.assets?.[0]?.value ?? null).catch(() => null)
            : Promise.resolve(null),
        ]);
        return {
          spec: t.name,
          icon: specIcon,
          rows: Math.max(...nodes.map((n) => n.display_row)),
          nodes: nodes.map((n, i) => ({
            id: n.id,
            row: n.display_row,
            col: n.display_col - firstCol,
            name: n.ranks[0]?.tooltip?.talent.name ?? "",
            talentId: n.ranks[0]?.tooltip?.talent.id ?? 0,
            icon: icons[i],
            ranks: n.ranks.map((r) => r.tooltip?.spell_tooltip?.description ?? ""),
            requires: n.locked_by?.[0] ?? null,
          })),
        };
      }));
    })();
    trees.set(key, hit);
    hit.catch(() => trees.delete(key));
  }
  return hit;
}
