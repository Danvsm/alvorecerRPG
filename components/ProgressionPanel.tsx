"use client";
import { useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import type { Row } from "@/lib/types";

export default function ProgressionPanel({
  character,
  attributes,
  values,
  refresh,
}: {
  character: Row;
  attributes: Row[];
  values: Row[];
  refresh: () => Promise<void>;
}) {
  const [rule, setRule] = useState<Row>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let valid = true;
    browserDb()
      .rpc("character_progression", { target: character.id })
      .then(({ data, error }) => {
        if (!valid) return;
        if (error) setError(error.message);
        else {
          setRule(data);
          setError("");
        }
      });
    return () => {
      valid = false;
    };
  }, [character, values]);
  const active = attributes
    .filter((a) => a.active && !a.character_id)
    .toSorted((a, b) => a.position - b.position);
  return (
    <section className="panel sheet-attributes">
      <div className="spread">
        <h2>Progressão • Nível {rule?.level ?? character.level}</h2>
        <span>{character.xp} XP disponíveis</span>
      </div>
      <p>XP total conquistado: {character.xp_total}</p>
      {rule && (
        <>
          <div className="progress-line">
            <span
              style={{
                width: `${rule.total ? (rule.completed / rule.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p>
            {rule.completed}/{rule.total} atributos concluíram a meta{" "}
            {rule.target}.
          </p>
          <small>
            {rule.next_unlocked
              ? `Próxima faixa desbloqueada até ${rule.cap}.`
              : rule.can_unlock
                ? "Todos concluídos. O primeiro avanço abre a próxima faixa; o segundo atributo sobe o nível."
                : rule.level === 10
                  ? "Faixa final: até 50."
                  : `Conclua todos os atributos em ${rule.target} para abrir a próxima faixa.`}
          </small>
        </>
      )}
      <div className="attribute-grid compact-attributes">
        {active.map((attribute) => {
          const value =
            values.find(
              (v) =>
                v.attribute_id === attribute.id &&
                v.character_id === character.id,
            )?.value || 0;
          return (
            <div className="attribute" key={attribute.id}>
              <span>{attribute.name}</span>
              <strong>{value}</strong>
              <button
                disabled={
                  busy || !rule || character.xp < rule.cost || value >= rule.cap
                }
                onClick={async () => {
                  if (!rule || busy) return;
                  if (
                    !confirm(
                      `Evoluir ${attribute.name} para ${value + 1} por ${rule.cost} XP?`,
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    const result = await browserDb().rpc("buy_attribute", {
                      c: character.campaign_id,
                      target: character.id,
                      attribute: attribute.id,
                      request_id: crypto.randomUUID(),
                    });
                    if (result.error) throw new Error(result.error.message);
                    setRule(result.data);
                    await refresh();
                  } catch (caught) {
                    setError((caught as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                +1 • {rule?.cost ?? 100} XP
              </button>
            </div>
          );
        })}
      </div>
      {attributes.filter(a=>a.active&&a.character_id===character.id).length>0&&<details><summary>Atributos individuais</summary>{attributes.filter(a=>a.active&&a.character_id===character.id).map(a=><p key={a.id}>{a.name}: {values.find(v=>v.attribute_id===a.id&&v.character_id===character.id)?.value??0}</p>)}</details>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
