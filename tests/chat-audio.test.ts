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
import {
  hasValidAudioContainer,
  inspectAudioDuration,
} from "../supabase/functions/alvorecer-api/audio-duration";

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
  assert.equal(
    selectChatAudioFormat(() => false),
    null,
  );
});

test("the waveform is compact and database safe", () => {
  const waveform = compactWaveform([0, 12, 50, 140], 48);
  assert.equal(waveform.length, 48);
  assert.ok(waveform.every((point) => point >= 4 && point <= 100));
});

test("the server reads WebM, OGG and nested MP4 durations without dependencies", () => {
  const webm = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x1f, 0x43, 0xb6, 0x75, 0x8b, 0xe7, 0x82,
    0x03, 0xe8, 0xa3, 0x85, 0x81, 0x03, 0xe8, 0x80, 0x00,
  ]);
  assert.equal(inspectAudioDuration(webm, "audio/webm"), 2020);
  assert.equal(hasValidAudioContainer(webm, "audio/webm"), true);

  const ogg = new Uint8Array(27);
  ogg.set([0x4f, 0x67, 0x67, 0x53]);
  ogg.set([0x80, 0xbb], 6);
  assert.equal(inspectAudioDuration(ogg, "audio/ogg"), 1000);
  assert.equal(hasValidAudioContainer(ogg, "audio/ogg"), true);

  const mp4 = new Uint8Array(68);
  const view = new DataView(mp4.buffer);
  view.setUint32(0, 16);
  mp4.set([0x66, 0x74, 0x79, 0x70], 4);
  view.setUint32(16, 52);
  mp4.set([0x6d, 0x6f, 0x6f, 0x76], 20);
  view.setUint32(24, 44);
  mp4.set([0x6d, 0x76, 0x68, 0x64], 28);
  view.setUint32(44, 1000);
  view.setUint32(48, 2500);
  assert.equal(inspectAudioDuration(mp4, "audio/mp4"), 2500);
  assert.equal(hasValidAudioContainer(mp4, "audio/mp4"), true);
  assert.equal(
    hasValidAudioContainer(new Uint8Array([1, 2, 3, 4]), "audio/webm"),
    false,
  );
});

test("voice media uses a private bucket and server-only finalization", async () => {
  const [migration, durationReader, recorder, player, edge] = await Promise.all(
    [
      readFile(
        new URL(
          "../supabase/migrations/20260920213000_chat_voice_messages.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../supabase/functions/alvorecer-api/audio-duration.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../components/VoiceRecorder.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../components/ChatAudio.tsx", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../supabase/functions/alvorecer-api/audio-finalize.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    ],
  );

  assert.match(migration, /'chat-audio',[\s\S]*?false,[\s\S]*?3145728/);
  assert.match(migration, /create policy chat_audio_insert/);
  assert.match(migration, /create policy chat_audio_read/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /interval '7 days'/);
  assert.match(recorder, /MediaRecorder/);
  assert.match(recorder, /MAX_CHAT_AUDIO_MS/);
  assert.match(player, /preload="none"/);
  assert.match(edge, /inspectAudioDuration/);
  assert.match(edge, /finalize_chat_audio/);
  assert.match(durationReader, /WEBM_CLUSTER/);
  assert.match(durationReader, /mp4Duration/);
  assert.match(durationReader, /oggDuration/);
  assert.match(edge, /hasValidAudioContainer/);
  assert.match(edge, /let durationMs = claimedDurationMs/);
});
