"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Package,
  ScrollText,
  Sparkles,
} from "lucide-react";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import ProgressionPanel from "./ProgressionPanel";

type SheetTab = "summary" | "attributes" | "skills" | "equipment";

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
  resourceControl,
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
  resourceControl: (resource: Row) => React.ReactNode;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SheetTab>("summary");

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
      <section className="panel sheet-identity">
        <IdentityAvatar
          identity={identity}
          avatarId={character.avatar_id}
          avatarAlt={character.name}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={avatarUrls}
          size={108}
          className="sheet-identity-avatar"
        />
        <div className="sheet-identity-copy">
          <p className="sheet-level">NÍVEL {character.level || 1}</p>
          <h2>{character.name}</h2>
          <p>
            {character.class || "Classe não definida"} ·{" "}
            {character.race || "Raça não definida"}
          </p>
        </div>
        <aside
          className="sheet-identity-resources"
          aria-label="Vida, Mana e Fôlego atuais"
        >
          {resources.map((resource) => resourceControl(resource))}
        </aside>
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
            <p className="empty">Nenhuma habilidade ou vantagem adquirida.</p>
          )}

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
