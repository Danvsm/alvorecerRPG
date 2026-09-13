"use client";

import { Coins, Shield, Sparkles } from "lucide-react";
import { formatDracmas } from "@/lib/currency";
import type { Row } from "@/lib/types";
import ProgressionPanel from "./ProgressionPanel";

export default function CharacterSheet({
  character,
  avatarUrl,
  resources,
  attributes,
  values,
  advantages,
  ownedAdvantages,
  resourceControl,
  openWallet,
  refresh,
}: {
  character: Row;
  avatarUrl?: string;
  resources: Row[];
  attributes: Row[];
  values: Row[];
  advantages: Row[];
  ownedAdvantages: Row[];
  resourceControl: (resource: Row) => React.ReactNode;
  openWallet: () => void;
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
        {avatarUrl ? (
          <img className="sheet-avatar" src={avatarUrl} alt={character.name} />
        ) : (
          <div className="sheet-avatar empty-portrait">
            <Shield size={28} />
          </div>
        )}
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

      <div className="sheet-summary-grid">

        <section className="panel wallet-summary">
          <Coins size={22} />
          <div>
            <small>Saldo</small>
            <strong>{formatDracmas(character.dracmas_cents)}</strong>
          </div>
          <button onClick={openWallet}>Abrir Carteira</button>
        </section>
      </div>

      <ProgressionPanel character={character} attributes={attributes} values={values} refresh={refresh} />

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
