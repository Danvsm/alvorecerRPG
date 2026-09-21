import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

test("ICE route validates user and call access even on cached credentials", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "tests/fixtures/call-ice-route.ts",
  ]);
  assert.match(stdout, /authorization passed/);
});
