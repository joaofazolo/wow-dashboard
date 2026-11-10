import { createServer, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { CharacterClass, CharacterRef, CharacterStatus, ForeverLegacy, ForeverProfessions, ForeverQuestCompare, ForeverStatus, SourceResult } from "./types.js";
import { fetchRaiderIO } from "./sources/raiderio.js";
import { blizzardEnabled, fetchBlizzard, realmNames } from "./sources/blizzard.js";
import { fetchWarcraftLogs, warcraftLogsEnabled } from "./sources/warcraftlogs.js";
import { fetchForeverCharacter, fetchForeverRulesets } from "./sources/forever.js";
import { fetchForeverProfessions } from "./sources/foreverProfessions.js";
import { fetchForeverLegacy } from "./sources/foreverLegacy.js";
import { fetchForeverQuestCompare } from "./sources/foreverQuests.js";
import { errorMessage } from "./sources/http.js";
import { sampleBlizzard, sampleWarcraftLogs } from "./sources/placeholder.js";

const PORT = Number(process.env.PORT ?? 3000);
const CACHE_MS = 5 * 60 * 1000;

/** Parses "region/realm/name". Realms may be typed as shown in game ("Tol Barad") or as slugs ("tol-barad"). */
function parseRef(s: string): CharacterRef | null {
  const [region, realm, name, ...rest] = s.split("/").map((p) => p.trim());
  if (!region || !realm || !name || rest.length) return null;
  return {
    region: region.toLowerCase(),
    realm: realm.toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-"),
    name,
  };
}

const REGIONS = new Set(["us", "eu", "kr", "tw"]);

async function settle<T>(enabled: boolean, setupHint: string, fn: () => Promise<T>, sample?: () => T): Promise<SourceResult<T>> {
  if (!enabled) return sample ? { status: "sample", data: sample(), reason: setupHint } : { status: "disabled", reason: setupHint };
  try {
    return { status: "ok", data: await fn() };
  } catch (err) {
    return { status: "error", error: errorMessage(err) };
  }
}

// Small in-memory cache so refreshing the page doesn't hammer the APIs.
const cache = new Map<string, { at: number; value: Promise<CharacterStatus> }>();

function loadCharacter(ref: CharacterRef, force: boolean): Promise<CharacterStatus> {
  const key = `${ref.region}/${ref.realm}/${ref.name.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit.value;

  const value = (async (): Promise<CharacterStatus> => {
    const rio = settle(true, "", () => fetchRaiderIO(ref));
    // Warcraft Logs ranks per spec, so it waits for Raider.IO to say which class and spec the character is.
    const cls = rio.then((r): CharacterClass | null => (r.status === "ok" ? { className: r.data.className, activeSpec: r.data.spec } : null));
    const [raiderio, blizzard, warcraftlogs] = await Promise.all([
      rio,
      settle(blizzardEnabled, "Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env", () => fetchBlizzard(ref), () => sampleBlizzard(ref)),
      cls.then((c) => settle(warcraftLogsEnabled, "Set WCL_CLIENT_ID / WCL_CLIENT_SECRET in .env", () => fetchWarcraftLogs(ref, c), () => sampleWarcraftLogs(ref, c))),
    ]);
    return { ref, fetchedAt: new Date().toISOString(), raiderio, blizzard, warcraftlogs };
  })();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const foreverCache = new Map<string, { at: number; value: Promise<ForeverStatus> }>();

function loadForever(region: string, name: string, force: boolean): Promise<ForeverStatus> {
  const key = `${region}/${name.toLowerCase()}`;
  const hit = foreverCache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit.value;

  const hint = "Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env";
  const value = (async (): Promise<ForeverStatus> => {
    const [character, rulesets] = await Promise.all([
      settle(blizzardEnabled, hint, () => fetchForeverCharacter(region, name)),
      settle(blizzardEnabled, hint, () => fetchForeverRulesets(region)),
    ]);
    return { region, name, fetchedAt: new Date().toISOString(), character, rulesets };
  })();
  foreverCache.set(key, { at: Date.now(), value });
  value.then((r) => r.character.status === "error" && foreverCache.delete(key)); // don't keep serving a failure
  return value;
}

const professionsCache = new Map<string, { at: number; value: Promise<SourceResult<ForeverProfessions>> }>();

/** Profession earnings and missing recipes. The first load per profession takes a while (every recipe is fetched once). */
function loadProfessions(region: string, name: string, force: boolean): Promise<SourceResult<ForeverProfessions>> {
  const key = `${region}/${name.toLowerCase()}`;
  const hit = professionsCache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = settle(blizzardEnabled, "Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env", () => fetchForeverProfessions(region, name));
  professionsCache.set(key, { at: Date.now(), value });
  value.then((r) => r.status === "error" && professionsCache.delete(key)); // don't keep serving a failure
  return value;
}

const legacyCache = new Map<string, { at: number; value: Promise<SourceResult<ForeverLegacy>> }>();

function loadLegacy(region: string, name: string, force: boolean): Promise<SourceResult<ForeverLegacy>> {
  const key = `${region}/${name.toLowerCase()}`;
  const hit = legacyCache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = settle(blizzardEnabled, "Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env", () => fetchForeverLegacy(region, name));
  legacyCache.set(key, { at: Date.now(), value });
  value.then((r) => r.status === "error" && legacyCache.delete(key)); // don't keep serving a failure
  return value;
}

async function buildBundle(): Promise<{ js: string; version: string }> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./client/app.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
  });
  const js = result.outputFiles[0].text;
  return { js, version: createHash("sha1").update(js).digest("hex").slice(0, 12) };
}

// In production the code can't change while the server runs, so it's bundled once; in dev it's rebuilt per request.
let bundled: Promise<{ js: string; version: string }> | null = null;
function clientBundle() {
  if (process.env.NODE_ENV !== "production") return buildBundle();
  bundled ??= buildBundle();
  bundled.catch(() => (bundled = null));
  return bundled;
}

function send(res: ServerResponse, status: number, type: string, body: string, cacheControl = "no-store") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": cacheControl });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname === "/") {
      // The script URL carries a hash of the code, so a deploy gives it a new address that no cache (Cloudflare, the
      // browser) has seen. Without it, a cache in front of the server can keep serving the old script with the new page.
      const [html, { version }] = await Promise.all([readFile(new URL("../public/index.html", import.meta.url), "utf8"), clientBundle()]);
      return send(res, 200, "text/html; charset=utf-8", html.replace('src="/app.js"', `src="/app.js?v=${version}"`));
    }
    if (url.pathname === "/app.js") {
      const { js, version } = await clientBundle();
      // A versioned URL never changes content, so it can be cached for good; the bare URL stays uncached.
      const immutable = url.searchParams.get("v") === version;
      return send(res, 200, "text/javascript; charset=utf-8", js, immutable ? "public, max-age=31536000, immutable" : "no-store");
    }
    if (url.pathname === "/api/character") {
      // The character list lives in the browser, so any character can be requested.
      const ref = parseRef(url.searchParams.get("c") ?? "");
      if (!ref || !REGIONS.has(ref.region)) return send(res, 400, "text/plain", "Expected region/realm/name, e.g. us/azralon/Masushaman (region: us, eu, kr or tw)");
      return send(res, 200, "application/json", JSON.stringify(await loadCharacter(ref, url.searchParams.has("refresh"))));
    }
    if (url.pathname === "/api/realms") {
      // Realm names for the add-character form's suggestions.
      const region = (url.searchParams.get("region") ?? "").toLowerCase();
      if (!REGIONS.has(region)) return send(res, 400, "text/plain", "Expected region: us, eu, kr or tw");
      return send(res, 200, "application/json", JSON.stringify(await realmNames(region).catch(() => [])));
    }
    if (url.pathname === "/api/forever/quests") {
      // ?c=region/Name-Surname, and optionally &with=region/Name-Surname to compare against.
      const parse = (v: string | null) => {
        const [region, name, ...rest] = (v ?? "").split("/").map((p) => p.trim());
        return REGIONS.has(region?.toLowerCase()) && name?.includes("-") && !rest.length ? { region: region.toLowerCase(), name } : null;
      };
      const me = parse(url.searchParams.get("c"));
      const other = url.searchParams.has("with") ? parse(url.searchParams.get("with")) : null;
      if (!me || (url.searchParams.has("with") && !other)) {
        return send(res, 400, "text/plain", "Expected region/Name-Surname, e.g. us/Thrall-Stormborn (region: us, eu, kr or tw)");
      }
      const result = await settle<ForeverQuestCompare>(blizzardEnabled, "Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env", () => fetchForeverQuestCompare(me.region, me.name, other));
      return send(res, 200, "application/json", JSON.stringify(result));
    }
    if (url.pathname === "/api/forever/legacy") {
      const [region, name, ...rest] = (url.searchParams.get("c") ?? "").split("/").map((p) => p.trim());
      if (!REGIONS.has(region?.toLowerCase()) || !name?.includes("-") || rest.length) {
        return send(res, 400, "text/plain", "Expected region/Name-Surname, e.g. us/Thrall-Stormborn (region: us, eu, kr or tw)");
      }
      return send(res, 200, "application/json", JSON.stringify(await loadLegacy(region.toLowerCase(), name, url.searchParams.has("refresh"))));
    }
    if (url.pathname === "/api/forever/professions") {
      const [region, name, ...rest] = (url.searchParams.get("c") ?? "").split("/").map((p) => p.trim());
      if (!REGIONS.has(region?.toLowerCase()) || !name?.includes("-") || rest.length) {
        return send(res, 400, "text/plain", "Expected region/Name-Surname, e.g. us/Thrall-Stormborn (region: us, eu, kr or tw)");
      }
      return send(res, 200, "application/json", JSON.stringify(await loadProfessions(region.toLowerCase(), name, url.searchParams.has("refresh"))));
    }
    if (url.pathname === "/api/forever") {
      // WoW: Forever characters have no realm: "region/Name-Surname".
      const [region, name, ...rest] = (url.searchParams.get("c") ?? "").split("/").map((p) => p.trim());
      if (!REGIONS.has(region?.toLowerCase()) || !name?.includes("-") || rest.length) {
        return send(res, 400, "text/plain", "Expected region/Name-Surname, e.g. us/Thrall-Stormborn (region: us, eu, kr or tw)");
      }
      return send(res, 200, "application/json", JSON.stringify(await loadForever(region.toLowerCase(), name, url.searchParams.has("refresh"))));
    }
    send(res, 404, "text/plain", "Not found");
  } catch (err) {
    console.error(err);
    send(res, 500, "text/plain", errorMessage(err));
  }
}).listen(PORT, () => {
  console.log(`WoW dashboard on http://localhost:${PORT}`);
  console.log(`  Raider.IO:    enabled`);
  console.log(`  Blizzard:     ${blizzardEnabled ? "enabled" : "sample data (no credentials)"}`);
  console.log(`  WarcraftLogs: ${warcraftLogsEnabled ? "enabled" : "sample data (no credentials)"}`);
});

// In a container Node is PID 1, which ignores SIGTERM unless handled, so `docker stop` would wait 10s and then kill it.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)).closeAllConnections());
}
