"use client";

import {
  BookOpen,
  Compass,
  Crown,
  Eye,
  Feather,
  Flame,
  Gem,
  Heart,
  KeyRound,
  Leaf,
  Moon,
  Shield,
  Sparkles,
  Star,
  Sun,
  Swords,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Row } from "@/lib/types";
import styles from "./TitleManager.module.css";

const iconOptions = [
  ["star", Star, "Estrela"],
  ["shield", Shield, "Escudo"],
  ["crown", Crown, "Coroa"],
  ["flame", Flame, "Chama"],
  ["moon", Moon, "Lua"],
  ["sword", Swords, "Espadas"],
  ["sparkles", Sparkles, "Brilho"],
  ["compass", Compass, "Bússola"],
  ["book", BookOpen, "Livro"],
  ["eye", Eye, "Olho"],
  ["heart", Heart, "Coração"],
  ["leaf", Leaf, "Folha"],
  ["sun", Sun, "Sol"],
  ["gem", Gem, "Gema"],
  ["feather", Feather, "Pena"],
  ["key", KeyRound, "Chave"],
] as const;

const iconMap = Object.fromEntries(
  iconOptions.map(([key, Icon]) => [key, Icon]),
) as Record<string, typeof Star>;

export default function TitleManager({
  titles,
  players,
  busy,
  create,
  send,
}: {
  titles: Row[];
  players: Row[];
  busy: boolean;
  create: (values: {
    name: string;
    description: string;
    icon: string;
  }) => Promise<void>;
  send: (values: { titleId: string; identityId: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("star");
  const [sendTitleId, setSendTitleId] = useState("");
  const [identityId, setIdentityId] = useState("");

  const activeTitles = useMemo(
    () =>
      titles
        .filter((title) => title.active && !title.archived_at)
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"),
        ),
    [titles],
  );

  const submitCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await create({
      name: trimmedName,
      description: description.trim(),
      icon,
    });
    setName("");
    setDescription("");
    setIcon("star");
  };

  const submitSend = async () => {
    if (!sendTitleId || !identityId) return;
    await send({ titleId: sendTitleId, identityId });
    setIdentityId("");
  };

  return (
    <div className={styles.manager}>
      <form className={styles.creator} onSubmit={submitCreate}>
        <div className={styles.creatorIntro}>
          <strong>Criar título</strong>
          <small>Escolha um ícone e escreva o título que o jogador poderá usar no perfil.</small>
        </div>

        <label className={styles.nameField}>
          Nome do título
          <input
            required
            maxLength={100}
            value={name}
            disabled={busy}
            placeholder="Ex.: Portador da Chama"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className={styles.descriptionField}>
          Descrição opcional
          <input
            maxLength={200}
            value={description}
            disabled={busy}
            placeholder="Breve significado do título"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className={styles.iconSection}>
          <span>Ícone</span>
          <div className={styles.iconGrid}>
            {iconOptions.map(([key, Icon, label]) => {
              const selected = icon === key;
              return (
                <button
                  type="button"
                  key={key}
                  className={selected ? styles.iconSelected : undefined}
                  aria-label={label}
                  aria-pressed={selected}
                  title={label}
                  disabled={busy}
                  onClick={() => setIcon(key)}
                >
                  <Icon aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>

        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          Criar título
        </button>
      </form>

      <div className={styles.list}>
        {activeTitles.map((title) => {
          const Icon = iconMap[String(title.icon)] || Star;
          const isDefault =
            title.acquisition_origin === "free" &&
            Number(title.display_order) < 0;
          return (
            <article key={title.id} className={styles.card}>
              <span className={styles.preview}>
                <Icon
                  aria-hidden="true"
                  style={{ color: String(title.color || "#D9B568") }}
                />
              </span>
              <span className={styles.copy}>
                <strong>{title.name}</strong>
                <small>{isDefault ? "Título inicial" : "Título da campanha"}</small>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSendTitleId(String(title.id));
                  setIdentityId("");
                }}
              >
                Enviar
              </button>
            </article>
          );
        })}

        {!activeTitles.length && (
          <p className={styles.empty}>Nenhum título criado ainda.</p>
        )}
      </div>

      {sendTitleId && (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal} role="dialog" aria-modal="true">
            <div>
              <small>Entregar título</small>
              <h3>
                {activeTitles.find((title) => title.id === sendTitleId)?.name ||
                  "Título"}
              </h3>
            </div>

            <label>
              Jogador
              <select
                value={identityId}
                disabled={busy}
                onChange={(event) => setIdentityId(event.target.value)}
              >
                <option value="">Selecione</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                    {player.username ? ` ${player.username}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.modalActions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSendTitleId("");
                  setIdentityId("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !identityId}
                onClick={() => void submitSend()}
              >
                Enviar título
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
