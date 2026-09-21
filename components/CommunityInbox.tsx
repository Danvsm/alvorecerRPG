"use client";

import { ChevronDown, SquarePen, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { uploadGroupAvatarImage } from "@/lib/media";
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
  master,
  identities,
  cosmetics,
  equipment,
  urls,
  onlineUserIds,
  openConversation,
}: {
  campaign: string;
  actor: string;
  master: boolean;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  onlineUserIds: Set<string>;
  openConversation: (identityId: string) => void;
}) {
  const [conversations, setConversations] = useState<Row[]>([]);
  const [group, setGroup] = useState<Row | null>(null);
  const [groupAvatarUrl, setGroupAvatarUrl] = useState("");
  const [groupAvatarBusy, setGroupAvatarBusy] = useState(false);
  const [latestByConversation, setLatestByConversation] = useState<
    Record<string, Row>
  >({});
  const [error, setError] = useState("");
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);

  const actorIdentity = identities.find((identity) => identity.id === actor);

  const load = useCallback(async () => {
    if (!actor) return;
    setError("");

    const [conversationResult, groupResult] = await Promise.all([
      retryNetworkRead(() =>
        browserDb()
          .from("direct_conversations")
          .select("*")
          .eq("campaign_id", campaign)
          .or(`first_id.eq.${actor},second_id.eq.${actor}`)
          .order("created_at", { ascending: false }),
      ),
      retryNetworkRead(() =>
        browserDb().rpc("campaign_group_summary", {
          c: campaign,
          actor_id: actor,
        }),
      ),
    ]);

    if (conversationResult.error) {
      setError(readableErrorMessage(conversationResult.error));
      return;
    }

    const fallbackMemberCount = identities.filter(
      (identity) =>
        identity.active &&
        identity.user_id &&
        ["player", "master"].includes(String(identity.kind)),
    ).length;

    setGroup(
      groupResult.error
        ? {
            name: "Bar do Pink",
            member_count: fallbackMemberCount,
            unread: 0,
          }
        : ({
            ...(groupResult.data || {}),
            name: groupResult.data?.name || "Bar do Pink",
            member_count:
              Number(groupResult.data?.member_count || 0) ||
              fallbackMemberCount,
          } as Row),
    );

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
  }, [actor, campaign, identities]);

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

  useEffect(() => {
    const path = String(group?.avatar_storage_path || "");
    if (!path) {
      setGroupAvatarUrl("");
      return;
    }

    let valid = true;
    browserDb()
      .storage.from("group-avatars")
      .createSignedUrl(path, 3600)
      .then((result) => {
        if (!valid) return;
        if (result.error) {
          setGroupAvatarUrl("");
          return;
        }
        setGroupAvatarUrl(result.data.signedUrl);
      });

    return () => {
      valid = false;
    };
  }, [group?.avatar_storage_path, group?.avatar_updated_at]);

  const changeGroupAvatar = useCallback(
    async (file: File) => {
      if (!master || groupAvatarBusy) return;

      setGroupAvatarBusy(true);
      setError("");
      let uploadedPath = "";
      let committed = false;

      try {
        uploadedPath = await uploadGroupAvatarImage(file, campaign);
        const saved = await browserDb().rpc("campaign_group_avatar_set", {
          c: campaign,
          actor_id: actor,
          storage_path: uploadedPath,
        });
        if (saved.error) throw saved.error;
        committed = true;

        const signed = await browserDb()
          .storage.from("group-avatars")
          .createSignedUrl(uploadedPath, 3600);
        if (signed.error) throw signed.error;

        setGroupAvatarUrl(signed.data.signedUrl);
        setGroup((current) => ({
          ...(current || {}),
          avatar_storage_path: uploadedPath,
          avatar_updated_at: new Date().toISOString(),
        }));

        const previousPath = String(saved.data?.previous_path || "");
        if (previousPath && previousPath !== uploadedPath) {
          await browserDb().storage.from("group-avatars").remove([previousPath]);
        }

        window.dispatchEvent(
          new CustomEvent("alvorecer:chat-updated", {
            detail: { campaign },
          }),
        );
      } catch (reason) {
        if (uploadedPath && !committed) {
          await browserDb().storage.from("group-avatars").remove([uploadedPath]);
        }
        setError(readableErrorMessage(reason));
      } finally {
        setGroupAvatarBusy(false);
      }
    },
    [actor, campaign, groupAvatarBusy, master],
  );

  useEffect(() => {
    const groupId = String(group?.id || "");
    if (!groupId) return;

    const db = browserDb();
    const channel = db
      .channel(`community-inbox-group:${groupId}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "campaign_group_messages",
          filter: `group_id=eq.${groupId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [actor, group?.id, load]);

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
        <button
          type="button"
          className={styles.inboxRow + " " + styles.inboxGroupRow}
          onClick={() => openConversation("__bar-do-pink__")}
        >
          <span
            className={
              styles.inboxAvatar +
              " " +
              styles.inboxGroupAvatar +
              (master ? " " + styles.inboxGroupAvatarEditable : "")
            }
            title={master ? "Trocar foto do Bar do Pink" : undefined}
            onClick={(event) => {
              if (!master) return;
              event.preventDefault();
              event.stopPropagation();
              groupAvatarInputRef.current?.click();
            }}
          >
            {groupAvatarUrl ? (
              <img src={groupAvatarUrl} alt="" />
            ) : (
              <Users aria-hidden="true" />
            )}
          </span>

          <span className={styles.inboxRowText}>
            <strong>{String(group?.name || "Bar do Pink")}</strong>
            <small className={styles.inboxLastMessage}>
              {group?.latest_body
                ? (String(group.latest_sender_id) === actor
                    ? "Você"
                    : identities.find(
                        (identity) =>
                          String(identity.id) ===
                          String(group.latest_sender_id),
                      )?.name || "Jogador") +
                  ": " +
                  String(group.latest_body)
                : String(Number(group?.member_count || 0)) + " participantes"}
            </small>
          </span>

          {group?.latest_created_at && (
            <time dateTime={String(group.latest_created_at)}>
              {conversationTime(String(group.latest_created_at))}
            </time>
          )}
        </button>

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

      {master && (
        <input
          ref={groupAvatarInputRef}
          type="file"
          hidden
          accept="image/webp,image/png,image/jpeg"
          disabled={groupAvatarBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void changeGroupAvatar(file);
          }}
        />
      )}
    </section>
  );
}
