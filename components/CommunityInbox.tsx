"use client";

import { ChevronDown, SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import styles from "./CommunityPanel.module.css";

function inboxMediaType(message?: Row) {
  const relation = message?.chat_media;
  const media = Array.isArray(relation) ? relation[0] : relation;
  return media?.media_type === "audio" ? "audio" : "image";
}

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
        .select("id,conversation_id,sender_id,body,media_id,created_at,chat_media(media_type)")
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

  const contacts = useMemo(() => {
    const conversationByPeer = new Map<string, Row>();

    for (const conversation of conversations) {
      const peerId =
        conversation.first_id === actor
          ? conversation.second_id
          : conversation.first_id;

      if (peerId) conversationByPeer.set(peerId, conversation);
    }

    return identities
      .filter((identity) => identity.active && identity.id !== actor)
      .map((identity) => {
        const conversation = conversationByPeer.get(identity.id);
        const latest = conversation
          ? latestByConversation[conversation.id]
          : undefined;
        const activityAt =
          latest?.created_at || conversation?.created_at || "";
        const online = Boolean(
          identity.user_id && onlineUserIds.has(identity.user_id),
        );

        return {
          identity,
          conversation,
          latest,
          activityAt,
          online,
        };
      })
      .sort((left, right) => {
        const leftHasConversation = Boolean(left.conversation);
        const rightHasConversation = Boolean(right.conversation);

        if (leftHasConversation !== rightHasConversation) {
          return leftHasConversation ? -1 : 1;
        }

        if (leftHasConversation && rightHasConversation) {
          const recent =
            new Date(right.activityAt).getTime() -
            new Date(left.activityAt).getTime();
          if (recent !== 0) return recent;
        }

        if (left.online !== right.online) {
          return left.online ? -1 : 1;
        }

        return String(left.identity.name).localeCompare(
          String(right.identity.name),
          "pt-BR",
        );
      });
  }, [
    actor,
    conversations,
    identities,
    latestByConversation,
    onlineUserIds,
  ]);

  return (
    <section className={styles.inboxScreen} aria-label="Conversas">
      <header className={styles.inboxHeader}>
        <span className={styles.inboxOwnAvatar}>
          {actorIdentity && (
            <IdentityAvatar
              identity={actorIdentity}
              cosmetics={cosmetics}
              equipment={equipment}
              urls={urls}
              size={48}
            />
          )}
        </span>

        <div className={styles.inboxIdentity} aria-label="Perfil atual">
          <strong>{actorIdentity?.name || "Conversas"}</strong>
          <ChevronDown aria-hidden="true" />
        </div>

        <span className={styles.inboxCompose} aria-hidden="true">
          <SquarePen />
        </span>
      </header>

      <div className={styles.inboxList}>
        {contacts.map(({ identity, conversation, latest, activityAt, online }) => {
          const lastMessage = latest?.media_id
            ? inboxMediaType(latest) === "audio"
              ? latest.sender_id === actor
                ? "Você enviou um áudio"
                : "Enviou um áudio"
              : latest.sender_id === actor
                ? "Você enviou uma imagem"
                : "Enviou uma imagem"
            : latest?.body
              ? latest.sender_id === actor
                ? `Você: ${latest.body}`
                : latest.body
              : "Iniciar conversa";

          return (
            <button
              type="button"
              className={styles.inboxRow}
              key={identity.id}
              onClick={() => openConversation(identity.id)}
            >
              <span className={styles.inboxAvatar}>
                <IdentityAvatar
                  identity={identity}
                  cosmetics={cosmetics}
                  equipment={equipment}
                  urls={urls}
                  size={74}
                />
                {identity.user_id && (
                  <i
                    className={
                      online ? styles.inboxOnline : styles.inboxOffline
                    }
                    aria-label={online ? "Online" : "Offline"}
                  />
                )}
              </span>

              <span className={styles.inboxRowText}>
                <strong>{identity.name}</strong>
                <small
                  className={
                    conversation
                      ? styles.inboxLastMessage
                      : styles.inboxStartMessage
                  }
                >
                  {lastMessage}
                </small>
              </span>

              {conversation && (
                <time dateTime={activityAt}>
                  {conversationTime(activityAt)}
                </time>
              )}
            </button>
          );
        })}

        {!contacts.length && (
          <div className={styles.inboxEmpty}>
            <p>Nenhum perfil disponível para conversar.</p>
          </div>
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
