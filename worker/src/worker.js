import {
  buildReveals,
  computeTable,
  isVoided,
  matchLocked,
  makeCode,
  makeRecovery,
  normNick,
  normRecovery,
  normaliseResult,
  validSetScore,
  windowState,
} from "./logic.js";

let fixtureCache = null;
let fixtureCacheAt = 0;
const CACHE_MS = 60_000;

const cors = (env) => ({
  "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
});
const json = (body, status, env) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(env) } });
const kvGet = (env, key) => env.KV.get(key, "json");
const kvPut = (env, key, value) => env.KV.put(key, JSON.stringify(value));
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

async function fixtures(env, fresh = false) {
  const now = Date.now();
  if (!fresh && fixtureCache && now - fixtureCacheAt < CACHE_MS) return fixtureCache;
  const response = await fetch(`${env.FIXTURES_URL}${fresh ? `?t=${now}` : ""}`, { cf: { cacheTtl: fresh ? 0 : 60 } });
  if (!response.ok) throw new Error(`fixture fetch ${response.status}`);
  const body = await response.json();
  const resultStore = (await kvGet(env, "results")) || {};
  fixtureCache = (body.fixtures || []).map((match) => {
    const result = resultStore[match.id];
    return result ? { ...match, ...result } : match;
  });
  fixtureCacheAt = now;
  return fixtureCache;
}

async function uniqueRecovery(env) {
  for (let i = 0; i < 10; i++) {
    const code = makeRecovery(randomBytes);
    if (!(await kvGet(env, `recovery:${code}`))) return code;
  }
  throw new Error("could not allocate recovery code");
}

async function ensureUser(env, uid, nickname) {
  const user = (await kvGet(env, `user:${uid}`)) || { nickname: "", leagues: [] };
  if (nickname) user.nickname = normNick(nickname);
  if (!user.recovery) {
    user.recovery = await uniqueRecovery(env);
    await kvPut(env, `recovery:${user.recovery}`, uid);
  }
  await kvPut(env, `user:${uid}`, user);
  return user;
}

async function members(env, league) {
  const users = await Promise.all((league.members || []).map((uid) => kvGet(env, `user:${uid}`)));
  return (league.members || []).map((uid, index) => ({
    uid,
    nick: league.names?.[uid] || users[index]?.nickname || "Anon",
    since: league.joinedAt?.[uid] || 0,
  }));
}

async function allPicks(env, ids) {
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await kvGet(env, `picks:${id}`)) || {}])));
}

async function userPicks(env, uid) {
  if (!uid) return {};
  const matchList = await fixtures(env);
  const picksByMatch = await allPicks(env, matchList.map((match) => match.id));
  return Object.fromEntries(Object.entries(picksByMatch)
    .map(([matchId, matchPicks]) => [matchId, matchPicks[uid]])
    .filter(([, pick]) => pick && pick.p1 != null && pick.p2 != null)
    .map(([matchId, pick]) => [matchId, { p1: pick.p1, p2: pick.p2, savedAt: pick.ts || Date.now() }]));
}

async function createLeague(env, body) {
  const uid = String(body.uid || "").trim();
  if (!uid) return json({ error: "uid required" }, 400, env);
  const user = await ensureUser(env, uid, body.nickname);
  let code;
  do code = makeCode(randomBytes); while (await kvGet(env, `league:${code}`));
  const name = String(body.name || "Centre Court Club").trim().slice(0, 40);
  const now = Date.now();
  await kvPut(env, `league:${code}`, {
    code, name, owner: uid, members: [uid],
    names: { [uid]: user.nickname || "Anon" },
    joinedAt: { [uid]: now },
    createdAt: now,
  });
  user.leagues = [...new Set([...(user.leagues || []), code])];
  await kvPut(env, `user:${uid}`, user);
  return json({ ok: true, code, name, recovery: user.recovery }, 200, env);
}

async function joinLeague(env, body) {
  const uid = String(body.uid || "").trim();
  const code = String(body.code || "").trim().toUpperCase();
  if (!uid || !code) return json({ error: "uid and code required" }, 400, env);
  const league = await kvGet(env, `league:${code}`);
  if (!league) return json({ error: "league not found" }, 404, env);
  const user = await ensureUser(env, uid, body.nickname);
  if (!league.members.includes(uid)) league.members.push(uid);
  league.names ||= {};
  league.joinedAt ||= {};
  league.names[uid] = user.nickname || "Anon";
  league.joinedAt[uid] ||= Date.now();
  user.leagues = [...new Set([...(user.leagues || []), code])];
  await Promise.all([kvPut(env, `league:${code}`, league), kvPut(env, `user:${uid}`, user)]);
  return json({ ok: true, code, name: league.name, recovery: user.recovery }, 200, env);
}

async function restore(env, body) {
  const recovery = normRecovery(body.code);
  const uid = await kvGet(env, `recovery:${recovery}`);
  if (!uid) return json({ error: "recovery code not found" }, 404, env);
  const user = await kvGet(env, `user:${uid}`);
  return json({ ok: true, uid, nickname: user?.nickname || "", leagues: user?.leagues || [], recovery, picks: await userPicks(env, uid) }, 200, env);
}

