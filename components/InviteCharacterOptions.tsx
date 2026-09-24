"use client";

import { useCallback, useEffect, useState } from "react";

type SlotOption = {
  value: string;
  max_slots: number;
  used_slots: number;
  remaining_slots: number;
  available: boolean;
};

type InviteOptions = {
  classes: SlotOption[];
  races: SlotOption[];
};

export default function InviteCharacterOptions({ invite }: { invite: string }) {
  const [options, setOptions] = useState<InviteOptions | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite_options", token: invite }),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Convite indisponível");
      setOptions({
        classes: Array.isArray(payload.classes) ? payload.classes : [],
        races: Array.isArray(payload.races) ? payload.races : [],
      });
      setError("");
    } catch (reason) {
      setOptions(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar as vagas.",
      );
    }
  }, [invite]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  const optionLabel = (option: SlotOption) =>
    option.available
      ? `${option.value} (${option.remaining_slots} ${option.remaining_slots === 1 ? "vaga" : "vagas"})`
      : `${option.value} (sem vagas)`;

  return (
    <>
      <div className="invite-pair">
        <label>
          Classe
          <select name="characterClass" defaultValue="" required>
            <option value="" disabled>
              {options ? "Selecione sua classe" : "Carregando vagas..."}
            </option>
            {(options?.classes || []).map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={!option.available}
              >
                {optionLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Raça
          <select name="characterRace" defaultValue="" required>
            <option value="" disabled>
              {options ? "Selecione sua raça" : "Carregando vagas..."}
            </option>
            {(options?.races || []).map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={!option.available}
              >
                {optionLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="notice">{error}</p>}
    </>
  );
}
