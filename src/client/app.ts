import type { BlizzardData, CharacterRef, CharacterStatus, GearItem, KeystoneRun, RaidDifficulty, RaiderIOData, SourceResult, WarcraftLogsData } from "../types.js";

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

// Everything the viewer chooses is kept in this browser's storage; nothing is configured on the server.
const CHARACTERS_KEY = "wow-dashboard:characters";
const SELECTED_KEY = "wow-dashboard:character";

const tabs = document.getElementById("tabs")!;
const addForm = document.getElementById("add") as HTMLFormElement;
const addInput = document.getElementById("add-input") as HTMLInputElement;
const addStatus = document.getElementById("add-status")!;

const refKey = (r: CharacterRef) => `${r.region}/${r.realm}/${r.name}`;
const refLabel = (key: string) => {
  const [region, realm, name] = key.split("/");
  return `${name} – ${realm.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} (${region.toUpperCase()})`;
};
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
    const [region, realm, name] = key.split("/");
    const tab = document.createElement("div");
    tab.className = `tab${key === selected ? " active" : ""}`;
    const color = tabColors.get(key);
    if (color) tab.style.setProperty("--tab-color", color);
    tab.innerHTML = `<button class="pick" aria-current="${key === selected}"><span class="name">${esc(name)}</span><span class="realm">${esc(realm.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))} · ${esc(region.toUpperCase())}</span></button>
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
    document.getElementById("root")!.innerHTML = `<div class="empty"><strong>No characters yet.</strong><br/>Add one at the top as <code>region/realm/name</code>, e.g. <code>us/azralon/Masushaman</code>.</div>`;
    document.getElementById("updated")!.textContent = "";
    addInput.focus();
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
async function addCharacter(input: string) {
  const parts = input.split("/").map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !p)) throw new Error("Use region/realm/name, e.g. us/azralon/Masushaman");
  const res = await fetch(`/api/character?c=${encodeURIComponent(parts.join("/"))}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as CharacterStatus;
  if (data.raiderio.status !== "ok" && data.blizzard.status !== "ok") {
    throw new Error(`Couldn't find ${parts[2]} on ${parts[1]} (${parts[0].toUpperCase()})`);
  }
  const key = refKey({ ...data.ref, name: data.raiderio.status === "ok" ? data.raiderio.data.name : data.ref.name });
  if (!characters.some((k) => sameRef(k, key))) {
    characters = [...characters, key];
    writeStorage(CHARACTERS_KEY, characters);
  }
  return key;
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = addForm.querySelector("button")!;
  button.disabled = true;
  addStatus.className = "add-status";
  addStatus.textContent = "Checking…";
  try {
    const key = await addCharacter(addInput.value);
    addInput.value = "";
    addStatus.textContent = "";
    choose(key);
  } catch (err) {
    addStatus.className = "add-status err";
    addStatus.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});
// Spec buttons re-render only their own panel, from the data already loaded.
let current: CharacterStatus | null = null;
document.getElementById("root")!.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-spec-panel]");
  if (!button || !current || current.raiderio.status !== "ok") return;
  const panel = button.dataset.specPanel!;
  saveSpec(panel, Number(button.dataset.specId));
  const section = document.querySelector<HTMLElement>(`section[data-panel="${panel}"]`);
  const html = panel === "cutoffs" ? cutoffsSection(current.raiderio.data) : panel === "logs" ? logsSection(current.warcraftlogs) : null;
  if (section && html) section.outerHTML = html;
});

addInput.addEventListener("input", () => (addStatus.textContent = ""));


document.getElementById("refresh")!.addEventListener("click", () => load(true));

choose(new URL(location.href).searchParams.get("c") ?? readStorage<string | null>(SELECTED_KEY, null));
