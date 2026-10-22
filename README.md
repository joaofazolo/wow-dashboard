# WoW Dashboard

A small TypeScript dashboard for World of Warcraft characters. It pulls data from Raider.IO, the Blizzard API and Warcraft Logs.

```bash
npm install
cp .env.example .env   # optional, only needed for Blizzard / Warcraft Logs
npm run dev            # http://localhost:3000
```

Add characters with the box at the top (`region/realm/name`, e.g. `us/azralon/Masushaman`; realms can be typed as shown in game, like `us/Area 52/Name`). The list, the selected character and which panels are open are saved in your browser's local storage, so they're per browser. Panels start hidden; use the row of panel buttons under the character header to show the ones you want.

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

## Layout
- `src/server.ts`: HTTP server. It caches results for 5 minutes, serves `/api/characters`, and bundles the client with esbuild on request.
- `src/sources/*`: one module per API. Each returns normalized types from `src/types.ts`.
- `src/client/app.ts`: the browser code that renders the page.
- `public/index.html`: the page shell and styles.
