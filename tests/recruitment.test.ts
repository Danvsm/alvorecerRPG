import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260925214828_recruitment_application_management.sql",
  import.meta.url,
);

test("public /jogar landing follows the recruitment brief", async () => {
  const [page, landing, css] = await Promise.all([
    readFile(new URL("../app/jogar/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jogar/JogarLanding.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jogar/jogar.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Alvorecer \| Venha jogar RPG/);
  assert.match(page, /openGraph:/);
  assert.match(page, /amanhecer-og\.webp/);
  assert.match(landing, /CONHEÇA O RPG/);
  assert.match(landing, /SEU AMANHECER/);
  assert.match(landing, /Mestre com \+10 anos narrando/);
  assert.match(landing, /Aplicativo da campanha/);
  assert.match(landing, /IA de apoio ao sistema/);
  assert.match(landing, /Lanche durante as sessões/);
  assert.match(landing, /10 sessões/);
  assert.match(landing, /R\$ 4,90/);
  assert.match(landing, /R\$ 49,00/);
  assert.match(landing, /Figueira/);
  assert.doesNotMatch(landing.toLocaleLowerCase("pt-BR"), /sistema próprio/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);

  await Promise.all(
    [
      "amanhecer-hero.webp",
      "amanhecer-og.webp",
      "dama-de-sangue.webp",
      "mundo.webp",
      "sessao.webp",
    ].map((file) =>
      access(new URL(`../public/jogar/${file}`, import.meta.url)),
    ),
  );
});

test("recruitment form sends every defined field through the protected RPC", async () => {
  const [landing, route, migration] = await Promise.all([
    readFile(new URL("../app/jogar/JogarLanding.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/interesse/route.ts", import.meta.url), "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);

  for (const field of [
    "fullName",
    "preferredName",
    "age",
    "email",
    "whatsapp",
    "instagram",
    "city",
    "neighborhood",
    "experienceLevel",
    "availability",
    "preferredTime",
    "expectations",
    "avoidedContent",
    "discoverySource",
  ]) {
    assert.match(landing, new RegExp(field));
    assert.match(route, new RegExp(field));
  }

  assert.match(route, /submit_recruitment_application/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(migration, /set search_path = ''/);
  assert.match(
    migration,
    /revoke all on alvorecer_private\.recruitment_applications/,
  );
  assert.match(migration, /grant execute[\s\S]*to anon, service_role/);
});

test("only the master can list and manage recruitment applications", async () => {
  const [game, panel, migration] = await Promise.all([
    readFile(new URL("../components/Game.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../components/RecruitmentApplications.tsx", import.meta.url),
      "utf8",
    ),
    readFile(migrationUrl, "utf8"),
  ]);

  assert.match(game, /\["Inscrições", ClipboardList\]/);
  assert.match(game, /page === "Inscrições" && isMaster/);
  assert.match(panel, /master_recruitment_applications/);
  assert.match(panel, /master_recruitment_application_update/);
  for (const status of [
    "Nova",
    "Em análise",
    "Contatado",
    "Aprovado",
    "Lista de espera",
    "Não selecionado",
  ]) {
    assert.match(
      await readFile(new URL("../lib/recruitment.ts", import.meta.url), "utf8"),
      new RegExp(status),
    );
  }
  assert.match(migration, /not public\.is_master\(c\)/);
  assert.match(
    migration,
    /revoke all on function public\.master_recruitment_applications\(uuid\)[\s\S]*from public, anon/,
  );
});
