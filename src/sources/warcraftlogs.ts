// Warcraft Logs API v2 (GraphQL). Needs a client from https://www.warcraftlogs.com/api/clients/
// Schema explorer: https://www.warcraftlogs.com/v2-api-docs/warcraft/
import type { CharacterClass, CharacterRef, WarcraftLogsData, WarcraftLogsSpecRankings } from "../types.js";
import { CLASS_SPECS } from "../specs.js";
import { clientCredentials, getJson } from "./http.js";
import { realmSlug } from "./blizzard.js";

const { WCL_CLIENT_ID, WCL_CLIENT_SECRET, WCL_ZONE_ID } = process.env;

const getToken =
  WCL_CLIENT_ID && WCL_CLIENT_SECRET
    ? clientCredentials("https://www.warcraftlogs.com/oauth/token", WCL_CLIENT_ID, WCL_CLIENT_SECRET)
    : null;

export const warcraftLogsEnabled = getToken !== null;

/** One zoneRankings per spec, aliased by spec ID, so every spec comes back in a single request. */
function buildQuery(specs: { id: number; name: string; role: string }[]): string {
  const fields = specs.length
    ? specs.map((sp) => `s${sp.id}: zoneRankings(zoneID: $zone, specName: "${sp.name.replace(/\s+/g, "")}", metric: ${sp.role === "healer" ? "hps" : "dps"})`)
    : ["s0: zoneRankings(zoneID: $zone)"];
  return `
query ($name: String!, $server: String!, $region: String!, $zone: Int) {
  characterData {
    character(name: $name, serverSlug: $server, serverRegion: $region) {
      id
      ${fields.join("\n      ")}
    }
  }
}`;
}

// zoneRankings is an untyped JSON scalar in the schema; these are the fields we use.
interface ZoneRankings {
  zone?: number;
  difficulty?: number;
  metric?: string;
  bestPerformanceAverage?: number | null;
  medianPerformanceAverage?: number | null;
  rankings?: {
    encounter: { id: number; name: string };
    rankPercent: number | null;
    medianPercent: number | null;
    totalKills: number;
    spec: string | null;
  }[];
}

interface GqlResponse {
  data?: { characterData: { character: ({ id: number } & Record<string, ZoneRankings | number | null>) | null } };
  errors?: { message: string }[];
}

export async function fetchWarcraftLogs(ref: CharacterRef, cls: CharacterClass | null): Promise<WarcraftLogsData> {
  if (!getToken) throw new Error("Warcraft Logs API is not configured");
  // Warcraft Logs uses Blizzard's realm slugs ("area-52").
  const server = await realmSlug(ref.region, ref.realm);
  const specs = cls ? CLASS_SPECS[cls.className] ?? [] : [];
  const res = await getJson<GqlResponse>("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: buildQuery(specs),
      variables: { name: ref.name, server, region: ref.region, zone: WCL_ZONE_ID ? Number(WCL_ZONE_ID) : undefined },
    }),
  });
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));

  const character = res.data?.characterData.character;
  if (!character) throw new Error("Character not found on Warcraft Logs");

  const toSpec = (specId: number, name: string): WarcraftLogsSpecRankings => {
    const z = (character[`s${specId}`] ?? {}) as ZoneRankings;
    return {
      specId,
      name,
      difficulty: z.difficulty ?? null,
      metric: z.metric ?? null,
      bestPerformanceAverage: z.bestPerformanceAverage ?? null,
      medianPerformanceAverage: z.medianPerformanceAverage ?? null,
      encounters: (z.rankings ?? []).map((r) => ({
        name: r.encounter.name,
        bestPercent: r.rankPercent,
        medianPercent: r.medianPercent,
        kills: r.totalKills,
        spec: r.spec,
      })),
    };
  };
  const result = specs.length ? specs.map((sp) => toSpec(sp.id, sp.name)) : [toSpec(0, "All specs")];
  const active = specs.find((sp) => sp.name === cls?.activeSpec);

  return {
    profileUrl: `https://www.warcraftlogs.com/character/${ref.region}/${server}/${ref.name.toLowerCase()}`,
    specs: result,
    defaultSpecId: active?.id ?? result[0].specId,
  };
}
