"use client";

import { Sparkles } from "lucide-react";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import ProgressionPanel from "./ProgressionPanel";

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
  resourceControl: (resource: Row) => React.ReactNode;
  refresh: () => Promise<void>;
}) {
  const mainAdvantages = ownedAdvantages
    .filter((owned) => owned.character_id === character.id)
    .map((owned) =>
      advantages.find((advantage) => advantage.id === owned.advantage_id),
    )
    .filter(Boolean)
    .slice(0, 4) as Row[];
  const effects = Array.isArray(character.information?.effects)
    ? character.information.effects
    : [];

  return (
    <div className="character-sheet">
      <section className="panel sheet-identity">
        <IdentityAvatar
          identity={identity}
          avatarId={character.avatar_id}
          avatarAlt={character.name}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={avatarUrls}
          size={58}
        />
        <div>
          <p className="eyebrow">NÍVEL {character.level || 1}</p>
          <h2>{character.name}</h2>
          <p>
            {character.class || "Classe não definida"} ·{" "}
            {character.race || "Raça não definida"}
          </p>
        </div>
      </section>

      <section className="panel sheet-resources" aria-label="Recursos atuais">
        {resources.map((resource) => resourceControl(resource))}
      </section>

      <ProgressionPanel
        character={character}
        attributes={attributes}
        values={values}
        refresh={refresh}
      />

      {(mainAdvantages.length > 0 || effects.length > 0) && (
        <div className="sheet-summary-grid">
          {mainAdvantages.length > 0 && (
            <section className="panel">
              <p className="eyebrow">VANTAGENS PRINCIPAIS</p>
              {mainAdvantages.map((advantage) => (
                <div className="compact-line" key={advantage.id}>
                  <Sparkles size={15} />
                  <span>{advantage.name}</span>
                </div>
              ))}
            </section>
          )}
          {effects.length > 0 && (
            <section className="panel">
              <p className="eyebrow">ESTADOS E EFEITOS</p>
              {effects.map((effect: unknown, index: number) => (
                <div className="compact-line" key={index}>
                  <span>{String(effect)}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
