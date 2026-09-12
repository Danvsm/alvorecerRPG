"use client";

import { Coins, Shield, Sparkles, Star, TrendingUp } from "lucide-react";
import { formatDracmas } from "@/lib/currency";
import type { Row } from "@/lib/types";

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
}) {
  const baseAttributes = attributes
    .filter(
      (attribute) =>
        attribute.active &&
        (!attribute.character_id || attribute.character_id === character.id),
    )
    .sort((a, b) => a.position - b.position);
  const target = Number(character.level || 1) + 1;
  const completed = baseAttributes.filter(
    (attribute) =>
      Number(
        values.find(
          (value) =>
            value.character_id === character.id &&
            value.attribute_id === attribute.id,
        )?.value || 0,
      ) >= target,
  ).length;
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
        <section className="panel progression-card">
          <div className="spread">
            <div>
              <p className="eyebrow">PROGRESSÃO</p>
              <h3>Nível {character.level || 1}</h3>
            </div>
            <TrendingUp size={22} />
          </div>
          <div className="xp-pair">
            <span>
              <Star size={16} /> XP disponível{" "}
              <strong>
                {Number(character.xp || 0).toLocaleString("pt-BR")}
              </strong>
            </span>
            <span>
              XP total conquistado{" "}
              <strong>
                {Number(character.xp_total || character.xp || 0).toLocaleString(
                  "pt-BR",
                )}
              </strong>
            </span>
          </div>
          <div className="progress-line">
            <span
              style={{
                width: `${baseAttributes.length ? (completed / baseAttributes.length) * 100 : 0}%`,
              }}
            />
          </div>
          <small>
            {completed}/{baseAttributes.length} atributos no valor {target} ou
            maior
          </small>
        </section>

        <section className="panel wallet-summary">
          <Coins size={22} />
          <div>
            <small>Saldo</small>
            <strong>{formatDracmas(character.dracmas_cents)}</strong>
          </div>
          <button onClick={openWallet}>Abrir Carteira</button>
        </section>
      </div>

      <section className="panel sheet-attributes">
        <div className="spread">
          <h2>Atributos</h2>
          <small>Próximo nível: {target}</small>
        </div>
        <div className="attribute-grid compact-attributes">
          {baseAttributes.map((attribute) => (
            <div className="attribute" key={attribute.id}>
              <span>{attribute.name}</span>
              <strong>
                {values.find(
                  (value) =>
                    value.character_id === character.id &&
                    value.attribute_id === attribute.id,
                )?.value || 0}
              </strong>
            </div>
          ))}
        </div>
      </section>

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
