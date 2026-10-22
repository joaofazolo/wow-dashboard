// Every spec, per class, in the order Raider.IO numbers a character's spec_0..spec_3 scores.
// That order isn't always by ID (see Monk). Shared by the server and the browser.

export type SpecRole = "tank" | "healer" | "dps";

export interface Spec {
  id: number;
  name: string;
  role: SpecRole;
}

export const CLASS_SPECS: Record<string, Spec[]> = {
  "Death Knight": [{ id: 250, name: "Blood", role: "tank" }, { id: 251, name: "Frost", role: "dps" }, { id: 252, name: "Unholy", role: "dps" }],
  "Demon Hunter": [{ id: 577, name: "Havoc", role: "dps" }, { id: 581, name: "Vengeance", role: "tank" }, { id: 1480, name: "Devourer", role: "dps" }],
  Druid: [{ id: 102, name: "Balance", role: "dps" }, { id: 103, name: "Feral", role: "dps" }, { id: 104, name: "Guardian", role: "tank" }, { id: 105, name: "Restoration", role: "healer" }],
  Evoker: [{ id: 1467, name: "Devastation", role: "dps" }, { id: 1468, name: "Preservation", role: "healer" }, { id: 1473, name: "Augmentation", role: "dps" }],
  Hunter: [{ id: 253, name: "Beast Mastery", role: "dps" }, { id: 254, name: "Marksmanship", role: "dps" }, { id: 255, name: "Survival", role: "dps" }],
  Mage: [{ id: 62, name: "Arcane", role: "dps" }, { id: 63, name: "Fire", role: "dps" }, { id: 64, name: "Frost", role: "dps" }],
  Monk: [{ id: 268, name: "Brewmaster", role: "tank" }, { id: 270, name: "Mistweaver", role: "healer" }, { id: 269, name: "Windwalker", role: "dps" }],
  Paladin: [{ id: 65, name: "Holy", role: "healer" }, { id: 66, name: "Protection", role: "tank" }, { id: 70, name: "Retribution", role: "dps" }],
  Priest: [{ id: 256, name: "Discipline", role: "healer" }, { id: 257, name: "Holy", role: "healer" }, { id: 258, name: "Shadow", role: "dps" }],
  Rogue: [{ id: 259, name: "Assassination", role: "dps" }, { id: 260, name: "Outlaw", role: "dps" }, { id: 261, name: "Subtlety", role: "dps" }],
  Shaman: [{ id: 262, name: "Elemental", role: "dps" }, { id: 263, name: "Enhancement", role: "dps" }, { id: 264, name: "Restoration", role: "healer" }],
  Warlock: [{ id: 265, name: "Affliction", role: "dps" }, { id: 266, name: "Demonology", role: "dps" }, { id: 267, name: "Destruction", role: "dps" }],
  Warrior: [{ id: 71, name: "Arms", role: "dps" }, { id: 72, name: "Fury", role: "dps" }, { id: 73, name: "Protection", role: "tank" }],
};
