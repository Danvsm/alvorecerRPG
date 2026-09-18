"use client";

import { ChevronDown, ChevronLeft, Compass, SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import styles from "./CommunityPanel.module.css";

function conversationTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMessage = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const days = Math.round(
    (startToday.getTime() - startMessage.getTime()) / 86_400_000,
  );

  if (days <= 0) {
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Ontem";
  if (days < 7) return `${days} d`;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export default function CommunityInbox({
  campaign,
  actor,
  identities,
  cosmetics,
  equipment,
  urls,
  onlineUserIds,
  openConversation,
}: {
  campaign: string;
  actor: string;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  onlineUserIds: Set<string>;
  openConversation: (identityId: string) => void;
}) {
  const [conversations, setConversations] = useState<Row[]>([]);
  const [latestByConversation, setLatestByConversation] = useState<
    Record<string, Row>
  >({});
  const [newConversation, setNewConversation] = useState(false);
  const [error, setError] = useState("");

  const actorIdentity = identities.find((identity) => identity.id === actor);

  const load = useCallback(async () => {
    if (!actor) return;
    setError("");

    const conversationResult = await retryNetworkRead(() =>
      browserDb()
        .from("direct_conversations")
        .select("*")
        .eq("campaign_id", campaign)
        .or(`first_id.eq.${actor},second_id.eq.${actor}`)
        .order("created_at", { ascending: false }),
    );

    if (conversationResult.error) {
      setError(readableErrorMessage(conversationResult.error));
      return;
    }

    const nextConversations = conversationResult.data || [];
    setConversations(nextConversations);

    const ids = nextConversations.map((item) => item.id);
    if (!ids.length) {
      setLatestByConversation({});
      return;
    }

    const messageResult = await retryNetworkRead(() =>
      browserDb()
        .from("direct_messages")
        .select("id,conversation_id,sender_id,body,media_id,created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false }),
    );

    if (messageResult.error) {
      setError(readableErrorMessage(messageResult.error));
      return;
    }

    const latest: Record<string, Row> = {};
    for (const message of messageResult.data || []) {
      if (!latest[message.conversation_id]) {
        latest[message.conversation_id] = message;
      }
    }
    setLatestByConversation(latest);
  }, [actor, campaign]);

  useEffect(() => {
    void load();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ campaign?: string }>).detail;
      if (!detail?.campaign || detail.campaign === campaign) void load();
    };
    window.addEventListener("alvorecer:chat-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("alvorecer:chat-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [campaign, load]);

  const rows = useMemo(
    () =>
      conversations
        .map((conversation) => {
          const peerId =
            conversation.first_id === actor
              ? conversation.second_id
              : conversation.first_id;
          const peer = identities.find((identity) => identity.id === peerId);
          return {
            conversation,
            peerId,
            peer,
            latest: latestByConversation[conversation.id],
          };
        })
        .filter((entry) => entry.peer)
        .sort((left, right) => {
          const leftDate =
            left.latest?.created_at || left.conversation.created_at || "";
          const rightDate =
            right.latest?.created_at || right.conversation.created_at || "";
          return String(rightDate).localeCompare(String(leftDate));
        }),
    [actor, conversations, identities, latestByConversation],
  );

  const availableContacts = useMemo(
    () =>
      identities
        .filter(
          (identity) =>
            identity.active &&
            identity.id !== actor &&
            !rows.some((entry) => entry.peerId === identity.id),
        )
        .sort((left, right) =>
          String(left.name).localeCompare(String(right.name), "pt-BR"),
        ),
    [actor, identities, rows],
  );

  const open = (identityId: string) => {
    setNewConversation(false);
    openConversation(identityId);
  };

  return (
    <section className={styles.inboxScreen} aria-label="Conversas">
      <header className={styles.inboxHeader}>
        {newConversation ? (
          <button
            type="button"
            className={styles.inboxHeaderIcon}
            aria-label="Voltar às conversas"
            onClick={() => setNewConversation(false)}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : (
          <span className={styles.inboxEmblem} aria-hidden="true">
            <Compass />
          </span>
        )}

        <button
          type="button"
          className={styles.inboxIdentity}
          onClick={() => setNewConversation(false)}
          aria-label="Mostrar conversas"
        >
          <strong>
            {newConversation
              ? "Nova conversa"
              : actorIdentity?.name || "Conversas"}
          </strong>
          {!newConversation && <ChevronDown aria-hidden="true" />}
        </button>

        <button
          type="button"
          className={styles.inboxCompose}
          aria-label="Nova conversa"
          onClick={() => setNewConversation((current) => !current)}
        >
          <SquarePen aria-hidden="true" />
        </button>
      </header>

      <div className={styles.inboxList}>
        {newConversation ? (
          <>
            {availableContacts.map((identity) => (
              <button
                type="button"
                className={styles.inboxRow}
                key={identity.id}
                onClick={() => open(identity.id)}
              >
                <span className={styles.inboxAvatar}>
                  <IdentityAvatar
                    identity={identity}
                    cosmetics={cosmetics}
                    equipment={equipment}
                    urls={urls}
                    size={72}
                  />
                  {identity.user_id && (
                    <i
                      className={
                        onlineUserIds.has(identity.user_id)
                          ? styles.inboxOnline
                          : styles.inboxOffline
                      }
                      aria-label={
                        onlineUserIds.has(identity.user_id)
                          ? "Online"
                          : "Offline"
                      }
                    />
                  )}
                </span>
                <span className={styles.inboxRowText}>
                  <strong>{identity.name}</strong>
                  <small>{identity.subtitle || "Iniciar conversa"}</small>
                </span>
              </button>
            ))}
            {!availableContacts.length && (
              <p className={styles.inboxEmpty}>
                Você já tem uma conversa com todos os perfis disponíveis.
              </p>
            )}
          </>
        ) : (
          <>
            {rows.map(({ conversation, peer, peerId, latest }) => (
              <button
                type="button"
                className={styles.inboxRow}
                key={conversation.id}
                onClick={() => open(peerId)}
              >
                <span className={styles.inboxAvatar}>
                  <IdentityAvatar
                    identity={peer}
                    cosmetics={cosmetics}
                    equipment={equipment}
                    urls={urls}
                    size={72}
                  />
                  {peer?.user_id && (
                    <i
                      className={
                        onlineUserIds.has(peer.user_id)
                          ? styles.inboxOnline
                          : styles.inboxOffline
                      }
                      aria-label={
                        onlineUserIds.has(peer.user_id) ? "Online" : "Offline"
                      }
                    />
                  )}
                </span>

                <span className={styles.inboxRowText}>
                  <strong>{peer?.name || "Perfil indisponível"}</strong>
                  <small>
                    {latest?.media_id
                      ? "Enviou uma imagem"
                      : latest?.body || "Conversa iniciada"}
                  </small>
                </span>

                <time dateTime={latest?.created_at || conversation.created_at}>
                  {conversationTime(
                    latest?.created_at || conversation.created_at,
                  )}
                </time>
              </button>
            ))}

            {!rows.length && (
              <div className={styles.inboxEmpty}>
                <p>Nenhuma conversa ainda.</p>
                <button
                  type="button"
                  onClick={() => setNewConversation(true)}
                >
                  Iniciar uma conversa
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <p role="alert" className={styles.inboxError}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
