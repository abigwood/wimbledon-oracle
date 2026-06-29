import test from "node:test";
import assert from "node:assert/strict";
import { buildReveals, computeTable, computeTableWithMovement, normaliseResult, scorePick, validSetScore, windowState } from "../src/logic.js";

test("tennis set scores validate by tour", () => {
  assert.equal(validSetScore("men", 3, 2), true);
  assert.equal(validSetScore("men", 2, 3), true);
  assert.equal(validSetScore("men", 2, 1), false);
  assert.equal(validSetScore("women", 2, 1), true);
  assert.equal(validSetScore("women", 3, 1), false);
});

test("window is open strictly before scheduled start", () => {
  assert.equal(windowState(1000, 999), "open");
  assert.equal(windowState(1000, 1000), "shut");
});

test("scoring is 5 exact, 2 correct winner, 0 wrong winner", () => {
  assert.deepEqual(scorePick({ p1: 3, p2: 1 }, { p1: 3, p2: 1 }).pts, 5);
  assert.deepEqual(scorePick({ p1: 3, p2: 0 }, { p1: 3, p2: 2 }).pts, 2);
  assert.deepEqual(scorePick({ p1: 3, p2: 2 }, { p1: 1, p2: 3 }).pts, 0);
});

test("official results are capped to the tour match format", () => {
  assert.deepEqual(normaliseResult({ tour: "women", result: [3, 0] }), { p1: 2, p2: 0 });
  assert.deepEqual(normaliseResult({ tour: "women", result: { p1: 0, p2: 3 } }), { p1: 0, p2: 2 });
  assert.deepEqual(normaliseResult({ tour: "men", result: [4, 1] }), { p1: 3, p2: 1 });
  assert.equal(normaliseResult({ tour: "women", result: [3, 3] }), null);
});

test("standings reject post-start picks and sort by points", () => {
  const members = [{ uid: "a", nick: "Adam", since: 0 }, { uid: "b", nick: "Ben", since: 0 }];
  const completed = [{ id: "m1", startMs: 1000, result: { p1: 3, p2: 1 }, voided: false }];
  const picks = { m1: { a: { p1: 3, p2: 1, ts: 999 }, b: { p1: 3, p2: 1, ts: 1000 } } };
  const rows = computeTable(members, completed, picks);
  assert.equal(rows[0].nick, "Adam");
  assert.equal(rows[0].pts, 5);
  assert.equal(rows[1].pts, 0);
});

test("standings include movement after the latest completed match", () => {
  const members = [{ uid: "a", nick: "Adam", since: 0 }, { uid: "b", nick: "Ben", since: 0 }, { uid: "c", nick: "Aaron", since: 0 }];
  const completed = [
    { id: "m1", startMs: 1000, result: { p1: 2, p2: 0 }, voided: false },
    { id: "m2", startMs: 2000, result: { p1: 0, p2: 2 }, voided: false },
  ];
  const picks = {
    m1: {
      a: { p1: 2, p2: 0, ts: 900 },
      b: { p1: 2, p2: 1, ts: 900 },
      c: { p1: 0, p2: 2, ts: 900 },
    },
    m2: {
      a: { p1: 2, p2: 0, ts: 1900 },
      b: { p1: 0, p2: 2, ts: 1900 },
      c: { p1: 0, p2: 2, ts: 1900 },
    },
  };
  const rows = computeTableWithMovement(members, completed, picks);
  assert.deepEqual(rows.map((row) => [row.nick, row.rank, row.previousRank, row.movement]), [
    ["Ben", 1, 2, 1],
    ["Aaron", 2, 3, 1],
    ["Adam", 3, 1, -2],
  ]);
});

test("reveals stay hidden before start and expose all members after start", () => {
  const members = [{ uid: "a", nick: "Adam", since: 0 }, { uid: "b", nick: "Ben", since: 0 }];
  const matches = [{ id: "m1", player1: "One", player2: "Two", startAt: "1970-01-01T00:00:01.000Z", result: null, tour: "women", status: "upcoming" }];
  const picks = { m1: { a: { p1: 2, p2: 0, ts: 999 } } };
  assert.equal(buildReveals(members, matches, picks, 999).length, 0);
  matches[0].result = [2, 0];
  matches[0].status = "complete";
  const reveals = buildReveals(members, matches, picks, 1000);
  assert.equal(reveals[0].picks.length, 2);
  assert.equal(reveals[0].picks[1].asleep, true);
});
