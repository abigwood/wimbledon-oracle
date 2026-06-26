const TOURNAMENT_START = new Date("2026-06-29T11:00:00+01:00");
const API = window.WIM_API || null;
const STORAGE = {
  uid: "wimbledon_oracle_uid",
  name: "wimbledon_oracle_name",
  picks: "wimbledon_oracle_picks",
  leagues: "wimbledon_oracle_leagues",
  activeLeague: "wimbledon_oracle_active_league",
  recovery: "wimbledon_oracle_recovery",
};

const schedule = [
  ["2026-06-29", "First round", 4, 4, "featured"],
  ["2026-06-30", "First round", 4, 4, "featured"],
  ["2026-07-01", "Second round", 4, 4, "featured"],
  ["2026-07-02", "Second round", 4, 4, "featured"],
  ["2026-07-03", "Last 32", 4, 4, "featured"],
  ["2026-07-04", "Last 32", 4, 4, "featured"],
  ["2026-07-05", "Last 16", 4, 4, "all"],
  ["2026-07-06", "Last 16", 4, 4, "all"],
  ["2026-07-07", "Quarter-finals", 2, 2, "all"],
  ["2026-07-08", "Quarter-finals", 2, 2, "all"],
  ["2026-07-09", "Ladies' semi-finals", 0, 2, "all"],
  ["2026-07-10", "Gentlemen's semi-finals", 2, 0, "all"],
  ["2026-07-11", "Ladies' final", 0, 1, "all"],
  ["2026-07-12", "Gentlemen's final", 1, 0, "all"],
];

let fixtures = [];
let currentView = "today";
let tourFilter = "all";
let picks = readJSON(STORAGE.picks, {});
let playerName = localStorage.getItem(STORAGE.name) || "";
let leagueCodes = readJSON(STORAGE.leagues, []);
let activeLeague = localStorage.getItem(STORAGE.activeLeague) || leagueCodes[0] || "";
let leagueState = null;
let busyMatch = "";
let flashMessage = "";
const inviteCode = new URLSearchParams(location.search).get("league")?.toUpperCase() || "";

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function uid() {
  let value = localStorage.getItem(STORAGE.uid);
  if (!value) {
    value = `wim_${crypto.randomUUID?.() || `${Math.random().toString(36).slice(2)}_${Date.now()}`}`;
    localStorage.setItem(STORAGE.uid, value);
  }
  return value;
}

