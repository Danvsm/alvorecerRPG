import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct voice calls use protected scoped signaling", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260921065500_direct_voice_call_mvp.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /create table if not exists public\.direct_calls/);
  assert.match(
    migration,
    /create table if not exists public\.direct_call_signals/,
  );
  assert.match(migration, /public\.direct_call_start/);
  assert.match(migration, /public\.direct_call_action/);
  assert.match(migration, /public\.direct_call_signal/);
  assert.match(migration, /public\.can_access_direct_call/);
  assert.match(migration, /alter publication supabase_realtime add table public\.direct_calls/);
  assert.match(
    migration,
    /alter publication supabase_realtime add table public\.direct_call_signals/,
  );
  assert.doesNotMatch(migration, /campaign_events/);
});

test("chat integrates WebRTC voice calls and high priority call push", async () => {
  const [chat, call, push, worker] = await Promise.all([
    readFile(new URL("../components/DirectChat.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/VoiceCall.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/functions/alvorecer-push/index.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../public/alvorecer-sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(chat, /<VoiceCall/);
  assert.match(chat, /voiceCallRef\.current/);
  assert.doesNotMatch(
    chat,
    /Chamadas estarão disponíveis em breve/,
  );

  assert.match(call, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(call, /new RTCPeerConnection/);
  assert.match(call, /peerPromiseRef/);
  assert.match(call, /signalQueueRef/);
  assert.match(call, /processSignalNow/);
  assert.match(call, /alvorecer-call-owner:/);
  assert.match(call, /claimCallOwnership/);
  assert.match(call, /ownsCall/);
  assert.match(call, /peer\.signalingState !== "have-local-offer"/);
  assert.match(call, /microphoneErrorMessage/);
  assert.match(call, /Ao atender, o navegador solicitará acesso ao microfone/);
  assert.match(call, /Servidor TURN necessário/);
  assert.match(call, /event\.candidate\.type === "relay"/);
  assert.match(call, /direct_call_start/);
  assert.match(call, /direct_call_action/);
  assert.match(call, /direct_call_signal/);
  assert.match(call, /stun:stun\.l\.google\.com:19302/);
  assert.match(call, /action: "chat_call"/);

  assert.match(push, /action === "chat_call"/);
  assert.match(push, /kind: "call"/);
  assert.match(push, /payload\.kind === "call"/);
  assert.match(worker, /payload\.kind === "call"/);
});
