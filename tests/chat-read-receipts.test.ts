import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat shows gray sent receipts and blue read receipts in real time", async () => {
  const [component, css, migration] = await Promise.all([
    readFile(new URL("../components/DirectChat.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260921061550_chat_read_receipts.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(component, /from\("conversation_reads"\)/);
  assert.match(component, /table: "conversation_reads"/);
  assert.match(component, /new Date\(m\.created_at\)\.getTime\(\)/);
  assert.match(component, /peerHasRead \? "read" : "sent"/);
  assert.match(component, /aria-label=\{peerHasRead \? "Lida" : "Enviada"\}/);
  assert.match(css, /\.chat-message-time i\.sent\s*\{[^}]*#aaa29d/s);
  assert.match(css, /\.chat-message-time i\.read\s*\{[^}]*#53bdeb/s);
  assert.match(
    migration,
    /alter publication supabase_realtime\s+add table public\.conversation_reads/,
  );
});

test("chat emoji picker searches, remembers recent emojis and inserts at the cursor", async () => {
  const [chat, picker, css] = await Promise.all([
    readFile(new URL("../components/DirectChat.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/ChatEmojiPicker.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(chat, /<ChatEmojiPicker/);
  assert.match(chat, /selectionStart/);
  assert.match(chat, /selectionEnd/);
  assert.match(chat, /setSelectionRange\(cursor, cursor\)/);
  assert.match(picker, /placeholder="Pesquisar emoji"/);
  assert.match(picker, /alvorecer:recent-emojis:v1/);
  assert.match(picker, /Categorias de emojis/);
  assert.match(css, /\.chat-emoji-picker/);
  assert.match(css, /\.chat-emoji-grid/);
});
