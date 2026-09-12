"use client";
import { useState } from "react";
export default function KeyValueField({
  name,
  value,
  numeric = false,
}: {
  name: string;
  value: Record<string, unknown>;
  numeric?: boolean;
}) {
  const [pairs, setPairs] = useState(
    Object.entries(value || {}).map(([key, v]) => ({
      id: crypto.randomUUID(),
      key,
      value: String(v),
    })),
  );
  const names = pairs.filter((p) => p.key.trim()).map((p) => p.key.trim());
  const duplicate = new Set(names).size !== names.length;
  return (
    <div className="key-values">
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(
          Object.fromEntries(
            pairs
              .filter((p) => p.key.trim())
              .map((p) => [p.key.trim(), numeric ? Number(p.value) : p.value]),
          ),
        )}
      />
      {pairs.map((p) => (
        <div className="key-value-row" key={p.id}>
          <input
            aria-label="Nome da informação"
            placeholder="Nome"
            value={p.key}
            required
            onChange={(e) =>
              setPairs((ps) =>
                ps.map((v) =>
                  v.id === p.id ? { ...v, key: e.target.value } : v,
                ),
              )
            }
          />
          <input
            aria-label="Valor da informação"
            placeholder="Valor"
            value={p.value}
            type={numeric ? "number" : "text"}
            onChange={(e) =>
              setPairs((ps) =>
                ps.map((v) =>
                  v.id === p.id ? { ...v, value: e.target.value } : v,
                ),
              )
            }
          />
          <button
            type="button"
            aria-label={`Remover ${p.key || "informação"}`}
            onClick={() => setPairs((ps) => ps.filter((v) => v.id !== p.id))}
          >
            ×
          </button>
        </div>
      ))}
      {duplicate && (
        <p role="alert">Use nomes diferentes para cada informação.</p>
      )}
      <button
        type="button"
        onClick={() =>
          setPairs((ps) => [
            ...ps,
            { id: crypto.randomUUID(), key: "", value: numeric ? "0" : "" },
          ])
        }
      >
        + Informação
      </button>
    </div>
  );
}
