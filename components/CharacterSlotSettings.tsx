"use client";

import { useCallback, useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";
import type { Row } from "@/lib/types";

type SlotRow = {
  option_kind: "class" | "race";
  option_value: string;
  max_slots: number;
  used_slots: number;
  remaining_slots: number;
};

export default function CharacterSlotSettings({
  campaign,
  characters,
  saveCharacter,
}: {
  campaign: string;
  characters: Row[];
  saveCharacter: (characterId: string, characterClass: string, characterRace: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [drafts, setDrafts] = useState({ class: "", race: "" });
  const [error, setError] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [draftClass, setDraftClass] = useState<string | null>(null);
  const [draftRace, setDraftRace] = useState<string | null>(null);
  const selectedCharacter =
    characters.find((entry) => entry.id === selectedCharacterId) || characters[0];
  const currentClass = String(selectedCharacter?.class || "");
  const currentRace = String(selectedCharacter?.race || "");
  const chosenClass = draftClass ?? currentClass;
  const chosenRace = draftRace ?? currentRace;

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

  const adjust = async (row: SlotRow, delta: -1 | 1) => {
    const key = `${row.option_kind}:${row.option_value}:${delta}`;
    setBusyKey(key);
    setError("");
    try {
      const result = await browserDb().rpc("adjust_character_option_slot", {
        c: campaign,
        p_kind: row.option_kind,
        p_value: row.option_value,
        p_delta: delta,
      });
      if (result.error) throw result.error;
      await load();
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyKey("");
    }
  };

  const addOption = async (kind: "class" | "race") => {
    const value = drafts[kind].trim();
    if (value.length < 2) return;
    const key = `add:${kind}`;
    setBusyKey(key);
    setError("");
    try {
      const result = await browserDb().rpc("add_character_option", {
        c: campaign,
        p_kind: kind,
        p_value: value,
      });
      if (result.error) throw result.error;
      setDrafts((current) => ({ ...current, [kind]: "" }));
      await load();
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyKey("");
    }
  };

  const saveSelection = async () => {
    if (!selectedCharacter || !chosenClass || !chosenRace || busyKey) return;
    setBusyKey("character");
    setError("");
    try {
      await saveCharacter(String(selectedCharacter.id), chosenClass, chosenRace);
      setDraftClass(null);
      setDraftRace(null);
      await load();
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyKey("");
    }
  };

  const characterOptions = (kind: "class" | "race", currentValue: string) => {
    const options = rows.filter((row) => row.option_kind === kind);
    return (
      <>
        <option value="" disabled>?? — definir {kind === "class" ? "classe" : "raça"}</option>
        {currentValue && !options.some((row) => row.option_value === currentValue) && (
          <option value={currentValue}>{currentValue} (atual)</option>
        )}
        {options.map((row) => (
          <option
            key={row.option_value}
            value={row.option_value}
            disabled={row.remaining_slots <= 0 && row.option_value !== currentValue}
          >
            {row.option_value}{row.remaining_slots <= 0 && row.option_value !== currentValue ? " — sem vagas" : ""}
          </option>
        ))}
      </>
    );
  };

  const group = (kind: "class" | "race", title: string) => (
    <div className="character-slot-group">
      <div className="character-option-heading">
        <h3>{title}</h3>
        <div className="character-option-add">
          <input
            value={drafts[kind]}
            onChange={(event) =>
              setDrafts((current) => ({
                ...current,
                [kind]: event.target.value,
              }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addOption(kind);
              }
            }}
            placeholder={kind === "class" ? "Nova classe" : "Nova raça"}
            maxLength={120}
            aria-label={kind === "class" ? "Nome da nova classe" : "Nome da nova raça"}
          />
          <button
            type="button"
            className="secondary"
            disabled={Boolean(busyKey) || drafts[kind].trim().length < 2}
            onClick={() => void addOption(kind)}
          >
            <Plus size={16} />
            {busyKey === `add:${kind}`
              ? "Adicionando..."
              : kind === "class"
                ? "Adicionar classe"
                : "Adicionar raça"}
          </button>
        </div>
      </div>
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
                  {row.remaining_slots}{" "}
                  {row.remaining_slots === 1 ? "disponível" : "disponíveis"}
                </p>
              </div>
              <div className="character-slot-controls">
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    Boolean(busyKey) ||
                    row.max_slots <= Math.max(1, row.used_slots)
                  }
                  onClick={() => void adjust(row, -1)}
                  aria-label={`Diminuir vagas de ${row.option_value}`}
                  title={
                    row.max_slots <= Math.max(1, row.used_slots)
                      ? "Não é possível diminuir abaixo das vagas ocupadas"
                      : "Diminuir uma vaga"
                  }
                >
                  <Minus size={16} />
                  {busyKey === `${key}:-1` ? "Diminuindo..." : "Diminuir"}
                </button>
                <strong className="character-slot-total">{row.max_slots}</strong>
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(busyKey) || row.max_slots >= 100}
                  onClick={() => void adjust(row, 1)}
                  aria-label={`Aumentar vagas de ${row.option_value}`}
                  title="Aumentar uma vaga"
                >
                  <Plus size={16} />
                  {busyKey === `${key}:1` ? "Aumentando..." : "Aumentar"}
                </button>
              </div>
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
          Cada classe e raça começa com 1 vaga. Você também pode criar novas
          opções para a campanha. Use os botões para aumentar ou diminuir o total;
          o limite nunca pode ficar abaixo das vagas que já estão ocupadas.
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
      {!loading && characters.length > 0 && (
        <div className="character-choice-settings">
          <div>
            <h3>Classe e raça dos personagens</h3>
            <p>As escolhas feitas no convite aparecem na ficha do jogador. Altere aqui quando necessário.</p>
          </div>
          <div className="character-choice-fields">
            <label>
              Personagem
              <select
                value={String(selectedCharacter?.id || "")}
                disabled={Boolean(busyKey)}
                onChange={(event) => {
                  setSelectedCharacterId(event.target.value);
                  setDraftClass(null);
                  setDraftRace(null);
                }}
              >
                {characters.map((entry) => <option key={entry.id} value={entry.id}>{String(entry.name)}</option>)}
              </select>
            </label>
            <label>
              Classe
              <select value={chosenClass} disabled={Boolean(busyKey)} onChange={(event) => setDraftClass(event.target.value)}>
                {characterOptions("class", currentClass)}
              </select>
            </label>
            <label>
              Raça
              <select value={chosenRace} disabled={Boolean(busyKey)} onChange={(event) => setDraftRace(event.target.value)}>
                {characterOptions("race", currentRace)}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={Boolean(busyKey) || !chosenClass || !chosenRace || (chosenClass === currentClass && chosenRace === currentRace)}
            onClick={() => void saveSelection()}
          >
            {busyKey === "character" ? "Salvando..." : "Salvar classe e raça"}
          </button>
        </div>
      )}
    </section>
  );
}
