"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";

type SlotRow = {
  option_kind: "class" | "race";
  option_value: string;
  max_slots: number;
  used_slots: number;
  remaining_slots: number;
};

export default function CharacterSlotSettings({
  campaign,
}: {
  campaign: string;
}) {
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const result = await browserDb().rpc("master_character_option_slots", {
      c: campaign,
    });
    if (result.error) {
      setError(readableErrorMessage(result.error));
      setRows([]);
    } else {
      setRows((result.data || []) as SlotRow[]);
      setError("");
    }
    setLoading(false);
  }, [campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  const increase = async (row: SlotRow) => {
    const key = `${row.option_kind}:${row.option_value}`;
    setBusyKey(key);
    setError("");
    try {
      const result = await browserDb().rpc("increase_character_option_slot", {
        c: campaign,
        p_kind: row.option_kind,
        p_value: row.option_value,
      });
      if (result.error) throw result.error;
      await load();
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyKey("");
    }
  };

  const group = (kind: "class" | "race", title: string) => (
    <div className="character-slot-group">
      <h3>{title}</h3>
      {rows
        .filter((row) => row.option_kind === kind)
        .map((row) => {
          const key = `${row.option_kind}:${row.option_value}`;
          return (
            <div className="list-row character-slot-row" key={key}>
              <div>
                <strong>{row.option_value}</strong>
                <p className="muted">
                  {row.used_slots} em uso de {row.max_slots}{" "}
                  {row.max_slots === 1 ? "vaga" : "vagas"}
                  {" · "}
                  {row.remaining_slots} disponível
                  {row.remaining_slots === 1 ? "" : "is"}
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                disabled={Boolean(busyKey)}
                onClick={() => void increase(row)}
              >
                <Plus size={16} />
                {busyKey === key ? "Aumentando..." : "Adicionar vaga"}
              </button>
            </div>
          );
        })}
    </div>
  );

  return (
    <section className="panel character-slot-settings">
      <div>
        <h2>Vagas de classes e raças</h2>
        <p>
          Cada classe e raça começa com 1 vaga. Quando uma vaga é ocupada, novos
          jogadores não podem escolhê-la até você adicionar outra.
        </p>
      </div>
      {error && <div className="notice">{error}</div>}
      {loading ? (
        <p className="muted">Carregando vagas...</p>
      ) : (
        <div className="character-slot-columns">
          {group("class", "Classes")}
          {group("race", "Raças")}
        </div>
      )}
    </section>
  );
}
