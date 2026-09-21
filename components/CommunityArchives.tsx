"use client";

import Image from "next/image";
import { Archive, Clock, Images, LoaderCircle, PhoneCall, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import styles from "./CommunityPanel.module.css";

type ArchivedPost = Row & {
  id: string;
  author_name: string;
  author_username?: string;
  image_path: string | null;
  caption: string;
  created_at: string;
  archived_at: string;
  expires_at: string;
};

type ArchivedChatPhoto = Row & {
  id: string;
  message_id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  first_name: string;
  second_name: string;
  storage_path: string;
  created_at: string;
  chat_expires_at: string;
  archive_expires_at: string;
  removed_from_chat_at?: string | null;
  message_deleted_at?: string | null;
  message_cleared_at?: string | null;
};

type ArchivedCall = Row & {
  id: string;
  conversation_id: string;
  caller_id: string;
  caller_name: string;
  callee_id: string;
  callee_name: string;
  status: "ended" | "declined" | "cancelled" | "missed" | "failed";
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  ended_by_name: string | null;
  failure_reason: string | null;
  duration_seconds: number;
  recording_id: string | null;
  recording_storage_path: string | null;
  recording_mime_type: string | null;
  recording_duration_ms: number | null;
  recording_byte_size: number | null;
};

type ArchiveDeleteType = "call" | "chat_media" | "post";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const remainingTime = (expiresAt: string, now: number) => {
  const milliseconds = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
};

const callStatusLabel: Record<ArchivedCall["status"], string> = {
  ended: "Encerrada",
  declined: "Recusada",
  cancelled: "Cancelada",
  missed: "Não atendida",
  failed: "Falhou",
};

const callDuration = (seconds: number) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}min ${rest}s`;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

export default function CommunityArchives({ campaign }: { campaign: string }) {
  const [posts, setPosts] = useState<ArchivedPost[]>([]);
  const [chatPhotos, setChatPhotos] = useState<ArchivedChatPhoto[]>([]);
  const [calls, setCalls] = useState<ArchivedCall[]>([]);
  const [callRecordingUrls, setCallRecordingUrls] = useState<Record<string, string>>({});
  const [postUrls, setPostUrls] = useState<Record<string, string>>({});
  const [chatUrls, setChatUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [postResponse, chatResponse, callResponse] = await Promise.all([
      retryNetworkRead(() =>
        browserDb().rpc("community_archived_posts", { c: campaign }),
      ),
      retryNetworkRead(() =>
        browserDb().rpc("master_chat_media_archive", { c: campaign }),
      ),
      retryNetworkRead(() =>
        browserDb().rpc("master_direct_call_archive", { c: campaign }),
      ),
    ]);

    if (postResponse.error || chatResponse.error || callResponse.error) {
      setError(
        readableErrorMessage(
          postResponse.error || chatResponse.error || callResponse.error,
        ),
      );
      setLoading(false);
      return;
    }

    const loadedPosts = (postResponse.data || []) as ArchivedPost[];
    const loadedChatPhotos = (chatResponse.data || []) as ArchivedChatPhoto[];
    const loadedCalls = (callResponse.data || []) as ArchivedCall[];
    setPosts(loadedPosts);
    setChatPhotos(loadedChatPhotos);
    setCalls(loadedCalls);

    const recordedCalls = loadedCalls.filter(
      (call): call is ArchivedCall & { recording_storage_path: string } =>
        Boolean(call.recording_storage_path),
    );

    if (recordedCalls.length) {
      const signedRecordings = await browserDb()
        .storage.from("call-recordings")
        .createSignedUrls(
          recordedCalls.map((call) => call.recording_storage_path),
          3600,
        );

      if (signedRecordings.error) {
        setError(readableErrorMessage(signedRecordings.error));
      } else {
        setCallRecordingUrls(
          Object.fromEntries(
            recordedCalls.map((call, index) => [
              call.id,
              signedRecordings.data?.[index]?.signedUrl || "",
            ]),
          ),
        );
      }
    } else {
      setCallRecordingUrls({});
    }

    const mediaPosts = loadedPosts.filter(
      (post): post is ArchivedPost & { image_path: string } =>
        Boolean(post.image_path),
    );

    if (mediaPosts.length) {
      const signed = await browserDb()
        .storage.from("community-posts")
        .createSignedUrls(
          mediaPosts.map((post) => post.image_path),
          3600,
        );

      if (signed.error) {
        setError(readableErrorMessage(signed.error));
      } else {
        setPostUrls(
          Object.fromEntries(
            mediaPosts.map((post, index) => [
              post.id,
              signed.data?.[index]?.signedUrl || "",
            ]),
          ),
        );
      }
    } else {
      setPostUrls({});
    }

    if (loadedChatPhotos.length) {
      const signedChat = await Promise.all(
        loadedChatPhotos.map(async (photo) => {
          const remainingSeconds = Math.floor(
            (new Date(photo.archive_expires_at).getTime() - Date.now()) / 1000,
          );
          if (remainingSeconds <= 0) return [photo.id, ""] as const;

          const signed = await browserDb()
            .storage.from("chat-media")
            .createSignedUrl(
              photo.storage_path,
              Math.max(1, Math.min(3600, remainingSeconds)),
            );

          return [
            photo.id,
            signed.error ? "" : signed.data.signedUrl,
          ] as const;
        }),
      );
      setChatUrls(Object.fromEntries(signedChat));
    } else {
      setChatUrls({});
    }

    setLoading(false);
  }, [campaign]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const deleteArchivedItem = async (
    type: ArchiveDeleteType,
    id: string,
    label: string,
  ) => {
    if (deleting) return;
    if (
      !window.confirm(
        `Excluir definitivamente ${label}? Esta ação não pode ser desfeita.`,
      )
    )
      return;

    const key = `${type}:${id}`;
    setDeleting(key);
    setError("");

    try {
      const response = await browserDb().rpc("master_archive_delete", {
        c: campaign,
        item_type: type,
        target_id: id,
      });

      if (response.error) {
        setError(readableErrorMessage(response.error));
        return;
      }

      if (type === "call") {
        setCalls((current) => current.filter((item) => item.id !== id));
        setCallRecordingUrls((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      } else if (type === "chat_media") {
        setChatPhotos((current) => current.filter((item) => item.id !== id));
        setChatUrls((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      } else {
        setPosts((current) => current.filter((item) => item.id !== id));
        setPostUrls((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      }
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setDeleting("");
    }
  };

  return (
    <section className={styles.archives} aria-labelledby="archives-title">
      <div className={styles.archivesHeading}>
        <span>
          <Archive aria-hidden="true" />
        </span>
        <div>
          <small>ÁREA EXCLUSIVA DO MESTRE</small>
          <h1 id="archives-title">Arquivos</h1>
          <p>
            Chamadas encerradas ficam registradas no histórico. Fotos enviadas
            no chat ficam preservadas por 72 horas e publicações excluídas da
            Comunidade continuam arquivadas por 24 horas.
          </p>
        </div>
      </div>

      {loading && (
        <p className={styles.feedStatus}>
          <LoaderCircle aria-hidden="true" /> Carregando arquivos...
        </p>
      )}

      {!loading && (
        <>
          <section className={styles.archiveSection} aria-labelledby="call-archive-title">
            <div className={styles.archiveSectionHeading}>
              <span>
                <PhoneCall aria-hidden="true" />
                <strong id="call-archive-title">Chamadas</strong>
              </span>
              <small>Histórico</small>
            </div>

            {!calls.length && !error && (
              <div className={styles.emptyFeed}>
                <PhoneCall aria-hidden="true" />
                <strong>Nenhuma chamada arquivada.</strong>
                <span>Chamadas encerradas, recusadas ou não atendidas aparecerão aqui.</span>
              </div>
            )}

            <div className={styles.archiveGrid}>
              {calls.map((call) => (
                <article className={styles.archiveCard} key={call.id}>
                  <div className={styles.archiveTextPreview}>
                    <PhoneCall aria-hidden="true" />
                    <span>{callStatusLabel[call.status]}</span>
                  </div>

                  <div className={styles.archiveDetails}>
                    <strong>
                      {call.caller_name} × {call.callee_name}
                    </strong>
                    <span>{callStatusLabel[call.status]}</span>
                    <p>
                      {call.status === "failed" && call.failure_reason
                        ? call.failure_reason
                        : call.answered_at
                          ? "Ligação atendida."
                          : call.status === "declined"
                            ? "Ligação recusada antes de atender."
                            : call.status === "cancelled"
                              ? "Ligação cancelada antes de atender."
                              : "Ligação não atendida."}
                    </p>
                    <dl>
                      <div>
                        <dt>Iniciada</dt>
                        <dd>{dateTime.format(new Date(call.created_at))}</dd>
                      </div>
                      {call.answered_at && (
                        <div>
                          <dt>Atendida</dt>
                          <dd>{dateTime.format(new Date(call.answered_at))}</dd>
                        </div>
                      )}
                      {call.ended_at && (
                        <div>
                          <dt>Encerrada</dt>
                          <dd>{dateTime.format(new Date(call.ended_at))}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Duração</dt>
                        <dd>{callDuration(call.duration_seconds)}</dd>
                      </div>
                      {call.ended_by_name && (
                        <div>
                          <dt>Encerrada por</dt>
                          <dd>{call.ended_by_name}</dd>
                        </div>
                      )}
                    </dl>
                    {call.recording_id && callRecordingUrls[call.id] && (
                      <div className={styles.archiveCallRecording}>
                        <strong>Gravação da conversa</strong>
                        <audio
                          controls
                          preload="none"
                          src={callRecordingUrls[call.id]}
                        />
                        {call.recording_duration_ms && (
                          <small>
                            Áudio arquivado ·{" "}
                            {callDuration(
                              Math.floor(call.recording_duration_ms / 1000),
                            )}
                          </small>
                        )}
                      </div>
                    )}
                    <em>
                      <Clock aria-hidden="true" /> Salva no histórico de chamadas
                    </em>
                    <button
                      type="button"
                      className={styles.archiveDeleteButton}
                      disabled={Boolean(deleting)}
                      onClick={() =>
                        void deleteArchivedItem(
                          "call",
                          call.id,
                          `a chamada entre ${call.caller_name} e ${call.callee_name}`,
                        )
                      }
                    >
                      {deleting === `call:${call.id}` ? (
                        <LoaderCircle aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                      Excluir definitivamente
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.archiveSection} aria-labelledby="chat-archive-title">
            <div className={styles.archiveSectionHeading}>
              <span>
                <Images aria-hidden="true" />
                <strong id="chat-archive-title">Fotos do chat</strong>
              </span>
              <small>72 horas</small>
            </div>

            {!chatPhotos.length && !error && (
              <div className={styles.emptyFeed}>
                <Images aria-hidden="true" />
                <strong>Nenhuma foto de chat arquivada.</strong>
                <span>Fotos enviadas nas conversas aparecerão aqui.</span>
              </div>
            )}

            <div className={styles.archiveGrid}>
              {chatPhotos.map((photo) => (
                <article className={styles.archiveCard} key={photo.id}>
                  {chatUrls[photo.id] ? (
                    <Image
                      src={chatUrls[photo.id]}
                      width={900}
                      height={900}
                      sizes="(max-width: 700px) 100vw, 420px"
                      alt={`Foto enviada por ${photo.sender_name} no chat`}
                      unoptimized
                    />
                  ) : (
                    <div className={styles.archiveTextPreview}>
                      <Images aria-hidden="true" />
                      <span>Imagem indisponível</span>
                    </div>
                  )}

                  <div className={styles.archiveDetails}>
                    <strong>{photo.sender_name}</strong>
                    <span>
                      {photo.first_name} × {photo.second_name}
                    </span>
                    <p>
                      {photo.removed_from_chat_at || photo.message_deleted_at
                        ? "Removida do chat pelo autor."
                        : photo.message_cleared_at
                          ? "Conversa limpa pelos jogadores."
                          : "Foto enviada na conversa."}
                    </p>
                    <dl>
                      <div>
                        <dt>Enviada</dt>
                        <dd>{dateTime.format(new Date(photo.created_at))}</dd>
                      </div>
                      <div>
                        <dt>Visível no chat até</dt>
                        <dd>
                          {dateTime.format(new Date(photo.chat_expires_at))}
                        </dd>
                      </div>
                    </dl>
                    <em>
                      <Clock aria-hidden="true" /> Arquivo expira em{" "}
                      {remainingTime(photo.archive_expires_at, now)}
                    </em>
                    <button
                      type="button"
                      className={styles.archiveDeleteButton}
                      disabled={Boolean(deleting)}
                      onClick={() =>
                        void deleteArchivedItem(
                          "chat_media",
                          photo.id,
                          `a foto enviada por ${photo.sender_name}`,
                        )
                      }
                    >
                      {deleting === `chat_media:${photo.id}` ? (
                        <LoaderCircle aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                      Excluir definitivamente
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.archiveSection} aria-labelledby="post-archive-title">
            <div className={styles.archiveSectionHeading}>
              <span>
                <Archive aria-hidden="true" />
                <strong id="post-archive-title">Publicações excluídas</strong>
              </span>
              <small>24 horas</small>
            </div>

            {!posts.length && !error && (
              <div className={styles.emptyFeed}>
                <Archive aria-hidden="true" />
                <strong>Nenhuma publicação arquivada.</strong>
                <span>Exclusões feitas pelo Mestre não passam por esta área.</span>
              </div>
            )}

            <div className={styles.archiveGrid}>
              {posts.map((post) => (
                <article className={styles.archiveCard} key={post.id}>
                  {postUrls[post.id] && (
                    <Image
                      src={postUrls[post.id]}
                      width={900}
                      height={900}
                      sizes="(max-width: 700px) 100vw, 420px"
                      alt={`Publicação arquivada de ${post.author_name}`}
                      unoptimized
                    />
                  )}
                  {!post.image_path && (
                    <div className={styles.archiveTextPreview}>
                      <Image
                        src="/community/feed-writer-wolf.webp"
                        width={150}
                        height={150}
                        alt="Publicação somente de texto"
                      />
                      <span>Apenas texto</span>
                    </div>
                  )}
                  <div className={styles.archiveDetails}>
                    <strong>{post.author_name}</strong>
                    <span>
                      {post.author_username
                        ? `@${post.author_username}`
                        : "Sem username"}
                    </span>
                    <p>{post.caption}</p>
                    <dl>
                      <div>
                        <dt>Publicada</dt>
                        <dd>{dateTime.format(new Date(post.created_at))}</dd>
                      </div>
                      <div>
                        <dt>Excluída</dt>
                        <dd>{dateTime.format(new Date(post.archived_at))}</dd>
                      </div>
                    </dl>
                    <em>
                      <Clock aria-hidden="true" /> Exclusão definitiva em{" "}
                      {remainingTime(post.expires_at, now)}
                    </em>
                    <button
                      type="button"
                      className={styles.archiveDeleteButton}
                      disabled={Boolean(deleting)}
                      onClick={() =>
                        void deleteArchivedItem(
                          "post",
                          post.id,
                          `a publicação de ${post.author_name}`,
                        )
                      }
                    >
                      {deleting === `post:${post.id}` ? (
                        <LoaderCircle aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                      Excluir definitivamente
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
