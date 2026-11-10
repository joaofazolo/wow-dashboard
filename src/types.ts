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

/** A WoW: Forever character. Forever has no realms: characters are looked up as Name-Surname per region. */
export interface ForeverCharacter {
  name: string;
  level: number;
  race: string | null;
  className: string | null;
  spec: string | null;
  faction: string | null;
  guild: string | null;
  title: string | null;
  equippedItemLevel: number | null;
  achievementPoints: number | null;
  lastLogin: string | null;
  insetUrl: string | null;
  /** Null when the endpoint failed; each section loads on its own. */
  gear: { slot: string; name: string; itemLevel: number | null; quality: string | null }[] | null;
  /** Talent builds (more than one with dual spec). Each lists its talent trees with points spent, most points first. */
  builds: { active: boolean; trees: { name: string; points: number; talents: { name: string; rank: number }[] }[] }[] | null;
  /** Classic PvP rank (0 = none). */
  pvp: { honorLevel: number | null; honorableKills: number | null; rank: number | null; maps: { name: string; played: number; won: number; lost: number }[] } | null;
  surname: string | null;
  gender: string | null;
  ruleset: string | null;
  /** Experience into the current level. */
  experience: number | null;
  /** Full-body render, transparent background. */
  renderUrl: string | null;
  stats: {
    health: number; power: number; powerType: string;
    strength: number; agility: number; stamina: number; intellect: number; spirit: number | null;
    armor: number; attackPower: number | null; rangedAttackPower: number | null; spellPower: number | null; defense: number | null;
    /** Percentages. */
    crit: number; spellCrit: number | null; dodge: number; parry: number; block: number;
    mainHandDps: number | null;
  } | null;
  professions: { name: string; skill: number; max: number; recipes: number; secondary: boolean }[] | null;
  quests: { inProgress: string[]; completed: number | null } | null;
  /** Highest standing first. `tier` is 0 (Hated) to 7 (Exalted). */
  reputations: { faction: string; standing: string; tier: number; value: number; max: number }[] | null;
  achievements: { count: number; points: number; recent: { name: string; at: string }[] } | null;
  /** Lifetime statistics by category, e.g. Kills → Total kills 2040. */
  lifetime: { category: string; stats: { name: string; value: string }[] }[] | null;
  transmogs: number | null;
}

/** Forever's rulesets (PvP, Normal, Roleplay…) replace realms; each has its own up/down status. */
export interface ForeverRuleset {
  id: number;
  name: string;
  status: string;
  up: boolean;
}

/** One profession recipe. */
export interface ProfessionRecipe {
  id: number;
  name: string;
  category: string;
  crafted: { id: number; name: string; quantity: number } | null;
  reagents: { id: number; name: string; quantity: number }[];
  /** Missing recipes only: the item that teaches it, if there is one, and the skill it needs. */
  learnFrom: { itemId: number; name: string; skill: number | null } | null;
}

export interface ProfessionProgress {
  name: string;
  skill: number;
  max: number;
  secondary: boolean;
  known: ProfessionRecipe[];
  missing: ProfessionRecipe[];
}

export interface ForeverProfessions {
  professions: ProfessionProgress[];
}

/** One Legacy Challenge (an account-wide achievement worth 1 Legacy Point). */
export interface LegacyChallenge {
  name: string;
  description: string;
  /** Top-level group as in game: Classes, Tradeskills, Dungeons, Raids, Player vs. Player, Adventure. */
  category: string;
  /** e.g. "Warrior" under Classes, "Ranks" under Player vs. Player. */
  subcategory: string | null;
  icon: string | null;
  completedAt: string | null;
  progress:
    | { kind: "bar"; value: number; max: number; label: string }
    | { kind: "steps"; steps: { label: string; done: boolean }[] }
    | null;
}

export interface ForeverLegacy {
  earned: number;
  total: number;
  /** Most points one character can spend in its Legacy trees. */
  perCharacterCap: number;
  /** Account-wide rewards for total points earned. */
  rewards: { points: number; name: string; kind: string }[];
  challenges: LegacyChallenge[];
}

export interface ForeverStatus {
  region: string;
  name: string;
  fetchedAt: string;
  character: SourceResult<ForeverCharacter>;
  rulesets: SourceResult<ForeverRuleset[]>;
}

export interface CharacterStatus {
  ref: CharacterRef;
  fetchedAt: string;
  raiderio: SourceResult<RaiderIOData>;
  blizzard: SourceResult<BlizzardData>;
  warcraftlogs: SourceResult<WarcraftLogsData>;
}
