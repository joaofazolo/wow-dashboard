import { loadWaylaid, setupWaylaid, waylaidView } from "./waylaid.js";
import type { BlizzardData, CharacterRef, CharacterStatus, ForeverCharacter, ForeverLegacy, LegacyChallenge, ForeverProfessions, ProfessionProgress, ProfessionRecipe,ForeverRuleset, ForeverStatus, TalentTree, ForeverQuestCompare, QuestInfo, GearItem,KeystoneRun, RaidDifficulty, RaiderIOData, SourceResult, WarcraftLogsData } from "../types.js";

const CLASS_COLORS: Record<string, string> = {
  "Death Knight": "#C41E3A", "Demon Hunter": "#A330C9", Druid: "#FF7C0A", Evoker: "#33937F",
  Hunter: "#AAD372", Mage: "#3FC7EB", Monk: "#00FF98", Paladin: "#F48CBA", Priest: "#FFFFFF",
  Rogue: "#FFF468", Shaman: "#0070DD", Warlock: "#8788EE", Warrior: "#C69B6D",
};
const QUALITY = ["#9d9d9d", "var(--q-common)", "var(--q-uncommon)", "var(--q-rare)", "var(--q-epic)", "var(--q-legendary)"];
const DIFFICULTY: Record<number, string> = { 3: "Normal", 4: "Heroic", 5: "Mythic" };

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

// Warcraft Logs parse colors.
function parseColor(p: number | null): string {
  if (p == null) return "var(--muted)";
  if (p >= 100) return "#e5cc80";
  if (p >= 99) return "#e268a8";
  if (p >= 95) return "#ff8000";
  if (p >= 75) return "#a335ee";
  if (p >= 50) return "#0070ff";
  if (p >= 25) return "#1eff00";
  return "#666";
}

function sourceNotice<T>(r: SourceResult<T>): string | null {
  if (r.status === "disabled") return `<p class="notice">Not configured — ${esc(r.reason)}</p>`;
  if (r.status === "error") return `<p class="notice err">${esc(r.error)}</p>`;
  return null;
}

const sampleTag = <T>(r: SourceResult<T>) =>
  r.status === "sample" ? `<p class="sample-tag">Sample data, not your character. ${esc(r.reason)}</p>` : "";

const kpi = (label: string, value: string, color?: string) =>
  `<div class="kpi"><div class="label">${label}</div><div class="value"${color ? ` style="color:${color}"` : ""}>${value}</div></div>`;

function runsTable(runs: KeystoneRun[]): string {
  if (!runs.length) return `<p class="notice">No runs this season.</p>`;
  return `<table>
    <tr><th>Dungeon</th><th class="num">Key</th><th class="num">Time</th><th class="num">Score</th><th class="num">When</th></tr>
    ${runs.map((r) => `<tr>
      <td><a href="${esc(r.url)}" target="_blank" title="${esc(r.dungeon)}">${esc(r.dungeon)}</a></td>
      <td class="num ${r.upgrades > 0 ? "timed" : "depleted"}">+${r.level}${"★".repeat(r.upgrades)}</td>
      <td class="num">${mmss(r.clearTimeMs)} / ${mmss(r.parTimeMs)}</td>
      <td class="num">${r.score.toFixed(1)}</td>
      <td class="num">${ago(r.completedAt)}</td>
    </tr>`).join("")}
  </table>`;
}

function mythicPlusSection(rio: RaiderIOData): string {
  return `<section data-panel="recent-runs">
    <h3>Mythic+ — recent runs <a href="${esc(rio.profileUrl)}" target="_blank">raider.io ↗</a></h3>
    ${runsTable(rio.recentRuns.slice(0, 8))}
  </section>
  <section data-panel="best-runs">
    <h3>Mythic+ — best runs</h3>
    ${runsTable([...rio.bestRuns].sort((a, b) => b.score - a.score))}
  </section>`;
}

function raidSection(rio: RaiderIOData): string {
  const rows = rio.raids.map((r) => {
    const pct = (n: number) => (r.totalBosses ? (n / r.totalBosses) * 100 : 0);
    return `<tr><td>${esc(r.name)}</td><td class="num"><strong>${esc(r.summary)}</strong>
      <div class="bar" title="N ${r.normal} / H ${r.heroic} / M ${r.mythic}"><span style="width:${pct(r.mythic) || pct(r.heroic) || pct(r.normal)}%;background:${r.mythic ? "var(--q-legendary)" : r.heroic ? "var(--q-epic)" : "var(--q-rare)"}"></span></div></td></tr>`;
  });
  return `<section data-panel="raids"><h3>Raid progression</h3>${rows.length ? `<table>${rows.join("")}</table>` : `<p class="notice">No raid kills.</p>`}</section>`;
}

// What could replace this item: an upgrade on its own track, or (once maxed, or crafted) a drop from a higher track.
function gearOutlook(g: GearItem, seasonMax: number | null): { kind: "upgrade" | "drop"; target: number; why: string } | null {
  const u = g.upgrade;
  if (u && u.level < u.max) return { kind: "upgrade", target: u.maxItemLevel, why: `${u.track} ${u.level}/${u.max}: upgrade to ${u.maxItemLevel} with crests` };
  if (seasonMax && g.itemLevel < seasonMax) {
    const from = u ? `${u.track} ${u.level}/${u.max} is maxed` : "Not on an upgrade track (crafted or special)";
    return { kind: "drop", target: seasonMax, why: `${from}: a Myth-track drop reaches ${seasonMax}` };
  }
  return null;
}

function gearSection(rio: RaiderIOData): string {
  const rows = rio.gear.map((g) => ({ g, o: gearOutlook(g, rio.seasonMaxItemLevel) }));
  const count = (k: string) => rows.filter((r) => r.o?.kind === k).length;
  const summary = rio.seasonMaxItemLevel
    ? `<p class="gear-legend"><span class="up">↑ ${count("upgrade")} upgradeable</span> · <span class="drop">◆ ${count("drop")} have better drops</span> · season max ${rio.seasonMaxItemLevel}</p>`
    : `<p class="notice">Upgrade data unavailable.</p>`;
  return `<section data-panel="gear"><h3>Gear <span>${rio.itemLevel} ilvl</span></h3>${summary}<table class="gear">
    ${rows.map(({ g, o }) => `<tr${o ? ` title="${esc(o.why)}"` : ""}>
      <td class="slot">${esc(g.slot)}</td>
      <td class="name" style="color:${QUALITY[g.quality] ?? "inherit"}">${esc(g.name)}</td>
      <td class="track">${g.upgrade ? `${esc(g.upgrade.track)} ${g.upgrade.level}/${g.upgrade.max}` : "—"}</td>
      <td class="num">${g.itemLevel}</td>
      <td class="num mark">${o ? `<span class="${o.kind === "upgrade" ? "up" : "drop"}">${o.kind === "upgrade" ? "↑" : "◆"} ${o.target}</span>` : ""}</td>
    </tr>`).join("")}
  </table></section>`;
}

const DIFFICULTY_NAME: Record<RaidDifficulty, string> = { LFR: "LFR", NORMAL: "Normal", HEROIC: "Heroic", MYTHIC: "Mythic" };

