import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { CharacterClass, CharacterRef, CharacterStatus, SourceResult } from "./types.js";
import { fetchRaiderIO } from "./sources/raiderio.js";
import { blizzardEnabled, fetchBlizzard } from "./sources/blizzard.js";
import { fetchWarcraftLogs, warcraftLogsEnabled } from "./sources/warcraftlogs.js";
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

async function clientBundle(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./client/app.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
  });
  return result.outputFiles[0].text;
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname === "/") {
      return send(res, 200, "text/html; charset=utf-8", await readFile(new URL("../public/index.html", import.meta.url), "utf8"));
    }
    if (url.pathname === "/app.js") {
      return send(res, 200, "text/javascript; charset=utf-8", await clientBundle());
    }
    if (url.pathname === "/api/character") {
      // The character list lives in the browser, so any character can be requested.
      const ref = parseRef(url.searchParams.get("c") ?? "");
      if (!ref || !REGIONS.has(ref.region)) return send(res, 400, "text/plain", "Expected region/realm/name, e.g. us/azralon/Masushaman (region: us, eu, kr or tw)");
      return send(res, 200, "application/json", JSON.stringify(await loadCharacter(ref, url.searchParams.has("refresh"))));
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
