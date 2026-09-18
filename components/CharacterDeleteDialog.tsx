"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Trash2, X } from "lucide-react";
import type { Row } from "@/lib/types";

const count = (value: unknown) => Number(value || 0);

export function CharacterDeleteDialog({
  characterName,
  preview,
  busy,
  close,
  remove,
}: {
  characterName: string;
  preview: Row;
  busy: boolean;
  close: () => void;
  remove: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  const consequences = useMemo(() => {
    const entries: string[] = [];
    const combatEntries = count(preview.combat_entries);
    const activeCombats = count(preview.active_combats);
    const inventory = count(preview.inventory);
    const resources = count(preview.resources);
    const attributeValues = count(preview.attribute_values);
    const advantages = count(preview.advantages);
    const customAttributes = count(preview.custom_attributes);

    if (combatEntries > 0) {
      entries.push(
        `${combatEntries} participação(ões) em combate${activeCombats > 0 ? ` — ${activeCombats} em combate ativo` : ""}`,
      );
    }
    if (inventory > 0) entries.push(`${inventory} item(ns) do inventário`);
    if (resources > 0) entries.push(`${resources} recurso(s) da ficha`);
    if (attributeValues > 0)
      entries.push(`${attributeValues} valor(es) de atributo`);
    if (advantages > 0) entries.push(`${advantages} vantagem(ns) vinculada(s)`);
    if (customAttributes > 0)
      entries.push(`${customAttributes} atributo(s) exclusivo(s) do personagem`);

    return entries;
  }, [preview]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="character-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="spread">
        <h2 id="character-delete-title">
          <Trash2 size={20} /> Excluir {characterName}?
        </h2>
        <button type="button" aria-label="Fechar" disabled={busy} onClick={close}>
          <X size={20} />
        </button>
      </div>

      {consequences.length > 0 ? (
        <>
          <p>Além do personagem, também serão removidos:</p>
          <ul>
            {consequences.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>Tem certeza que deseja continuar?</p>
        </>
      ) : (
        <p>Tem certeza que deseja excluir este personagem?</p>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={busy}
          onClick={async () => {
            setError("");
            try {
              await remove();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Não foi possível excluir");
            }
          }}
        >
          {busy ? "Excluindo..." : "Excluir"}
        </button>
      </div>
    </dialog>
  );
}

export function CharacterDeleteSuccessDialog({
  characterName,
  close,
}: {
  characterName: string;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  return (
    <dialog ref={ref} aria-labelledby="character-delete-success-title">
      <div className="spread">
        <h2 id="character-delete-success-title">
          <CheckCircle2 size={20} /> Excluído com sucesso
        </h2>
        <button type="button" aria-label="Fechar" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <p>{characterName} foi excluído definitivamente.</p>
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={close}>
          OK
        </button>
      </div>
    </dialog>
  );
}
