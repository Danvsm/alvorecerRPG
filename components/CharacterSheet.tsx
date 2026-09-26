"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Package,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { formatCompactDracmas } from "@/lib/currency";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import ProgressionPanel from "./ProgressionPanel";
import CharacterSkills from "./CharacterSkills";

type SheetTab = "summary" | "attributes" | "skills" | "equipment";
type SkillTab = "active" | "passive" | "advantages";

export default function CharacterSheet({
  character,
  identity,
  cosmetics,
  equipment,
  avatarUrls,
  resources,
  attributes,
  values,
  advantages,
  ownedAdvantages,
  items,
  inventory,
  refresh,
}: {
  character: Row;
  identity?: Row;
  cosmetics: Row[];
  equipment: Row[];
  avatarUrls: Record<string, string>;
  resources: Row[];
  attributes: Row[];
  values: Row[];
  advantages: Row[];
  ownedAdvantages: Row[];
  items: Row[];
  inventory: Row[];
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SheetTab>("summary");
  const [skillTab, setSkillTab] = useState<SkillTab>("active");

  const compactValue = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    const units = [
      { value: 1_000_000_000_000, suffix: "tri" },
      { value: 1_000_000_000, suffix: "bi" },
      { value: 1_000_000, suffix: "mi" },
      { value: 1_000, suffix: "mil" },
    ];
    const absolute = Math.abs(value);
    for (const unit of units) {
      if (absolute >= unit.value) {
        return `${new Intl.NumberFormat("pt-BR", {
          maximumFractionDigits: 1,
        }).format(value / unit.value)} ${unit.suffix}`;
      }
    }
    return new Intl.NumberFormat("pt-BR").format(value);
  };

  const resourceLabels: Record<string, string> = {
    life: "Vida",
    mana: "Mana",
    stamina: "Fôlego",
  };

  const vitalResources = resources
    .filter((resource) => resourceLabels[String(resource.key)])
    .toSorted(
      (left, right) =>
        ["life", "mana", "stamina"].indexOf(String(left.key)) -
        ["life", "mana", "stamina"].indexOf(String(right.key)),
    );

  const characterAdvantages = useMemo(
    () =>
      ownedAdvantages
        .filter((owned) => owned.character_id === character.id)
        .map((owned) => ({
          owned,
          advantage: advantages.find(
            (advantage) => advantage.id === owned.advantage_id,
          ),
        }))
        .filter((entry) => Boolean(entry.advantage)),
    [advantages, character.id, ownedAdvantages],
  );

  const effects = Array.isArray(character.information?.effects)
    ? character.information.effects
    : [];

  const characterInventory = useMemo(
    () =>
      inventory
        .filter((entry) => entry.character_id === character.id)
        .map((entry) => ({
          entry,
          item: items.find((item) => item.id === entry.item_id),
        }))
        .filter((entry) => Boolean(entry.item)),
    [character.id, inventory, items],
  );

  const tabs: Array<{
    key: SheetTab;
    label: string;
    Icon: typeof ScrollText;
  }> = [
    { key: "summary", label: "Resumo", Icon: ScrollText },
    { key: "attributes", label: "Atributos", Icon: BarChart3 },
    { key: "skills", label: "Habilidades", Icon: Sparkles },
    { key: "equipment", label: "Equipamento", Icon: Package },
  ];

  return (
    <div className="character-sheet player-character-sheet">
      <section className="panel sheet-identity sheet-identity-sketch">
        <IdentityAvatar
          identity={identity}
          avatarId={character.avatar_id}
          avatarAlt={character.name}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={avatarUrls}
          size={118}
          className="sheet-identity-avatar"
        />

        <div className="sheet-identity-details">
          <h2>{character.name}</h2>

          <p className="sheet-character-meta">
            {character.class || "Classe não definida"} ·{" "}
            {character.race || "Raça não definida"} · Nível{" "}
            {character.level || 1} · XP atual{" "}
            {compactValue(Number(character.xp || 0))}
          </p>

          <div
            className="sheet-inline-balance"
            title={`Saldo exato: ${new Intl.NumberFormat("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(Number(character.dracmas_cents || 0) / 100)} Dracmas`}
          >
            D$ {formatCompactDracmas(character.dracmas_cents)}
          </div>

          <div
            className="sheet-vitals"
            aria-label="Vida, Mana e Fôlego atuais"
          >
            {vitalResources.map((resource) => (
              <div
                className="sheet-vital-row"
                data-resource={String(resource.key)}
                key={String(resource.key)}
              >
                <span>{resourceLabels[String(resource.key)]}</span>
                <strong>
                  {Number(resource.current || 0)} / {Number(resource.maximum || 0)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <nav className="sheet-tabs" aria-label="Seções da ficha">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "active" : ""}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {tab === "summary" && (
        <ProgressionPanel
          character={character}
          attributes={attributes}
          values={values}
          refresh={refresh}
          mode="summary"
        />
      )}

      {tab === "attributes" && (
        <ProgressionPanel
          character={character}
          attributes={attributes}
          values={values}
          refresh={refresh}
          mode="attributes"
        />
      )}

      {tab === "skills" && (
        <section className="panel sheet-tab-panel">
          <div className="sheet-tab-heading">
            <Sparkles size={19} />
            <h2>Habilidades e vantagens</h2>
          </div>
          <nav className="character-skill-tabs" aria-label="Tipos de habilidades">
            {([ ["active", "Ativas"], ["passive", "Passivas"], ["advantages", "Vantagens"] ] as const).map(([key, label]) => (
              <button key={key} type="button" className={skillTab === key ? "active" : ""}
                aria-current={skillTab === key ? "page" : undefined} onClick={() => setSkillTab(key)}>{label}</button>
            ))}
          </nav>
          {skillTab !== "advantages" && <CharacterSkills key={`${character.id}-${skillTab}`}
            characterId={String(character.id)} skillType={skillTab} />}
          {skillTab === "advantages" && <div className="character-advantages">
            <h3>Vantagens adquiridas</h3>
          {characterAdvantages.length > 0 ? (
            <div className="sheet-skill-list">
              {characterAdvantages.map(({ owned, advantage }) => (
                <article className="sheet-list-card" key={owned.id}>
                  <strong>{String(advantage?.name || "Vantagem")}</strong>
                  {advantage?.description && (
                    <p>{String(advantage.description)}</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">Nenhuma vantagem adquirida.</p>
          )}
          </div>}

          {effects.length > 0 && (
            <div className="sheet-effects">
              <h3>Estados e efeitos</h3>
              {effects.map((effect: unknown, index: number) => (
                <div className="compact-line" key={index}>
                  <Sparkles size={15} />
                  <span>{String(effect)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "equipment" && (
        <section className="panel sheet-tab-panel">
          <div className="sheet-tab-heading">
            <Package size={19} />
            <h2>Equipamento</h2>
          </div>
          {characterInventory.length > 0 ? (
            <div className="sheet-equipment-list">
              {characterInventory.map(({ entry, item }) => (
                <article className="sheet-list-card" key={entry.id}>
                  <div>
                    <strong>{String(item?.name || "Item")}</strong>
                    <small>
                      {String(item?.kind || "item")} · quantidade{" "}
                      {Number(entry.quantity || 0)}
                    </small>
                  </div>
                  {item?.description && <p>{String(item.description)}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty">Nenhum equipamento no inventário.</p>
          )}
        </section>
      )}
    </div>
  );
}
