"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, CircleHelp } from "lucide-react";
import { browserDb } from "@/lib/client";
import type { Row } from "@/lib/types";
import AttributeXpDialog from "./AttributeXpDialog";

function compactNumber(value: number) {
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
}

export default function ProgressionPanel({
  character,
  attributes,
  values,
  refresh,
  mode = "summary",
}: {
  character: Row;
  attributes: Row[];
  values: Row[];
  refresh: () => Promise<void>;
  mode?: "summary" | "attributes";
}) {
  const [rule, setRule] = useState<Row>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [purchase, setPurchase] = useState<{
    attribute: Row;
    currentValue: number;
  } | null>(null);

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
  }, [character.id, values]);

  const active = useMemo(
    () =>
      attributes
        .filter((attribute) => attribute.active && !attribute.character_id)
        .toSorted((left, right) => left.position - right.position),
    [attributes],
  );

  const attributeValue = (attributeId: string) =>
    Number(
      values.find(
        (value) =>
          value.attribute_id === attributeId &&
          value.character_id === character.id,
      )?.value || 0,
    );

  const highlighted = useMemo(
    () =>
      active
        .map((attribute) => ({
          attribute,
          value: Number(
            values.find(
              (entry) =>
                entry.attribute_id === attribute.id &&
                entry.character_id === character.id,
            )?.value || 0,
          ),
        }))
        .toSorted(
          (left, right) =>
            right.value - left.value ||
            Number(left.attribute.position || 0) -
              Number(right.attribute.position || 0),
        )
        .slice(0, 3),
    [active, character.id, values],
  );

  const openPurchase = (attribute: Row) => {
    if (!rule || busy) return;
    setPurchase({
      attribute,
      currentValue: attributeValue(attribute.id),
    });
  };

  const buy = async (points: number) => {
    if (!rule || !purchase || busy) return;
    const cost = Number(rule.cost || 0);
    const xpAmount = points * cost;
    if (points <= 0 || cost <= 0 || xpAmount <= 0) return;

    setBusy(true);
    setError("");
    try {
      const result = await browserDb().rpc("buy_attribute_xp", {
        c: character.campaign_id,
        target: character.id,
        attribute: purchase.attribute.id,
        xp_amount: xpAmount,
        request_id: crypto.randomUUID(),
      });
      if (result.error) throw new Error(result.error.message);
      setRule(result.data);
      setPurchase(null);
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const purchaseDialog =
    purchase && rule ? (
      <AttributeXpDialog
        attributeName={String(purchase.attribute.name || "Atributo")}
        currentValue={purchase.currentValue}
        cap={Number(rule.cap || 0)}
        availableXp={Number(character.xp || 0)}
        cost={Number(rule.cost || 100)}
        busy={busy}
        close={() => {
          if (!busy) setPurchase(null);
        }}
        confirm={buy}
      />
    ) : null;

  if (mode === "attributes") {
    return (
      <>
        <section className="panel sheet-attributes sheet-tab-panel">
        <div className="sheet-tab-heading">
          <BarChart3 size={19} />
          <div>
            <h2>Atributos</h2>
            <p>Use XP disponível para evoluir seu personagem.</p>
          </div>
        </div>

        <div className="attribute-grid sheet-full-attributes">
          {active.map((attribute) => {
            const value = attributeValue(attribute.id);
            return (
              <div className="attribute sheet-attribute-card" key={attribute.id}>
                <span>{attribute.name}</span>
                <strong>{value}</strong>
                <button
                  disabled={
                    busy ||
                    !rule ||
                    Number(character.xp || 0) < Number(rule.cost || 0) ||
                    value >= Number(rule.cap || 0)
                  }
                  onClick={() => openPurchase(attribute)}
                >
                  +1 · {compactNumber(Number(rule?.cost ?? 100))} XP
                </button>
              </div>
            );
          })}
        </div>

        {attributes.filter(
          (attribute) =>
            attribute.active && attribute.character_id === character.id,
        ).length > 0 && (
          <details className="sheet-individual-attributes">
            <summary>Atributos individuais</summary>
            {attributes
              .filter(
                (attribute) =>
                  attribute.active &&
                  attribute.character_id === character.id,
              )
              .map((attribute) => (
                <p key={attribute.id}>
                  {attribute.name}: {attributeValue(attribute.id)}
                </p>
              ))}
          </details>
        )}

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        </section>
        {purchaseDialog}
      </>
    );
  }

  const progress = Number(rule?.total)
    ? (Number(rule?.completed || 0) / Number(rule?.total || 1)) * 100
    : 0;

  return (
    <>
      <section className="panel sheet-progression-summary">
        <div className="sheet-progression-heading">
          <div>
            <h2>Progressão · Nível {rule?.level ?? character.level}</h2>
            {rule && (
              <p>
                {rule.completed} / {rule.total} atributos concluídos
              </p>
            )}
          </div>
          <strong>{compactNumber(Number(character.xp || 0))} XP disponíveis</strong>
        </div>

        {rule && (
          <>
            <div className="progress-line sheet-progress-line">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="sheet-progress-copy">
              <CircleHelp size={17} aria-hidden="true" />
              <small>
                {rule.next_unlocked
                  ? `Próxima faixa desbloqueada até ${rule.cap}.`
                  : rule.can_unlock
                    ? "Todos concluídos. O primeiro avanço abre a próxima faixa; o segundo atributo sobe o nível."
                    : rule.level === 10
                      ? "Faixa final: até 50."
                      : `Conclua todos os atributos em ${rule.target} para abrir a próxima faixa.`}
              </small>
              <b>{Math.round(progress)}%</b>
            </div>
          </>
        )}
      </section>

      <section className="sheet-highlighted-attributes" aria-label="Atributos em destaque">
        <div className="sheet-section-title">
          <BarChart3 size={18} />
          <h2>Atributos em destaque</h2>
        </div>
        <div className="attribute-grid sheet-highlight-grid">
          {highlighted.map(({ attribute, value }) => (
            <div className="attribute sheet-attribute-card" key={attribute.id}>
              <span>{attribute.name}</span>
              <strong>{value}</strong>
              <button
                disabled={
                  busy ||
                  !rule ||
                  Number(character.xp || 0) < Number(rule.cost || 0) ||
                  value >= Number(rule.cap || 0)
                }
                onClick={() => openPurchase(attribute)}
              >
                +1 · {compactNumber(Number(rule?.cost ?? 100))} XP
              </button>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {purchaseDialog}
    </>
  );
}
