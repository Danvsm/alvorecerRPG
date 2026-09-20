import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compactWaveform,
  formatAudioDuration,
  MAX_CHAT_AUDIO_BYTES,
  MAX_CHAT_AUDIO_MS,
  selectChatAudioFormat,
} from "../lib/chat-audio";

test("voice messages keep the five minute and three megabyte limits", () => {
  assert.equal(MAX_CHAT_AUDIO_MS, 300_000);
  assert.equal(MAX_CHAT_AUDIO_BYTES, 3_145_728);
  assert.equal(formatAudioDuration(0), "0:00");
  assert.equal(formatAudioDuration(300_000), "5:00");
});

test("voice recording prefers Opus and falls back to MP4", () => {
  assert.equal(
    selectChatAudioFormat((mime) => mime === "audio/webm;codecs=opus")
      ?.storageMime,
    "audio/webm",
  );
  assert.equal(
    selectChatAudioFormat((mime) => mime === "audio/mp4")?.storageMime,
    "audio/mp4",
  );
  assert.equal(selectChatAudioFormat(() => false), null);
});

test("the waveform is compact and database safe", () => {
  const waveform = compactWaveform([0, 12, 50, 140], 48);
  assert.equal(waveform.length, 48);
  assert.ok(waveform.every((point) => point >= 4 && point <= 100));
});

test("voice media uses a private bucket and server-only finalization", async () => {
  const [migration, recorder, player, edge] = await Promise.all([
    readFile(
      new URL(
        "../supabase/migrations/20260920213000_chat_voice_messages.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../components/VoiceRecorder.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ChatAudio.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/functions/alvorecer-api/audio-finalize.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(migration, /'chat-audio',[\s\S]*?false,[\s\S]*?3145728/);
  assert.match(migration, /create policy chat_audio_insert/);
  assert.match(migration, /create policy chat_audio_read/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /interval '7 days'/);
  assert.match(recorder, /MediaRecorder/);
  assert.match(recorder, /MAX_CHAT_AUDIO_MS/);
  assert.match(player, /preload="none"/);
  assert.match(edge, /parseBuffer/);
  assert.match(edge, /finalize_chat_audio/);
});
