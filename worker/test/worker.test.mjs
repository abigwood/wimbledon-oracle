import test from "node:test";
import assert from "node:assert/strict";
import { officialMatchOpen } from "../src/worker.js";

test("official Wimbledon booking status stays open before play starts", () => {
  assert.equal(officialMatchOpen({ status: null, statusCode: "B" }), true);
  assert.equal(officialMatchOpen({ status: "Scheduled", statusCode: "" }), true);
  assert.equal(officialMatchOpen({ status: "In Progress", statusCode: "L" }), false);
});
