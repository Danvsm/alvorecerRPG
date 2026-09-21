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
  assert.match(call, /CallNegotiator/);
  assert.match(call, /microphoneErrorMessage/);
  assert.match(call, /Ao atender, o navegador solicitará acesso ao microfone/);
  assert.match(call, /Servidor TURN necessário/);
  assert.match(call, /event\.candidate\.type === "relay"/);
  assert.match(call, /direct_call_start/);
  assert.match(call, /direct_call_action/);
  assert.match(call, /direct_call_signal/);
  assert.match(call, /loadIceConfig/);
  assert.match(call, /action: "chat_call"/);

  assert.match(push, /action === "chat_call"/);
  assert.match(push, /kind: "call"/);
  assert.match(push, /payload\.kind === "call"/);
  assert.match(worker, /payload\.kind === "call"/);
});


test("master community archives include finished voice calls", async () => {
  const [archive, migration] = await Promise.all([
    readFile(new URL("../components/CommunityArchives.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260921190046_master_direct_call_archive.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(archive, /master_direct_call_archive/);
  assert.match(archive, /Chamadas/);
  assert.match(archive, /duration_seconds/);
  assert.match(migration, /public\.master_direct_call_archive/);
  assert.match(migration, /public\.is_master\(c\)/);
  assert.match(
    migration,
    /'ended','declined','cancelled','missed','failed'/,
  );
  assert.match(
    migration,
    /grant execute on function public\.master_direct_call_archive\(uuid\) to authenticated/,
  );
});


test("master can permanently remove archived community items", async () => {
  const [archive, migration] = await Promise.all([
    readFile(new URL("../components/CommunityArchives.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260921190649_master_archive_delete.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(archive, /master_archive_delete/);
  assert.match(archive, /Excluir definitivamente/);
  assert.match(archive, /"call"/);
  assert.match(archive, /"chat_media"/);
  assert.match(archive, /"post"/);

  assert.match(migration, /public\.master_archive_delete/);
  assert.match(migration, /public\.is_master\(c\)/);
  assert.match(migration, /delete from public\.direct_calls/);
  assert.match(migration, /delete from public\.community_posts/);
  assert.match(migration, /archive_expires_at=least\(archive_expires_at,now\(\)\)/);
  assert.match(
    migration,
    /grant execute on function public\.master_archive_delete\(uuid,text,uuid\)\s+to authenticated/,
  );
});
