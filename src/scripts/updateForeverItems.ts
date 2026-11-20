// Rebuilds data/forever-items.json from the Blizzard API: `npm run items:update [region]` (default us).
// Takes a few minutes. If calls fail partway, nothing is written; run it again and it picks up where it stopped.
import { writeFile } from "node:fs/promises";
import { blizzardEnabled } from "../sources/blizzard.js";
import { BUNDLED_ITEMS, buildItemList, itemListJson } from "../sources/foreverItems.js";

const region = process.argv[2] ?? "us";
if (!blizzardEnabled) {
  console.error("Set BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env first.");
  process.exit(1);
}
const started = Date.now();
const list = await buildItemList(region, (msg) => console.log(msg));
if (!list.complete) {
  console.error("Some calls failed, so the file wasn't written. Run it again to fetch what's missing.");
  process.exit(1);
}
await writeFile(BUNDLED_ITEMS, itemListJson(list));
console.log(`Wrote ${list.items.length} items to data/forever-items.json in ${Math.round((Date.now() - started) / 1000)}s.`);