function until(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${mins % 60}m`;
}

/** One Great Vault row: a slot unlocks at each threshold, and its reward is set by the Nth best entry. */
function vaultRow(label: string, unit: string, thresholds: number[], done: string[] | null, note = ""): string {
  const slots = thresholds.map((t) => {
    const need = `${t} ${t === 1 ? unit.replace(/s$/, "") : unit}`;
    if (!done) return `<div class="slot locked"><div class="reward">?</div><div class="need">${need}</div></div>`;
    return done.length >= t
      ? `<div class="slot open"><div class="reward">${esc(done[t - 1])}</div><div class="need">${need}</div></div>`
      : `<div class="slot locked"><div class="reward">${done.length}/${t}</div><div class="need">${need}</div></div>`;
  });
  return `<div class="vault-row"><div class="vault-label">${label}${note}</div>${slots.join("")}</div>`;
}

function vaultSection(rio: RaiderIOData, bnet: SourceResult<BlizzardData>): string {
  const runs = rio.weeklyRuns.map((r) => `+${r.level}`);
  const raid = bnet.status === "ok" || bnet.status === "sample" ? bnet.data.weeklyRaidKills?.map((k) => DIFFICULTY_NAME[k.difficulty]) ?? null : null;
  const raidNote =
    bnet.status === "sample" ? `<div class="sample-tag">Sample data</div>`
    : bnet.status === "disabled" ? `<div class="vault-note">Needs Blizzard key</div>`
    : bnet.status === "error" ? `<div class="vault-note err" title="${esc(bnet.error)}">Blizzard error</div>`
    : raid ? "" : `<div class="vault-note">Unavailable</div>`;
  return `<section data-panel="vault">
    <h3>Great Vault ${rio.week ? `<span>resets in ${until(rio.week.end)}</span>` : ""}</h3>
    ${vaultRow("Raid", "bosses", [2, 4, 6], raid, raidNote)}
    ${vaultRow("Dungeons", "runs", [1, 4, 8], runs)}
    <p class="notice">World / Delves row: not exposed by any public API.</p>
  </section>`;
}

const DIFFICULTY_ORDER: RaidDifficulty[] = ["MYTHIC", "HEROIC", "NORMAL", "LFR"];

function lockoutsSection(rio: RaiderIOData, bnet: SourceResult<BlizzardData>): string {
  const head = `<h3>Raid lockouts ${rio.week ? `<span>resets in ${until(rio.week.end)}</span>` : ""}</h3>`;
  if (bnet.status === "error") return `<section data-panel="lockouts">${head}<p class="notice err">${esc(bnet.error)}</p></section>`;
  if (bnet.status !== "ok") return `<section data-panel="lockouts">${head}<p class="notice">Needs the Blizzard key (BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET in .env).</p></section>`;
  const all = bnet.data.raidLockouts;
  if (!all) return `<section data-panel="lockouts">${head}<p class="notice">Lockout data unavailable.</p></section>`;

  const raids = rio.raids.map((r) => {
    const saved = all.filter((l) => l.raid === r.name).sort((a, b) => DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty));
    const lines = saved.map((l) => {
      const bosses = (r.bosses.length ? r.bosses : l.killed).map((name) => ({ name, killed: l.killed.includes(name) }));
      return lockoutLine(DIFFICULTY_NAME[l.difficulty], l.killed.length, r.totalBosses || bosses.length, bosses);
    });
    return `<div class="lockout-raid"><div class="lockout-name">${esc(r.name)}</div>${lines.join("") || `<p class="notice">Not saved this week.</p>`}</div>`;
  });
  return `<section data-panel="lockouts">${head}${raids.join("") || `<p class="notice">No current-season raids.</p>`}${legacyLockouts(bnet.data.legacyLockouts)}</section>`;
}

/** One saved difficulty: "Heroic 2/8", then every boss as killed or still available. */
function lockoutLine(difficulty: string, killed: number, total: number, bosses: { name: string; killed: boolean }[]): string {
  const chips = bosses
    .map((b) => (b.killed ? `<span class="chip done" title="Killed this week">✓ ${esc(b.name)}</span>` : `<span class="chip" title="Still available">${esc(b.name)}</span>`))
    .join("");
  return `<div class="lockout"><div class="lockout-diff">${esc(difficulty)} <strong>${killed}/${total}</strong></div><div class="chips">${chips}</div></div>`;
}

/** Older expansions' raids saved this week, grouped by expansion, then raid. */
function legacyLockouts(legacy: BlizzardData["legacyLockouts"]): string {
  if (!legacy) return "";
  if (!legacy.length) return `<div class="legacy"><div class="lockout-name">Legacy raids</div><p class="notice">No legacy raids saved this week.</p></div>`;
  const group = <T,>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, T[]>();
    for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
    return [...m];
  };
  const html = group(legacy, (l) => l.expansion).map(([expansion, ls]) =>
    `<div class="legacy-exp">${esc(expansion)}</div>` +
    group(ls, (l) => l.raid).map(([raid, modes]) =>
      `<div class="lockout-raid"><div class="lockout-name">${esc(raid)}</div>${modes.map((l) => {
        // Without the journal's boss list, fall back to just the bosses killed.
        const bosses = l.bosses.length ? l.bosses : l.killed.map((name) => ({ name, killed: true }));
        return lockoutLine(l.difficulty, l.killed.length, l.totalBosses, bosses);
      }).join("")}</div>`).join(""));
  return `<div class="legacy"><div class="legacy-title">Legacy raids</div>${html.join("")}</div>`;
}

// Which spec each spec-aware panel shows, per character. Kept in browser storage.
const SPEC_CHOICES_KEY = "wow-dashboard:specs";

/** The spec to show in a panel: the viewer's earlier pick if still valid, else the panel's default. */
function chosenSpec(panel: string, ids: number[], fallback: number | null): number | null {
  const saved = readStorage<Record<string, number>>(SPEC_CHOICES_KEY, {})[`${selected}|${panel}`];
  return saved != null && ids.includes(saved) ? saved : fallback;
}

function saveSpec(panel: string, specId: number) {
  const all = readStorage<Record<string, number>>(SPEC_CHOICES_KEY, {});
  all[`${selected}|${panel}`] = specId;
  writeStorage(SPEC_CHOICES_KEY, all);
}

/** A row of spec buttons; clicking one re-renders just this panel (see the click handler on #root). */
function specTabs(panel: string, specs: { specId: number; name: string; note?: string }[], active: number | null): string {
  if (specs.length < 2) return "";
  return `<div class="spec-tabs" role="group" aria-label="Spec">${specs
    .map((sp) => `<button type="button" data-spec-panel="${panel}" data-spec-id="${sp.specId}" aria-pressed="${sp.specId === active}">${esc(sp.name)}${sp.note ? ` <span class="muted">${esc(sp.note)}</span>` : ""}</button>`)
    .join("")}</div>`;
}

function cutoffsSection(rio: RaiderIOData): string {
  const c = rio.cutoffs;
  if (!c) return `<section data-panel="cutoffs"><h3>Season cutoffs</h3><p class="notice">Cutoffs unavailable.</p></section>`;
  const score = rio.mythicPlus?.score ?? 0;
  const specId = chosenSpec("cutoffs", c.specs.map((sp) => sp.specId), c.defaultSpecId);
  const spec = c.specs.find((sp) => sp.specId === specId) ?? null;
  const pct = (n: number | null) => (n == null ? null : `top ${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`);
  // Cutoff score, then ✓ or how many points short.
  const cell = (target: number | null, mine: number) =>
    target == null ? `<td class="num">—</td>`
    : `<td class="num">${Math.round(target).toLocaleString()} ${mine >= target ? `<span class="up gap">✓</span>` : `<span class="muted gap">−${Math.ceil(target - mine)}</span>`}</td>`;
  const rows = c.percentiles.map((p, i) =>
    `<tr><td style="color:${esc(p.color ?? "inherit")}">${esc(p.label)}</td>${cell(p.region, score)}${spec ? cell(spec.cutoffs[i], spec.score) : ""}</tr>`);
  const achievements = c.achievements
    .map((a) => `<span class="chip ${score >= a.score ? "done" : ""}" title="Keystone ${esc(a.name)}: ${a.score}">${score >= a.score ? "✓ " : ""}${esc(a.name)} ${a.score}</span>`)
    .join("");
  const tabs = specTabs("cutoffs", c.specs.map((sp) => ({ specId: sp.specId, name: sp.name, note: sp.score ? sp.score.toFixed(0) : "–" })), specId);
  return `<section data-panel="cutoffs">
    <h3>Season cutoffs</h3>
    ${tabs}
    <table>
      <tr><th></th>
        <th class="num">Region<div class="sub-th">${score.toFixed(0)}${pct(c.regionTopPercent) ? ` · ≈ ${pct(c.regionTopPercent)}` : ""}</div></th>
        ${spec ? `<th class="num">${esc(`${spec.name} ${rio.className}`)}<div class="sub-th">${spec.score ? `${spec.score.toFixed(0)}${pct(spec.topPercent) ? ` · ≈ ${pct(spec.topPercent)}` : ""}` : "no score"}</div></th>` : ""}
      </tr>
      ${rows.join("")}
    </table>
    <div class="chips">${achievements}</div>
    <p class="notice small">Updated ${ago(c.updatedAt)} · top 0.1% is roughly the title cutoff</p>
  </section>`;
}

function statsSection(r: SourceResult<BlizzardData>): string {
  const notice = sourceNotice(r);
  if (notice || (r.status !== "ok" && r.status !== "sample")) return `<section data-panel="stats"><h3>Stats (Blizzard)</h3>${notice}</section>`;
  const s = r.data.stats;
  if (!s) return `<section data-panel="stats"><h3>Stats (Blizzard)</h3><p class="notice">No statistics returned.</p></section>`;
  const row = (k: string, v: string) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
  return `<section data-panel="stats"><h3>Stats (Blizzard)</h3>${sampleTag(r)}<table>
    ${row("Health", s.health.toLocaleString())}
    ${row(esc(s.powerType), s.power.toLocaleString())}
    ${row(esc(s.primary.name), s.primary.value.toLocaleString())}
    ${row("Stamina", s.stamina.toLocaleString())}
    ${row("Critical Strike", `${s.crit.toFixed(2)}%`)}
    ${row("Haste", `${s.haste.toFixed(2)}%`)}
    ${row("Mastery", `${s.mastery.toFixed(2)}%`)}
    ${row("Versatility", `${s.versatility.toFixed(2)}%`)}
  </table></section>`;
}

function logsSection(r: SourceResult<WarcraftLogsData>): string {
  const notice = sourceNotice(r);
  if (notice || (r.status !== "ok" && r.status !== "sample")) return `<section data-panel="logs"><h3>Warcraft Logs</h3>${notice}</section>`;
  const specId = chosenSpec("logs", r.data.specs.map((sp) => sp.specId), r.data.defaultSpecId);
  const w = r.data.specs.find((sp) => sp.specId === specId) ?? r.data.specs[0];
  const label = [w.difficulty ? DIFFICULTY[w.difficulty] : null, w.metric?.toUpperCase()].filter(Boolean).join(" · ");
  const tabs = specTabs("logs", r.data.specs.map((sp) => ({ specId: sp.specId, name: sp.name })), w.specId);
  return `<section data-panel="logs">
    <h3>Warcraft Logs ${label ? `— ${esc(label)}` : ""} <a href="${esc(r.data.profileUrl)}" target="_blank">warcraftlogs ↗</a></h3>
    ${sampleTag(r)}
    ${tabs}
    <p>Best avg <strong style="color:${parseColor(w.bestPerformanceAverage)}">${w.bestPerformanceAverage?.toFixed(1) ?? "—"}</strong>
       · Median avg <strong style="color:${parseColor(w.medianPerformanceAverage)}">${w.medianPerformanceAverage?.toFixed(1) ?? "—"}</strong></p>
    ${w.encounters.length ? `<table>
      <tr><th>Boss</th><th class="num">Best</th><th class="num">Median</th><th class="num">Kills</th></tr>
      ${w.encounters.map((e) => `<tr><td>${esc(e.name)}</td>
        <td class="num" style="color:${parseColor(e.bestPercent)}">${e.bestPercent != null ? Math.floor(e.bestPercent) : "—"}</td>
        <td class="num" style="color:${parseColor(e.medianPercent)}">${e.medianPercent != null ? Math.floor(e.medianPercent) : "—"}</td>
        <td class="num">${e.kills}</td></tr>`).join("")}
    </table>` : `<p class="notice">No ranked logs for ${esc(w.name)} in this zone.</p>`}
  </section>`;
}

function card(c: CharacterStatus): string {
  const rio = c.raiderio.status === "ok" ? c.raiderio.data : null;
  const bnet = c.blizzard.status === "ok" ? c.blizzard.data : null;
  const color = (rio && CLASS_COLORS[rio.className]) ?? "var(--accent)";

  const pill = (name: string, r: SourceResult<unknown>) =>
    `<span class="pill ${r.status}" title="${esc(r.status === "error" ? r.error : r.status === "disabled" || r.status === "sample" ? r.reason : "ok")}">${name}</span>`;

  const hero = `<div class="hero">
    <img class="avatar" src="${esc(bnet?.insetUrl ?? rio?.thumbnailUrl ?? "")}" alt="" onerror="this.style.visibility='hidden'" />
    <div>
      <h2>${esc(rio?.name ?? c.ref.name)}</h2>
      ${bnet?.title ? `<div>${esc(bnet.title)}</div>` : ""}
      <div class="sub">${bnet ? `Level ${bnet.level} · ` : ""}${rio ? `${esc(rio.race)} ${esc(rio.spec)} ${esc(rio.className)}` : ""}</div>
      <div class="sub">${rio?.guild ? `&lt;${esc(rio.guild)}&gt; · ` : ""}${esc(c.ref.realm)} (${esc(c.ref.region.toUpperCase())})${bnet ? ` · last login ${ago(bnet.lastLogin)}` : ""}</div>
    </div>
    <div class="kpis">
      ${rio?.mythicPlus ? kpi("M+ score", rio.mythicPlus.score.toFixed(1), rio.mythicPlus.color) : ""}
      ${kpi("Item level", String(bnet?.equippedItemLevel ?? rio?.itemLevel ?? "—"))}
      ${rio ? kpi("Achievements", rio.achievementPoints.toLocaleString()) : ""}
    </div>
  </div>`;

  const body = rio
    ? `<div class="grid">${vaultSection(rio, c.blizzard)}${cutoffsSection(rio)}${mythicPlusSection(rio)}${raidSection(rio)}${lockoutsSection(rio, c.blizzard)}${logsSection(c.warcraftlogs)}${gearSection(rio)}${statsSection(c.blizzard)}</div>`
    : `<section>${sourceNotice(c.raiderio)}</section>`;

  return `<article class="card" style="--class:${color}">${hero}${body}
    <div class="sources">${pill("Raider.IO", c.raiderio)}${pill("Blizzard", c.blizzard)}${pill("Warcraft Logs", c.warcraftlogs)}</div>
  </article>`;
}

// WoW: Forever characters are saved as "forever/region/Name-Surname" and get their own card.
const FOREVER = "forever";
const isForever = (key: string) => key.split("/")[0].toLowerCase() === FOREVER;

// Blizzard's item quality types.
const QUALITY_TYPE: Record<string, string> = {
  POOR: QUALITY[0], COMMON: QUALITY[1], UNCOMMON: QUALITY[2], RARE: QUALITY[3], EPIC: QUALITY[4], LEGENDARY: QUALITY[5], ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};

function foreverGearSection(ch: ForeverCharacter): string {
  const head = `<h3>Gear ${ch.equippedItemLevel ? `<span>${ch.equippedItemLevel} ilvl</span>` : ""}</h3>`;
  if (!ch.gear) return `<section data-panel="forever-gear">${head}<p class="notice">Equipment unavailable.</p></section>`;
  return `<section data-panel="forever-gear">${head}<table class="gear">
    ${ch.gear.map((g) => `<tr>
      <td class="slot">${esc(g.slot)}</td>
      <td class="name" style="color:${(g.quality && QUALITY_TYPE[g.quality]) ?? "inherit"}">${esc(g.name)}</td>
      <td class="num">${g.itemLevel ?? "—"}</td>
    </tr>`).join("")}
  </table></section>`;
}

// Talents are drawn like the in-game talent frame: three trees of 4 columns, a row per tier, arrows for prerequisites.
const TALENT_PITCH = 54; // px between talent icons
const TALENT_ICON = 38;
let talentBuild = 0; // which build is shown when a character has two (dual spec)

type Tree = TalentTree;
type TreeNode = Tree["nodes"][number];

/** A prerequisite arrow from one talent to the one it unlocks: straight down, sideways, or sideways then down. */
function talentArrow(from: TreeNode, to: TreeNode, lit: boolean): string {
  const cx = (n: TreeNode) => n.col * TALENT_PITCH + TALENT_ICON / 2;
  const top = (n: TreeNode) => (n.row - 1) * TALENT_PITCH;
  const cls = `tt-arrow${lit ? " lit" : ""}`;
  const head = 8; // room for the arrowhead before the target icon
  if (from.col === to.col) {
    return `<div class="${cls} down" style="left:${cx(from) - 3}px;top:${top(from) + TALENT_ICON}px;height:${top(to) - top(from) - TALENT_ICON - head}px"></div>`;
  }
  const left = Math.min(cx(from), cx(to)), width = Math.abs(cx(to) - cx(from));
  if (from.row === to.row) {
    const side = to.col > from.col ? "right" : "left";
    const x = side === "right" ? cx(from) + TALENT_ICON / 2 : cx(to) + TALENT_ICON / 2 + head;
    return `<div class="${cls} ${side}" style="left:${x}px;top:${top(from) + TALENT_ICON / 2 - 3}px;width:${width - TALENT_ICON - head}px"></div>`;
  }
  return `<div class="${cls} flat" style="left:${left}px;top:${top(from) + TALENT_ICON / 2 - 3}px;width:${width}px"></div>
    <div class="${cls} down" style="left:${cx(to) - 3}px;top:${top(from) + TALENT_ICON / 2}px;height:${top(to) - top(from) - TALENT_ICON / 2 - head}px"></div>`;
}

function talentTree(tree: Tree, spent: Map<number, number>, points: number, className: string): string {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const rankOf = (n: TreeNode) => spent.get(n.talentId) ?? 0;
  const maxed = (n: TreeNode) => rankOf(n) >= n.ranks.length;
  const arrows = tree.nodes.filter((n) => n.requires && byId.has(n.requires)).map((n) => talentArrow(byId.get(n.requires!)!, n, maxed(byId.get(n.requires!)!))).join("");

  const nodes = tree.nodes.map((n) => {
    const rank = rankOf(n), max = n.ranks.length;
    const needPoints = (n.row - 1) * 5;
    const prereq = n.requires ? byId.get(n.requires) : undefined;
    const open = points >= needPoints && (!prereq || maxed(prereq));
    const state = rank >= max ? "maxed" : rank > 0 ? "partial" : open ? "open" : "locked";
    // The tooltip reads like the game's: name, rank, current effect, next rank, and what's still needed.
    const tip = [
      `<div class="tt-tip-name">${esc(n.name)}</div>`,
      `<div>Rank ${rank}/${max}</div>`,
      rank > 0 ? `<div class="tt-tip-desc">${esc(n.ranks[rank - 1])}</div>` : "",
      rank < max ? `${rank > 0 ? `<div class="tt-tip-next">Next rank:</div>` : ""}<div class="tt-tip-desc">${esc(n.ranks[rank])}</div>` : "",
      points < needPoints ? `<div class="tt-tip-req">Requires ${needPoints} points in ${esc(tree.spec)} Talents</div>` : "",
      prereq && !maxed(prereq) ? `<div class="tt-tip-req">Requires ${prereq.ranks.length} point${prereq.ranks.length > 1 ? "s" : ""} in ${esc(prereq.name)}</div>` : "",
    ].join("");
    return `<div class="tt-node ${state}" tabindex="0" style="left:${n.col * TALENT_PITCH}px;top:${(n.row - 1) * TALENT_PITCH}px" aria-label="${esc(`${n.name} ${rank}/${max}`)}">
      ${n.icon ? `<img src="${esc(n.icon)}" alt="" />` : ""}
      <span class="tt-rank">${rank}/${max}</span>
      <div class="tt-tip" role="tooltip">${tip}</div>
    </div>`;
  }).join("");

  return `<div class="talent-tree"${tree.icon ? ` style="--tree-art:url('${esc(tree.icon)}')"` : ""}>
    <div class="tt-head">${tree.icon ? `<img src="${esc(tree.icon)}" alt="" />` : ""}<span>${esc(tree.spec)}</span><b>${points}</b></div>
    <div class="tt-grid" style="width:${3 * TALENT_PITCH + TALENT_ICON}px;height:${(tree.rows - 1) * TALENT_PITCH + TALENT_ICON}px" aria-label="${esc(`${tree.spec} ${className} talents`)}">${arrows}${nodes}</div>
  </div>`;
}

function foreverSpecsSection(ch: ForeverCharacter): string {
  if (!ch.builds) return `<section data-panel="forever-talents" class="wide talents" data-talents><h3>Talents</h3><p class="notice">Talents unavailable.</p></section>`;
  // Active build first; with dual spec the other one can be picked.
  const builds = [...ch.builds].sort((a, b) => Number(b.active) - Number(a.active));
  const build = builds[Math.min(talentBuild, builds.length - 1)];
  const switcher = builds.length > 1
    ? `<div class="spec-tabs" role="group" aria-label="Talent build">${builds.map((b, i) => `<button type="button" data-talent-build="${i}" aria-pressed="${b === build}">${b.active ? "Active build" : "Inactive build"}</button>`).join("")}</div>`
    : "";
  const pointsIn = (spec: string) => build?.trees.find((t) => t.name === spec)?.points ?? 0;
  const specs = ch.talentTrees?.map((t) => t.spec) ?? build?.trees.map((t) => t.name) ?? [];
  const head = `<h3>Talents <span>${specs.map(pointsIn).join(" / ")}</span></h3>`;

  if (!ch.talentTrees?.length) {
    // No layout from the API: list the talents taken instead.
    const list = build?.trees.length
      ? build.trees.map((t) => `<div class="lockout"><div class="lockout-diff">${esc(t.name)} <strong>${t.points}</strong> points</div>
          <div class="chips">${t.talents.map((x) => `<span class="chip">${esc(x.name)} ${x.rank}</span>`).join("")}</div></div>`).join("")
      : `<p class="notice">No talent points spent.</p>`;
    return `<section data-panel="forever-talents" class="wide talents" data-talents>${head}${switcher}${list}</section>`;
  }
  const spent = new Map((build?.trees ?? []).flatMap((t) => t.talents.map((x) => [x.id, x.rank] as const)));
  return `<section data-panel="forever-talents" class="wide talents" data-talents>${head}${switcher}
    <div class="talent-frame">${ch.talentTrees.map((t) => talentTree(t, spent, pointsIn(t.spec), ch.className ?? "")).join("")}</div>
  </section>`;
}

/** A 0–100% bar with a label on the left and the numbers on the right. */
const meter = (label: string, value: number, max: number, right: string, color = "var(--class, var(--accent))") =>
  `<div class="meter"><div class="meter-label"><span>${label}</span><span class="muted">${right}</span></div>
    <div class="bar"><span style="width:${max ? Math.min(100, (value / max) * 100) : 0}%;background:${color}"></span></div></div>`;

function foreverStatsSection(ch: ForeverCharacter): string {
  const s = ch.stats;
  if (!s) return `<section data-panel="forever-stats"><h3>Stats</h3><p class="notice">Stats unavailable.</p></section>`;
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const cells: [string, string | null][] = [
    ["Health", s.health.toLocaleString()], [s.powerType, s.power.toLocaleString()],
    ["Strength", String(s.strength)], ["Agility", String(s.agility)],
    ["Stamina", String(s.stamina)], ["Intellect", String(s.intellect)],
    ["Spirit", s.spirit != null ? String(s.spirit) : null], ["Armor", s.armor.toLocaleString()],
    ["Attack power", s.attackPower ? String(s.attackPower) : null], ["Ranged AP", s.rangedAttackPower ? String(s.rangedAttackPower) : null],
    ["Spell power", s.spellPower ? String(s.spellPower) : null], ["Defense", s.defense ? String(s.defense) : null],
    ["Crit", pct(s.crit)], ["Spell crit", s.spellCrit ? pct(s.spellCrit) : null],
    ["Dodge", pct(s.dodge)], ["Parry", s.parry ? pct(s.parry) : null],
    ["Block", s.block ? pct(s.block) : null], ["Main hand DPS", s.mainHandDps ? s.mainHandDps.toFixed(1) : null],
  ];
  return `<section data-panel="forever-stats"><h3>Stats</h3><div class="stat-grid">${cells
    .filter((c): c is [string, string] => c[1] != null)
    .map(([k, v]) => `<div><span class="muted">${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")}</div></section>`;
}

function foreverQuestsSection(ch: ForeverCharacter): string {
  const q = ch.quests;
  if (!q) return `<section data-panel="forever-quests"><h3>Quest log</h3><p class="notice">Quests unavailable.</p></section>`;
  return `<section data-panel="forever-quests"><h3>Quest log <span>${q.inProgress.length} active${q.completed != null ? ` · ${q.completed.toLocaleString()} done` : ""}</span></h3>
    ${q.inProgress.length ? `<ul class="quest-list">${q.inProgress.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : `<p class="notice">No quests in progress.</p>`}
  </section>`;
}

function foreverProfessionsSection(ch: ForeverCharacter): string {
  const p = ch.professions;
  const body = !p ? `<p class="notice">Professions unavailable.</p>`
    : !p.length ? `<p class="notice">No professions learned.</p>`
    : p.map((x) => meter(`${esc(x.name)}${x.secondary ? ` <span class="muted small">secondary</span>` : ""}`, x.skill, x.max, `${x.skill}/${x.max} · ${x.recipes} recipes`)).join("");
  return `<section data-panel="forever-professions"><h3>Professions</h3>${body}</section>`;
}

// Classic reputation colours, Hated (0) to Exalted (7).
const STANDING_COLORS = ["#cc2222", "#ff4422", "#ee6622", "#e6c34a", "#2fbf71", "#2fbf71", "#1fc9a8", "#1fc9d9"];

function foreverReputationsSection(ch: ForeverCharacter): string {
  const r = ch.reputations;
  if (!r) return `<section data-panel="forever-reputations"><h3>Reputations</h3><p class="notice">Reputations unavailable.</p></section>`;
  return `<section data-panel="forever-reputations"><h3>Reputations <span>${r.length}</span></h3>${r.map((x) =>
    meter(esc(x.faction), x.value, x.max, `${esc(x.standing)} ${x.max ? `${x.value.toLocaleString()}/${x.max.toLocaleString()}` : ""}`, STANDING_COLORS[x.tier] ?? "var(--muted)")).join("")}</section>`;
}

/** Dungeon boss kills, achievements, PvP and collections: the small stuff, together. */
function foreverProgressSection(ch: ForeverCharacter): string {
  const dungeons = ch.lifetime?.find((c) => c.category === "Dungeons & Raids")?.stats ?? [];
  const a = ch.achievements;
  const line = (k: string, v: string) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
  return `<section data-panel="forever-progress"><h3>Dungeons &amp; progress</h3>
    ${dungeons.length ? `<table>${dungeons.map((d) => line(esc(d.name), esc(d.value))).join("")}</table>` : `<p class="notice">No dungeon kills yet.</p>`}
    <table class="progress">
      ${a ? line("Achievements", `${a.count} · ${a.points} pts`) : ""}
      ${ch.pvp ? line("Honorable kills", (ch.pvp.honorableKills ?? 0).toLocaleString()) + line("PvP rank", String(ch.pvp.rank ?? "—")) : ""}
      ${ch.transmogs != null ? line("Appearances collected", ch.transmogs.toLocaleString()) : ""}
    </table>
    ${a?.recent.length ? `<div class="chips">${a.recent.map((e) => `<span class="chip done" title="${esc(new Date(e.at).toLocaleString())}">✓ ${esc(e.name)}</span>`).join("")}</div>` : ""}
  </section>`;
}

function foreverLifetimeSection(ch: ForeverCharacter): string {
  const cats = (ch.lifetime ?? []).filter((c) => c.category !== "Dungeons & Raids");
  if (!cats.length) return "";
  return `<section data-panel="forever-lifetime" class="wide"><h3>Lifetime statistics</h3><div class="lifetime">${cats.map((c) =>
    `<div><div class="legacy-exp">${esc(c.category)}</div><table>${c.stats.map((st) => `<tr><td>${esc(st.name)}</td><td class="num">${esc(st.value)}</td></tr>`).join("")}</table></div>`).join("")}</div></section>`;
}

/** Server status of every ruleset, for the card's footer. */
function foreverRulesets(r: SourceResult<ForeverRuleset[]>): string {
  if (r.status !== "ok") return "";
  return `<span class="rulesets" title="Forever has rulesets instead of realms">Rulesets: ${r.data
    .map((rs) => `${esc(rs.name)} <span class="${rs.up ? "timed" : "depleted"}">● ${esc(rs.status)}</span>`).join(" · ")}</span>`;
}

// The Forever card has two views: everything at a glance, or what the professions earn. Kept in browser storage.
const FOREVER_VIEW_KEY = "wow-dashboard:forever-view";
type ForeverView = "overview" | "quests" | "professions" | "legacy" | "crates";
const FOREVER_VIEWS: Record<ForeverView, string> = { overview: "Overview", quests: "Quests", professions: "Professions", legacy: "Legacy", crates: "Waylaid Crates" };
const asView = (v: unknown): ForeverView => (typeof v === "string" && Object.hasOwn(FOREVER_VIEWS, v) ? (v as ForeverView) : "overview");
let foreverView: ForeverView = asView(readStorage<string>(FOREVER_VIEW_KEY, "overview"));
let currentForever: ForeverStatus | null = null;

// Blizzard's API doesn't say where recipes come from; Wowhead's WoW: Forever database does (vendors, drops, quests).
const WOWHEAD = "https://www.wowhead.com/forever";

/** Where to look up a missing recipe's source: the item that teaches it, else the item it makes (its page lists the recipe), else a search. */
function wowheadUrl(r: ProfessionRecipe): string {
  if (r.learnFrom) return `${WOWHEAD}/item=${r.learnFrom.itemId}`;
  if (r.crafted) return `${WOWHEAD}/item=${r.crafted.id}`;
  return `${WOWHEAD}/search?q=${encodeURIComponent(r.name)}`;
}

/** A recipe's materials, e.g. "6× Copper Bar, 1× Weak Flux". */
const reagentList = (r: ProfessionRecipe) => r.reagents.map((x) => `${x.quantity}× ${x.name}`).join(", ");

// Blizzard's recipe ids aren't Wowhead's spell ids (Linen Bandage is recipe 1838, spell 3275), so a recipe name links
// to the item it makes (whose page lists the recipe), or to a Wowhead search when it makes no item.
const recipeLink = (r: ProfessionRecipe) =>
  `<a href="${r.crafted ? `${WOWHEAD}/item=${r.crafted.id}` : `${WOWHEAD}/search?q=${encodeURIComponent(r.name)}`}" target="_blank" rel="noopener">${esc(r.name)}</a>`;
const itemLink = (id: number, name: string) => `<a href="${WOWHEAD}/item=${id}" target="_blank" rel="noopener">${esc(name)}</a>`;

function professionSection(p: ProfessionProgress): string {
  const knownRows = [...p.known].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map((r) => `<tr>
      <td>${recipeLink(r)}</td><td class="muted">${esc(r.category)}</td>
      <td>${r.crafted ? `${itemLink(r.crafted.id, r.crafted.name)}${r.crafted.quantity > 1 ? ` <span class="muted small">×${r.crafted.quantity}</span>` : ""}` : `<span class="muted">—</span>`}</td>
      <td class="muted small">${r.reagents.map((x) => `${x.quantity}× ${itemLink(x.id, x.name)}`).join(", ")}</td>
    </tr>`).join("");
  const missingRows = p.missing.map((r) => {
    const learn = r.learnFrom;
    const canLearn = learn?.skill != null && learn.skill <= p.skill;
    return `<tr data-name="${esc(r.name.toLowerCase())}" data-category="${esc(r.category)}" data-learnable="${canLearn}" title="${esc(reagentList(r))}">
      <td>${recipeLink(r)}</td><td class="muted">${esc(r.category)}</td>
      <td>${learn ? esc(learn.name) : `<span class="muted">Trainer or other</span>`}
        <a class="source-link" href="${esc(wowheadUrl(r))}" target="_blank" rel="noopener" title="Where it comes from (vendor, drop or quest) on Wowhead">source ↗</a></td>
      <td class="num ${canLearn ? "up" : "muted"}">${learn?.skill ?? "—"}</td>
    </tr>`;
  }).join("");
  const learnable = p.missing.filter((r) => r.learnFrom?.skill != null && r.learnFrom.skill <= p.skill).length;
  const categories = new Map<string, number>();
  for (const r of p.missing) categories.set(r.category, (categories.get(r.category) ?? 0) + 1);
  const categoryOptions = [...categories].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join("");

  // Each profession starts closed; its header (name, skill and bar) opens it.
  return `<section class="wide profession"><details>
    <summary>
      <h3><span class="prof-name">${esc(p.name)}${p.secondary ? " (secondary)" : ""}</span> <span>${p.skill}/${p.max} · ${p.known.length} known · ${p.missing.length} missing</span></h3>
      <div class="bar"><span style="width:${p.max ? Math.min(100, (p.skill / p.max) * 100) : 0}%;background:var(--class, var(--accent))"></span></div>
    </summary>
    <h4>Your recipes</h4>
    ${knownRows ? `<div class="scroll"><table class="recipes"><tr><th>Recipe</th><th>Category</th><th>Makes</th><th>Materials</th></tr>${knownRows}</table></div>` : `<p class="notice">No recipes known.</p>`}
    <h4>Missing recipes</h4>
    <div class="missing-controls">
      <input type="search" placeholder="Filter recipes" data-missing-filter aria-label="Filter missing ${esc(p.name)} recipes" />
      <select data-missing-category aria-label="Category of missing ${esc(p.name)} recipes"><option value="">All categories (${p.missing.length})</option>${categoryOptions}</select>
      <label><input type="checkbox" data-missing-learnable /> Only ones I can learn now (${learnable})</label>
    </div>
    ${missingRows ? `<div class="scroll"><table class="recipes missing"><tr><th>Recipe</th><th>Category</th><th>Learn from</th><th class="num">Skill</th></tr>${missingRows}</table></div>` : `<p class="notice">You know every recipe.</p>`}
  </details></section>`;
}

async function loadProfessionsPage(refresh = false) {
  const key = selected;
  const page = document.querySelector<HTMLElement>(".professions-page");
  if (!key || !page || !isForever(key)) return;
  const [, region, name] = key.split("/");
  try {
    const res = await fetch(`/api/forever/professions?c=${encodeURIComponent(`${region}/${name}`)}${refresh ? "&refresh" : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as SourceResult<ForeverProfessions>;
    if (selected !== key || foreverView !== "professions" || !page.isConnected) return;
    if (data.status !== "ok") {
      page.innerHTML = `<section>${sourceNotice(data) ?? ""}</section>`;
      return;
    }
    page.innerHTML = `<div class="grid">${data.data.professions.map(professionSection).join("") || `<section><p class="notice">No professions learned.</p></section>`}</div>`;
  } catch (err) {
    if (page.isConnected) page.innerHTML = `<p class="notice err">${esc(err instanceof Error ? err.message : err)}</p>`;
  }
}

// Legacy page, styled after the in-game achievement frame: categories down the left, challenge rows on the right.
let currentLegacy: ForeverLegacy | null = null;
let legacyCategory = "Summary";

/** The in-game style status bar: dark track, green fill, the numbers centred on top. */
const wowBar = (value: number, max: number, text = `${value.toLocaleString()} / ${max.toLocaleString()}`) =>
  `<div class="wow-bar"><span style="width:${max ? Math.min(100, (value / max) * 100) : 0}%"></span><em>${esc(text)}</em></div>`;

const legacyRatio = (c: LegacyChallenge) =>
  c.completedAt ? 1
  : c.progress?.kind === "bar" ? c.progress.value / (c.progress.max || 1)
  : c.progress?.kind === "steps" ? c.progress.steps.filter((x) => x.done).length / (c.progress.steps.length || 1)
  : 0;

function legacyRow(c: LegacyChallenge): string {
  const p = c.progress;
  const body = c.completedAt ? ""
    : p?.kind === "bar" ? wowBar(p.value, p.max)
    : p?.kind === "steps" ? `<ul class="ach-steps">${p.steps.map((x) => `<li class="${x.done ? "done" : ""}">${x.done ? "✓ " : "– "}${esc(x.label)}</li>`).join("")}</ul>`
    : "";
  return `<div class="ach-row ${c.completedAt ? "done" : ""}">
    ${c.icon ? `<img class="ach-icon" src="${esc(c.icon)}" alt="" loading="lazy" />` : `<div class="ach-icon"></div>`}
    <div class="ach-text">
      <div class="ach-name">${esc(c.name)}</div>
      <div class="ach-desc">${esc(c.description)}</div>
      ${body}
    </div>
    <div class="ach-side">
      <div class="ach-shield" title="1 Legacy Point">1</div>
      ${c.completedAt ? `<div class="ach-date">${new Date(c.completedAt).toLocaleDateString()}</div>` : ""}
    </div>
  </div>`;
}

function legacySummary(l: ForeverLegacy, categories: string[]): string {
  const marks = l.rewards.map((r) => `<span class="reward-mark ${l.earned >= r.points ? "got" : ""}" style="left:${(r.points / l.total) * 100}%" title="${esc(`${r.points}: ${r.name} (${r.kind})`)}">${r.points}</span>`).join("");
  const closest = l.challenges.filter((c) => !c.completedAt && legacyRatio(c) > 0).sort((a, b) => legacyRatio(b) - legacyRatio(a)).slice(0, 5);
  const recent = l.challenges.filter((c) => c.completedAt).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)).slice(0, 3);
  return `<h4 class="lf-heading">Legacy Points Earned</h4>
    <div class="reward-track">${wowBar(l.earned, l.total)}<div class="reward-marks">${marks}</div></div>
    <div class="reward-list">${l.rewards.map((r) => `<div class="reward ${l.earned >= r.points ? "got" : ""}">
      <span class="reward-pts">${r.points}</span><span><strong>${esc(r.name)}</strong><span class="muted"> ${esc(r.kind)}</span></span>
      <span class="reward-state">${l.earned >= r.points ? "Unlocked" : `${r.points - l.earned} to go`}</span></div>`).join("")}</div>
    <p class="lf-note">Each character can spend up to ${l.perCharacterCap} of these points in its Legacy trees. Which perks a character picked isn't available from Blizzard's API.</p>
    <h4 class="lf-heading">Progress Overview</h4>
    <div class="lf-cat-bars">${categories.map((cat) => {
      const list = l.challenges.filter((c) => c.category === cat);
      return `<button type="button" class="lf-cat-bar" data-legacy-category="${esc(cat)}"><span>${esc(cat)}</span>${wowBar(list.filter((c) => c.completedAt).length, list.length)}</button>`;
    }).join("")}</div>
    ${closest.length ? `<h4 class="lf-heading">Closest to Completion</h4>${closest.map(legacyRow).join("")}` : ""}
    ${recent.length ? `<h4 class="lf-heading">Recently Earned</h4>${recent.map(legacyRow).join("")}` : ""}`;
}

function legacyFrame(l: ForeverLegacy): string {
  const categories = [...new Set(l.challenges.map((c) => c.category))];
  if (legacyCategory !== "Summary" && !categories.includes(legacyCategory)) legacyCategory = "Summary";
  const count = (cat: string) => {
    const list = l.challenges.filter((c) => c.category === cat);
    return `${list.filter((c) => c.completedAt).length}/${list.length}`;
  };
  const nav = ["Summary", ...categories].map((cat) =>
    `<button type="button" data-legacy-category="${esc(cat)}" aria-pressed="${legacyCategory === cat}"><span>${esc(cat)}</span>${cat === "Summary" ? "" : `<small>${count(cat)}</small>`}</button>`).join("");

  let content: string;
  if (legacyCategory === "Summary") content = legacySummary(l, categories);
  else {
    // Grouped by subcategory as in game; the current character's class comes first.
    const list = l.challenges.filter((c) => c.category === legacyCategory);
    const ownClass = currentForever?.character.status === "ok" ? currentForever.character.data.className : null;
    const groups = [...new Set(list.map((c) => c.subcategory ?? ""))].sort((a, b) => Number(b === ownClass) - Number(a === ownClass));
    content = groups.map((g) => `${g ? `<h4 class="lf-heading">${esc(g)}</h4>` : ""}${list.filter((c) => (c.subcategory ?? "") === g).map(legacyRow).join("")}`).join("");
  }

  return `<div class="legacy-frame">
    <div class="lf-header">
      <div class="lf-title">Legacy</div>
      <div class="lf-total"><span class="ach-shield big">${l.earned}</span><span>${l.earned} / ${l.total} Legacy Points</span></div>
    </div>
    <div class="lf-body">
      <nav class="lf-cats" aria-label="Legacy categories">${nav}</nav>
      <div class="lf-content">${content}</div>
    </div>
  </div>`;
}

async function loadLegacyPage(refresh = false) {
  const key = selected;
  const page = document.querySelector<HTMLElement>(".legacy-page");
  if (!key || !page || !isForever(key)) return;
  const [, region, name] = key.split("/");
  try {
    const res = await fetch(`/api/forever/legacy?c=${encodeURIComponent(`${region}/${name}`)}${refresh ? "&refresh" : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as SourceResult<ForeverLegacy>;
    if (selected !== key || foreverView !== "legacy" || !page.isConnected) return;
    if (data.status !== "ok") {
      page.innerHTML = `<section>${sourceNotice(data) ?? ""}</section>`;
      return;
    }
    currentLegacy = data.data;
    page.innerHTML = legacyFrame(data.data);
  } catch (err) {
    if (page.isConnected) page.innerHTML = `<p class="notice err">${esc(err instanceof Error ? err.message : err)}</p>`;
  }
}

// Quests view: this character's quest log, optionally compared with another saved Forever character.
// Who each character is compared with is kept in browser storage.
const QUEST_COMPARE_KEY = "wow-dashboard:quest-compare";
const WOWHEAD_QUEST = (id: number) => `${WOWHEAD}/quest=${id}`;

const compareTarget = (key: string): string | null => {
  const other = readStorage<Record<string, string>>(QUEST_COMPARE_KEY, {})[key];
  return other && characters.includes(other) && other !== key ? other : null;
};

function questCompareBar(): string {
  const others = characters.filter((k) => isForever(k) && k !== selected);
  const current = selected ? compareTarget(selected) : null;
  const options = others.map((k) => `<option value="${esc(k)}" ${k === current ? "selected" : ""}>${esc(k.split("/")[2].replace("-", " "))} (${esc(k.split("/")[1].toUpperCase())})</option>`).join("");
  return `<div class="quest-compare-bar">
    <label>Compare with <select data-quest-compare><option value="">Nobody, just my quests</option>${options}</select></label>
    ${others.length ? "" : `<span class="muted small">Add another WoW: Forever character at the top to compare with.</span>`}
  </div>`;
}

function questTable(quests: QuestInfo[], empty: string): string {
  if (!quests.length) return `<p class="notice">${esc(empty)}</p>`;
  return `<table class="quests">
    <tr><th>Quest</th><th>Area</th><th>Type</th><th class="num">XP</th><th class="num">Level</th></tr>
    ${quests.map((q) => `<tr>
      <td>${esc(q.name)}</td><td class="muted">${esc(q.area ?? "—")}</td>
      <td>${q.type ? `<span class="quest-type ${esc(q.type.toLowerCase())}">${esc(q.type)}</span>` : ""}</td>
      <td class="num">${q.xp != null ? q.xp.toLocaleString() : "—"}</td>
      <td class="num"><a class="source-link" href="${esc(WOWHEAD_QUEST(q.id))}" target="_blank" rel="noopener" title="Quest level and details on Wowhead (Blizzard's API doesn't give quest levels)">Wowhead ↗</a></td>
    </tr>`).join("")}
  </table>`;
}

/** Completed-quest differences are long, so they start closed. */
const questDetails = (title: string, quests: QuestInfo[], empty: string) =>
  `<details class="quest-details"><summary>${esc(title)} <span class="muted">(${quests.length})</span></summary>${questTable(quests, empty)}</details>`;

function questsView(d: ForeverQuestCompare): string {
  const me = d.me.name, them = d.other?.name;
  if (!d.other) {
    return `<div class="grid"><section class="wide"><h3>${esc(me)}'s quest log <span>${d.inProgress.onlyMe.length} in progress · ${d.completed.both.toLocaleString()} completed</span></h3>
      ${questTable(d.inProgress.onlyMe, "No quests in progress.")}</section></div>`;
  }
  return `<div class="grid">
    <section class="wide"><h3>In both quest logs <span>${d.inProgress.shared.length} shared</span></h3>
      ${questTable(d.inProgress.shared, `No quests in common. ${me} and ${them} have nothing to do together right now.`)}</section>
    <div class="quest-pair">
      <section><h3>Only ${esc(me)} <span>level ${d.me.level} · ${d.inProgress.onlyMe.length}</span></h3>${questTable(d.inProgress.onlyMe, "Nothing else in the log.")}</section>
      <section><h3>Only ${esc(them!)} <span>level ${d.other.level} · ${d.inProgress.onlyOther.length}</span></h3>${questTable(d.inProgress.onlyOther, "Nothing else in the log.")}</section>
    </div>
    <section class="wide"><h3>Completed <span>${d.completed.both.toLocaleString()} by both</span></h3>
      ${questDetails(`Done by ${me}, not by ${them}`, d.completed.onlyMe, "None.")}
      ${questDetails(`Done by ${them}, not by ${me}`, d.completed.onlyOther, "None.")}</section>
  </div>`;
}

async function loadQuestsPage() {
  const key = selected;
  const body = document.querySelector<HTMLElement>(".quests-body");
  if (!key || !body || !isForever(key)) return;
  const other = compareTarget(key);
  const toParam = (k: string) => k.split("/").slice(1).join("/");
  body.innerHTML = `<p class="loading">Loading quests${other ? ` for both characters` : ""}…</p>`;
  try {
    const res = await fetch(`/api/forever/quests?c=${encodeURIComponent(toParam(key))}${other ? `&with=${encodeURIComponent(toParam(other))}` : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as SourceResult<ForeverQuestCompare>;
    if (selected !== key || foreverView !== "quests" || compareTarget(key) !== other || !body.isConnected) return;
    body.innerHTML = data.status === "ok" ? questsView(data.data) : `<section>${sourceNotice(data) ?? ""}</section>`;
  } catch (err) {
    if (body.isConnected) body.innerHTML = `<p class="notice err">${esc(err instanceof Error ? err.message : err)}</p>`;
  }
}

function foreverCard(f: ForeverStatus): string {
  const ch = f.character.status === "ok" ? f.character.data : null;
  const color = (ch?.className && CLASS_COLORS[ch.className]) ?? "var(--accent)";
  const pill = (name: string, r: SourceResult<unknown>) =>
    `<span class="pill ${r.status}" title="${esc(r.status === "error" ? r.error : r.status === "disabled" || r.status === "sample" ? r.reason : "ok")}">${name}</span>`;
  const stat = (name: string) => ch?.lifetime?.flatMap((c) => c.stats).find((s) => s.name === name)?.value ?? null;

  const hero = `<div class="hero forever"${ch?.renderUrl ? ` style="--render:url('${esc(ch.renderUrl)}')"` : ""}>
    ${ch?.insetUrl ? `<img class="avatar" src="${esc(ch.insetUrl)}" alt="" onerror="this.style.visibility='hidden'" />` : ""}
    <div>
      <h2>${esc(ch ? [ch.name, ch.surname].filter(Boolean).join(" ") : f.name)}</h2>
      ${ch?.title ? `<div>${esc(ch.title)}</div>` : ""}
      <div class="sub">${ch ? [`Level ${ch.level}`, [ch.race, ch.spec, ch.className].filter(Boolean).map(esc).join(" ")].filter(Boolean).join(" · ") : ""}</div>
      <div class="sub">${ch?.guild ? `&lt;${esc(ch.guild)}&gt; · ` : ""}WoW: Forever (${esc(f.region.toUpperCase())})${ch?.ruleset ? ` · ${esc(ch.ruleset)} ruleset` : ""}${ch?.faction ? ` · ${esc(ch.faction)}` : ""}</div>
      <div class="sub">${ch?.experience != null ? `${ch.experience.toLocaleString()} XP into level ${ch.level}` : ""}${ch?.lastLogin ? ` · last login ${ago(ch.lastLogin)}` : ""}</div>
    </div>
    <div class="kpis">
      ${ch?.equippedItemLevel ? kpi("Item level", String(ch.equippedItemLevel)) : ""}
      ${ch?.stats ? kpi("Health", ch.stats.health.toLocaleString()) : ""}
      ${stat("Total kills") ? kpi("Kills", stat("Total kills")!) : ""}
      ${stat("Total deaths") ? kpi("Deaths", stat("Total deaths")!) : ""}
      ${ch?.quests?.completed != null ? kpi("Quests done", ch.quests.completed.toLocaleString()) : ""}
    </div>
  </div>`;

  // Sections start closed; the row of panel buttons above them opens the ones you want (see setupPanels).
  const panels = ch
    ? [foreverGearSection(ch), foreverStatsSection(ch), foreverQuestsSection(ch), foreverProfessionsSection(ch),
       foreverReputationsSection(ch), foreverProgressSection(ch), foreverSpecsSection(ch), foreverLifetimeSection(ch)].join("")
    : "";
  const views = ch
    ? `<div class="panel-bar" role="group" aria-label="View">${(Object.keys(FOREVER_VIEWS) as ForeverView[]).map((v) =>
        `<button type="button" data-forever-view="${v}" aria-pressed="${foreverView === v}">${FOREVER_VIEWS[v]}</button>`).join("")}</div>`
    : "";
  const body = !ch ? `<section>${sourceNotice(f.character)}</section>`
    : foreverView === "professions" ? `<div class="professions-page"><p class="loading">Loading recipes… the first load takes about 20 seconds.</p></div>`
    : foreverView === "legacy" ? `<div class="legacy-page"><p class="loading">Loading Legacy challenges…</p></div>`
    : foreverView === "crates" ? waylaidView({ region: f.region, level: ch.level, faction: ch.faction })
    : foreverView === "quests" ? `<div class="quests-page">${questCompareBar()}<div class="quests-body"><p class="loading">Loading quests…</p></div></div>`
    : `<div class="grid overview">${panels}</div>`;

  return `<article class="card" style="--class:${color}">${hero}${views}${body}
    <div class="sources">${pill("Blizzard (Forever)", f.character)}${foreverRulesets(f.rulesets)}</div>
  </article>`;
}

// Everything the viewer chooses is kept in this browser's storage; nothing is configured on the server.
const CHARACTERS_KEY = "wow-dashboard:characters";
const SELECTED_KEY = "wow-dashboard:character";

const tabs = document.getElementById("tabs")!;
const addForm = document.getElementById("add") as HTMLFormElement;
const addGame = document.getElementById("add-game") as HTMLSelectElement;
const addRegion = document.getElementById("add-region") as HTMLSelectElement;
const addRealm = document.getElementById("add-realm") as HTMLInputElement;
const addRealms = document.getElementById("add-realms") as HTMLDataListElement;
const addName = document.getElementById("add-name") as HTMLInputElement;
const addSurname = document.getElementById("add-surname") as HTMLInputElement;
const addStatus = document.getElementById("add-status")!;

const refKey = (r: CharacterRef) => `${r.region}/${r.realm}/${r.name}`;
/** The tab's second line: the realm, or "WoW: Forever" plus the region. */
const placeLabel = (key: string) => {
  const [a, b] = key.split("/");
  return isForever(key) ? `WoW: Forever · ${b.toUpperCase()}` : `${b.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} · ${a.toUpperCase()}`;
};
const refLabel = (key: string) => `${key.split("/")[2]} – ${placeLabel(key)}`;
const sameRef = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can block storage; the page still works until it's closed.
  }
}

let characters: string[] = readStorage<string[]>(CHARACTERS_KEY, []).filter((k) => typeof k === "string" && k.split("/").length === 3);

let selected: string | null = null;
// Class colours of characters already loaded, so tabs can be tinted.
const tabColors = new Map<string, string>();

function renderTabs() {
  tabs.replaceChildren(...characters.map((key) => {
    const name = key.split("/")[2];
    const tab = document.createElement("div");
    tab.className = `tab${key === selected ? " active" : ""}`;
    const color = tabColors.get(key);
    if (color) tab.style.setProperty("--tab-color", color);
    tab.innerHTML = `<button class="pick" aria-current="${key === selected}"><span class="name">${esc(name)}</span><span class="realm">${esc(placeLabel(key))}</span></button>
      <button class="x" title="Remove ${esc(name)}" aria-label="Remove ${esc(name)}">×</button>`;
    tab.querySelector(".pick")!.addEventListener("click", () => choose(key));
    tab.querySelector(".x")!.addEventListener("click", () => removeCharacter(key));
    return tab;
  }));
}

function removeCharacter(key: string) {
  if (!confirm(`Remove ${refLabel(key)} from the list?`)) return;
  characters = characters.filter((k) => k !== key);
  writeStorage(CHARACTERS_KEY, characters);
  if (key === selected) choose(characters[0] ?? null);
  else renderTabs();
}

/** Shows a saved character, or the "add one" screen when the list is empty. */
function choose(key: string | null) {
  selected = characters.find((k) => key && sameRef(k, key)) ?? characters[0] ?? null;
  renderTabs();
  const url = new URL(location.href);
  if (!selected) {
    url.searchParams.delete("c");
    history.replaceState(null, "", url);
    document.getElementById("root")!.innerHTML = `<div class="empty"><strong>No characters yet.</strong><br/>Add one at the top: pick Retail (region, server, name) or WoW: Forever (region, name, surname).</div>`;
    document.getElementById("updated")!.textContent = "";
    addName.focus();
    return;
  }
  url.searchParams.set("c", selected);
  history.replaceState(null, "", url);
  writeStorage(SELECTED_KEY, selected);
  load();
}

// Panels start hidden; a row of toggles under the character header shows them. This remembers which are shown.
const OPEN_PANELS_KEY = "wow-dashboard:open-panels";

const PANEL_LABELS: Record<string, string> = {
  vault: "Great Vault",
  cutoffs: "Season cutoffs",
  "recent-runs": "Recent runs",
  "best-runs": "Best runs",
  raids: "Raid progression",
  lockouts: "Raid lockouts",
  logs: "Warcraft Logs",
  gear: "Gear",
  stats: "Stats",
  "forever-gear": "Gear",
  "forever-stats": "Stats",
  "forever-quests": "Quest log",
  "forever-professions": "Professions",
  "forever-reputations": "Reputations",
  "forever-progress": "Dungeons & progress",
  "forever-talents": "Talents",
  "forever-lifetime": "Lifetime statistics",
};

/** Adds the panel toggle row above the grid and hides every panel the viewer hasn't turned on. */
function setupPanels(root: HTMLElement) {
  const grid = root.querySelector<HTMLElement>(".grid");
  if (!grid) return;
  // Looked up fresh each time: switching spec replaces a panel's element.
  const sections = () => [...grid.querySelectorAll<HTMLElement>("section[data-panel]")];
  const open = new Set(readStorage<string[]>(OPEN_PANELS_KEY, []));

  const bar = document.createElement("div");
  bar.className = "panel-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Panels");
  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent = "Pick the panels to show above.";

  const sync = () => {
    for (const section of sections()) section.hidden = !open.has(section.dataset.panel!);
    grid.hidden = !sections().some((x) => !x.hidden);
    hint.hidden = !grid.hidden;
    for (const b of bar.querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-pressed", String(open.has(b.dataset.panel!)));
  };

  for (const section of sections()) {
    const panel = section.dataset.panel!;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.panel = panel;
    button.textContent = PANEL_LABELS[panel] ?? panel;
    button.addEventListener("click", () => {
      if (open.has(panel)) open.delete(panel);
      else open.add(panel);
      writeStorage(OPEN_PANELS_KEY, [...open]);
      sync();
    });
    bar.append(button);
  }
  grid.before(bar, hint);
  sync();
}

async function load(refresh = false) {
  const root = document.getElementById("root")!;
  const button = document.getElementById("refresh") as HTMLButtonElement;
  const key = selected;
  if (!key) return;
  button.disabled = true;
  root.innerHTML = `<div class="loading">Loading ${esc(key.split("/")[2])}…</div>`;
  try {
    if (isForever(key)) {
      const [, region, name] = key.split("/");
      const res = await fetch(`/api/forever?c=${encodeURIComponent(`${region}/${name}`)}${refresh ? "&refresh" : ""}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ForeverStatus;
      if (selected !== key) return;
      const cls = data.character.status === "ok" ? data.character.data.className : null;
      if (cls && CLASS_COLORS[cls]) {
        tabColors.set(key, CLASS_COLORS[cls]);
        renderTabs();
      }
      current = null; // spec buttons only exist on retail cards
      currentForever = data;
      root.innerHTML = foreverCard(data);
      if (foreverView === "overview") setupPanels(root);
      if (foreverView === "professions") loadProfessionsPage(refresh);
      if (foreverView === "legacy") loadLegacyPage(refresh);
      if (foreverView === "quests") loadQuestsPage();
      if (foreverView === "crates") loadWaylaid(refresh);
      document.getElementById("updated")!.textContent = `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`;
      return;
    }
    const res = await fetch(`/api/character?c=${encodeURIComponent(key)}${refresh ? "&refresh" : ""}`);
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as CharacterStatus;
    if (selected !== key) return; // a newer choice was made while this one loaded
    if (data.raiderio.status === "ok" && CLASS_COLORS[data.raiderio.data.className]) {
      tabColors.set(key, CLASS_COLORS[data.raiderio.data.className]);
      renderTabs();
    }
    current = data;
    root.innerHTML = card(data);
    setupPanels(root);
    document.getElementById("updated")!.textContent = `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`;
  } catch (err) {
    root.innerHTML = `<p class="notice err">Failed to load: ${esc(err instanceof Error ? err.message : err)}</p>`;
  } finally {
    button.disabled = false;
  }
}

/** Checks the character exists, then saves it under the name and realm the server resolved. */
async function addCharacter(region: string, realm: string, name: string) {
  if (!realm) throw new Error("Pick a server");
  const res = await fetch(`/api/character?c=${encodeURIComponent(`${region}/${realm}/${name}`)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as CharacterStatus;
  if (data.raiderio.status !== "ok" && data.blizzard.status !== "ok") {
    throw new Error(`Couldn't find ${name} on ${realm} (${region.toUpperCase()})`);
  }
  return saveCharacter(refKey({ ...data.ref, name: data.raiderio.status === "ok" ? data.raiderio.data.name : data.ref.name }));
}

/** Same as addCharacter, for WoW: Forever, where characters have a surname instead of a realm. */
async function addForeverCharacter(region: string, name: string, surname: string) {
  if (!surname) throw new Error("WoW: Forever characters need their surname too");
  const res = await fetch(`/api/forever?c=${encodeURIComponent(`${region}/${name}-${surname}`)}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as ForeverStatus;
  if (data.character.status !== "ok") {
    throw new Error(`Couldn't find ${name} ${surname} in WoW: Forever (${region.toUpperCase()})${data.character.status === "error" ? `: ${data.character.error}` : `: ${data.character.reason}`}`);
  }
  const ch = data.character.data;
  return saveCharacter(`${FOREVER}/${region}/${ch.surname ? `${ch.name}-${ch.surname}` : `${name}-${surname}`}`);
}

function saveCharacter(key: string) {
  if (!characters.some((k) => sameRef(k, key))) {
    characters = [...characters, key];
    writeStorage(CHARACTERS_KEY, characters);
  }
  return key;
}

// The add form remembers the last game and region, and shows only the fields that game needs.
const ADD_FORM_KEY = "wow-dashboard:add-form";

function syncAddForm() {
  const forever = addGame.value === "forever";
  for (const el of addForm.querySelectorAll<HTMLElement>("[data-game]")) el.hidden = el.dataset.game !== addGame.value;
  addName.placeholder = forever ? "First name" : "Name";
  writeStorage(ADD_FORM_KEY, { game: addGame.value, region: addRegion.value });
  if (!forever) loadRealmSuggestions(addRegion.value);
}

const realmSuggestions = new Map<string, Promise<string[]>>();

/** Fills the server box's suggestions with the region's realms (typing any realm still works). */
async function loadRealmSuggestions(region: string) {
  let list = realmSuggestions.get(region);
  if (!list) {
    list = fetch(`/api/realms?region=${region}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    realmSuggestions.set(region, list);
  }
  const names = await list;
  if (addRegion.value === region) addRealms.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
}

const savedForm = readStorage<{ game?: string; region?: string }>(ADD_FORM_KEY, {});
if (savedForm.game === "forever" || savedForm.game === "retail") addGame.value = savedForm.game;
if (savedForm.region && [...addRegion.options].some((o) => o.value === savedForm.region)) addRegion.value = savedForm.region;
addGame.addEventListener("change", syncAddForm);
addRegion.addEventListener("change", syncAddForm);
syncAddForm();

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = addForm.querySelector("button")!;
  button.disabled = true;
  addStatus.className = "add-status";
  addStatus.textContent = "Checking…";
  try {
    const region = addRegion.value;
    const name = addName.value.trim();
    const key = addGame.value === "forever"
      ? await addForeverCharacter(region, name, addSurname.value.trim())
      : await addCharacter(region, addRealm.value.trim(), name);
    addName.value = "";
    addSurname.value = "";
    addStatus.textContent = "";
    choose(key);
  } catch (err) {
    addStatus.className = "add-status err";
    addStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});
setupWaylaid(document.getElementById("root")!);

// Spec buttons re-render only their own panel, from the data already loaded.
let current: CharacterStatus | null = null;
// Forever card: switching view re-renders from the data already loaded.
document.getElementById("root")!.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-forever-view]");
  if (!button || !currentForever) return;
  foreverView = asView(button.dataset.foreverView);
  writeStorage(FOREVER_VIEW_KEY, foreverView);
  const root = document.getElementById("root")!;
  root.innerHTML = foreverCard(currentForever);
  if (foreverView === "overview") setupPanels(root);
  if (foreverView === "professions") loadProfessionsPage();
  if (foreverView === "legacy") loadLegacyPage();
  if (foreverView === "quests") loadQuestsPage();
  if (foreverView === "crates") loadWaylaid();
});

document.getElementById("root")!.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-legacy-category]");
  const page = document.querySelector<HTMLElement>(".legacy-page");
  if (!button || !currentLegacy || !page) return;
  legacyCategory = button.dataset.legacyCategory!;
  page.innerHTML = legacyFrame(currentLegacy);
});

document.getElementById("root")!.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-talent-build]");
  const section = document.querySelector<HTMLElement>("section[data-talents]");
  if (!button || !section || currentForever?.character.status !== "ok") return;
  talentBuild = Number(button.dataset.talentBuild);
  section.outerHTML = foreverSpecsSection(currentForever.character.data);
});

document.getElementById("root")!.addEventListener("change", (e) => {
  const select = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-quest-compare]");
  if (!select || !selected) return;
  const all = readStorage<Record<string, string>>(QUEST_COMPARE_KEY, {});
  if (select.value) all[selected] = select.value;
  else delete all[selected];
  writeStorage(QUEST_COMPARE_KEY, all);
  loadQuestsPage();
});

// Missing recipes: the filter box, category and "learn now" box hide rows in their own profession.
document.getElementById("root")!.addEventListener("input", (e) => {
  const section = (e.target as HTMLElement).closest<HTMLElement>("section.profession");
  if (!section || !(e.target as HTMLElement).matches("[data-missing-filter], [data-missing-category], [data-missing-learnable]")) return;
  const text = section.querySelector<HTMLInputElement>("[data-missing-filter]")!.value.trim().toLowerCase();
  const category = section.querySelector<HTMLSelectElement>("[data-missing-category]")!.value;
  const onlyLearnable = section.querySelector<HTMLInputElement>("[data-missing-learnable]")!.checked;
  for (const row of section.querySelectorAll<HTMLTableRowElement>("table.missing tr[data-name]")) {
    row.hidden = (!!text && !row.dataset.name!.includes(text)) || (!!category && row.dataset.category !== category) || (onlyLearnable && row.dataset.learnable !== "true");
  }
});

document.getElementById("root")!.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-spec-panel]");
  if (!button || !current || current.raiderio.status !== "ok") return;
  const panel = button.dataset.specPanel!;
  saveSpec(panel, Number(button.dataset.specId));
  const section = document.querySelector<HTMLElement>(`section[data-panel="${panel}"]`);
  const html = panel === "cutoffs" ? cutoffsSection(current.raiderio.data) : panel === "logs" ? logsSection(current.warcraftlogs) : null;
  if (section && html) section.outerHTML = html;
});

addForm.addEventListener("input", () => (addStatus.textContent = ""));


document.getElementById("refresh")!.addEventListener("click", () => load(true));

choose(new URL(location.href).searchParams.get("c") ?? readStorage<string | null>(SELECTED_KEY, null));
