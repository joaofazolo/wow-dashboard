// Shared between server and client.

export type SourceResult<T> =
  | { status: "ok"; data: T }
  | { status: "sample"; data: T; reason: string } // placeholder data because the source has no API key
  | { status: "disabled"; reason: string }
  | { status: "error"; error: string };

/** Who the character is, from Raider.IO, for sources that need class or spec. */
export interface CharacterClass {
  className: string;
  /** The spec the character is currently in, e.g. "Elemental". */
  activeSpec: string;
}

export interface CharacterRef {
  region: string;
  realm: string; // realm slug, e.g. "azralon"
  name: string;
}

export interface RaiderIOData {
  name: string;
  race: string;
  className: string;
  spec: string;
  role: string;
  faction: string;
  guild: string | null;
  thumbnailUrl: string;
  profileUrl: string;
  achievementPoints: number;
  itemLevel: number;
  lastCrawledAt: string;
  mythicPlus: {
    season: string;
    score: number;
    color: string;
    roleScores: { dps: number; healer: number; tank: number };
  } | null;
  recentRuns: KeystoneRun[];
  bestRuns: KeystoneRun[];
  /** Every M+ run since the weekly reset, highest key first. Feeds the Great Vault M+ row. */
  weeklyRuns: KeystoneRun[];
  /** Region-wide score cutoffs for this M+ season, or null if they couldn't be loaded. */
  cutoffs: SeasonCutoffs | null;
  /** The current raid/M+ week, or null if the reset times couldn't be loaded. */
  week: { start: string; end: string } | null;
  raids: {
    slug: string;
    name: string;
    /** Every boss in the raid, in encounter order. Empty if Raider.IO's raid data couldn't be loaded. */
    bosses: string[];
    summary: string;
    totalBosses: number;
    normal: number;
    heroic: number;
    mythic: number;
  }[];
  gear: GearItem[];
  /** Highest item level obtainable this season, or null if the upgrade data couldn't be loaded. */
  seasonMaxItemLevel: number | null;
}

export interface GearItem {
  slot: string;
  name: string;
  itemLevel: number;
  quality: number;
  icon: string;
  /** Upgrade track and rank, e.g. Myth 2/6. Null for crafted items or when unknown. */
  upgrade: { track: string; level: number; max: number; maxItemLevel: number } | null;
}

export interface SeasonCutoffs {
  updatedAt: string;
  /** Score needed for each percentile, region-wide (all factions). */
  percentiles: { label: string; region: number | null; color: string | null }[];
  /** Roughly which top percentage of the region the character's overall score is in. */
  regionTopPercent: number | null;
  /** Every spec of the character's class, with its own score and the spec's cutoffs (same order as percentiles). */
  /** `name` is the spec alone, e.g. "Restoration". */
  specs: { specId: number; name: string; score: number; cutoffs: (number | null)[]; topPercent: number | null }[];
  /** The spec shown first: the one with the highest M+ score. */
  defaultSpecId: number | null;
  /** Keystone achievements and the score each one needs. */
  achievements: { name: string; score: number }[];
}

export interface KeystoneRun {
  dungeon: string;
  shortName: string;
  level: number;
  upgrades: number;
  score: number;
  completedAt: string;
  clearTimeMs: number;
  parTimeMs: number;
  role: string | null;
  url: string;
}

export interface BlizzardData {
  level: number;
  title: string | null;
  averageItemLevel: number;
  equippedItemLevel: number;
  lastLogin: string;
  renderUrl: string | null;
  insetUrl: string | null;
  stats: {
    health: number;
    power: number;
    powerType: string;
    primary: { name: string; value: number };
    stamina: number;
    crit: number;
    haste: number;
    mastery: number;
    versatility: number;
  } | null;
  /** Bosses killed since the weekly reset in the current expansion's raids, at the highest difficulty killed. */
  weeklyRaidKills: RaidKill[] | null;
  /** What the character is saved to this week: bosses killed since the reset, per raid and difficulty. */
  raidLockouts: RaidLockout[] | null;
  /** Same as raidLockouts but for older expansions' raids, newest expansion first. */
  legacyLockouts: LegacyLockout[] | null;
}

export type RaidDifficulty = "LFR" | "NORMAL" | "HEROIC" | "MYTHIC";

export interface RaidLockout {
  raid: string;
  difficulty: RaidDifficulty;
  killed: string[];
}

export interface LegacyLockout {
  expansion: string;
  raid: string;
  /** Blizzard's display name, e.g. "Heroic" or "25 Player (Heroic)". */
  difficulty: string;
  killed: string[];
  totalBosses: number;
  /** Every boss in the raid in journal order, marked killed or not this week. Empty if the journal couldn't be loaded. */
  bosses: { name: string; killed: boolean }[];
}

export interface RaidKill {
  raid: string;
  boss: string;
  difficulty: RaidDifficulty;
  killedAt: string;
}

export interface WarcraftLogsData {
  profileUrl: string;
  /** Rankings per spec of the character's class (one "All specs" entry if the class is unknown). */
  specs: WarcraftLogsSpecRankings[];
  /** The spec shown first: the one the character is currently playing. */
  defaultSpecId: number | null;
}

export interface WarcraftLogsSpecRankings {
  specId: number;
  name: string;
  difficulty: number | null;
  metric: string | null;
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
  encounters: { name: string; bestPercent: number | null; medianPercent: number | null; kills: number; spec: string | null }[];
}

export interface CharacterStatus {
  ref: CharacterRef;
  fetchedAt: string;
  raiderio: SourceResult<RaiderIOData>;
  blizzard: SourceResult<BlizzardData>;
  warcraftlogs: SourceResult<WarcraftLogsData>;
}
