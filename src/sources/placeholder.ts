// Made-up data shown for sources that have no API key yet, so the layout can be seen before setup.
// The client labels it as sample data; none of these numbers come from the real character.
import type { BlizzardData, CharacterClass, CharacterRef, WarcraftLogsData } from "../types.js";
import { CLASS_SPECS } from "../specs.js";

export function sampleBlizzard(ref: CharacterRef): BlizzardData {
  return {
    level: 80,
    title: null,
    averageItemLevel: 0,
    equippedItemLevel: 0,
    lastLogin: new Date(Date.now() - 3 * 3600_000).toISOString(),
    renderUrl: null,
    insetUrl: null,
    stats: {
      health: 1_850_000,
      power: 250_000,
      powerType: "Mana",
      primary: { name: "Intellect", value: 42_500 },
      stamina: 92_500,
      crit: 18.42,
      haste: 24.17,
      mastery: 61.3,
      versatility: 9.85,
    },
    weeklyRaidKills: (["HEROIC", "HEROIC", "HEROIC", "NORMAL", "NORMAL"] as const).map((difficulty, i) => ({
      raid: "Sample Raid",
      boss: `Sample Boss ${i + 1}`,
      difficulty,
      killedAt: new Date(Date.now() - (i + 1) * 3600_000).toISOString(),
    })),
    // Lockouts are matched to real raid names, so made-up ones would never show; the panel asks for a key instead.
    raidLockouts: null,
    legacyLockouts: null,
  };
}

export function sampleWarcraftLogs(ref: CharacterRef, cls: CharacterClass | null): WarcraftLogsData {
  const bosses: [number | null, number | null, number][] = [
    [96.4, 81.2, 14], [88.1, 70.5, 12], [99.2, 90.3, 11], [74.6, 52.8, 9],
    [63.0, 41.7, 8], [81.9, 66.4, 6], [55.3, 38.9, 4], [null, null, 0],
  ];
  const specs = (cls && CLASS_SPECS[cls.className]) || [{ id: 0, name: "All specs", role: "dps" as const }];
  return {
    profileUrl: `https://www.warcraftlogs.com/character/${ref.region}/${ref.realm}/${ref.name.toLowerCase()}`,
    // Each spec gets the same made-up bosses, shifted so switching specs visibly changes the numbers.
    specs: specs.map((sp, i) => {
      const shift = (n: number | null) => (n == null ? null : Math.max(1, Math.min(99.9, n - i * 17)));
      return {
        specId: sp.id,
        name: sp.name,
        difficulty: 4,
        metric: sp.role === "healer" ? "hps" : "dps",
        bestPerformanceAverage: shift(79.8),
        medianPerformanceAverage: shift(63.1),
        encounters: bosses.map(([best, median, kills], j) => ({
          name: `Sample Boss ${j + 1}`,
          bestPercent: shift(best),
          medianPercent: shift(median),
          kills: Math.max(0, kills - i * 3),
          spec: kills ? sp.name : null,
        })),
      };
    }),
    defaultSpecId: specs.find((sp) => sp.name === cls?.activeSpec)?.id ?? specs[0].id,
  };
}
