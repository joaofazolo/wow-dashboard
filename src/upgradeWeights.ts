// Stat weights for the Upgrades view, in Attack Power: 1 AP = 1. Percentage stats are per 1%.
//
// Protection Warrior is from Wowhead's WoW: Forever stat guide
// (https://www.wowhead.com/forever/guide/classes/warrior/protection/stat-priority-pve-tank). Its offensive values are
// the guide's: 1% expertise is worth 115 AP up to the 6.5% soft cap and 46 AP from there to the 14% hard cap, 1% hit 60 AP
// up to the 8% melee cap, 1% crit 34 AP, 1% haste 21 AP, and Strength 2.2 AP (2 AP, plus 10% from Blessing of Kings).
// Agility is ~70% of Strength offensively. The guide gives no numbers for defensive stats, only an order, so DEFENSIVE
// below is our own scale. Each preset mixes the two so items rank roughly in the guide's Defensive, Balanced and
// Offensive priority orders. Weapon DPS isn't in the guide either; 10 AP per point of DPS is a guess.

export type WeightKey =
  | "str" | "agi" | "sta" | "int" | "spi" | "ap" | "rap" | "sp" | "heal" | "mp5" | "hp5"
  | "crit" | "hit" | "exp" | "expSoft" | "haste" | "dodge" | "parry" | "block"
  | "defense" | "defenseCapped" | "blockValue" | "armor" | "bonusArmor" | "dps";
export type Weights = Partial<Record<WeightKey, number>>;

/** Where capped stats stop paying. Defense is the bonus over your base (5 per level): 140 makes a boss unable to crit you. */
export interface Caps { hit: number; expSoft: number; expHard: number; defense: number }

export interface Preset { id: string; name: string; weights: Weights; caps: Caps; setup: Setup }
export type Setup = "shield" | "twohand" | "dualwield" | "held";

export const WEIGHT_LABELS: [WeightKey, string][] = [
  ["sta", "Stamina"], ["str", "Strength"], ["agi", "Agility"], ["int", "Intellect"], ["spi", "Spirit"],
  ["ap", "Attack Power"], ["rap", "Ranged Attack Power"], ["sp", "Spell Power"], ["heal", "Healing"],
  ["hit", "Hit % (to cap)"], ["exp", "Expertise % (to soft cap)"], ["expSoft", "Expertise % (soft to hard cap)"],
  ["crit", "Crit %"], ["haste", "Haste %"],
  ["defense", "Defense (to cap)"], ["defenseCapped", "Defense (over cap)"], ["dodge", "Dodge %"], ["parry", "Parry %"],
  ["block", "Block %"], ["blockValue", "Block Value"], ["armor", "Armor"], ["bonusArmor", "Bonus Armor"],
  ["mp5", "Mana per 5"], ["hp5", "Health per 5"], ["dps", "Weapon DPS"],
];

const OFFENSIVE: Weights = { str: 2.2, agi: 1.5, ap: 1, hit: 60, exp: 115, expSoft: 46, crit: 34, haste: 21, dps: 10 };
const DEFENSIVE: Weights = {
  sta: 10, agi: 4, defense: 12, defenseCapped: 6, armor: 0.25, bonusArmor: 0.25, dodge: 30, parry: 36, block: 12, blockValue: 1,
};
const mix = (offense: number, defense: number): Weights => {
  const out: Weights = {};
  for (const [k] of WEIGHT_LABELS) {
    const v = (OFFENSIVE[k] ?? 0) * offense + (DEFENSIVE[k] ?? 0) * defense;
    if (v) out[k] = +v.toFixed(2);
  }
  return out;
};

const WARRIOR_CAPS: Caps = { hit: 8, expSoft: 6.5, expHard: 14, defense: 140 };
export const NO_CAPS: Caps = { hit: 100, expSoft: 100, expHard: 100, defense: 1000 };

export const PRESETS: Record<string, Preset[]> = {
  Warrior: [
    { id: "prot-balanced", name: "Protection: Balanced", weights: mix(1, 0.6), caps: WARRIOR_CAPS, setup: "shield" },
    { id: "prot-defensive", name: "Protection: Defensive", weights: mix(0.3, 1), caps: WARRIOR_CAPS, setup: "shield" },
    { id: "prot-offensive", name: "Protection: Offensive", weights: mix(1, 0.2), caps: WARRIOR_CAPS, setup: "shield" },
  ],
};

/** The hands each weapon setup fills, by Blizzard inventory type. */
export const SETUPS: Record<Setup, { name: string; mainHand: string[]; offHand: string[] }> = {
  shield: { name: "One-hander and shield", mainHand: ["WEAPON", "WEAPONMAINHAND"], offHand: ["SHIELD"] },
  twohand: { name: "Two-hander", mainHand: ["TWOHWEAPON"], offHand: [] },
  dualwield: { name: "Dual wield", mainHand: ["WEAPON", "WEAPONMAINHAND"], offHand: ["WEAPON", "WEAPONOFFHAND"] },
  held: { name: "One-hander and off-hand item", mainHand: ["WEAPON", "WEAPONMAINHAND"], offHand: ["HOLDABLE", "SHIELD"] },
};
