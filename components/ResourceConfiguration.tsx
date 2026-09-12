"use client";
import { useState } from "react";
import type { Row } from "@/lib/types";
const labels: Row = { life: "Vida", mana: "Mana", stamina: "Fôlego" };
export default function ResourceConfiguration(props: {
  campaign?: boolean;
  character?: Row;
  resources: Row[];
  rules: Row[];
  attributes: Row[];
  values: Row[];
  save: (op: string, d: Row) => Promise<unknown>;
  busy: boolean;
}) {
  return (
    <section className="panel">
      <h2>
        {props.campaign
          ? "Padrões de recursos da campanha"
          : "Cálculo dos recursos"}
      </h2>
      <div className="resource-grid">
        {["life", "mana", "stamina"].map((key) => (
          <Editor
            key={
              key + JSON.stringify([props.resources, props.rules, props.values])
            }
            resourceKey={key}
            {...props}
          />
        ))}
      </div>
    </section>
  );
}
function Editor({
  resourceKey: key,
  campaign,
  character,
  resources,
  rules,
  attributes,
  values,
  save,
  busy,
}: any) {
  const r = resources.find((r: Row) => r.key === key),
    rule = rules.find((r: Row) => r.key === key),
    inherited = r?.inherit_rule !== false,
    effective = campaign || inherited ? rule : r;
  const [mode, setMode] = useState(
      !campaign && inherited
        ? "inherit"
        : effective?.automatic
          ? "auto"
          : "manual",
    ),
    [attr, setAttr] = useState(effective?.attribute_id || ""),
    [mul, setMul] = useState(String(effective?.multiplier ?? 1)),
    [manual, setManual] = useState(r?.manual_maximum ?? r?.maximum ?? 0),
    [error, setError] = useState("");
  const value =
    values.find(
      (v: Row) =>
        v.attribute_id === (mode === "inherit" ? rule?.attribute_id : attr) &&
        v.character_id === character?.id,
    )?.value || 0;
  const auto = mode === "auto" || (mode === "inherit" && rule?.automatic);
  const max = auto
    ? Math.floor(
        Math.max(0, value) *
          Number(mode === "inherit" ? rule?.multiplier : mul),
      )
    : manual;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          await save(campaign ? "campaign_rule" : "resource_config", {
            character_id: character?.id,
            key,
            inherit_rule: mode === "inherit",
            automatic: mode === "auto",
            attribute_id: attr || null,
            multiplier: Number(mul),
            manual_maximum: Number(manual),
          });
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h3>{labels[key]}</h3>
      <label>
        Modo
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {!campaign && <option value="inherit">Padrão da campanha</option>}
          <option value="auto">Atributo × multiplicador</option>
          <option value="manual">Máximo manual</option>
        </select>
      </label>
      {mode === "auto" && (
        <>
          <label>
            Atributo base
            <select
              required
              value={attr}
              onChange={(e) => setAttr(e.target.value)}
            >
              <option value="">Selecione</option>
              {attributes
                .filter(
                  (a: Row) =>
                    !a.character_id || a.character_id === character?.id,
                )
                .map((a: Row) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Multiplicador
            <input
              type="number"
              step="any"
              min="0"
              required
              value={mul}
              onChange={(e) => setMul(e.target.value)}
            />
          </label>
        </>
      )}
      {mode === "manual" && !campaign && (
        <label>
          Máximo manual
          <input
            type="number"
            min="0"
            step="1"
            required
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
      )}
      {mode === "inherit" && (
        <p>
          {rule?.automatic
            ? `${attributes.find((a: Row) => a.id === rule.attribute_id)?.name || "Atributo"} × ${rule.multiplier}`
            : "Máximo manual do personagem"}
        </p>
      )}
      {!campaign && (
        <p>
          Resultado: <strong>{max}</strong>
          <br />
          Atual: {r?.current || 0}
        </p>
      )}
      {campaign && mode === "manual" && <p>Máximo definido por personagem.</p>}
      <button disabled={busy} className="primary">
        Salvar {labels[key]}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
