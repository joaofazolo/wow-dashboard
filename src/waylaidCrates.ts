// Waylaid Crates: what each one takes and what it pays, shared by the crate-price source and the calculator view.
//
// Bundles come from each crate's in-game tooltip (Blizzard's static-forever item data). Favor per crate is from
// community testing (https://theforeverguides.com/professions/merchants-favor/): white crates pay 5 Favor per tier
// step, green crates double that, and every Favor comes with 50 copper. Artisan payouts weren't known yet, so the
// calculator takes them as an editable guess that follows the same pattern.

export type Tier = "Apprentice" | "Journeyman" | "Expert" | "Artisan";
export interface Crate { id: number; name: string; tier: Tier; level: number; green: boolean; bundles: [qty: number, item: string, itemId: number][] }

export const KNOWN_FAVOR: Record<Exclude<Tier, "Artisan">, number> = { Apprentice: 5, Journeyman: 10, Expert: 15 };
export const COPPER_PER_FAVOR = 50;

export const CRATES: Crate[] = [
  { id: 248684, name: "Apprentice Textiles", tier: "Apprentice", level: 10, green: false, bundles: [[40, "Linen Cloth", 2589], [20, "Light Leather", 2318]] },
  { id: 248683, name: "Apprentice Ore", tier: "Apprentice", level: 10, green: false, bundles: [[20, "Copper Ore", 2770], [20, "Tin Ore", 2771]] },
  { id: 248682, name: "Apprentice Herbs", tier: "Apprentice", level: 10, green: false, bundles: [[20, "Peacebloom", 2447], [20, "Silverleaf", 765], [10, "Earthroot", 2449], [10, "Mageroyal", 785], [10, "Briarthorn", 2450]] },
  { id: 248685, name: "Apprentice Curiosities", tier: "Apprentice", level: 10, green: false, bundles: [[20, "Strange Dust", 10940], [4, "Greater Magic Essence", 10939], [6, "Small Glimmering Shard", 10978], [2, "Large Glimmering Shard", 11084]] },
  { id: 248702, name: "Apprentice Fabrics", tier: "Apprentice", level: 10, green: true, bundles: [[2, "Cured Light Hide", 4231], [20, "Bolt of Linen Cloth", 2996]] },
  { id: 248703, name: "Apprentice Ingots", tier: "Apprentice", level: 10, green: true, bundles: [[20, "Copper Bar", 2840], [20, "Tin Bar", 3576], [10, "Bronze Bar", 2841]] },
  { id: 248704, name: "Apprentice Parts", tier: "Apprentice", level: 10, green: true, bundles: [[16, "Handful of Copper Bolts", 4359], [16, "Copper Tube", 4361], [4, "Copper Modulator", 4363]] },
  { id: 248688, name: "Journeyman Textiles", tier: "Journeyman", level: 10, green: false, bundles: [[20, "Wool Cloth", 2592], [40, "Silk Cloth", 4306], [20, "Medium Leather", 2319]] },
  { id: 248687, name: "Journeyman Ore", tier: "Journeyman", level: 10, green: false, bundles: [[10, "Silver Ore", 2775], [20, "Iron Ore", 2772]] },
  { id: 248686, name: "Journeyman Herbs", tier: "Journeyman", level: 10, green: false, bundles: [[10, "Stranglekelp", 3820], [10, "Bruiseweed", 2453], [10, "Wild Steelbloom", 3355], [10, "Grave Moss", 3369], [10, "Kingsblood", 3356]] },
  { id: 248689, name: "Journeyman Curiosities", tier: "Journeyman", level: 10, green: false, bundles: [[20, "Soul Dust", 11083], [4, "Greater Astral Essence", 11082], [6, "Small Glowing Shard", 11138], [2, "Large Glowing Shard", 11139]] },
  { id: 248705, name: "Journeyman Fabrics", tier: "Journeyman", level: 10, green: true, bundles: [[6, "Bolt of Woolen Cloth", 2997], [10, "Bolt of Silk Cloth", 4305], [2, "Cured Medium Hide", 4233]] },
  { id: 248706, name: "Journeyman Ingots", tier: "Journeyman", level: 10, green: true, bundles: [[10, "Silver Bar", 2842], [20, "Iron Bar", 3575]] },
  { id: 248707, name: "Journeyman Parts", tier: "Journeyman", level: 10, green: true, bundles: [[8, "Bronze Tube", 4371], [7, "Whirring Bronze Gizmo", 4375], [4, "Bronze Framework", 4382], [45, "Gold Power Core", 10558]] },
  { id: 248693, name: "Expert Textiles", tier: "Expert", level: 20, green: false, bundles: [[40, "Mageweave Cloth", 4338], [20, "Heavy Leather", 4234]] },
  { id: 248692, name: "Expert Ore", tier: "Expert", level: 20, green: false, bundles: [[10, "Gold Ore", 2776], [20, "Mithril Ore", 3858]] },
  { id: 248690, name: "Earthly Expert Herbs", tier: "Expert", level: 20, green: false, bundles: [[20, "Liferoot", 3357], [10, "Fadeleaf", 3818], [10, "Goldthorn", 3821], [10, "Khadgar's Whisker", 3358]] },
  { id: 248691, name: "Flowering Expert Herbs", tier: "Expert", level: 20, green: false, bundles: [[10, "Wintersbite", 3819], [10, "Firebloom", 4625], [20, "Purple Lotus", 8831], [10, "Arthas' Tears", 8836]] },
  { id: 248694, name: "Expert Curiosities", tier: "Expert", level: 20, green: false, bundles: [[20, "Vision Dust", 11137], [4, "Greater Mystic Essence", 11135], [6, "Small Radiant Shard", 11177], [2, "Large Radiant Shard", 11178]] },
  { id: 248708, name: "Expert Fabrics", tier: "Expert", level: 20, green: true, bundles: [[8, "Bolt of Mageweave", 4339], [2, "Cured Heavy Hide", 4236]] },
  { id: 248709, name: "Expert Ingots", tier: "Expert", level: 20, green: true, bundles: [[20, "Mithril Bar", 3860], [15, "Steel Bar", 3859], [10, "Gold Bar", 3577]] },
  { id: 248710, name: "Expert Parts", tier: "Expert", level: 20, green: true, bundles: [[8, "Iron Strut", 4387], [5, "Mithril Tube", 10559], [12, "Unstable Trigger", 10560], [5, "Mithril Casing", 10561]] },
  { id: 248698, name: "Artisan Textiles", tier: "Artisan", level: 35, green: false, bundles: [[40, "Runecloth", 14047], [20, "Thick Leather", 4304], [20, "Rugged Leather", 8170]] },
  { id: 248697, name: "Artisan Ore", tier: "Artisan", level: 35, green: false, bundles: [[10, "Truesilver Ore", 7911], [20, "Thorium Ore", 10620], [20, "Dark Iron Ore", 11370]] },
  { id: 248695, name: "Earthly Artisan Herbs", tier: "Artisan", level: 35, green: false, bundles: [[10, "Golden Sansam", 13464], [20, "Sungrass", 8838], [10, "Blindweed", 8839], [10, "Ghost Mushroom", 8845], [10, "Gromsblood", 8846]] },
  { id: 248696, name: "Flowering Artisan Herbs", tier: "Artisan", level: 35, green: false, bundles: [[20, "Dreamfoil", 13463], [20, "Mountain Silversage", 13465], [20, "Plaguebloom", 13466], [20, "Icecap", 13467]] },
  { id: 248699, name: "Artisan Curiosities", tier: "Artisan", level: 35, green: false, bundles: [[20, "Dream Dust", 11176], [4, "Greater Nether Essence", 11175], [6, "Small Brilliant Shard", 14343], [2, "Large Brilliant Shard", 14344]] },
  { id: 248711, name: "Artisan Fabrics", tier: "Artisan", level: 35, green: true, bundles: [[8, "Bolt of Runecloth", 14048], [2, "Cured Thick Hide", 8172]] },
  { id: 248712, name: "Artisan Ingots", tier: "Artisan", level: 35, green: true, bundles: [[2, "Dark Iron Bar", 11371], [10, "Truesilver Bar", 6037], [20, "Thorium Bar", 12359]] },
  { id: 248713, name: "Artisan Parts", tier: "Artisan", level: 35, green: true, bundles: [[5, "Thorium Widget", 15994], [5, "Truesilver Transformer", 18631], [2, "Thorium Tube", 16000]] },
];

/** Every item the calculator prices: the crates themselves and every bundle's material. */
export const WAYLAID_ITEM_IDS: number[] = [...new Set(CRATES.flatMap((c) => [c.id, ...c.bundles.map(([, , id]) => id)]))];