async function getMe(env, url) {
  const uid = url.searchParams.get("uid") || "";
  const user = uid ? await kvGet(env, `user:${uid}`) : null;
  return json(user ? { uid, nickname: user.nickname, leagues: user.leagues || [], recovery: user.recovery } : { uid, leagues: [] }, 200, env);
}

async function getUserPicks(env, url) {
  const uid = url.searchParams.get("uid") || "";
  if (!uid) return json({ error: "uid required" }, 400, env);
  return json({ uid, picks: await userPicks(env, uid) }, 200, env);
}

async function savePick(env, body) {
  const uid = String(body.uid || "").trim();
  const matchId = String(body.matchId || "").trim();
  const p1 = Number(body.p1);
  const p2 = Number(body.p2);
  if (!uid || !matchId) return json({ error: "uid and matchId required" }, 400, env);
  let matchList;
  try { matchList = await fixtures(env); }
  catch { return json({ error: "cannot verify match start; pick not saved" }, 503, env); }
  const match = matchList.find((item) => String(item.id) === matchId);
  if (!match) return json({ error: "match not found" }, 404, env);
  if (!match.player1 || !match.player2) return json({ error: "players not confirmed" }, 403, env);
  if (!validSetScore(match.tour, p1, p2)) return json({ error: "invalid set score" }, 400, env);
  if (matchLocked(match, Date.now()))
    return json({ error: "predictions are locked" }, 403, env);
  if (match.officialDay && match.officialMatchId) {
    try {
      const official = await officialMatchStatus(match);
      if (!official || !officialMatchOpen(official))
        return json({ error: "the official match status shows play has started" }, 403, env);
    } catch {
      return json({ error: "cannot verify the official match status; pick not saved" }, 503, env);
    }
  } else if (!match.startAt) {
    return json({ error: "official start information is unavailable; pick not saved" }, 503, env);
  }
  await ensureUser(env, uid, body.nickname);
  const picks = (await kvGet(env, `picks:${matchId}`)) || {};
  picks[uid] = { p1, p2, ts: Date.now() };
  await kvPut(env, `picks:${matchId}`, picks);
  return json({ ok: true, matchId, p1, p2 }, 200, env);
}

async function state(env, url) {
  const code = String(url.searchParams.get("code") || "").toUpperCase();
  const league = await kvGet(env, `league:${code}`);
  if (!league) return json({ error: "league not found" }, 404, env);
  const matchList = await fixtures(env);
  const memberList = await members(env, league);
  const picks = await allPicks(env, matchList.map((match) => match.id));
  const completed = matchList
    .map((match) => ({
      id: match.id,
      startMs: Date.parse(match.lockAt || match.startAt) || 0,
      result: normaliseResult(match),
      voided: isVoided(match),
    }))
    .filter((match) => match.result || match.voided);
  return json({
    code,
    name: league.name,
    owner: league.owner,
    table: computeTable(memberList, completed, picks),
    reveals: buildReveals(memberList, matchList, picks, Date.now()).slice(0, 20),
  }, 200, env);
}

async function officialMatchStatus(match) {
  const query = `query Schedule($year: Int!, $day: Int!) {
    schedule(year: $year, tournDay: $day) {
      courts { matches { matchId status statusCode } }
    }
  }`;
  const response = await fetch("https://www.wimbledon.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "WimbledonOracle/1.0" },
    body: JSON.stringify({
      operationName: "Schedule",
      variables: { year: 2026, day: Number(match.officialDay) },
      query,
    }),
  });
  if (!response.ok) throw new Error(`official status ${response.status}`);
  const payload = await response.json();
  const matches = payload?.data?.schedule?.courts?.flatMap((court) => court.matches || []) || [];
  return matches.find((item) => String(item.matchId) === String(match.officialMatchId));
}

export function officialMatchOpen(official) {
  const status = String(official?.status || "").toLowerCase();
  const statusCode = String(official?.statusCode || "").toUpperCase();
  return ["scheduled", "not started"].includes(status) || statusCode === "B";
}

async function settle(env, body) {
  if (!env.SETTLE_SECRET || body.secret !== env.SETTLE_SECRET) return json({ error: "forbidden" }, 403, env);
  if (!body.results || typeof body.results !== "object") return json({ error: "results object required" }, 400, env);
  await kvPut(env, "results", body.results);
  fixtureCache = null;
  return json({ ok: true, matches: Object.keys(body.results).length }, 200, env);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (request.method === "GET") {
        if (path === "/" || path === "/health") return json({ ok: true, service: "wimbledon-oracle-window" }, 200, env);
        if (path === "/me") return getMe(env, url);
        if (path === "/picks") return getUserPicks(env, url);
        if (path === "/state") return state(env, url);
      }
      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (path === "/league") return createLeague(env, body);
        if (path === "/join") return joinLeague(env, body);
        if (path === "/restore") return restore(env, body);
        if (path === "/pick") return savePick(env, body);
        if (path === "/settle") return settle(env, body);
      }
      return json({ error: "not found" }, 404, env);
    } catch (error) {
      return json({ error: "server error", detail: String(error?.message || error) }, 500, env);
    }
  },
};