async function api(path, body) {
  if (!API) throw new Error("The shared league service is not connected.");
  const options = body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : {};
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function makeSlots() {
  return schedule.flatMap(([date, round, men, women, coverage]) => {
    const rows = [];
    for (let i = 1; i <= men; i++) rows.push(makeSlot(date, round, "men", i, coverage));
    for (let i = 1; i <= women; i++) rows.push(makeSlot(date, round, "women", i, coverage));
    return rows;
  });
}

function makeSlot(date, round, tour, n, coverage) {
  return {
    id: `${date}-${tour}-${n}`,
    date, round, tour, coverage,
    featured: coverage === "featured",
    time: null, startAt: null, court: null,
    player1: null, player2: null, seed1: null, seed2: null,
    status: "pending-draw", result: null,
  };
}

async function loadFixtures() {
  const slots = makeSlots();
  try {
    const response = await fetch(`data/fixtures.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error();
    const live = await response.json();
    const byId = Object.fromEntries((live.fixtures || []).map((fixture) => [fixture.id, fixture]));
    fixtures = slots.map((slot) => ({ ...slot, ...(byId[slot.id] || {}) }));
    (live.fixtures || []).filter((fixture) => !fixtures.some((slot) => slot.id === fixture.id)).forEach((fixture) => fixtures.push(fixture));
  } catch {
    fixtures = slots;
  }
}

async function hydrateIdentity() {
  if (!API) return;
  try {
    const me = await api(`/me?uid=${encodeURIComponent(uid())}`);
    if (me.nickname && !playerName) {
      playerName = me.nickname;
      localStorage.setItem(STORAGE.name, playerName);
    }
    if (me.recovery) localStorage.setItem(STORAGE.recovery, me.recovery);
    if (me.leagues?.length) {
      leagueCodes = [...new Set([...leagueCodes, ...me.leagues])];
      localStorage.setItem(STORAGE.leagues, JSON.stringify(leagueCodes));
      if (!activeLeague) setActiveLeague(leagueCodes[0], false);
    }
    if (activeLeague) await loadLeagueState();
  } catch {
    // The PWA remains usable for already-cached fixtures and picks while offline.
  }
}

async function loadLeagueState() {
  if (!activeLeague || !API) { leagueState = null; return; }
  try {
    leagueState = await api(`/state?code=${encodeURIComponent(activeLeague)}`);
  } catch (error) {
    leagueState = { error: error.message, code: activeLeague };
  }
}

function setActiveLeague(code, refresh = true) {
  activeLeague = code || "";
  if (activeLeague) localStorage.setItem(STORAGE.activeLeague, activeLeague);
  else localStorage.removeItem(STORAGE.activeLeague);
  if (refresh) loadLeagueState().then(render);
}

function saveLeague(code) {
  leagueCodes = [...new Set([...leagueCodes, code])];
  localStorage.setItem(STORAGE.leagues, JSON.stringify(leagueCodes));
  setActiveLeague(code, false);
}

function dateLabel(value, long = false) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: long ? "long" : "short",
    day: "numeric",
    month: long ? "long" : "short",
  }).format(new Date(`${value}T12:00:00+01:00`));
}

function matchTime(match) {
  if (match.startAt) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
    }).format(new Date(match.startAt));
  }
  return match.time || "Time TBC";
}

function daysToStart() {
  const diff = TOURNAMENT_START - Date.now();
  if (diff <= 0) return "The Championships are under way";
  const days = Math.ceil(diff / 86400000);
  return `${days} day${days === 1 ? "" : "s"} until first play`;
}

function playerInitial() {
  return (playerName.trim()[0] || "?").toUpperCase();
}

function hero() {
  return `<section class="hero">
    <span class="eyebrow">The Championships · 29 June–12 July</span>
    <h1>Call the score in sets.</h1>
    <p>Eight featured predictions per day until the round of 16. Then every gentlemen's and ladies' singles match to the finals.</p>
    <div class="countdown">🎾 <span>${daysToStart()}</span></div>
  </section>`;
}

function drawNotice() {
  if (fixtures.some((fixture) => fixture.player1 && fixture.player2)) return "";
  return `<div class="notice">
    <span class="notice-icon">📋</span>
    <div><strong>Draw pending</strong><p>The official singles draw has not yet been loaded. Match cards will populate only from confirmed Wimbledon information.</p></div>
  </div>`;
}

function installNotice() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return "";
  return `<div class="notice install-notice"><span class="notice-icon">📱</span><div><strong>Use the Home Screen app</strong><p>On iPhone: open in Safari, tap Share, then Add to Home Screen. Always use that icon so your identity and picks stay together.</p></div></div>`;
}

function scoreOptions(match) {
  return match.tour === "men"
    ? [["3–0", 3, 0], ["3–1", 3, 1], ["3–2", 3, 2], ["0–3", 0, 3], ["1–3", 1, 3], ["2–3", 2, 3]]
    : [["2–0", 2, 0], ["2–1", 2, 1], ["0–2", 0, 2], ["1–2", 1, 2]];
}

function matchOpen(match) {
  return Boolean(match.player1 && match.player2 && match.startAt && Date.now() < Date.parse(match.startAt) && !match.result && !["walkover", "retired", "cancelled", "abandoned"].includes(String(match.status).toLowerCase()));
}

function resultText(match) {
  const result = Array.isArray(match.result) ? match.result : match.result && [match.result.p1, match.result.p2];
  if (result?.length === 2) return `Final: ${result[0]}–${result[1]}`;
  if (["walkover", "retired", "cancelled", "abandoned"].includes(String(match.status).toLowerCase())) return "Void";
  if (match.startAt && Date.now() >= Date.parse(match.startAt)) return "Picks locked";
  return "Predictions open";
}

function matchCard(match) {
  const pick = picks[match.id];
  const ready = Boolean(match.player1 && match.player2);
  const open = matchOpen(match);
  const options = scoreOptions(match).map(([label, p1, p2]) => {
    const selected = pick && pick.p1 === p1 && pick.p2 === p2;
    return `<button class="score-button${selected ? " selected" : ""}" type="button" data-pick="${match.id}" data-p1="${p1}" data-p2="${p2}" ${open && busyMatch !== match.id ? "" : "disabled"}>${busyMatch === match.id && selected ? "Saving…" : label}</button>`;
  }).join("");
  return `<article class="match-card">
    <div class="match-meta">
      <span class="tour-badge">${match.tour === "men" ? "Gentlemen's singles" : "Ladies' singles"}</span>
      <span>${matchTime(match)}${match.court ? ` · ${match.court}` : ""}</span>
    </div>
    <div class="players">
      <div class="player-row"><span class="seed">${match.seed1 ? `[${match.seed1}]` : ""}</span><span class="player-name${ready ? "" : " pending"}">${match.player1 || `${match.coverage === "featured" ? "Featured" : "Draw"} player TBC`}</span></div>
      <div class="versus">VS</div>
      <div class="player-row"><span class="seed">${match.seed2 ? `[${match.seed2}]` : ""}</span><span class="player-name${ready ? "" : " pending"}">${match.player2 || "Opponent TBC"}</span></div>
    </div>
    <div class="pick-zone">
      <div class="pick-label">${ready ? resultText(match) : "Predictions open when players are confirmed"}</div>
      <div class="score-options">${options}</div>
      ${pick ? `<div class="pick-saved">🔒 Your pick: ${pick.p1}–${pick.p2}${open ? " · changeable until start" : ""}</div>` : ""}
    </div>
  </article>`;
}

function groupedDays(list) {
  return [...new Set(list.map((fixture) => fixture.date))].map((date) => {
    const matches = list.filter((fixture) => fixture.date === date);
    const round = matches[0]?.round || "";
    const featured = matches[0]?.coverage === "featured";
    const open = date === new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }) || date === "2026-06-29";
    return `<details class="day-card" ${open ? "open" : ""}>
      <summary>
        <div><strong>${dateLabel(date, true)}</strong><span>${round}</span></div>
        <span>${matches.length} predictions${featured ? " · featured selection" : " · complete singles slate"}</span>
      </summary>
      <div class="day-body">${matches.map(matchCard).join("")}</div>
    </details>`;
  }).join("");
}

function todayView() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  let dayMatches = fixtures.filter((fixture) => fixture.date === today);
  let title = "Today's predictions";
  let subtitle = dateLabel(today, true);
  if (!dayMatches.length) {
    dayMatches = fixtures.filter((fixture) => fixture.date === "2026-06-29");
    title = "Opening day preview";
    subtitle = "Monday 29 June · first round";
  }
  return `${hero()}${installNotice()}${inviteCode && !leagueCodes.includes(inviteCode) ? `<div class="notice invite-notice"><span class="notice-icon">🏆</span><div><strong>League invitation: ${inviteCode}</strong><p>Open the League tab to join.</p></div></div>` : ""}${drawNotice()}
    <div class="section-head">
      <div><span class="eyebrow">Next up</span><h2>${title}</h2><p>${subtitle}</p></div>
      <span class="pill">4 men · 4 women</span>
    </div>
    ${dayMatches.map(matchCard).join("")}`;
}

function scheduleView() {
  const filtered = fixtures.filter((fixture) => tourFilter === "all" || fixture.tour === tourFilter);
  return `${hero()}
    <div class="section-head"><div><span class="eyebrow">Full tournament</span><h2>Prediction schedule</h2></div></div>
    <div class="filters">
      ${["all", "men", "women"].map((value) => `<button class="filter${tourFilter === value ? " active" : ""}" data-filter="${value}">${value === "all" ? "All singles" : value === "men" ? "Gentlemen" : "Ladies"}</button>`).join("")}
    </div>
    ${drawNotice()}${groupedDays(filtered)}`;
}

function picksView() {
  const picked = fixtures.filter((fixture) => picks[fixture.id]);
  return `<div class="section-head"><div><span class="eyebrow">${playerName || "Your profile"}</span><h2>My predictions</h2><p>Synced securely when online; cached on this device</p></div></div>
    <div class="stats-grid">
      <div class="stat"><b>${picked.length}</b><span>Picks made</span></div>
      <div class="stat"><b>${fixtures.length}</b><span>Total cards</span></div>
      <div class="stat"><b>${fixtures.length - picked.length}</b><span>To pick</span></div>
    </div>
    ${picked.length ? groupedDays(picked) : `<div class="empty"><strong>No picks yet</strong><p>Choose a set score on any confirmed match before its scheduled start.</p></div>`}`;
}

function leagueSwitcher() {
  if (!leagueCodes.length) return "";
  return `<div class="filters">${leagueCodes.map((code) =>
    `<button class="filter${activeLeague === code ? " active" : ""}" data-league="${code}">${leagueState?.code === code ? leagueState.name : code}</button>`
  ).join("")}</div>`;
}

function revealCard(reveal) {
  const result = reveal.voided ? "Void" : reveal.settled ? `${reveal.result.p1}–${reveal.result.p2}` : "In play / awaiting result";
  return `<div class="reveal-card">
    <div class="reveal-head"><strong>${reveal.player1} v ${reveal.player2}</strong><span>${result}</span></div>
    <div class="reveal-picks">${reveal.picks.map((pick) =>
      `<div><span>${pick.nick}</span><b>${pick.asleep ? "—" : `${pick.p1}–${pick.p2}`}</b><em>${reveal.voided || !pick.settled ? "" : `+${pick.pts}`}</em></div>`
    ).join("")}</div>
  </div>`;
}

function leagueView() {
  const recovery = localStorage.getItem(STORAGE.recovery);
  const joinDefault = inviteCode || "";
  const controls = `<div class="league-actions">
    <form class="action-card" id="createLeagueForm">
      <span class="eyebrow">Start a competition</span><h3>Create a league</h3>
      <input name="leagueName" maxlength="40" placeholder="Centre Court Club" required>
      <button class="primary wide" type="submit">Create league</button>
    </form>
    <form class="action-card" id="joinLeagueForm">
      <span class="eyebrow">Got an invitation?</span><h3>Join a league</h3>
      <input name="leagueCode" maxlength="6" value="${joinDefault}" placeholder="ABC234" required>
      <button class="primary wide" type="submit">Join league</button>
    </form>
  </div>`;
  const restore = `<form class="restore-card" id="restoreForm">
    <div><strong>${recovery ? "Your recovery code" : "Returning on another device?"}</strong><p>${recovery ? `<code>${recovery}</code> — save this privately.` : "Enter your three-word recovery code to restore your identity, leagues and standings."}</p></div>
    ${recovery ? "" : `<input name="recoveryCode" placeholder="word-word-word" required><button class="primary" type="submit">Restore</button>`}
  </form>`;
  if (!leagueCodes.length) {
    return `<div class="section-head"><div><span class="eyebrow">Private predictor leagues</span><h2>Play against your mates</h2></div></div>${flash()}${controls}${restore}`;
  }
  const state = leagueState;
  const content = !state
    ? `<div class="empty"><strong>Loading league…</strong></div>`
    : state.error
      ? `<div class="notice"><span class="notice-icon">⚠️</span><div><strong>League unavailable</strong><p>${escapeHTML(state.error)}</p></div></div>`
      : `<section class="league-card">
          <span class="eyebrow">Private predictor league</span>
          <h2>${escapeHTML(state.name)}</h2>
          <div class="league-code"><span>League code</span><strong>${state.code}</strong></div>
          <button class="secondary wide" type="button" data-share-league="${state.code}">Invite mates</button>
          <table class="table"><thead><tr><th>Player</th><th>Pts</th><th>Exact</th></tr></thead>
          <tbody>${state.table.map((row, index) => `<tr><td class="${row.uid === uid() ? "you" : ""}">${index + 1}. ${escapeHTML(row.nick)}${row.uid === uid() ? " (you)" : ""}</td><td>${row.pts}</td><td>${row.exact}</td></tr>`).join("")}</tbody></table>
        </section>
        ${state.reveals?.length ? `<div class="section-head"><div><span class="eyebrow">After match start</span><h2>Recent reveals</h2></div></div>${state.reveals.map(revealCard).join("")}` : ""}`;
  return `<div class="section-head"><div><span class="eyebrow">Private predictor leagues</span><h2>League table</h2></div></div>${flash()}${leagueSwitcher()}${content}${controls}${restore}`;
}

function rulesView() {
  return `<div class="rules-card">
    <span class="eyebrow">Simple by design</span>
    <h2>How Wimbledon Oracle works</h2>
    <ul class="rules-list">
      <li>Predict the <strong>match score in sets</strong>, not each individual set.</li>
      <li>Gentlemen's singles: 3–0, 3–1 or 3–2 to either player.</li>
      <li>Ladies' singles: 2–0 or 2–1 to either player.</li>
      <li><strong>Exact set score = 5 points.</strong></li>
      <li><strong>Correct winner, wrong set score = 2 points.</strong></li>
      <li>Wrong winner or no prediction = 0 points.</li>
      <li>Picks lock at the scheduled match start and reveal to the league.</li>
      <li>Walkovers, retirements, cancellations and abandoned matches are void.</li>
    </ul>
    <div class="round-grid">
      <div class="round-rule"><b>Rounds 1–2</b><span>Top 4 men's + top 4 women's matches each day</span></div>
      <div class="round-rule"><b>Last 32</b><span>Top 4 men's + top 4 women's matches each day</span></div>
      <div class="round-rule"><b>Last 16–SF</b><span>Every men's and women's match</span></div>
      <div class="round-rule"><b>Finals</b><span>Both champions decided</span></div>
    </div>
  </div>`;
}

function flash() {
  return flashMessage ? `<div class="flash">${escapeHTML(flashMessage)}</div>` : "";
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function render() {
  const views = { today: todayView, schedule: scheduleView, picks: picksView, league: leagueView, rules: rulesView };
  document.getElementById("app").innerHTML = views[currentView]();
  document.getElementById("profileInitial").textContent = playerInitial();
  document.querySelectorAll(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === currentView));
}

async function requireName() {
  if (playerName) return true;
  document.getElementById("playerName").value = "";
  document.getElementById("profileDialog").showModal();
  return false;
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) {
    currentView = nav.dataset.view;
    if (currentView === "league") await loadLeagueState();
    render();
    scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) { tourFilter = filter.dataset.filter; render(); return; }
  const league = event.target.closest("[data-league]");
  if (league) { setActiveLeague(league.dataset.league); return; }
  const share = event.target.closest("[data-share-league]");
  if (share) {
    const url = `${location.origin}${location.pathname}?league=${share.dataset.shareLeague}`;
    const text = `Join my Wimbledon Oracle league ${share.dataset.shareLeague}: ${url}`;
    if (navigator.share) await navigator.share({ title: "Wimbledon Oracle", text, url }).catch(() => {});
    else await navigator.clipboard.writeText(text);
    flashMessage = "League invitation copied.";
    render();
    return;
  }
  const pickButton = event.target.closest("[data-pick]");
  if (pickButton) {
    if (!(await requireName())) return;
    const matchId = pickButton.dataset.pick;
    const previous = picks[matchId];
    picks[matchId] = { p1: Number(pickButton.dataset.p1), p2: Number(pickButton.dataset.p2), savedAt: Date.now() };
    busyMatch = matchId;
    render();
    try {
      await api("/pick", { uid: uid(), nickname: playerName, matchId, p1: picks[matchId].p1, p2: picks[matchId].p2 });
      localStorage.setItem(STORAGE.picks, JSON.stringify(picks));
      flashMessage = "Pick saved.";
    } catch (error) {
      if (previous) picks[matchId] = previous; else delete picks[matchId];
      flashMessage = error.message;
    } finally {
      busyMatch = "";
      render();
    }
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "createLeagueForm") {
    event.preventDefault();
    if (!(await requireName())) return;
    const name = new FormData(event.target).get("leagueName");
    try {
      const response = await api("/league", { uid: uid(), nickname: playerName, name });
      saveLeague(response.code);
      if (response.recovery) localStorage.setItem(STORAGE.recovery, response.recovery);
      await loadLeagueState();
      flashMessage = `League ${response.code} created.`;
    } catch (error) { flashMessage = error.message; }
    render();
  }
  if (event.target.id === "joinLeagueForm") {
    event.preventDefault();
    if (!(await requireName())) return;
    const code = String(new FormData(event.target).get("leagueCode") || "").toUpperCase();
    try {
      const response = await api("/join", { uid: uid(), nickname: playerName, code });
      saveLeague(response.code);
      if (response.recovery) localStorage.setItem(STORAGE.recovery, response.recovery);
      await loadLeagueState();
      history.replaceState({}, "", location.pathname);
      flashMessage = `Joined ${response.name}.`;
    } catch (error) { flashMessage = error.message; }
    render();
  }
  if (event.target.id === "restoreForm") {
    event.preventDefault();
    const code = new FormData(event.target).get("recoveryCode");
    try {
      const response = await api("/restore", { code });
      localStorage.setItem(STORAGE.uid, response.uid);
      localStorage.setItem(STORAGE.recovery, response.recovery);
      playerName = response.nickname || playerName;
      if (playerName) localStorage.setItem(STORAGE.name, playerName);
      leagueCodes = response.leagues || [];
      localStorage.setItem(STORAGE.leagues, JSON.stringify(leagueCodes));
      setActiveLeague(leagueCodes[0] || "", false);
      await loadLeagueState();
      flashMessage = "Identity and leagues restored.";
    } catch (error) { flashMessage = error.message; }
    render();
  }
});

const profileDialog = document.getElementById("profileDialog");
document.getElementById("profileButton").addEventListener("click", () => {
  document.getElementById("playerName").value = playerName;
  profileDialog.showModal();
});
document.getElementById("profileForm").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const value = document.getElementById("playerName").value.trim();
  if (!value) return;
  playerName = value;
  localStorage.setItem(STORAGE.name, playerName);
  profileDialog.close();
  render();
});

if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js")
    .then((registration) => {
      registration.update();
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    })
    .catch(() => {});
}

Promise.all([loadFixtures(), hydrateIdentity()]).then(() => {
  if (inviteCode && !leagueCodes.includes(inviteCode)) currentView = "league";
  render();
});

setInterval(async () => {
  await loadFixtures();
  if (currentView === "league") await loadLeagueState();
  render();
}, 60_000);
