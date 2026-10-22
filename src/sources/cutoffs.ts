// Raider.IO M+ season cutoffs: the score needed for each population percentile, refreshed by Raider.IO a few times a day.
// Region-wide numbers come from /season-cutoffs, per-spec numbers from /cutoff-analysis.
import type { SeasonCutoffs } from "../types.js";
import { getJson } from "./http.js";
import { CLASS_SPECS } from "../specs.js";

const CACHE_MS = 60 * 60 * 1000;

const PERCENTILES = [
  { key: "p999", percentile: 0.1, label: "Top 0.1%" },
  { key: "p990", percentile: 1, label: "Top 1%" },
  { key: "p900", percentile: 10, label: "Top 10%" },
  { key: "p750", percentile: 25, label: "Top 25%" },
  { key: "p600", percentile: 40, label: "Top 40%" },
];

const ACHIEVEMENTS = [
  { key: "keystoneExplorer", name: "Explorer" },
  { key: "keystoneConqueror", name: "Conqueror" },
  { key: "keystoneMaster", name: "Master" },
  { key: "keystoneHero", name: "Hero" },
  { key: "keystoneLegend", name: "Legend" },
  { key: "keystoneMyth", name: "Myth" },
];

interface Quantile { quantile: number; quantileMinValue: number }
type SeasonCutoffsResponse = { cutoffs: { updatedAt: string } & Record<string, unknown> };
interface SpecCohort { specId: number; label: string; percentiles: { percentile: number; cutoffScore: number | null }[] }
interface CutoffAnalysisResponse { updatedAt: string; cohorts: SpecCohort[] }

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = fetcher();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key)); // don't cache failures
  return value;
}

const regionCutoffs = (region: string, season: string) =>
  cached(`region/${region}/${season}`, () =>
    getJson<SeasonCutoffsResponse>(`https://raider.io/api/v1/mythic-plus/season-cutoffs?${new URLSearchParams({ region, season })}`));

// ~2 MB covering every spec, so it's fetched once per region and shared by all characters.
const specCutoffs = (region: string, season: string) =>
  cached(`specs/${region}/${season}`, () =>
    getJson<CutoffAnalysisResponse>(`https://raider.io/api/v1/mythic-plus/cutoff-analysis?${new URLSearchParams({
      region, season, category: "specs", percentiles: PERCENTILES.map((p) => p.percentile).join(","), density: "false",
    })}`));

/** Interpolates where a score sits from known (score, top-percent) points. */
function estimateTopPercent(score: number, points: { score: number; top: number }[]): number | null {
  const sorted = points.filter((p) => p.score > 0).sort((a, b) => a.score - b.score);
  if (!sorted.length || score < sorted[0].score) return null;
  const above = sorted.findIndex((p) => p.score > score);
  if (above === -1) return sorted[sorted.length - 1].top;
  const lo = sorted[above - 1], hi = sorted[above];
  return lo.top + ((score - lo.score) / (hi.score - lo.score)) * (hi.top - lo.top);
}

/**
 * Region cutoffs plus, for every spec of the class, that spec's cutoffs and the character's score in it.
 * `scores` is Raider.IO's season scores object (spec_0..spec_3 follow CLASS_SPECS order).
 */
export async function fetchCutoffs(region: string, season: string, className: string, scores: Record<string, number>): Promise<SeasonCutoffs> {
  const classSpecs = CLASS_SPECS[className] ?? [];
  const [{ cutoffs: c }, specData] = await Promise.all([
    regionCutoffs(region, season),
    classSpecs.length ? specCutoffs(region, season).catch(() => null) : null,
  ]);
  const entry = (key: string) => (c[key] ?? {}) as { all?: Quantile | null; allColor?: string | null; score?: number; cutoffs?: { all?: Quantile | null } };

  // Every region entry (percentiles, achievements, allTimedN) is a (score, quantile) point; more points, finer estimate.
  const regionPoints = Object.keys(c)
    .map((k) => (entry(k).cutoffs ?? entry(k)).all)
    .filter((q): q is Quantile => !!q && typeof q.quantileMinValue === "number" && typeof q.quantile === "number")
    .map((q) => ({ score: q.quantileMinValue, top: (1 - q.quantile) * 100 }));

  const specs = classSpecs.map((spec, i) => {
    const cohort = specData?.cohorts.find((x) => x.specId === spec.id);
    const cutoffs = PERCENTILES.map((p) => cohort?.percentiles.find((x) => x.percentile === p.percentile)?.cutoffScore ?? null);
    const score = scores[`spec_${i}`] ?? 0;
    const points = PERCENTILES.map((p, j) => ({ score: cutoffs[j] ?? 0, top: p.percentile }));
    return { specId: spec.id, name: spec.name, score, cutoffs, topPercent: score && cohort ? estimateTopPercent(score, points) : null };
  });
  const best = [...specs].sort((a, b) => b.score - a.score)[0];

  return {
    updatedAt: new Date(c.updatedAt).toISOString(),
    percentiles: PERCENTILES.map(({ key, label }) => ({ label, region: entry(key).all?.quantileMinValue ?? null, color: entry(key).allColor ?? null })),
    regionTopPercent: estimateTopPercent(scores.all ?? 0, regionPoints),
    specs,
    defaultSpecId: best?.score ? best.specId : (specs[0]?.specId ?? null),
    achievements: ACHIEVEMENTS.map(({ key, name }) => ({ name, score: entry(key).score ?? 0 })).filter((a) => a.score > 0),
  };
}
