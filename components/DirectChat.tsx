"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  ChevronLeft,
  Flag,
  Heart,
  MessageCircle,
  Mic,
  MoreVertical,
  Phone,
  Plus,
  Send,
  Smile,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import ChatImage from "./ChatImage";
import ChatAudio from "./ChatAudio";
import ChatEmojiPicker from "./ChatEmojiPicker";
import IdentityAvatar from "./IdentityAvatar";
import VoiceRecorder from "./VoiceRecorder";
import VoiceCall, { type VoiceCallHandle } from "./VoiceCall";
import { optimizedWebp, uploadGroupAvatarImage } from "@/lib/media";
import type { ChatAudioPayload } from "@/lib/chat-audio";

function mediaType(message: Row) {
  const relation = message.chat_media;
  const media = Array.isArray(relation) ? relation[0] : relation;
  return media?.media_type === "audio" ? "audio" : "image";
}

function messageDayKey(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const CAMPAIGN_GROUP_SELECTION = "__bar-do-pink__";

function messageDayLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (messageDayKey(value) === messageDayKey(today.toISOString()))
    return "Hoje";
  if (messageDayKey(value) === messageDayKey(yesterday.toISOString()))
    return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export default function DirectChat({
  campaign,
  identities,
  cosmetics,
  equipment,
  urls,
  actor,
  master,
  revision,
  requestedPeer,
  docked = false,
  hideBubble = false,
  onUnreadChange,
  openProfile,
}: {
  campaign: string;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  actor: string;
  master: boolean;
  revision: unknown;
  requestedPeer?: { id: string; nonce: number };
  docked?: boolean;
  hideBubble?: boolean;
  onUnreadChange?: (count: number) => void;
  openProfile?: (identityId: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [conversations, setConversations] = useState<Row[]>([]),
    [group, setGroup] = useState<Row | null>(null),
    [groupAvatarUrl, setGroupAvatarUrl] = useState(""),
    [groupAvatarBusy, setGroupAvatarBusy] = useState(false),
    [messages, setMessages] = useState<Row[]>([]),
    [peerReadAt, setPeerReadAt] = useState(""),
    [unread, setUnread] = useState(0),
    [selected, setSelected] = useState(""),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [limit, setLimit] = useState(50),
    [latestByConversation, setLatestByConversation] = useState<
      Record<string, Row>
    >({}),
    [unreadByConversation, setUnreadByConversation] = useState<
      Record<string, number>
    >({}),
    [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set()),
    [contactsInteractive, setContactsInteractive] = useState(true),
    [mutedConversations, setMutedConversations] = useState<Set<string>>(
      new Set(),
    ),
    [contactMenu, setContactMenu] = useState<{
      conversationId: string;
      identityId: string;
      name: string;
      x: number;
      y: number;
    } | null>(null),
    [actionDialog, setActionDialog] = useState<{
      type: "clear" | "report";
      conversationId: string;
      identityId: string;
      name: string;
    } | null>(null),
    [reportReason, setReportReason] = useState(""),
    [feedback, setFeedback] = useState(""),
    [messageMenu, setMessageMenu] = useState<{
      message: Row;
      x: number;
      y: number;
    } | null>(null),
    [messageDialog, setMessageDialog] = useState<{
      type: "report" | "delete";
      message: Row;
    } | null>(null),
    [messageReportReason, setMessageReportReason] = useState("");
  const [messageLikes, setMessageLikes] = useState<
    Record<string, { count: number; mine: boolean }>
  >({});
  const [likingMessageId, setLikingMessageId] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [position, setPosition] = useState({ right: true, y: 75 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceCallRef = useRef<VoiceCallHandle>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const handledRequestNonce = useRef(requestedPeer?.nonce ?? 0);
  const suppressContactUntil = useRef(0);
  const swallowBubbleClick = useRef(false);
  const contactUnlockTimer = useRef<number | null>(null);
  const contactPress = useRef<{
    timer: number | null;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const closeEmoji = useCallback(() => setEmojiOpen(false), []);

  const action = async (op: string, d: Row) => {
    const r = await browserDb().rpc("social_action", {
      c: campaign,
      op,
      d: { ...d, actor_id: actor },
    });
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  const pushReceivedMessage = async (conversationId: string) => {
    try {
      const sessionResult = await browserDb().auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) return;

      await fetch("/api/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "chat_message",
          campaign,
          conversationId,
          actorId: actor,
        }),
        keepalive: true,
      });
    } catch {
      // A mensagem continua enviada mesmo se o aviso push falhar.
    }
  };

  const sendVoice = async (payload: ChatAudioPayload) => {
    if (busy || !selected)
      throw new Error("Abra uma conversa para enviar o áudio.");
    setBusy(true);
    setError("");
    try {
      const db = browserDb();
      const sessionResult = await db.auth.getSession();
      const token = sessionResult.data.session?.access_token;
      if (!token) throw new Error("Entre novamente.");

      const reservation = await db.rpc("chat_audio_reserve", {
        c: campaign,
        actor_id: actor,
        conversation_id: selected,
        requested_mime: payload.mimeType,
      });
      if (reservation.error) throw reservation.error;

      const upload = await db.storage
        .from("chat-audio")
        .upload(reservation.data.path, payload.blob, {
          contentType: payload.mimeType,
          cacheControl: "3600",
          upsert: false,
        });
      if (upload.error) throw upload.error;

      const response = await fetch("/api/chat-audio/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          campaign,
          actorId: actor,
          mediaId: reservation.data.id,
          durationMs: payload.durationMs,
          waveform: payload.waveform,
        }),
      });
      const responseText = await response.text();
      let result: Row = {};
      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        result = {
          error: response.ok
            ? "O servidor respondeu em um formato inesperado."
            : "Não foi possível validar o áudio no servidor.",
        };
      }
      if (!response.ok) {
        throw new Error(result.error || "Não foi possível enviar o áudio.");
      }

      void pushReceivedMessage(selected);
      setRefresh((value) => value + 1);
      window.dispatchEvent(
        new CustomEvent("alvorecer:chat-updated", { detail: { campaign } }),
      );
    } finally {
      setBusy(false);
    }
  };

  const chatControl = async (
    controlAction:
      | "chat_mute"
      | "chat_clear"
      | "chat_report"
      | "chat_message_report"
      | "chat_message_delete",
    conversationId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const sessionResult = await browserDb().auth.getSession();
    const token = sessionResult.data.session?.access_token;
    if (!token) throw new Error("Entre novamente.");

    const response = await fetch("/api/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: controlAction,
        campaign,
        conversationId,
        actorId: actor,
        ...extra,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Não foi possível concluir a ação.");
    }
    return payload as Row;
  };

  const showFeedback = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => {
      setFeedback((current) => (current === message ? "" : current));
    }, 2400);
  };

  const closeContactPress = () => {
    const press = contactPress.current;
    if (press?.timer != null) {
      window.clearTimeout(press.timer);
    }
    contactPress.current = null;
  };

  const openContactMenu = (
    conversationId: string,
    identityId: string,
    name: string,
    clientX: number,
    clientY: number,
  ) => {
    const width = 205;
    const height = 150;
    const x = Math.max(10, Math.min(clientX, window.innerWidth - width - 10));
    const y = Math.max(10, Math.min(clientY, window.innerHeight - height - 10));
    suppressContactUntil.current = performance.now() + 750;
    setContactMenu({ conversationId, identityId, name, x, y });
  };

  const toggleMute = async (
    conversationId: string,
    currentlyMuted: boolean,
  ) => {
    setBusy(true);
    setError("");
    try {
      await chatControl("chat_mute", conversationId, {
        muted: !currentlyMuted,
      });
      setMutedConversations((current) => {
        const next = new Set(current);
        if (currentlyMuted) next.delete(conversationId);
        else next.add(conversationId);
        return next;
      });
      showFeedback(
        currentlyMuted ? "Notificações reativadas." : "Conversa silenciada.",
      );
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
      setContactMenu(null);
    }
  };

  const confirmClear = async () => {
    if (!actionDialog || actionDialog.type !== "clear") return;
    setBusy(true);
    setError("");
    try {
      await chatControl("chat_clear", actionDialog.conversationId);
      setLatestByConversation((current) => {
        const next = { ...current };
        delete next[actionDialog.conversationId];
        return next;
      });
      if (selected === actionDialog.conversationId) {
        setMessages([]);
      }
      setRefresh((value) => value + 1);
      showFeedback("Conversa limpa.");
      setActionDialog(null);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async () => {
    if (!actionDialog || actionDialog.type !== "report") return;
    if (reportReason.trim().length < 3) {
      setError("Explique o motivo da denúncia.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await chatControl("chat_report", actionDialog.conversationId, {
        reason: reportReason.trim(),
      });
      setReportReason("");
      setActionDialog(null);
      showFeedback("Denúncia enviada.");
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openMessageMenu = (message: Row, clientX: number, clientY: number) => {
    const width = 176;
    const height = 104;
    const x = Math.max(10, Math.min(clientX, window.innerWidth - width - 10));
    const y = Math.max(10, Math.min(clientY, window.innerHeight - height - 10));
    setMessageMenu({ message, x, y });
  };

  const toggleMessageLike = async (message: Row) => {
    const messageId = String(message.id || "");
    if (
      !messageId ||
      selected === CAMPAIGN_GROUP_SELECTION ||
      likingMessageId === messageId
    ) {
      return;
    }

    setLikingMessageId(messageId);
    setError("");
    try {
      const result = await browserDb().rpc("direct_message_like_toggle", {
        c: campaign,
        actor_id: actor,
        target_message_id: messageId,
      });
      if (result.error) throw result.error;

      const state = (result.data || {}) as Row;
      setMessageLikes((current) => ({
        ...current,
        [messageId]: {
          count: Number(state.count || 0),
          mine: Boolean(state.liked),
        },
      }));
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setLikingMessageId("");
    }
  };

  const deleteOwnMessage = async () => {
    if (!messageDialog || messageDialog.type !== "delete" || !selected) return;

    const target = messageDialog.message;
    setBusy(true);
    setError("");
    try {
      await chatControl("chat_message_delete", selected, {
        messageId: target.id,
      });

      setMessages((current) =>
        current.filter((message) => message.id !== target.id),
      );
      setMessageDialog(null);
      setRefresh((value) => value + 1);
      window.dispatchEvent(
        new CustomEvent("alvorecer:chat-updated", {
          detail: { campaign },
        }),
      );
      showFeedback(target.media_id ? "Anexo excluído." : "Mensagem excluída.");
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const reportMessage = async () => {
    if (!messageDialog || messageDialog.type !== "report" || !selected) return;
    if (messageReportReason.trim().length < 3) {
      setError("Explique o motivo da denúncia.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await chatControl("chat_message_report", selected, {
        messageId: messageDialog.message.id,
        reason: messageReportReason.trim(),
      });
      setMessageReportReason("");
      setMessageDialog(null);
      showFeedback("Mensagem denunciada.");
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    onUnreadChange?.(unread);
  }, [onUnreadChange, unread]);

  useEffect(() => {
    let valid = true;
    retryNetworkRead(() =>
      browserDb()
        .from("conversation_mutes")
        .select("conversation_id")
        .eq("campaign_id", campaign),
    ).then((result) => {
      if (!valid || result.error) return;
      setMutedConversations(
        new Set(
          (result.data || []).map((entry: Row) =>
            String(entry.conversation_id),
          ),
        ),
      );
    });
    return () => {
      valid = false;
    };
  }, [campaign, actor, refresh]);

  useEffect(
    () => () => {
      if (contactUnlockTimer.current !== null) {
        window.clearTimeout(contactUnlockTimer.current);
      }
      closeContactPress();
    },
    [],
  );
  useEffect(() => {
    if (hideBubble) {
      setOpen(false);
      setSelected("");
      setMessages([]);
    }
  }, [hideBubble]);
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

        setRefresh((value) => value + 1);
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
    const refreshChat = (event: Event) => {
      const detail = (event as CustomEvent<{ campaign?: string }>).detail;
      if (!detail?.campaign || detail.campaign === campaign) {
        setRefresh((value) => value + 1);
      }
    };
    window.addEventListener("alvorecer:chat-updated", refreshChat);
    return () =>
      window.removeEventListener("alvorecer:chat-updated", refreshChat);
  }, [campaign]);

  useEffect(() => {
    if (!requestedPeer?.id || !actor) return;
    if (requestedPeer.nonce === handledRequestNonce.current) return;
    handledRequestNonce.current = requestedPeer.nonce;

    if (requestedPeer.id === CAMPAIGN_GROUP_SELECTION) {
      setSelected(CAMPAIGN_GROUP_SELECTION);
      setOpen(true);
      setRefresh((value) => value + 1);
      return;
    }

    let valid = true;
    action("conversation", { recipient_id: requestedPeer.id })
      .then((r) => {
        if (valid) {
          setSelected(r.id);
          setOpen(true);
          setRefresh((v) => v + 1);
        }
      })
      .catch((e) => setError(readableErrorMessage(e)));
    return () => {
      valid = false;
    };
  }, [requestedPeer, actor]);
  useEffect(() => {
    let valid = true;
    Promise.all([
      browserDb()
        .from("direct_conversations")
        .select("*")
        .eq("campaign_id", campaign)
        .order("created_at", { ascending: false }),
      retryNetworkRead(() =>
        browserDb().rpc("unread_messages", { c: campaign, actor }),
      ),
      retryNetworkRead(() =>
        browserDb().rpc("community_presence", { c: campaign }),
      ),
      retryNetworkRead(() =>
        browserDb().rpc("campaign_group_summary", {
          c: campaign,
          actor_id: actor,
        }),
      ),
    ]).then(async ([c, r, presence, groupResult]) => {
      if (!valid) return;
      const failed = [c, r, presence].find((x) => x.error);
      if (failed?.error) {
        setError(readableErrorMessage(failed.error));
        return;
      }

      const nextConversations = c.data || [];
      setConversations(nextConversations);

      let nextGroup = groupResult.error
        ? null
        : ((groupResult.data || null) as Row | null);

      if (!nextGroup?.id) {
        const fallbackGroup = await retryNetworkRead(() =>
          browserDb()
            .from("campaign_group_chats")
            .select("id,name,avatar_storage_path,avatar_updated_at")
            .eq("campaign_id", campaign)
            .maybeSingle(),
        );

        if (fallbackGroup.data?.id) {
          nextGroup = {
            ...fallbackGroup.data,
            name: fallbackGroup.data.name || "Bar do Pink",
            member_count: identities.filter(
              (identity) =>
                identity.active &&
                identity.user_id &&
                ["player", "master"].includes(String(identity.kind)),
            ).length,
            unread: 0,
            latest_id: null,
            latest_sender_id: null,
            latest_body: null,
            latest_created_at: null,
          };
        } else if (groupResult.error && fallbackGroup.error) {
          setError(readableErrorMessage(groupResult.error));
        }
      }

      if (valid) setGroup(nextGroup);
      setUnread(Number(r.data || 0));
      setOnlineUserIds(
        new Set(
          (presence.data || [])
            .filter((entry: Row) => entry.online)
            .map((entry: Row) => entry.user_id),
        ),
      );

      const ids = nextConversations.map((entry) => entry.id);
      if (!ids.length) {
        setLatestByConversation({});
        setUnreadByConversation({});
        return;
      }

      const [latestResult, receiptResult] = await Promise.all([
        retryNetworkRead(() =>
          browserDb()
            .from("direct_messages")
            .select(
              "id,conversation_id,sender_id,body,media_id,created_at,chat_media(media_type)",
            )
            .in("conversation_id", ids)
            .is("cleared_at", null)
            .order("created_at", { ascending: false }),
        ),
        retryNetworkRead(() =>
          browserDb()
            .from("conversation_reads")
            .select("conversation_id,read_at")
            .eq("identity_id", actor)
            .in("conversation_id", ids),
        ),
      ]);

      if (!valid) return;
      if (latestResult.error || receiptResult.error) {
        setError(
          readableErrorMessage(latestResult.error || receiptResult.error),
        );
        return;
      }

      const readAtByConversation = new Map<string, number>();
      for (const receipt of receiptResult.data || []) {
        const readAt = Date.parse(String(receipt.read_at || ""));
        if (Number.isFinite(readAt)) {
          readAtByConversation.set(String(receipt.conversation_id), readAt);
        }
      }

      const latest: Record<string, Row> = {};
      const unreadCounts: Record<string, number> = {};
      for (const message of latestResult.data || []) {
        const conversationId = String(message.conversation_id);
        if (!latest[conversationId]) {
          latest[conversationId] = message;
        }
        if (String(message.sender_id) === String(actor)) continue;

        const createdAt = Date.parse(String(message.created_at || ""));
        const readAt =
          readAtByConversation.get(conversationId) ?? Number.NEGATIVE_INFINITY;
        if (Number.isFinite(createdAt) && createdAt > readAt) {
          unreadCounts[conversationId] = (unreadCounts[conversationId] || 0) + 1;
        }
      }
      setLatestByConversation(latest);
      setUnreadByConversation(unreadCounts);
    });
    return () => {
      valid = false;
    };
  }, [campaign, actor, revision, refresh]);
  useEffect(() => {
    if (!selected || !open) return;
    let valid = true;
    const isGroup = selected === CAMPAIGN_GROUP_SELECTION;

    if (isGroup) {
      retryNetworkRead(() =>
        browserDb().rpc("campaign_group_messages", {
          c: campaign,
          actor_id: actor,
          page_size: limit,
        }),
      ).then(async (result) => {
        if (!valid) return;
        if (result.error) {
          setError(readableErrorMessage(result.error));
          return;
        }
        setMessages(((result.data || []) as Row[]).reverse());

        const readResult = await browserDb().rpc("campaign_group_action", {
          c: campaign,
          actor_id: actor,
          op: "read",
          message_body: null,
        });
        if (readResult.error) {
          setError(readableErrorMessage(readResult.error));
          return;
        }

        const unreadResult = await retryNetworkRead(() =>
          browserDb().rpc("unread_messages", { c: campaign, actor }),
        );
        if (!unreadResult.error && valid) {
          setUnread(Number(unreadResult.data || 0));
          setGroup((current) =>
            current ? { ...current, unread: 0 } : current,
          );
        }
      });
    } else {
      browserDb()
        .from("direct_messages")
        .select("*,chat_media(media_type)")
        .eq("conversation_id", selected)
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(async (r) => {
          if (!valid) return;
          if (r.error) {
            setError(readableErrorMessage(r.error));
            return;
          }
          const nextMessages = ((r.data || []) as Row[]).reverse();
          setMessages(nextMessages);

          const messageIds = nextMessages
            .map((message) => String(message.id || ""))
            .filter(Boolean);
          if (messageIds.length) {
            const likesResult = await retryNetworkRead(() =>
              browserDb()
                .from("direct_message_likes")
                .select("message_id,identity_id")
                .in("message_id", messageIds),
            );
            if (!valid) return;
            if (likesResult.error) {
              setError(readableErrorMessage(likesResult.error));
            } else {
              const nextLikes: Record<
                string,
                { count: number; mine: boolean }
              > = {};
              for (const like of likesResult.data || []) {
                const messageId = String(like.message_id);
                const current = nextLikes[messageId] || {
                  count: 0,
                  mine: false,
                };
                nextLikes[messageId] = {
                  count: current.count + 1,
                  mine:
                    current.mine || String(like.identity_id) === String(actor),
                };
              }
              setMessageLikes(nextLikes);
            }
          } else {
            setMessageLikes({});
          }

          if (
            conversations.some(
              (c) =>
                c.id === selected && [c.first_id, c.second_id].includes(actor),
            )
          ) {
            try {
              await action("read", { conversation_id: selected });
              const unreadResult = await retryNetworkRead(() =>
                browserDb().rpc("unread_messages", {
                  c: campaign,
                  actor,
                }),
              );
              if (!unreadResult.error && valid) {
                setUnread(Number(unreadResult.data || 0));
                setUnreadByConversation((current) => ({
                  ...current,
                  [selected]: 0,
                }));
              }
            } catch (e) {
              setError(readableErrorMessage(e));
            }
          }
        });
    }

    return () => {
      valid = false;
    };
  }, [
    selected,
    open,
    actor,
    campaign,
    revision,
    refresh,
    limit,
    conversations,
    group?.id,
  ]);
  useEffect(() => {
    if (!open || !selected || selected === CAMPAIGN_GROUP_SELECTION) return;
    const db = browserDb();
    const channel = db
      .channel(`direct-message-likes:${selected}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_message_likes",
        },
        (payload) => {
          const changed = ((payload.new && Object.keys(payload.new).length
            ? payload.new
            : payload.old) || {}) as Row;
          if (
            !changed.message_id ||
            !messages.some(
              (message) => String(message.id) === String(changed.message_id),
            )
          ) {
            return;
          }
          setRefresh((value) => value + 1);
        },
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [actor, messages, open, selected]);

  useEffect(() => {
    if (!group?.id) return;
    const db = browserDb();
    const channel = db
      .channel(`campaign-group:${group.id}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "campaign_group_messages",
          filter: `group_id=eq.${group.id}`,
        },
        (payload) => {
          const message = payload.new as Row;
          if (selected === CAMPAIGN_GROUP_SELECTION) {
            setMessages((current) => {
              if (current.some((item) => item.id === message.id)) return current;
              return [...current, message].slice(-200);
            });
            void browserDb().rpc("campaign_group_action", {
              c: campaign,
              actor_id: actor,
              op: "read",
              message_body: null,
            });
          }
          setRefresh((value) => value + 1);
        },
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }, [actor, campaign, group?.id, selected]);

  useEffect(() => {
    setMessages([]);
    setMessageLikes({});
    setEmojiOpen(false);
  }, [selected]);

  const insertEmoji = (emoji: string) => {
    const input = messageInputRef.current;
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${emoji}${body.slice(end)}`.slice(
      0,
      4000,
    );
    const cursor = Math.min(start + emoji.length, next.length);
    setBody(next);
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  useEffect(() => {
    if (!selected || !open) {
      setPeerReadAt("");
      return;
    }

    const conversation = conversations.find((entry) => entry.id === selected);
    const peerId =
      conversation?.first_id === actor
        ? conversation?.second_id
        : conversation?.first_id;
    if (!peerId) {
      setPeerReadAt("");
      return;
    }

    let valid = true;
    const db = browserDb();
    retryNetworkRead(() =>
      db
        .from("conversation_reads")
        .select("read_at")
        .eq("conversation_id", selected)
        .eq("identity_id", peerId)
        .maybeSingle(),
    ).then((receipt) => {
      if (!valid) return;
      if (receipt.error) {
        setError(readableErrorMessage(receipt.error));
        return;
      }
      setPeerReadAt(receipt.data?.read_at || "");
    });

    const channel = db
      .channel(`chat-receipt:${selected}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_reads",
          filter: `conversation_id=eq.${selected}`,
        },
        (payload) => {
          const receipt = payload.new as Row;
          if (String(receipt.identity_id) !== String(peerId)) return;
          setPeerReadAt(String(receipt.read_at || ""));
        },
      )
      .subscribe();

    return () => {
      valid = false;
      void db.removeChannel(channel);
    };
  }, [selected, open, actor, conversations]);

  useEffect(() => {
    if (!open || !selected) return;
    window.requestAnimationFrame(() =>
      messagesEndRef.current?.scrollIntoView({ block: "end" }),
    );
  }, [messages, open, selected]);

  const actorIdentity = identities.find((identity) => identity.id === actor);

  const contactRows = useMemo(() => {
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
        const activityAt = latest?.created_at || conversation?.created_at || "";
        const online = Boolean(
          identity.user_id && onlineUserIds.has(identity.user_id),
        );
        return { identity, conversation, latest, activityAt, online };
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
  }, [actor, conversations, identities, latestByConversation, onlineUserIds]);

  const openContact = async (identityId: string) => {
    if (
      busy ||
      !contactsInteractive ||
      performance.now() < suppressContactUntil.current
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const conversation = await action("conversation", {
        recipient_id: identityId,
      });
      setVoiceOpen(false);
      setSelected(conversation.id);
      setLimit(50);
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openGroup = () => {
    if (busy || !contactsInteractive) return;
    setVoiceOpen(false);
    setEmojiOpen(false);
    setSelected(CAMPAIGN_GROUP_SELECTION);
    setLimit(50);
  };

  const openIdentityProfile = (identityId?: string) => {
    if (!identityId || !openProfile) return;
    setVoiceOpen(false);
    setEmojiOpen(false);
    setOpen(false);
    setSelected("");
    setMessages([]);
    openProfile(identityId);
  };

  const contactTime = (value?: string) => {
    if (!value) return "";
    const date = new Date(value);
    const now = new Date();
    const startToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
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
  };

  const selectedGroup = selected === CAMPAIGN_GROUP_SELECTION;
  const selectedConversation = selectedGroup
    ? undefined
    : conversations.find((c) => c.id === selected);
  const selectedPeerIds = selectedConversation
    ? [selectedConversation.first_id, selectedConversation.second_id].filter(
        (id) => id !== actor,
      )
    : [];
  const selectedPeer =
    selectedPeerIds.length === 1
      ? identities.find((identity) => identity.id === selectedPeerIds[0])
      : undefined;
  const selectedPeerName =
    selectedPeer?.name ||
    selectedPeerIds
      .map(
        (id) =>
          identities.find((identity) => identity.id === id)?.name ||
          "Perfil indisponível",
      )
      .join(" e ") ||
    "Conversa";
  const selectedPeerOnline = Boolean(
    selectedPeer?.user_id && onlineUserIds.has(selectedPeer.user_id),
  );

  const canSend =
    selectedGroup ||
    Boolean(
      selectedConversation &&
        [selectedConversation.first_id, selectedConversation.second_id].includes(
          actor,
        ),
    );

  const lockContactList = () => {
    suppressContactUntil.current = performance.now() + 520;
    setContactsInteractive(false);

    if (contactUnlockTimer.current !== null) {
      window.clearTimeout(contactUnlockTimer.current);
    }

    contactUnlockTimer.current = window.setTimeout(() => {
      suppressContactUntil.current = 0;
      setContactsInteractive(true);
      contactUnlockTimer.current = null;
    }, 520);
  };

  const openChatList = () => {
    lockContactList();
    setSelected("");
    setMessages([]);
    setLimit(50);
    setError("");
    setVoiceOpen(false);
    setOpen(true);
  };

  const closeChat = () => {
    if (contactUnlockTimer.current !== null) {
      window.clearTimeout(contactUnlockTimer.current);
      contactUnlockTimer.current = null;
    }
    suppressContactUntil.current = 0;
    setContactsInteractive(true);
    setSelected("");
    setMessages([]);
    setLimit(50);
    setVoiceOpen(false);
    setOpen(false);
  };

  return (
    <>
      {!hideBubble && (
        <button
          className={`chat-bubble${docked ? " combat-docked" : ""}`}
          style={{
            top: `${position.y}%`,
            left: position.right ? "auto" : 12,
            right: position.right ? 12 : "auto",
            touchAction: "none",
          }}
          aria-label={`Mensagens, ${unread} não lidas`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            if (!drag.current) return;
            if (
              Math.abs(e.clientX - drag.current.x) +
                Math.abs(e.clientY - drag.current.y) >
              8
            )
              drag.current.moved = true;
            if (drag.current.moved)
              setPosition({
                right: e.clientX > window.innerWidth / 2,
                y: Math.max(
                  10,
                  Math.min(85, (e.clientY / window.innerHeight) * 100),
                ),
              });
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            swallowBubbleClick.current = true;
            if (!drag.current?.moved) {
              if (open) closeChat();
              else openChatList();
            }
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            drag.current = null;
          }}
          onPointerCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            drag.current = null;
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();

            if (swallowBubbleClick.current) {
              swallowBubbleClick.current = false;
              return;
            }

            if (open) closeChat();
            else openChatList();
          }}
        >
          <MessageCircle />
          {unread > 0 && (
            <span className="chat-bubble-unread">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}
      {open && (
        <aside
          className="chat-window"
          aria-label="Mensagens"
          onPointerUpCapture={(e) => {
            if (performance.now() < suppressContactUntil.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClickCapture={(e) => {
            if (performance.now() < suppressContactUntil.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <header className="chat-thread-header">
            <button
              type="button"
              className="chat-thread-back"
              onClick={() => {
                if (selected) {
                  lockContactList();
                  setVoiceOpen(false);
                  setSelected("");
                  setMessages([]);
                  setLimit(50);
                } else {
                  closeChat();
                }
              }}
              aria-label={selected ? "Voltar às conversas" : "Fechar mensagens"}
            >
              <ChevronLeft />
            </button>
            <div className="chat-thread-peer">
              {selectedGroup ? (
                master ? (
                  <button
                    type="button"
                    className="chat-group-header-avatar chat-group-avatar-editable"
                    disabled={groupAvatarBusy}
                    aria-label="Trocar foto do Bar do Pink"
                    title="Trocar foto do Bar do Pink"
                    onClick={() => groupAvatarInputRef.current?.click()}
                  >
                    {groupAvatarUrl ? (
                      <img src={groupAvatarUrl} alt="" />
                    ) : (
                      <Users aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  <span className="chat-group-header-avatar" aria-hidden="true">
                    {groupAvatarUrl ? (
                      <img src={groupAvatarUrl} alt="" />
                    ) : (
                      <Users />
                    )}
                  </span>
                )
              ) : (
                (selectedPeer || (!selected && actorIdentity)) && (
                  <button
                    type="button"
                    className="chat-profile-avatar-button"
                    aria-label={`Abrir perfil de ${String(
                      (selectedPeer || actorIdentity)?.name || "usuário",
                    )}`}
                    onClick={() =>
                      openIdentityProfile(
                        String((selectedPeer || actorIdentity)?.id || ""),
                      )
                    }
                  >
                    <IdentityAvatar
                      identity={selectedPeer || actorIdentity}
                      cosmetics={cosmetics}
                      equipment={equipment}
                      urls={urls}
                      size={selected ? 58 : 46}
                    />
                  </button>
                )
              )}
              <div>
                <strong>
                  {selected
                    ? selectedGroup
                      ? String(group?.name || "Bar do Pink")
                      : selectedPeerName
                    : actorIdentity?.name || "Mensagens"}
                </strong>
                {selected ? (
                  selectedGroup ? (
                    <small>{Number(group?.member_count || 0)} participantes</small>
                  ) : (
                    <small className={selectedPeerOnline ? "online" : ""}>
                      {selectedPeerOnline ? "Online" : "Offline"}
                    </small>
                  )
                ) : (
                  <small>Mensagens</small>
                )}
              </div>
            </div>
            {selected && !selectedGroup ? (
              <div className="chat-thread-actions">
                <button
                  type="button"
                  className="chat-thread-call"
                  aria-label="Iniciar chamada"
                  onClick={() => {
                    if (!selectedConversation) return;
                    if (!selectedPeer?.user_id) {
                      showFeedback("Este perfil não pode receber chamadas.");
                      return;
                    }
                    void voiceCallRef.current
                      ?.start(String(selectedConversation.id))
                      .catch((reason) =>
                        showFeedback(readableErrorMessage(reason)),
                      );
                  }}
                >
                  <Phone />
                </button>
                <button
                  type="button"
                  className="chat-thread-more"
                  aria-label="Mais opções da conversa"
                  onClick={(event) => {
                    if (!selectedConversation || !selectedPeer) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    openContactMenu(
                      String(selectedConversation.id),
                      String(selectedPeer.id),
                      String(selectedPeer.name),
                      rect.right - 190,
                      rect.bottom + 8,
                    );
                  }}
                >
                  <MoreVertical />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="chat-thread-close"
                onClick={closeChat}
                aria-label="Fechar mensagens"
              >
                <X />
              </button>
            )}
          </header>
          {!selected && (
            <div
              className="chat-contact-list"
              aria-label="Lista de conversas"
              data-interactive={contactsInteractive ? "true" : "false"}
            >
              <button
                  type="button"
                  className="chat-contact-row chat-group-row"
                  disabled={busy || !contactsInteractive}
                  onClick={openGroup}
                >
                  <span
                    className="chat-contact-avatar chat-group-avatar"
                    aria-hidden="true"
                  >
                    {groupAvatarUrl ? (
                      <img src={groupAvatarUrl} alt="" />
                    ) : (
                      <Users />
                    )}
                  </span>

                  <span className="chat-contact-copy">
                    <strong>{String(group?.name || "Bar do Pink")}</strong>
                    <small>
                      {group?.latest_body ? (
                        <>
                          {String(group?.latest_sender_id) === actor
                            ? "Você"
                            : identities.find(
                                (identity) =>
                                  String(identity.id) ===
                                  String(group?.latest_sender_id),
                              )?.name || "Jogador"}
                          : {String(group?.latest_body)}
                        </>
                      ) : (
                        "Todos os jogadores da campanha"
                      )}
                    </small>
                  </span>

                  <span className="chat-contact-meta">
                    {Number(group?.unread || 0) > 0 && (
                      <i
                        className="chat-unread-count"
                        aria-label={`${Number(group?.unread || 0)} mensagens não lidas`}
                      >
                        {Number(group?.unread) > 99
                          ? "99+"
                          : Number(group?.unread)}
                      </i>
                    )}
                    {group?.latest_created_at && (
                      <time dateTime={String(group?.latest_created_at)}>
                        {contactTime(String(group?.latest_created_at))}
                      </time>
                    )}
                  </span>
                </button>

              {contactRows.map(
                ({ identity, conversation, latest, activityAt, online }) => {
                  const unreadCount = conversation
                    ? Number(unreadByConversation[conversation.id] || 0)
                    : 0;
                  const lastMessage = latest?.media_id
                    ? mediaType(latest) === "audio"
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
                      className="chat-contact-row"
                      key={identity.id}
                      disabled={busy || !contactsInteractive}
                      onPointerDown={(event) => {
                        if (
                          !conversation ||
                          (event.pointerType === "mouse" && event.button !== 0)
                        ) {
                          return;
                        }
                        closeContactPress();
                        const startX = event.clientX;
                        const startY = event.clientY;
                        const timer = window.setTimeout(() => {
                          if (contactPress.current?.moved) return;
                          openContactMenu(
                            String(conversation.id),
                            String(identity.id),
                            String(identity.name),
                            startX,
                            startY,
                          );
                          if ("vibrate" in navigator) navigator.vibrate(18);
                        }, 520);
                        contactPress.current = {
                          timer,
                          x: startX,
                          y: startY,
                          moved: false,
                        };
                      }}
                      onPointerMove={(event) => {
                        if (!contactPress.current) return;
                        if (
                          Math.abs(event.clientX - contactPress.current.x) +
                            Math.abs(event.clientY - contactPress.current.y) >
                          12
                        ) {
                          contactPress.current.moved = true;
                          closeContactPress();
                        }
                      }}
                      onPointerUp={closeContactPress}
                      onPointerCancel={closeContactPress}
                      onContextMenu={(event) => {
                        if (!conversation) return;
                        event.preventDefault();
                        openContactMenu(
                          String(conversation.id),
                          String(identity.id),
                          String(identity.name),
                          event.clientX,
                          event.clientY,
                        );
                      }}
                      onKeyDown={(event) => {
                        if (
                          !conversation ||
                          !(
                            event.key === "ContextMenu" ||
                            (event.shiftKey && event.key === "F10")
                          )
                        ) {
                          return;
                        }
                        event.preventDefault();
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        openContactMenu(
                          String(conversation.id),
                          String(identity.id),
                          String(identity.name),
                          rect.right - 210,
                          rect.top + 18,
                        );
                      }}
                      onClick={(e) => {
                        if (performance.now() < suppressContactUntil.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        void openContact(identity.id);
                      }}
                    >
                      <span
                        className="chat-contact-avatar chat-contact-avatar-profile"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openIdentityProfile(String(identity.id));
                        }}
                      >
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
                              online
                                ? "chat-contact-presence online"
                                : "chat-contact-presence"
                            }
                            aria-label={online ? "Online" : "Offline"}
                          />
                        )}
                      </span>

                      <span className="chat-contact-copy">
                        <strong>{identity.name}</strong>
                        <small>{lastMessage}</small>
                      </span>

                      {conversation && (
                        <span className="chat-contact-meta">
                          {unreadCount > 0 && (
                            <i
                              className="chat-unread-count"
                              aria-label={`${unreadCount} ${
                                unreadCount === 1
                                  ? "mensagem não lida"
                                  : "mensagens não lidas"
                              }`}
                            >
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </i>
                          )}
                          {mutedConversations.has(String(conversation.id)) && (
                            <BellOff
                              size={14}
                              aria-label="Conversa silenciada"
                            />
                          )}
                          <time dateTime={activityAt}>
                            {contactTime(activityAt)}
                          </time>
                        </span>
                      )}
                    </button>
                  );
                },
              )}

              {!contactRows.length && (
                <p className="chat-contact-empty">
                  Nenhum perfil disponível para conversar.
                </p>
              )}
            </div>
          )}
          {selected && (
            <div className="chat-messages">
              {messages.length >= limit && (
                <button onClick={() => setLimit((n) => n + 50)}>
                  Carregar anteriores
                </button>
              )}
              {messages.map((m, index) => {
                const sender = identities.find((i) => i.id === m.sender_id);
                const mine = m.sender_id === actor;
                const previous = messages[index - 1];
                const showDay =
                  !previous ||
                  messageDayKey(previous.created_at) !==
                    messageDayKey(m.created_at);
                const peerHasRead = Boolean(
                  mine &&
                  peerReadAt &&
                  m.created_at &&
                  new Date(m.created_at).getTime() <=
                    new Date(peerReadAt).getTime(),
                );
                const likeState = messageLikes[String(m.id)] || {
                  count: 0,
                  mine: false,
                };
                const messageActions = !selectedGroup ? (
                  <div className="chat-message-actions" aria-label="Ações da mensagem">
                    <button
                      type="button"
                      className={`chat-message-action-button chat-message-like${
                        likeState.mine ? " is-liked" : ""
                      }`}
                      aria-label={
                        likeState.mine
                          ? "Remover curtida da mensagem"
                          : "Curtir mensagem"
                      }
                      aria-pressed={likeState.mine}
                      disabled={likingMessageId === String(m.id)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void toggleMessageLike(m);
                      }}
                    >
                      <Heart
                        aria-hidden="true"
                        fill={likeState.mine ? "currentColor" : "none"}
                      />
                      {likeState.count > 0 && (
                        <span>{likeState.count > 99 ? "99+" : likeState.count}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="chat-message-action-button chat-message-more"
                      aria-label="Abrir opções da mensagem"
                      title="Opções da mensagem"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        openMessageMenu(m, rect.left, rect.bottom + 6);
                      }}
                    >
                      <MoreVertical aria-hidden="true" />
                    </button>
                  </div>
                ) : null;

                return (
                  <div className="chat-message-block" key={m.id}>
                    {showDay && (
                      <div className="chat-day-separator">
                        <span>{messageDayLabel(m.created_at)}</span>
                      </div>
                    )}
                    <div
                      className={
                        mine ? "chat-message-row mine" : "chat-message-row"
                      }
                    >
                      {!mine && (
                        <button
                          type="button"
                          className="chat-message-avatar chat-message-avatar-profile"
                          aria-label={`Abrir perfil de ${sender?.name || "usuário"}`}
                          onClick={() => openIdentityProfile(String(m.sender_id))}
                        >
                          <IdentityAvatar
                            identity={sender}
                            identityId={m.sender_id}
                            avatarAlt={sender?.name}
                            cosmetics={cosmetics}
                            equipment={equipment}
                            urls={urls}
                            size={42}
                          />
                        </button>
                      )}
                      {mine && messageActions}
                      <div
                        className={
                          mine
                            ? `chat-message mine${selectedGroup ? "" : " chat-message-actionable"}`
                            : `chat-message${selectedGroup ? "" : " chat-message-actionable"}`
                        }
                        role={selectedGroup ? undefined : "button"}
                        tabIndex={selectedGroup ? undefined : 0}
                        aria-label={
                          selectedGroup
                            ? undefined
                            : mine
                              ? "Abrir opções da sua mensagem"
                              : "Abrir opções da mensagem"
                        }
                        onClick={(event) => {
                          if (selectedGroup) return;
                          event.stopPropagation();
                          openMessageMenu(m, event.clientX, event.clientY);
                        }}
                        onKeyDown={(event) => {
                          if (selectedGroup) return;
                          if (event.key !== "Enter" && event.key !== " ")
                            return;
                          event.preventDefault();
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          openMessageMenu(
                            m,
                            rect.left + rect.width / 2,
                            rect.top + rect.height / 2,
                          );
                        }}
                      >
                        {selectedGroup && !mine && (
                          <strong className="chat-group-sender">
                            {sender?.name || "Jogador"}
                          </strong>
                        )}
                        {m.media_id ? (
                          mediaType(m) === "audio" ? (
                            <ChatAudio id={m.media_id} />
                          ) : (
                            <ChatImage id={m.media_id} />
                          )
                        ) : (
                          <p>{m.body}</p>
                        )}
                        <span className="chat-message-time">
                          <small>
                            {new Date(m.created_at).toLocaleTimeString(
                              "pt-BR",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </small>
                          {mine && !selectedGroup && (
                            <i
                              className={peerHasRead ? "read" : "sent"}
                              role="img"
                              aria-label={peerHasRead ? "Lida" : "Enviada"}
                              title={peerHasRead ? "Lida" : "Enviada"}
                            >
                              ✓✓
                            </i>
                          )}
                        </span>
                      </div>
                      {!mine && messageActions}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
          {canSend && (
            <form
              className={`chat-composer${voiceOpen ? " voice-active" : ""}${selectedGroup ? " group-chat-composer" : ""}`}
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || !body.trim()) return;
                setBusy(true);
                setError("");
                try {
                  if (selectedGroup) {
                    const sent = await browserDb().rpc("campaign_group_action", {
                      c: campaign,
                      actor_id: actor,
                      op: "message",
                      message_body: body.trim(),
                    });
                    if (sent.error) throw sent.error;
                  } else {
                    await action("message", {
                      conversation_id: selected,
                      body: body.trim(),
                    });
                    void pushReceivedMessage(selected);
                  }
                  setBody("");
                  setEmojiOpen(false);
                  setRefresh((v) => v + 1);
                  window.dispatchEvent(
                    new CustomEvent("alvorecer:chat-updated", {
                      detail: { campaign },
                    }),
                  );
                } catch (e) {
                  setError(readableErrorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {emojiOpen && !voiceOpen && (
                <ChatEmojiPicker onSelect={insertEmoji} onClose={closeEmoji} />
              )}
              {voiceOpen ? (
                <VoiceRecorder
                  disabled={busy}
                  onClose={() => setVoiceOpen(false)}
                  onSend={sendVoice}
                />
              ) : (
                <>
                  {!selectedGroup && (
                    <label
                      className="chat-image-button"
                      aria-label="Enviar imagem"
                    >
                    <Plus aria-hidden="true" />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file || busy) return;
                        setBusy(true);
                        setError("");
                        try {
                          const blob = await optimizedWebp(file, 800);
                          const db = browserDb();
                          const r = await db.rpc("chat_media_action", {
                            c: campaign,
                            op: "reserve",
                            d: { actor_id: actor, conversation_id: selected },
                          });
                          if (r.error) throw r.error;
                          const upload = await db.storage
                            .from("chat-media")
                            .upload(r.data.path, blob, {
                              contentType: "image/webp",
                            });
                          if (upload.error) throw upload.error;
                          const sent = await db.rpc("chat_media_action", {
                            c: campaign,
                            op: "send",
                            d: { actor_id: actor, media_id: r.data.id },
                          });
                          if (sent.error) throw sent.error;
                          void pushReceivedMessage(selected);
                          setRefresh((v) => v + 1);
                          window.dispatchEvent(
                            new CustomEvent("alvorecer:chat-updated", {
                              detail: { campaign },
                            }),
                          );
                        } catch (e) {
                          setError(readableErrorMessage(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    </label>
                  )}
                  <div className="chat-text-field">
                    <textarea
                      ref={messageInputRef}
                      aria-label="Mensagem"
                      required
                      maxLength={4000}
                      rows={1}
                      placeholder="Mensagem..."
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                    <div className="chat-inline-actions">
                      <button
                        type="button"
                        className="chat-inline-emoji-button"
                        disabled={busy}
                        aria-label="Adicionar emoji"
                        aria-expanded={emojiOpen}
                        onClick={() => setEmojiOpen((current) => !current)}
                      >
                        <Smile aria-hidden="true" />
                      </button>
                      {!selectedGroup && (
                        <button
                          type="button"
                          className="chat-inline-voice-button"
                          disabled={busy}
                          aria-label="Gravar mensagem de voz"
                          onClick={() => {
                            setEmojiOpen(false);
                            setVoiceOpen(true);
                          }}
                        >
                          <Mic aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="chat-send-button"
                    disabled={busy || !body.trim()}
                    aria-label="Enviar mensagem"
                  >
                    <Send aria-hidden="true" />
                  </button>
                </>
              )}
            </form>
          )}
          {master && selectedGroup && (
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
          {messageMenu && !selectedGroup && (
            <>
              <button
                type="button"
                className="chat-context-backdrop"
                aria-label="Fechar opções da mensagem"
                onClick={() => setMessageMenu(null)}
              />
              <div
                className="chat-message-context-menu"
                role="menu"
                style={{ left: messageMenu.x, top: messageMenu.y }}
              >
                {messageMenu.message.sender_id === actor ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMessageDialog({
                        type: "delete",
                        message: messageMenu.message,
                      });
                      setMessageMenu(null);
                    }}
                  >
                    <Trash2 size={17} />
                    Excluir
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMessageReportReason("");
                      setMessageDialog({
                        type: "report",
                        message: messageMenu.message,
                      });
                      setMessageMenu(null);
                    }}
                  >
                    <Flag size={17} />
                    Denunciar
                  </button>
                )}
              </div>
            </>
          )}

          {contactMenu && (
            <>
              <button
                type="button"
                className="chat-context-backdrop"
                aria-label="Fechar opções da conversa"
                onClick={() => setContactMenu(null)}
              />
              <div
                className="chat-context-menu"
                role="menu"
                style={{ left: contactMenu.x, top: contactMenu.y }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionDialog({
                      type: "clear",
                      conversationId: contactMenu.conversationId,
                      identityId: contactMenu.identityId,
                      name: contactMenu.name,
                    });
                    setContactMenu(null);
                  }}
                >
                  <Trash2 size={17} />
                  Limpar conversa
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void toggleMute(
                      contactMenu.conversationId,
                      mutedConversations.has(contactMenu.conversationId),
                    )
                  }
                >
                  {mutedConversations.has(contactMenu.conversationId) ? (
                    <Bell size={17} />
                  ) : (
                    <BellOff size={17} />
                  )}
                  {mutedConversations.has(contactMenu.conversationId)
                    ? "Ativar notificações"
                    : "Silenciar"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setReportReason("");
                    setActionDialog({
                      type: "report",
                      conversationId: contactMenu.conversationId,
                      identityId: contactMenu.identityId,
                      name: contactMenu.name,
                    });
                    setContactMenu(null);
                  }}
                >
                  <Flag size={17} />
                  Denunciar
                </button>
              </div>
            </>
          )}

          {messageDialog?.type === "delete" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-delete-message-title"
              >
                <div className="chat-action-dialog-icon danger">
                  <Trash2 size={22} />
                </div>
                <h3 id="chat-delete-message-title">
                  {messageDialog.message.media_id
                    ? "Excluir anexo?"
                    : "Excluir mensagem?"}
                </h3>
                <p>Ela será removida para você e para a outra pessoa.</p>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setMessageDialog(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void deleteOwnMessage()}
                  >
                    {busy ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {messageDialog?.type === "report" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-report-message-title"
              >
                <div className="chat-action-dialog-icon">
                  <Flag size={22} />
                </div>
                <h3 id="chat-report-message-title">Denunciar mensagem</h3>
                <p>Conte o motivo da denúncia.</p>
                <label className="chat-report-field">
                  <span className="visually-hidden">Motivo da denúncia</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={messageReportReason}
                    onChange={(event) =>
                      setMessageReportReason(event.target.value)
                    }
                    placeholder="Escreva o motivo..."
                    autoFocus
                  />
                  <small>{messageReportReason.length}/500</small>
                </label>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMessageReportReason("");
                      setMessageDialog(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || messageReportReason.trim().length < 3}
                    onClick={() => void reportMessage()}
                  >
                    {busy ? "Enviando..." : "Enviar denúncia"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {actionDialog?.type === "clear" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-clear-title"
              >
                <div className="chat-action-dialog-icon danger">
                  <Trash2 size={22} />
                </div>
                <h3 id="chat-clear-title">Limpar conversa?</h3>
                <p>
                  Tem certeza que deseja limpar a conversa? As mensagens serão
                  removidas para você e para a outra pessoa.
                </p>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setActionDialog(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void confirmClear()}
                  >
                    {busy ? "Limpando..." : "Limpar conversa"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {actionDialog?.type === "report" && (
            <div className="chat-action-backdrop" role="presentation">
              <section
                className="chat-action-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-report-title"
              >
                <div className="chat-action-dialog-icon">
                  <Flag size={22} />
                </div>
                <h3 id="chat-report-title">Denunciar conversa</h3>
                <p>Conte o motivo da denúncia.</p>
                <label className="chat-report-field">
                  <span className="visually-hidden">Motivo da denúncia</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    placeholder="Escreva o motivo..."
                    autoFocus
                  />
                  <small>{reportReason.length}/500</small>
                </label>
                <div className="chat-action-dialog-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReportReason("");
                      setActionDialog(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || reportReason.trim().length < 3}
                    onClick={() => void submitReport()}
                  >
                    {busy ? "Enviando..." : "Enviar denúncia"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {feedback && (
            <p className="chat-action-feedback" role="status">
              {feedback}
            </p>
          )}

          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </aside>
      )}
      <VoiceCall
        ref={voiceCallRef}
        campaign={campaign}
        actor={actor}
        identities={identities}
        cosmetics={cosmetics}
        equipment={equipment}
        urls={urls}
      />
    </>
  );
}
