# WoW Dashboard

A small TypeScript dashboard for World of Warcraft characters. It pulls data from Raider.IO, the Blizzard API and Warcraft Logs.

```bash
npm install
cp .env.example .env   # optional, only needed for Blizzard / Warcraft Logs
npm run dev            # http://localhost:3000
```

Add characters with the form at the top: pick **Retail** (then region, server and name; the server box suggests the region's realms, and realms can be typed as shown in game, like `Area 52`) or **WoW: Forever** (then region, first name and surname). The list, the selected character and which panels are open are saved in your browser's local storage, so they're per browser. Panels start hidden; use the row of panel buttons under the character header to show the ones you want.

## Data sources

| Source | Key needed | What it provides |
|---|---|---|
| [Raider.IO](https://raider.io/api) | No | M+ score, recent and best runs, raid progression, gear, guild |
| [Blizzard Profile API](https://develop.battle.net/documentation/world-of-warcraft/profile-apis) | Yes (free) | Level, title, last login, full character render, secondary stats |
| [Warcraft Logs v2](https://www.warcraftlogs.com/v2-api-docs/warcraft/) | Yes (free) | Raid parse percentiles per boss |
| [Raider.IO season cutoffs](https://raider.io/api/v1/mythic-plus/season-cutoffs?region=us) | No | Region-wide score needed for the top 0.1% / 1% / 10% / 25% / 40%, and each Keystone achievement |
| [Raider.IO cutoff analysis](https://raider.io/mythic-plus/cutoffs) | No | The same percentiles within each spec, compared against the character's best spec |
| [Raider.IO periods](https://raider.io/api/v1/periods) | No | Weekly reset times, used for the Great Vault panel |
| [Raidbots static data](https://www.raidbots.com/static/data/live/bonuses.json) | No | Decodes each item's upgrade track (e.g. Myth 2/6) so the gear panel can mark upgrades and better drops |

### WoW: Forever

Add a WoW: Forever character by picking WoW: Forever in the form, then its region, first name and surname. Forever has no realms: names are unique per region, so no ruleset is needed, and servers are grouped into rulesets (PvP, Normal, Roleplay, RP-PvP). Its tab uses the same Blizzard key, through the `profile-forever-{region}` / `dynamic-forever-{region}` namespaces, and its Overview has a row of panel buttons (all closed at first, remembered per browser) for: character render, experience, gear, stats, quest log, talents (drawn like the in-game talent frame: the class's three trees from Blizzard's Forever talent data, with ranks, prerequisite arrows and game-style tooltips), professions, reputations, dungeon boss kills, achievements, PvP, transmog count, lifetime statistics (kills, deaths, travel…) and each ruleset's server status. That's 13 Blizzard calls per character, cached for 5 minutes. Blizzard hasn't documented the Forever API yet ([what's known to work](https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334)); characters only appear once they reach level 10 and log out, and their portrait can take hours to show up. Raider.IO and Warcraft Logs don't cover Forever.

The **Quests** view lists the quest log (area, type such as Dungeon or Elite, and XP) and can compare it with another saved Forever character: quests in both logs, quests only one has, and quests one has completed that the other hasn't. Blizzard's API has no quest levels, so each quest links to its Wowhead page instead.

The **Professions** view (button under the Forever header) shows each profession's skill, the recipes the character knows (what each makes and its materials) and the ones it's missing, with how to learn them: the "Plans:" / "Pattern:" / "Recipe:" item and the skill it needs, or "Trainer or other" when the API doesn't say. Missing recipes are sorted by the skill they need and can be filtered by name, by category or to the ones learnable now. Each one links to its [Wowhead WoW: Forever](https://www.wowhead.com/forever) page for where it comes from (vendor, drop or quest), since Blizzard's API doesn't say. Every recipe is fetched once per server run, so the first load takes about 20 seconds.

The **Legacy** view tracks Legacy Points, styled after the in-game achievement frame. Each Legacy Challenge is an account-wide achievement whose reward is a Legacy Point, so it shows all 65 by category with what's done, progress bars (class level, profession skill, battleground reputation) and dungeon/raid checklists, plus the collection rewards at 15, 25, 40 and 55 points. Those reward thresholds aren't in the API and are hard-coded from the in-game panel. Which perks a character has spent its points on isn't in the API either.

The Great Vault panel's dungeon row uses Raider.IO's runs since the weekly reset. Its raid row counts bosses whose last kill (from Blizzard's `/encounters/raids`) is after the reset, so it needs the Blizzard key. No public API exposes delves or world activities, so that row isn't tracked. The Raid lockouts panel uses the same kill times to show, per current raid and difficulty, which bosses are killed this week and which are left (full boss lists come from Raider.IO).

Until a source's keys are set, its panel shows made-up sample data (from [src/sources/placeholder.ts](src/sources/placeholder.ts)) labelled "Sample data", and its status pill turns yellow. Once you add the keys and restart, the panel switches to real data.

### Blizzard API credentials
1. Log in at https://develop.battle.net/access/clients with your Battle.net account. Turn on the authenticator if it asks you to.
2. Click **Create Client**. Enter any name. For Redirect URL, use `http://localhost:3000/callback`. The dashboard doesn't use this URL, but the form needs a value.
3. Copy the **Client ID** and **Client Secret** into `.env` as `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`.

The app uses the client-credentials flow, which gives it read access to any public character data.

### Warcraft Logs credentials
1. Go to https://www.warcraftlogs.com/api/clients/ and create a client. For the redirect URL, use `http://localhost:3000/callback`.
2. Copy the ID and secret into `.env` as `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET`.
3. Optional: to use a zone other than the current raid, set `WCL_ZONE_ID`.

## Docker and CI

Every push to `main` runs [.github/workflows/ci.yml](.github/workflows/ci.yml): a typecheck, then (if it passes) a Docker image build pushed to `ghcr.io/joaofazolo/wow-dashboard`, tagged `latest` and with the commit SHA. Pull requests run the typecheck only.

The image doesn't contain your `.env`; pass the keys at runtime:

```bash
docker run -d -p 3000:3000 --env-file .env ghcr.io/joaofazolo/wow-dashboard:latest
```

## Layout
- `src/server.ts`: HTTP server. It caches results for 5 minutes, serves `/api/characters`, and bundles the client with esbuild on request.
- `src/sources/*`: one module per API. Each returns normalized types from `src/types.ts`.
- `src/client/app.ts`: the browser code that renders the page.
- `public/index.html`: the page shell and styles.
