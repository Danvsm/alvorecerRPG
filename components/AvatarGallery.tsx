"use client";

import {
  Archive,
  Check,
  ImagePlus,
  RotateCcw,
  Trash2,
  Pencil,
  LockKeyhole,
  UnlockKeyhole,
  Share2,
  UserRoundCheck,
  Power,
} from "lucide-react";
import { useState } from "react";
import type { Row } from "@/lib/types";
import {
  avatarSelectableFor,
  avatarRarityLabels,
  avatarStateLabels,
  type AvatarPolicyOperation,
} from "@/lib/avatar";

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
  onRename,
  onPolicy,
  players = [],
  targetUserId,
  targetIsMaster = false,
}: {
  avatars: Row[];
  urls: Record<string, string>;
  selectedId?: string | null;
  manager?: boolean;
  compact?: boolean;
  busy: boolean;
  onSelect?: (id: string) => Promise<void>;
  onUpload?: (file: File, name: string, rarity: string) => Promise<void>;
  onRename?: (avatar: Row) => void;
  onArchive?: (avatar: Row) => Promise<void>;
  onDelete?: (avatar: Row) => Promise<void>;
  onPolicy?: (
    avatar: Row,
    operation: AvatarPolicyOperation,
    exclusiveUserId?: string,
  ) => Promise<void>;
  players?: Row[];
  targetUserId?: string | null;
  targetIsMaster?: boolean;
}) {
  const [uploadError, setUploadError] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [exclusiveDrafts, setExclusiveDrafts] = useState<
    Record<string, string>
  >({});
  const available = manager
    ? avatars
    : avatars.filter((avatar) => avatar.active);
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const visible = available.filter(
    (avatar) =>
      normalize(avatar.name).includes(normalize(search.trim())) &&
      (stateFilter === "all" || avatar.state === stateFilter),
  );

  return (
    <section
      className={
        manager
          ? compact
            ? "avatar-manager avatar-manager-compact"
            : "panel avatar-manager"
          : "avatar-picker"
      }
    >
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
      </div>
      {manager && onUpload && (
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            const file = values.get("avatarFile");
            const name = String(values.get("avatarName") || "").trim();
            setUploadError("");
            if (!(file instanceof File) || !file.size || !name) return;
            try {
              await onUpload(file, name, String(values.get("avatarRarity") || "common"));
              form.reset();
            } catch (error) {
              setUploadError((error as Error).message);
            }
          }}
        >
          <label>
            Nome do avatar
            <input
              name="avatarName"
              required
              maxLength={80}
              disabled={busy}
              placeholder="Guerreiro Sombrio"
            />
          </label>
          <label>
            Imagem
            <input
              name="avatarFile"
              type="file"
              required
              accept="image/webp,image/png,image/jpeg"
              disabled={busy}
            />
          </label>
          <label>
            Raridade
            <select name="avatarRarity" defaultValue="common" disabled={busy}>
              <option value="common">Comum</option>
              <option value="uncommon">Incomum</option>
              <option value="rare">Rara</option>
              <option value="epic">Épica</option>
              <option value="legendary">Lendária</option>
              <option value="event">Evento</option>
              <option value="supporter">Apoiador</option>
              <option value="master">Mestre</option>
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>
            <ImagePlus size={17} /> Cadastrar avatar
          </button>
          {uploadError && (
            <p role="alert" className="error">
              {uploadError}
            </p>
          )}
        </form>
      )}

      <div className="avatar-filters">
        <label>
          Pesquisar avatares
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome do avatar"
          />
        </label>
        {manager && (
          <label>
            Filtrar por estado
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {Object.entries(avatarStateLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="avatar-grid">
        {visible.map((avatar) => {
          const selected = avatar.id === selectedId;
          const image = urls[avatar.id];
          const selectable = avatarSelectableFor(
            avatar,
            targetUserId,
            targetIsMaster,
            selectedId,
          );
          const state =
            avatar.state || (avatar.active ? "available" : "archived");
          const usage = Array.isArray(avatar.usage) ? avatar.usage : [];
          const exclusiveDraft =
            exclusiveDrafts[avatar.id] ?? avatar.exclusive_user_id ?? "";
          return (
            <article
              className={`avatar-card${selected ? " selected" : ""}${!avatar.active ? " archived" : ""}${!selectable ? " unavailable" : ""}`}
              key={avatar.id}
            >
              <button
                type="button"
                className="avatar-choice"
                disabled={busy || !onSelect || !selectable}
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
              <span className={`avatar-state ${state}`}>
                {avatarStateLabels[state] || state}
              </span>
              <small className="avatar-rarity">
                {avatarRarityLabels[avatar.rarity] || avatar.rarity || "Comum"}
                {avatar.chest_only ? " · Baú" : ""}
              </small>
              {manager && usage.length > 0 && (
                <small className="avatar-usage">
                  Em uso por:{" "}
                  {usage
                    .map((entry) =>
                      entry.name === entry.username
                        ? entry.username
                        : `${entry.name} / ${entry.username}`,
                    )
                    .join(", ")}
                </small>
              )}
              {manager && avatar.exclusive_username && (
                <small className="avatar-exclusive">
                  Exclusivo de: {avatar.exclusive_username}
                </small>
              )}
              {manager && (
                <details className="avatar-administration">
                  <summary>Administrar</summary>
                  <div className="avatar-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRename?.(avatar)}
                    >
                      <Pencil size={15} /> Editar nome
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void onPolicy?.(
                          avatar,
                          avatar.blocked ? "unblock" : "block",
                        )
                      }
                    >
                      {avatar.blocked ? (
                        <UnlockKeyhole size={15} />
                      ) : (
                        <LockKeyhole size={15} />
                      )}
                      {avatar.blocked ? "Desbloquear" : "Bloquear"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void onPolicy?.(
                          avatar,
                          avatar.shared ? "unshare" : "share",
                        )
                      }
                    >
                      <Share2 size={15} />
                      {avatar.shared ? "Uso único" : "Compartilhar"}
                    </button>
                    <label className="avatar-exclusive-control">
                      Exclusividade
                      <select
                        value={exclusiveDraft}
                        disabled={busy}
                        onChange={(event) =>
                          setExclusiveDrafts((current) => ({
                            ...current,
                            [avatar.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Sem exclusividade</option>
                        {players.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name} / {player.username}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        exclusiveDraft === (avatar.exclusive_user_id || "")
                      }
                      onClick={() =>
                        void onPolicy?.(
                          avatar,
                          exclusiveDraft ? "exclusive" : "clear_exclusive",
                          exclusiveDraft || undefined,
                        )
                      }
                    >
                      <UserRoundCheck size={15} /> Salvar exclusividade
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onArchive?.(avatar)}
                    >
                      {!avatar.archived_at ? (
                        <Archive size={15} />
                      ) : (
                        <RotateCcw size={15} />
                      )}
                      {!avatar.archived_at ? "Arquivar" : "Reativar"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void onPolicy?.(
                          avatar,
                          avatar.active ? "disable" : "enable",
                        )
                      }
                    >
                      <Power size={15} />
                      {avatar.active ? "Desativar para todos" : "Ativar uso"}
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
                </details>
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
