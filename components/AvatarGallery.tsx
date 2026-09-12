"use client";

import { Archive, Check, ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import type { Row } from "@/lib/types";

export default function AvatarGallery({
  avatars,
  urls,
  selectedId,
  manager = false,
  compact = false,
  busy,
  onSelect,
  onUpload,
  onArchive,
  onDelete,
}: {
  avatars: Row[];
  urls: Record<string, string>;
  selectedId?: string | null;
  manager?: boolean;
  compact?: boolean;
  busy: boolean;
  onSelect?: (id: string) => Promise<void>;
  onUpload?: (file: File) => Promise<void>;
  onArchive?: (avatar: Row) => Promise<void>;
  onDelete?: (avatar: Row) => Promise<void>;
}) {
  const visible = manager
    ? avatars
    : avatars.filter((avatar) => avatar.active || avatar.id === selectedId);

  return (
    <section className={manager ? "panel avatar-manager" : "avatar-picker"}>
      <div className="spread">
        {!compact && (
          <div>
            <h2>{manager ? "Galeria de avatares" : "Escolha seu avatar"}</h2>
            <p>
              {manager
                ? "Cadastre as artes que poderão ser escolhidas pelos jogadores."
                : "Selecione uma identidade para representar seu personagem."}
            </p>
          </div>
        )}
        {manager && onUpload && (
          <label className="button-label primary-label">
            <ImagePlus size={17} />
            Cadastrar avatar
            <input
              hidden
              type="file"
              accept="image/webp,image/png,image/jpeg"
              disabled={busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) await onUpload(file);
              }}
            />
          </label>
        )}
      </div>

      <div className="avatar-grid">
        {visible.map((avatar) => {
          const selected = avatar.id === selectedId;
          const image = urls[avatar.id];
          return (
            <article
              className={`avatar-card${selected ? " selected" : ""}${!avatar.active ? " archived" : ""}`}
              key={avatar.id}
            >
              <button
                type="button"
                className="avatar-choice"
                disabled={busy || !onSelect || (!avatar.active && !selected)}
                aria-pressed={selected}
                aria-label={`Escolher avatar ${avatar.name}`}
                onClick={() => onSelect?.(avatar.id)}
              >
                {image ? (
                  <img src={image} alt={avatar.name} loading="lazy" />
                ) : (
                  <span className="avatar-loading">Carregando</span>
                )}
                {selected && (
                  <span className="avatar-selected" aria-label="Selecionado">
                    <Check size={17} />
                  </span>
                )}
              </button>
              <strong>{avatar.name}</strong>
              {!avatar.active && <small>Arquivado</small>}
              {manager && (
                <div className="avatar-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onArchive?.(avatar)}
                  >
                    {avatar.active ? (
                      <Archive size={15} />
                    ) : (
                      <RotateCcw size={15} />
                    )}
                    {avatar.active ? "Arquivar" : "Reativar"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `Excluir definitivamente o avatar “${avatar.name}”?`,
                        )
                      )
                        void onDelete?.(avatar);
                    }}
                  >
                    <Trash2 size={15} /> Excluir
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <p className="empty">Nenhum avatar cadastrado nesta campanha.</p>
      )}
    </section>
  );
}
