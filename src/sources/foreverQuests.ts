// Compares two WoW: Forever characters' quests: what's in both quest logs, what only one has, and what one has
// completed that the other hasn't. Quest details (area, type, XP) are static and cached for the life of the server.
import type { ForeverQuestCompare, QuestInfo } from "../types.js";
import { blizzardGet, blizzardGetOrNull } from "./blizzard.js";
import { pool } from "./http.js";

interface Quest {
  id: number;
  title: string;
  area?: { name: string };
  category?: { name: string };
  type?: { name: string };
  rewards?: { experience?: number };
}

const questCache = new Map<string, Promise<Quest | null>>();

function quest(region: string, id: number): Promise<Quest | null> {
  const key = `${region}/${id}`;
  let hit = questCache.get(key);
  if (!hit) {
    hit = blizzardGetOrNull<Quest>(region, `/data/wow/quest/${id}?namespace=static-forever-${region}&locale=en_US`);
    questCache.set(key, hit);
    hit.catch(() => questCache.delete(key));
  }
  return hit;
}

interface Log {
  name: string;
  level: number;
  inProgress: Map<number, string>;
  completed: Map<number, string>;
}

async function questLog(region: string, character: string): Promise<Log> {
  const base = `/profile/wow/character/${encodeURIComponent(character.toLowerCase())}`;
  const profile = `namespace=profile-forever-${region}&locale=en_US`;
  const [summary, quests, completed] = await Promise.all([
    blizzardGet<{ name: string; surname?: string; level: number }>(region, `${base}?${profile}`),
    blizzardGet<{ in_progress?: { id: number; name: string }[] }>(region, `${base}/quests?${profile}`),
    blizzardGetOrNull<{ quests?: { id: number; name: string }[] }>(region, `${base}/quests/completed?${profile}`),
  ]);
  return {
    name: [summary.name, summary.surname].filter(Boolean).join(" "),
    level: summary.level,
    inProgress: new Map((quests.in_progress ?? []).map((q) => [q.id, q.name])),
    completed: new Map((completed?.quests ?? []).map((q) => [q.id, q.name])),
  };
}

/** Quest details for a set of ids, sorted by area then name. Quests the API can't find keep their name only. */
async function describe(region: string, ids: Map<number, string>): Promise<QuestInfo[]> {
  const list = await pool([...ids], async ([id, name]): Promise<QuestInfo> => {
    const q = await quest(region, id).catch(() => null);
    // Class quests have no area, only a category (e.g. "Warrior").
    return { id, name: q?.title ?? name, area: q?.area?.name ?? q?.category?.name ?? null, type: q?.type?.name ?? null, xp: q?.rewards?.experience ?? null };
  });
  return list.sort((a, b) => (a.area ?? "~").localeCompare(b.area ?? "~") || a.name.localeCompare(b.name));
}

const only = <T>(a: Map<number, T>, b: Map<number, T> | null) => new Map([...a].filter(([id]) => !b?.has(id)));
const both = <T>(a: Map<number, T>, b: Map<number, T>) => new Map([...a].filter(([id]) => b.has(id)));

export async function fetchForeverQuestCompare(region: string, character: string, other: { region: string; name: string } | null): Promise<ForeverQuestCompare> {
  const [me, them] = await Promise.all([questLog(region, character), other ? questLog(other.region, other.name) : Promise.resolve(null)]);
  const [shared, onlyMe, onlyOther, doneOnlyMe, doneOnlyOther] = await Promise.all([
    them ? describe(region, both(me.inProgress, them.inProgress)) : Promise.resolve([]),
    describe(region, only(me.inProgress, them?.inProgress ?? null)),
    them ? describe(region, only(them.inProgress, me.inProgress)) : Promise.resolve([]),
    them ? describe(region, only(me.completed, them.completed)) : Promise.resolve([]),
    them ? describe(region, only(them.completed, me.completed)) : Promise.resolve([]),
  ]);
  return {
    me: { name: me.name, level: me.level },
    other: them ? { name: them.name, level: them.level } : null,
    inProgress: { shared, onlyMe, onlyOther },
    completed: { both: them ? both(me.completed, them.completed).size : me.completed.size, onlyMe: doneOnlyMe, onlyOther: doneOnlyOther },
  };
}
