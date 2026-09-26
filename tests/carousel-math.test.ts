import assert from "node:assert/strict";
import test from "node:test";
import { circularDistance, snapPosition } from "../app/jogar/carouselMath";

test("circular positions cross either end without jumping across the scene", () => {
  assert.equal(circularDistance(0, 12, 13), 1);
  assert.equal(circularDistance(12, 0, 13), -1);
  assert.ok(Math.abs(circularDistance(0, 12.8, 13)) < 0.21);
  assert.ok(Math.abs(circularDistance(12, -0.2, 13)) < 0.81);
});

test("a quick drag coasts and settles on one card with a bounded travel", () => {
  assert.equal(snapPosition(1.35, 0, 0), 1);
  assert.equal(snapPosition(1.35, 0.007, 0), 2);
  assert.equal(snapPosition(11, 1, 0), 3);
  assert.equal(snapPosition(-11, -1, 0), -3);
});
