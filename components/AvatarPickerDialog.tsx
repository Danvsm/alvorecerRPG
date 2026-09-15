"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import AvatarGallery from "./AvatarGallery";
import type { Row } from "@/lib/types";

export default function AvatarPickerDialog({
  open,
  avatars,
  urls,
  selectedId,
  subject,
  busy,
  close,
  select,
}: {
  open: boolean;
  avatars: Row[];
  urls: Record<string, string>;
  selectedId?: string | null;
  subject?: string;
  busy: boolean;
  close: () => void;
  select: (id: string) => Promise<unknown>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pendingId, setPendingId] = useState(selectedId || "");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setPendingId(selectedId || "");
      setError("");
    }
  }, [open, selectedId]);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      className="avatar-dialog"
      ref={ref}
      aria-labelledby="avatar-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="spread avatar-dialog-heading">
        <div>
          <p className="eyebrow">FOTO SELECIONADA</p>
          <h2 id="avatar-dialog-title">
            Alterar avatar{subject ? ` de ${subject}` : ""}
          </h2>
        </div>
        <button
          aria-label="Fechar seleção de avatar"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <div className="avatar-dialog-scroll">
        <AvatarGallery
          compact
          avatars={avatars}
          urls={urls}
          selectedId={pendingId}
          busy={busy}
          onSelect={async (id) => {
            setPendingId(id);
          }}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={
            busy || !avatars.some((a) => a.id === pendingId && a.active)
          }
          onClick={async () => {
            try {
              await select(pendingId);
              close();
            } catch (caught) {
              setError((caught as Error).message);
            }
          }}
        >
          Confirmar
        </button>
      </div>
    </dialog>
  );
}
