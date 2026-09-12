"use client";

import { RefreshCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Row } from "@/lib/types";

const labels: Row = {
  characters: "Personagens arquivados",
  creatures: "Modelos de criatura arquivados",
  items: "Itens arquivados sem vínculos",
  advantages: "Vantagens arquivadas sem vínculos",
  invites: "Convites cancelados ou expirados",
  avatars: "Avatares arquivados sem uso",
};

export default function CleanupPanel({
  busy,
  preview,
  remove,
}: {
  busy: boolean;
  preview: () => Promise<Row>;
  remove: (entries: Row[]) => Promise<void>;
}) {
  const [result, setResult] = useState<Row | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const entries = result
    ? Object.values(result).flatMap((value) =>
        Array.isArray(value) ? value : [],
      )
    : [];

  const inspect = async () => {
    try {
      const next = await preview();
      setResult(next);
      setSelected(
        Object.values(next)
          .flatMap((value) => (Array.isArray(value) ? value : []))
          .map((entry: Row) => `${entry.entity}:${entry.id}`),
      );
    } catch {
      // The parent displays the server error in the shared alert.
    }
  };

  return (
    <section className="panel cleanup-panel">
      <div className="spread">
        <div>
          <p className="eyebrow">MANUTENÇÃO SEGURA</p>
          <h2>Limpeza de dados de teste</h2>
          <p>
            Somente registros arquivados, expirados e sem dependências ativas
            aparecem aqui.
          </p>
        </div>
        <ShieldCheck size={24} />
      </div>
      <button disabled={busy} onClick={() => void inspect()}>
        <RefreshCcw size={16} />{" "}
        {result ? "Analisar novamente" : "Analisar o que pode ser removido"}
      </button>
      {result && (
        <div className="cleanup-preview">
          {Object.entries(result).map(([group, value]) => {
            const groupEntries = Array.isArray(value) ? value : [];
            if (!groupEntries.length) return null;
            return (
              <fieldset key={group}>
                <legend>{labels[group] || group}</legend>
                {groupEntries.map((entry: Row) => {
                  const key = `${entry.entity}:${entry.id}`;
                  return (
                    <label className="check-line" key={key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter(
                                  (candidate) => candidate !== key,
                                ),
                          )
                        }
                      />
                      {entry.name}
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
          {!entries.length && (
            <p className="empty">Não há dados elegíveis para limpeza.</p>
          )}
          {entries.length > 0 && (
            <button
              className="danger-button"
              disabled={busy || !selected.length}
              onClick={async () => {
                if (
                  prompt(
                    "Digite EXCLUIR para remover definitivamente os itens selecionados.",
                  ) !== "EXCLUIR"
                )
                  return;
                try {
                  await remove(
                    entries.filter((entry: Row) =>
                      selected.includes(`${entry.entity}:${entry.id}`),
                    ),
                  );
                  await inspect();
                } catch {
                  // The parent displays the server error in the shared alert.
                }
              }}
            >
              <Trash2 size={16} /> Excluir {selected.length} selecionado(s)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
