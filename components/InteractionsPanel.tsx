"use client";

import {
  AlertTriangle,
  BellRing,
  Check,
  Gift,
  Megaphone,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";

type NotificationKind =
  | "announcement"
  | "message"
  | "event"
  | "reward"
  | "warning";

const styles: Record<
  NotificationKind,
  {
    label: string;
    description: string;
    Icon: ComponentType<{ size?: number }>;
  }
> = {
  announcement: {
    label: "Aviso",
    description: "Comunicado geral do mestre",
    Icon: Megaphone,
  },
  message: {
    label: "Mensagem",
    description: "Recado direto e pessoal",
    Icon: MessageCircle,
  },
  event: {
    label: "Evento",
    description: "Acontecimento da campanha",
    Icon: Swords,
  },
  reward: {
    label: "Recompensa",
    description: "Prêmio, conquista ou presente",
    Icon: Gift,
  },
  warning: {
    label: "Urgente",
    description: "Algo que precisa de atenção",
    Icon: AlertTriangle,
  },
};

const templates: Array<{
  label: string;
  kind: NotificationKind;
  title: string;
  body: string;
}> = [
  {
    label: "Sessão começando",
    kind: "event",
    title: "A sessão vai começar",
    body: "Prepare sua ficha. A aventura está prestes a continuar.",
  },
  {
    label: "Recado do mestre",
    kind: "announcement",
    title: "Aviso do mestre",
    body: "Tenho uma atualização importante para você no Alvorecer.",
  },
  {
    label: "Recompensa",
    kind: "reward",
    title: "Você recebeu uma recompensa",
    body: "Uma nova recompensa foi reservada para você. Confira no Alvorecer.",
  },
  {
    label: "Atenção",
    kind: "warning",
    title: "Atenção",
    body: "Existe um aviso importante esperando por você no Alvorecer.",
  },
];

export default function InteractionsPanel({
  campaign,
  members,
  profiles,
  identities,
  cosmetics,
  equipment,
  urls,
}: {
  campaign: string;
  members: Row[];
  profiles: Row[];
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
}) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [kind, setKind] = useState<NotificationKind>("announcement");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const playerRows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");

    return members
      .filter(
        (member) =>
          member.campaign_id === campaign &&
          member.role === "player" &&
          member.access_active &&
          !member.archived_at,
      )
      .map((member) => {
        const profile = profiles.find((item) => item.id === member.user_id);
        const identity = identities.find(
          (item) =>
            item.user_id === member.user_id &&
            item.campaign_id === campaign &&
            item.active,
        );
        const name =
          identity?.name ||
          profile?.display_name ||
          profile?.username ||
          "Jogador";
        const username = profile?.username
          ? `@${profile.username}`
          : identity?.subtitle || "";

        return {
          id: String(member.user_id),
          name: String(name),
          username: String(username),
          identity,
        };
      })
      .filter((player) => {
        if (!normalized) return true;
        return `${player.name} ${player.username}`
          .toLocaleLowerCase("pt-BR")
          .includes(normalized);
      })
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [campaign, identities, members, profiles, search]);

  const allPlayerIds = useMemo(
    () =>
      members
        .filter(
          (member) =>
            member.campaign_id === campaign &&
            member.role === "player" &&
            member.access_active &&
            !member.archived_at,
        )
        .map((member) => String(member.user_id)),
    [campaign, members],
  );

  const selectedStyle = styles[kind];
  const SelectedIcon = selectedStyle.Icon;
  const allSelected =
    allPlayerIds.length > 0 &&
    allPlayerIds.every((id) => selectedUsers.includes(id));

  const togglePlayer = (id: string) => {
    setSelectedUsers((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
    setSuccess("");
  };

  const toggleAll = () => {
    setSelectedUsers(allSelected ? [] : allPlayerIds);
    setSuccess("");
  };

  const reset = () => {
    setSelectedUsers([]);
    setKind("announcement");
    setTitle("");
    setBody("");
    setSearch("");
    setError("");
    setSuccess("");
  };

  const applyTemplate = (template: (typeof templates)[number]) => {
    setKind(template.kind);
    setTitle(template.title);
    setBody(template.body);
    setSuccess("");
  };

  const send = async () => {
    if (!selectedUsers.length) {
      setError("Selecione pelo menos um jogador.");
      return;
    }
    if (!title.trim()) {
      setError("Escreva o título da notificação.");
      return;
    }
    if (!body.trim()) {
      setError("Escreva a mensagem que o jogador vai receber.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccess("");

    try {
      const result = await browserDb().rpc("send_master_notification", {
        c: campaign,
        recipient_ids: selectedUsers,
        notification_kind: kind,
        notification_title: title.trim(),
        notification_body: body.trim(),
      });

      if (result.error) throw result.error;

      const count = Number(result.data || selectedUsers.length);
      setSuccess(
        count === 1
          ? "Notificação enviada para 1 jogador."
          : `Notificação enviada para ${count} jogadores.`,
      );
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="interactions-panel">
      <div className="interaction-intro">
        <div>
          <span className="interaction-eyebrow">
            <Sparkles size={15} />
            Ferramentas do mestre
          </span>
          <h2>Interações</h2>
          <p>
            Crie ações que chegam diretamente aos jogadores. Novas ferramentas
            poderão ser adicionadas aqui depois.
          </p>
        </div>
        <span className="interaction-tool-count">1 ferramenta ativa</span>
      </div>

      <article className="interaction-tool">
        <header className="interaction-tool-header">
          <span className="interaction-tool-icon">
            <BellRing size={24} />
          </span>
          <div>
            <h3>Enviar notificação</h3>
            <p>
              Envie um aviso personalizado para um jogador, um grupo ou todos.
            </p>
          </div>
        </header>

        <div className="notification-builder">
          <section className="interaction-recipients">
            <div className="interaction-section-title">
              <div>
                <strong>1. Escolha quem vai receber</strong>
                <small>{selectedUsers.length} selecionado(s)</small>
              </div>
              <button type="button" onClick={toggleAll}>
                <Users size={16} />
                {allSelected ? "Limpar seleção" : "Selecionar todos"}
              </button>
            </div>

            <label className="interaction-player-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar jogador..."
              />
            </label>

            <div className="interaction-player-list">
              {playerRows.map((player) => {
                const checked = selectedUsers.includes(player.id);
                return (
                  <button
                    type="button"
                    className={
                      checked
                        ? "interaction-player selected"
                        : "interaction-player"
                    }
                    key={player.id}
                    onClick={() => togglePlayer(player.id)}
                  >
                    <span className="interaction-player-avatar">
                      <IdentityAvatar
                        identity={player.identity}
                        cosmetics={cosmetics}
                        equipment={equipment}
                        urls={urls}
                        size={42}
                      />
                    </span>
                    <span className="interaction-player-copy">
                      <strong>{player.name}</strong>
                      <small>{player.username || "Jogador"}</small>
                    </span>
                    <span className="interaction-player-check">
                      {checked && <Check size={15} />}
                    </span>
                  </button>
                );
              })}

              {!playerRows.length && (
                <p className="interaction-empty">Nenhum jogador encontrado.</p>
              )}
            </div>
          </section>

          <section className="interaction-compose">
            <div className="interaction-section-title">
              <div>
                <strong>2. Monte a notificação</strong>
                <small>Personalize como ela vai chegar.</small>
              </div>
            </div>

            <div className="interaction-templates">
              <span>Modelos rápidos</span>
              <div>
                {templates.map((template) => (
                  <button
                    type="button"
                    key={template.label}
                    onClick={() => applyTemplate(template)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="interaction-kind-grid">
              {(Object.entries(styles) as Array<
                [NotificationKind, (typeof styles)[NotificationKind]]
              >).map(([value, option]) => {
                const Icon = option.Icon;
                return (
                  <button
                    type="button"
                    aria-pressed={kind === value}
                    className={kind === value ? "selected" : ""}
                    key={value}
                    onClick={() => {
                      setKind(value);
                      setSuccess("");
                    }}
                  >
                    <Icon size={18} />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>

            <label className="interaction-field">
              <span>
                Título <small>{title.length}/100</small>
              </span>
              <input
                type="text"
                maxLength={100}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setSuccess("");
                }}
                placeholder="Ex.: A sessão vai começar"
              />
            </label>

            <label className="interaction-field">
              <span>
                Mensagem <small>{body.length}/500</small>
              </span>
              <textarea
                rows={5}
                maxLength={500}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setSuccess("");
                }}
                placeholder="Escreva exatamente o que o jogador precisa receber..."
              />
            </label>
          </section>

          <aside className="interaction-preview">
            <div className="interaction-section-title">
              <div>
                <strong>3. Prévia</strong>
                <small>É assim que o aviso aparece.</small>
              </div>
            </div>

            <div className="interaction-preview-device">
              <div className="interaction-preview-card" data-kind={kind}>
                <span className="interaction-preview-symbol">
                  <SelectedIcon size={23} />
                </span>
                <span>
                  <strong>{title.trim() || "Título da notificação"}</strong>
                  <small>
                    {body.trim() ||
                      "A mensagem personalizada vai aparecer aqui."}
                  </small>
                </span>
                <i />
              </div>
            </div>

            <div className="interaction-send-summary">
              <span>
                <Users size={16} />
                {selectedUsers.length
                  ? `${selectedUsers.length} jogador(es)`
                  : "Nenhum jogador selecionado"}
              </span>
              <span>
                <SelectedIcon size={16} />
                {selectedStyle.label}
              </span>
            </div>

            {error && (
              <p className="interaction-error" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="interaction-success" role="status">
                <Check size={16} />
                {success}
              </p>
            )}

            <div className="interaction-actions">
              <button type="button" onClick={reset} disabled={busy}>
                <RotateCcw size={17} />
                Limpar
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void send()}
                disabled={busy}
              >
                <Send size={17} />
                {busy ? "Enviando..." : "Enviar notificação"}
              </button>
            </div>
          </aside>
        </div>
      </article>
    </section>
  );
}
