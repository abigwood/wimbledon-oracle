import test from "node:test";
import assert from "node:assert/strict";
import { mergeResultOverlay, officialMatchOpen, officialResult } from "../src/worker.js";

test("official Wimbledon booking status stays open before play starts", () => {
  assert.equal(officialMatchOpen({ status: null, statusCode: "B" }), true);
  assert.equal(officialMatchOpen({ status: "Scheduled", statusCode: "" }), true);
  assert.equal(officialMatchOpen({ status: "In Progress", statusCode: "L" }), false);
});

test("official completed result beats stale live overlay", () => {
  const official = { id: "m1", tour: "men", status: "complete", result: [2, 3], lockAt: "old" };
  const overlay = { status: "live", result: null, lockAt: "newer" };
  assert.deepEqual(mergeResultOverlay(official, overlay), official);
});

test("settlement overlay can still complete an unsettled fixture", () => {
  const official = { id: "m1", tour: "women", status: "live", result: null };
  const overlay = { status: "complete", result: [2, 0] };
  assert.deepEqual(mergeResultOverlay(official, overlay), { ...official, ...overlay });
});

test("official completed set winners are capped to the match format", () => {
  const completed = { status: "Completed", statusCode: "D", score: { setsWon: [1, 1, 1, 1, 0, 0] } };
  assert.deepEqual(officialResult(completed, "men"), [3, 0]);
});
