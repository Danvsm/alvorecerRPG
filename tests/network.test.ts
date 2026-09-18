import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isTransientFetchFailure,
  readableErrorMessage,
  retryNetworkRead,
} from "../lib/network";

test("network read retries only transient fetch failures", async () => {
  let attempts = 0;
  const result = await retryNetworkRead(
    async () => {
      attempts += 1;
      return attempts < 3
        ? { data: null, error: { message: "TypeError: Failed to fetch" } }
        : { data: ["ok"], error: null };
    },
    2,
    0,
  );

  assert.equal(attempts, 3);
  assert.deepEqual(result.data, ["ok"]);
  assert.equal(result.error, null);
});

test("network read does not retry an application error", async () => {
  let attempts = 0;
  const result = await retryNetworkRead(
    async () => {
      attempts += 1;
      return { data: null, error: { message: "Acesso negado" } };
    },
    2,
    0,
  );

  assert.equal(attempts, 1);
  assert.equal((result.error as { message: string }).message, "Acesso negado");
});

test("raw browser fetch failure receives a readable message", () => {
  const failure = { message: "TypeError: Failed to fetch" };
  assert.equal(isTransientFetchFailure(failure), true);
  assert.match(readableErrorMessage(failure), /conexão oscilou/i);
  assert.equal(
    readableErrorMessage({ message: "Senha incorreta" }),
    "Senha incorreta",
  );
});

test("campaign connection avoids the duplicate realtime load", async () => {
  const source = await readFile(
    new URL("../components/Game.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /status === "SUBSCRIBED"\) load\(campaign\)/);
  assert.match(source, /retryNetworkRead\(\(\) => db\.rpc\("combat_snapshot"/);
});

test("notification clearing updates the local list without a full reload", async () => {
  const [source, notifications] = await Promise.all([
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/NotificationBell.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    source,
    /notifications: \(current\.notifications \|\| \[\]\)\.map/,
  );
  assert.match(source, /op === "notification_clear"/);
  assert.match(notifications, /Limpar notificações/);
});

test("community header and stories have no divider lines", async () => {
  const css = await readFile(
    new URL("../components/CommunityPanel.module.css", import.meta.url),
    "utf8",
  );
  const header = css.match(/\.socialHeader\s*\{[\s\S]*?\}/)?.[0] || "";
  const stories = css.match(/\.featuredRail\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.doesNotMatch(header, /border-bottom/);
  assert.doesNotMatch(stories, /border-bottom/);
  assert.match(stories, /scrollbar-width: none/);
  assert.match(
    css,
    /\.featuredRail::\-webkit-scrollbar\s*\{[\s\S]*?display: none/,
  );
});
