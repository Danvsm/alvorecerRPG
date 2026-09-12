"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import AvatarGallery from "./AvatarGallery";
import type { Row } from "@/lib/types";

export default function AvatarPickerDialog({
  open,
  avatars,
  urls,
  selectedId,
  busy,
  close,
  select,
}: {
  open: boolean;
  avatars: Row[];
  urls: Record<string, string>;
  selectedId?: string | null;
  busy: boolean;
  close: () => void;
  select: (id: string) => Promise<unknown>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
          <p className="eyebrow">IDENTIDADE DO PERSONAGEM</p>
          <h2 id="avatar-dialog-title">Alterar avatar</h2>
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
          selectedId={selectedId}
          busy={busy}
          onSelect={async (id) => {
            await select(id);
            close();
          }}
        />
      </div>
    </dialog>
  );
}
