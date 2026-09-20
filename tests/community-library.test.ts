import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = async () =>
  Promise.all([
    readFile(
      new URL("../components/CommunityLibrary.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/CommunityPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../supabase/migrations/20260920142044_community_editorial_articles.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

test("all four Explore cards open an editorial collection", async () => {
  const [library, panel] = await files();

  assert.match(panel, /revealLibrary\(category\.id as EditorialCategory\)/);
  assert.match(panel, /revealLibrary\("world_history"\)/);
  assert.match(panel, /view === "library"/);
  assert.match(panel, /<CommunityLibrary/);
  assert.match(library, /world_legends/);
  assert.match(library, /players/);
  assert.match(library, /character_stories/);
  assert.match(library, /world_history/);
});

test("the editorial experience is readable and master-only for writing", async () => {
  const [library] = await files();

  assert.match(library, /master &&/);
  assert.match(library, /> Escrever história/);
  assert.match(library, /maxLength=\{limits\.title\}/);
  assert.match(library, /maxLength=\{limits\.summary\}/);
  assert.match(library, /maxLength=\{limits\.body\}/);
  assert.match(library, /body: 20000/);
  assert.match(library, /community_article_action/);
  assert.match(library, /community_articles/);
  assert.match(library, /unoptimized/);
  assert.match(library, /Segure um card para gerenciar/);
  assert.match(library, /onPointerDown/);
  assert.match(library, />Editar</);
  assert.match(library, />Arquivar</);
  assert.match(library, />Excluir</);
  assert.doesNotMatch(library, /styles\.cardActions/);
});

test("editorial tables, RPC and media are protected in Supabase", async () => {
  const [, , migration] = await files();

  assert.match(migration, /create table public\.community_articles/);
  assert.match(
    migration,
    /alter table public\.community_articles enable row level security/,
  );
  assert.match(migration, /public\.is_member\(campaign_id\)/);
  assert.match(migration, /public\.is_master\(c\)/);
  assert.match(migration, /'community-articles'/);
  assert.match(migration, /community_article_media_insert/);
  assert.match(migration, /community_article_media_read/);
  assert.match(migration, /char_length\(btrim\(body\)\) between 50 and 20000/);
  assert.match(
    migration,
    /revoke all on function public\.community_article_action/,
  );
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to anon/);
});
