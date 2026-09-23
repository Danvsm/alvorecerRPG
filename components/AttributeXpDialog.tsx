"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export default function AttributeXpDialog({
  attributeName,
  currentValue,
  cap,
  availableXp,
  cost,
  busy,
  close,
  confirm,
}: {
  attributeName: string;
  currentValue: number;
  cap: number;
  availableXp: number;
  cost: number;
  busy: boolean;
  close: () => void;
  confirm: (points: number) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const maxPoints = useMemo(
    () =>
      Math.max(
        0,
        Math.min(
          Math.max(0, cap - currentValue),
          Math.floor(Math.max(0, availableXp) / Math.max(1, cost)),
        ),
      ),
    [availableXp, cap, cost, currentValue],
  );
  const [points, setPoints] = useState(1);

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  useEffect(() => {
    setPoints((current) =>
      Math.min(Math.max(1, current), Math.max(1, maxPoints)),
    );
  }, [maxPoints]);

  const xpAmount = points * cost;
  const targetValue = currentValue + points;

  return (
    <dialog
      className="attribute-xp-dialog"
      aria-labelledby="attribute-xp-title"
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="spread attribute-xp-dialog-heading">
        <div>
          <small>EVOLUIR ATRIBUTO</small>
          <h2 id="attribute-xp-title">{attributeName}</h2>
        </div>
        <button
          type="button"
          aria-label="Fechar"
          disabled={busy}
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>

      <div className="attribute-xp-summary">
        <div>
          <small>Atual</small>
          <strong>{currentValue}</strong>
        </div>
        <span>→</span>
        <div>
          <small>Depois</small>
          <strong>{targetValue}</strong>
        </div>
        <div>
          <small>Limite atual</small>
          <strong>{cap}</strong>
        </div>
      </div>

      <div className="attribute-xp-info">
        <span>XP disponível</span>
        <strong>{availableXp.toLocaleString("pt-BR")} XP</strong>
      </div>

      {maxPoints > 0 ? (
        <>
          <div className="attribute-xp-choice">
            <span>Quanto XP deseja colocar?</span>
            <div className="attribute-xp-options">
              {Array.from({ length: maxPoints }, (_, index) => index + 1).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    className={points === option ? "selected" : ""}
                    aria-pressed={points === option}
                    disabled={busy}
                    onClick={() => setPoints(option)}
                  >
                    <strong>{(option * cost).toLocaleString("pt-BR")} XP</strong>
                    <small>
                      +{option} atributo{option > 1 ? "s" : ""}
                    </small>
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="attribute-xp-confirmation">
            <span>Será gasto</span>
            <strong>{xpAmount.toLocaleString("pt-BR")} XP</strong>
          </div>
        </>
      ) : (
        <p className="muted">
          Você não possui XP suficiente ou este atributo já atingiu o limite
          permitido neste nível.
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || maxPoints <= 0}
          onClick={() => void confirm(points)}
        >
          {busy
            ? "Aplicando..."
            : "Confirmar " + xpAmount.toLocaleString("pt-BR") + " XP"}
        </button>
      </div>
    </dialog>
  );
}
