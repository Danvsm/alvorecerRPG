import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCompactDracmas, formatDracmas } from "../lib/currency";

test("compact Dracma balances stay readable in Portuguese", () => {
  assert.equal(formatCompactDracmas(800_000), "8 mil");
  assert.equal(formatCompactDracmas(850_000), "8,5 mil");
  assert.equal(formatCompactDracmas(12_200_00), "12,2 mil");
  assert.equal(formatCompactDracmas(100_000_000), "1 mi");
  assert.equal(formatCompactDracmas(150_000_000), "1,5 mi");
  assert.equal(formatCompactDracmas(100_000_000_000), "1 bi");
  assert.equal(formatCompactDracmas(99_950), "999,50");
  assert.equal(formatCompactDracmas(-850_000), "-8,5 mil");
});

test("full Dracma formatter remains available for exact balances", () => {
  assert.equal(formatDracmas(850_000), "8.500,00 Dracmas");
});
