"use client";

import Image from "next/image";
import {
  Camera,
  Crop,
  Heart,
  LoaderCircle,
  MessageCircle,
  MoreVertical,
  Send,
  Smile,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { uploadCommunityPostImage } from "@/lib/media";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import { versionedImageUrl } from "@/lib/image-cache";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import styles from "./CommunityPanel.module.css";

type FeedPost = Row & {
  id: string;
  author_id: string;
  author_username?: string;
  image_path: string | null;
  caption: string;
  created_at: string;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
};

type FeedComment = Row & {
  id: string;
  author_id: string;
  author_username?: string;
  parent_id?: string;
  body: string;
  like_count: number;
  viewer_liked: boolean;
};

type FeedProps = {
  campaign: string;
  actor: string;
  master: boolean;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  composerOpen: boolean;
  closeComposer: () => void;
  changeActor?: (id: string) => void;
  createWorldCharacter?: () => void;
};

const postDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const FEED_PAGE_SIZE = 5;

export default function CommunityFeed({
  campaign,
  actor,
  master,
  identities,
  cosmetics,
  equipment,
  urls,
  composerOpen,
  closeComposer,
  changeActor,
  createWorldCharacter,
}: FeedProps) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postUrls, setPostUrls] = useState<Record<string, string>>({});
  const [commentsPost, setCommentsPost] = useState<FeedPost | null>(null);
  const [busyPost, setBusyPost] = useState("");
  const [menuPost, setMenuPost] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingPostsRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const cursorRef = useRef<{ createdAt: string; id: string } | null>(null);

  const loadPosts = useCallback(
    async (reset = false) => {
      if (!campaign || !actor || (!reset && loadingPostsRef.current)) return;
      if (reset) loadGenerationRef.current += 1;
      const generation = loadGenerationRef.current;
      loadingPostsRef.current = true;
      const cursor = reset ? null : cursorRef.current;
      if (reset) {
        setLoading(true);
        setPosts([]);
        setPostUrls({});
        setHasMore(false);
        cursorRef.current = null;
      } else {
        setLoadingMore(true);
      }
      setError("");

      try {
        const response = await retryNetworkRead(() =>
          browserDb().rpc("community_feed_page", {
            c: campaign,
            requested_actor: actor,
            cursor_created_at: cursor?.createdAt || null,
            cursor_id: cursor?.id || null,
            page_size: FEED_PAGE_SIZE + 1,
          }),
        );
        if (response.error) throw response.error;
        if (generation !== loadGenerationRef.current) return;

        const loaded = (response.data || []).map((post: Row) => ({
          ...post,
          like_count: Number(post.like_count || 0),
          comment_count: Number(post.comment_count || 0),
        })) as FeedPost[];
        const visible = loaded.slice(0, FEED_PAGE_SIZE);
        const last = visible.at(-1);
        setHasMore(loaded.length > FEED_PAGE_SIZE);
        cursorRef.current = last
          ? { createdAt: last.created_at, id: last.id }
          : cursor;
        setPosts((current) => {
          if (reset) return visible;
          const currentIds = new Set(current.map((post) => post.id));
          return [
            ...current,
            ...visible.filter((post) => !currentIds.has(post.id)),
          ];
        });

        const mediaPosts = visible.filter(
          (post): post is FeedPost & { image_path: string } =>
            Boolean(post.image_path),
        );
        if (!mediaPosts.length) return;
        const signed = await browserDb()
          .storage.from("community-posts")
          .createSignedUrls(
            mediaPosts.map((post) => post.image_path),
            3600,
          );
        if (signed.error) throw signed.error;
        if (generation !== loadGenerationRef.current) return;
        const pageUrls = Object.fromEntries(
          mediaPosts.map((post, index) => [
            post.id,
            versionedImageUrl(
              signed.data?.[index]?.signedUrl || "",
              post.image_path,
            ),
          ]),
        );
        setPostUrls((current) =>
          reset ? pageUrls : { ...current, ...pageUrls },
        );
      } catch (reason) {
        if (generation === loadGenerationRef.current)
          setError(readableErrorMessage(reason));
      } finally {
        if (generation === loadGenerationRef.current) {
          loadingPostsRef.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [actor, campaign],
  );

  useEffect(() => {
    void loadPosts(true);
  }, [loadPosts]);

  useEffect(() => {
    const channel = browserDb()
      .channel(`community-feed:${campaign}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_events",
          filter: `campaign_id=eq.${campaign}`,
        },
        (payload) => {
          const event = payload.new as Row;
          if (
            event.scope !== "feed" ||
            String(event.actor_id || "") === actor
          )
            return;
          void loadPosts(true);
        },
      )
      .subscribe();

    return () => {
      void browserDb().removeChannel(channel);
    };
  }, [actor, campaign, loadPosts]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (
      !target ||
      !hasMore ||
      loadingMore ||
      !("IntersectionObserver" in window)
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadPosts(false);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadPosts, loadingMore]);

  const act = async (op: string, details: Row) => {
    const response = await browserDb().rpc("community_feed_action", {
      c: campaign,
      op,
      d: { ...details, actor_id: actor },
    });
    if (response.error) throw response.error;
    return response.data;
  };

  const togglePostLike = async (post: FeedPost) => {
    if (busyPost) return;
    setBusyPost(post.id);
    setError("");
    try {
      const result = await act("post_like", { post_id: post.id });
      setPosts((current) =>
        current.map((entry) =>
          entry.id === post.id
            ? {
                ...entry,
                viewer_liked: Boolean(result?.active),
                like_count: Math.max(
                  0,
                  entry.like_count + (result?.active ? 1 : -1),
                ),
              }
            : entry,
        ),
      );
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyPost("");
    }
  };

  const removePost = async (post: FeedPost) => {
    if (busyPost) return;
    setBusyPost(post.id);
    setMenuPost("");
    setError("");
    try {
      const result = await act("delete_post", { post_id: post.id });
      setPosts((current) => current.filter((entry) => entry.id !== post.id));
      setPostUrls((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      if (commentsPost?.id === post.id) setCommentsPost(null);

      if (result?.deleted && result?.image_path) {
        const deletion = await browserDb()
          .storage.from("community-posts")
          .remove([result.image_path]);
        if (deletion.error) {
          setError(
            "A publicação foi excluída. A foto será removida pela limpeza automática.",
          );
        } else {
          try {
            await act("confirm_post_cleanup", {
              image_path: result.image_path,
            });
          } catch {
            // A limpeza agendada confirma a remoção caso esta chamada falhe.
          }
        }
      }
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyPost("");
    }
  };

  return (
    <section className={styles.feed} aria-label="Início da comunidade">
      {loading && !posts.length && (
        <p className={styles.feedStatus}>
          <LoaderCircle aria-hidden="true" /> Carregando publicações...
        </p>
      )}
      {!loading && !posts.length && !error && (
        <div className={styles.emptyFeed}>
          <Camera aria-hidden="true" />
          <strong>O feed está esperando a primeira história.</strong>
          <span>Use o botão + para publicar uma foto.</span>
        </div>
      )}
      {posts.map((post) => {
        const author = identities.find(
          (identity) => identity.id === post.author_id,
        );
        if (!author) return null;
        const canDelete = master || post.author_id === actor;
        return (
          <article
            className={`${styles.feedCard} ${!post.image_path ? styles.textFeedCard : ""}`}
            key={post.id}
          >
            <header className={styles.feedAuthor}>
              <IdentityAvatar
                identity={author}
                cosmetics={cosmetics}
                equipment={equipment}
                urls={urls}
                size={54}
              />
              <span>
                <strong>{author.name}</strong>
                <small>
                  {post.author_username
                    ? `@${post.author_username}`
                    : author.subtitle || "Personagem do Mundo"}
                </small>
              </span>
              {canDelete && (
                <div className={styles.postMenu}>
                  <button
                    type="button"
                    className={styles.postMenuTrigger}
                    aria-label="Opções da publicação"
                    aria-expanded={menuPost === post.id}
                    onClick={() =>
                      setMenuPost((current) =>
                        current === post.id ? "" : post.id,
                      )
                    }
                  >
                    <MoreVertical aria-hidden="true" />
                  </button>
                  {menuPost === post.id && (
                    <div className={styles.postMenuPopover} role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busyPost === post.id}
                        onClick={() => void removePost(post)}
                      >
                        <Trash2 aria-hidden="true" />
                        {busyPost === post.id
                          ? "Excluindo..."
                          : "Excluir publicação"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </header>
            {postUrls[post.id] && (
              <Image
                className={styles.postImage}
                src={postUrls[post.id]}
                width={1600}
                height={1600}
                sizes="(max-width: 760px) 100vw, 844px"
                alt={`Publicação de ${author.name}`}
                loading="lazy"
                unoptimized
              />
            )}
            <div className={styles.postBody}>
              {post.image_path ? (
                <p>
                  <strong>{author.name}</strong> {post.caption}
                </p>
              ) : (
                <p>{post.caption}</p>
              )}
              <time dateTime={post.created_at}>
                {postDate.format(new Date(post.created_at))}
              </time>
            </div>
            <div className={styles.feedActions}>
              <button
                type="button"
                className={post.viewer_liked ? styles.liked : ""}
                aria-pressed={post.viewer_liked}
                aria-label={post.viewer_liked ? "Remover curtida" : "Curtir"}
                disabled={busyPost === post.id}
                onClick={() => void togglePostLike(post)}
              >
                <Heart aria-hidden="true" fill="currentColor" />
                <span>{post.like_count}</span>
              </button>
              <button
                type="button"
                aria-label="Abrir comentários"
                onClick={() => setCommentsPost(post)}
              >
                <MessageCircle aria-hidden="true" />
                <span>{post.comment_count}</span>
              </button>
            </div>
          </article>
        );
      })}

      {posts.length > 0 && hasMore && (
        <div className={styles.feedLoadMore} ref={loadMoreRef}>
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadPosts(false)}
          >
            {loadingMore ? (
              <>
                <LoaderCircle aria-hidden="true" /> Carregando...
              </>
            ) : (
              "Carregar mais publicações"
            )}
          </button>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {composerOpen && (
        <PostComposer
          campaign={campaign}
          actor={actor}
          master={master}
          identities={identities}
          close={closeComposer}
          changeActor={changeActor}
          createWorldCharacter={createWorldCharacter}
          publish={async (imagePath, caption) => {
            await act("create_post", {
              image_path: imagePath,
              caption,
            });
            closeComposer();
            await loadPosts(true);
          }}
        />
      )}

      {commentsPost && (
        <CommentsSheet
          post={commentsPost}
          campaign={campaign}
          actor={actor}
          master={master}
          identities={identities}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          close={() => setCommentsPost(null)}
          act={act}
          changed={async () => {
            await loadPosts(true);
          }}
        />
      )}
    </section>
  );
}

function PostComposer({
  campaign,
  actor,
  master,
  identities,
  close,
  changeActor,
  createWorldCharacter,
  publish,
}: {
  campaign: string;
  actor: string;
  master: boolean;
  identities: Row[];
  close: () => void;
  changeActor?: (id: string) => void;
  createWorldCharacter?: () => void;
  publish: (imagePath: string, caption: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState("");
  const [stage, setStage] = useState<"source" | "photo" | "writing">("source");
  const [fillPreview, setFillPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async () => {
    if (!file || !caption.trim() || busy) return;
    setBusy(true);
    setError("");
    let imagePath = "";
    try {
      imagePath = await uploadCommunityPostImage(file, campaign, actor);
      await publish(imagePath, caption.trim());
    } catch (reason) {
      if (imagePath)
        await browserDb().storage.from("community-posts").remove([imagePath]);
      setError(readableErrorMessage(reason));
      setBusy(false);
    }
  };

  const submitWriting = async () => {
    if (!caption.trim() || caption.trim().length > 1000 || busy) return;
    setBusy(true);
    setError("");
    try {
      await publish("", caption.trim());
    } catch (reason) {
      setError(readableErrorMessage(reason));
      setBusy(false);
    }
  };

  const selectFile = (selected?: File) => {
    if (!selected || busy) return;
    setError("");
    setFile(selected);
    setStage("photo");
  };

  const returnToSources = () => {
    if (busy) return;
    setFile(null);
    setCaption("");
    setStage("source");
  };

  const currentIdentity = identities.find((identity) => identity.id === actor);

  return (
    <dialog
      ref={ref}
      className={`${styles.composer} ${styles.feedComposer}`}
      aria-labelledby="community-composer-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <input
        ref={galleryRef}
        className={styles.feedComposerFileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(event) => {
          selectFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={cameraRef}
        className={styles.feedComposerFileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        disabled={busy}
        onChange={(event) => {
          selectFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <h2 id="community-composer-title" className="visually-hidden">
        Criar publicação
      </h2>

      {stage === "source" ? (
        <div className={styles.feedComposerSource}>
          <button
            type="button"
            className={styles.feedComposerClose}
            aria-label="Cancelar publicação"
            disabled={busy}
            onClick={close}
          >
            <X aria-hidden="true" />
          </button>

          <header className={styles.feedComposerIntro}>
            <span className={styles.feedComposerCompass} aria-hidden="true">
              ✦
            </span>
            <h2>Compartilhe uma história</h2>
            <p>Mostre para o mundo o que aconteceu na sua aventura.</p>
          </header>

          <section
            className={styles.feedComposerChoices}
            aria-label="Tipo de publicação"
          >
            <button
              type="button"
              className={styles.feedComposerGalleryChoice}
              disabled={busy}
              onClick={() => galleryRef.current?.click()}
            >
              <Image
                src="/community/feed-composer-gallery.webp"
                width={140}
                height={136}
                alt=""
                aria-hidden="true"
              />
              <span>
                <strong>Galeria</strong>
                <small>Escolher uma foto</small>
              </span>
              <span
                className={styles.feedComposerChoiceArrow}
                aria-hidden="true"
              >
                ›
              </span>
            </button>
            <div className={styles.feedComposerSecondaryChoices}>
              <button
                type="button"
                disabled={busy}
                onClick={() => cameraRef.current?.click()}
              >
                <Image
                  src="/community/feed-composer-camera.webp"
                  width={116}
                  height={116}
                  alt=""
                  aria-hidden="true"
                />
                <strong>Câmera</strong>
                <small>Tirar foto</small>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setCaption("");
                  setStage("writing");
                }}
              >
                <Image
                  src="/community/feed-composer-quill.webp"
                  width={100}
                  height={120}
                  alt=""
                  aria-hidden="true"
                />
                <strong>Escrita</strong>
                <small>Publicar somente texto</small>
              </button>
            </div>
          </section>

          {master && changeActor && (
            <div className={styles.feedComposerActorControls}>
              <label className={styles.actorPicker}>
                <span>Publicar como</span>
                <select
                  value={actor}
                  onChange={(event) => changeActor(event.target.value)}
                >
                  {identities
                    .filter(
                      (identity) =>
                        identity.active &&
                        ["master", "npc"].includes(identity.kind),
                    )
                    .map((identity) => (
                      <option key={identity.id} value={identity.id}>
                        {identity.name}
                      </option>
                    ))}
                </select>
              </label>
              {createWorldCharacter && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    close();
                    window.requestAnimationFrame(createWorldCharacter);
                  }}
                >
                  Criar Personagem do Mundo
                </button>
              )}
            </div>
          )}

          {error && (
            <p className={styles.feedComposerError} role="alert">
              {error}
            </p>
          )}
          <Image
            className={styles.feedComposerDivider}
            src="/community/feed-composer-divider.webp"
            width={900}
            height={300}
            alt=""
            aria-hidden="true"
          />
        </div>
      ) : stage === "photo" ? (
        <div className={styles.feedComposerPhoto}>
          <header className={styles.feedPhotoToolbar}>
            <button
              type="button"
              aria-label="Voltar para opções"
              disabled={busy}
              onClick={returnToSources}
            >
              <X aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Alternar enquadramento da prévia"
              aria-pressed={fillPreview}
              disabled={busy}
              onClick={() => setFillPreview((current) => !current)}
            >
              <Crop aria-hidden="true" />
            </button>
          </header>

          <figure
            className={styles.feedPhotoPreview}
            data-fill={fillPreview || undefined}
          >
            {preview && (
              <Image
                src={preview}
                width={1200}
                height={1200}
                alt="Prévia da publicação"
                unoptimized
                priority
              />
            )}
          </figure>

          <div className={styles.feedCaptionDock}>
            <div className={styles.feedCaptionField}>
              <Image
                src="/community/feed-composer-quill.webp"
                width={34}
                height={42}
                alt=""
                aria-hidden="true"
              />
              <textarea
                value={caption}
                maxLength={2000}
                rows={2}
                disabled={busy}
                aria-label="Legenda da publicação"
                placeholder="Escreva uma legenda..."
                onChange={(event) => setCaption(event.target.value)}
              />
              <button
                type="button"
                aria-label="Adicionar brilho à legenda"
                disabled={busy || caption.length > 1998}
                onClick={() => setCaption((current) => `${current}✨`)}
              >
                <Smile aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className={styles.feedPublishOrb}
              aria-label="Publicar"
              disabled={busy || !file || !caption.trim()}
              onClick={() => void submit()}
            >
              {busy ? (
                <LoaderCircle
                  className={styles.feedPublishSpinner}
                  aria-hidden="true"
                />
              ) : (
                <Send aria-hidden="true" />
              )}
            </button>
            <small className={styles.feedCaptionCount}>
              {caption.length}/2000
            </small>
            {error && (
              <p className={styles.feedComposerError} role="alert">
                {error}
              </p>
            )}
            <Image
              className={styles.feedComposerDivider}
              src="/community/feed-composer-divider.webp"
              width={900}
              height={300}
              alt=""
              aria-hidden="true"
            />
          </div>
        </div>
      ) : (
        <div className={styles.feedWriter}>
          <button
            type="button"
            className={styles.feedWriterClose}
            aria-label="Voltar para opções"
            disabled={busy}
            onClick={returnToSources}
          >
            <X aria-hidden="true" />
          </button>

          <header className={styles.feedWriterIntro}>
            <span className={styles.feedComposerCompass} aria-hidden="true">
              ✦
            </span>
            <h2>Escreva sua história</h2>
            <p>
              Compartilhe o que aconteceu na sua aventura. Seus pensamentos,
              descobertas, desafios ou qualquer momento que marcou sua jornada.
            </p>
          </header>

          <div className={styles.feedWriterIdentity}>
            <Image
              src="/community/feed-writer-wolf.webp"
              width={90}
              height={90}
              alt=""
              aria-hidden="true"
            />
            <span>
              <small>PUBLICAR COMO</small>
              <strong>{String(currentIdentity?.name || "Orkutista")}</strong>
            </span>
            <i aria-hidden="true" />
            <em>
              <Image
                src="/community/feed-composer-quill.webp"
                width={30}
                height={36}
                alt=""
                aria-hidden="true"
              />
              Apenas texto
            </em>
          </div>

          <div className={styles.feedWriterEditor}>
            <textarea
              autoFocus
              value={caption}
              maxLength={1000}
              rows={10}
              disabled={busy}
              aria-label="Texto da publicação"
              placeholder="Comece a escrever sua história..."
              onChange={(event) => setCaption(event.target.value)}
            />
            <footer>
              <small>{caption.length} / 1.000</small>
              <button
                type="button"
                aria-label="Publicar texto"
                disabled={busy || !caption.trim()}
                onClick={() => void submitWriting()}
              >
                {busy ? (
                  <LoaderCircle
                    className={styles.feedPublishSpinner}
                    aria-hidden="true"
                  />
                ) : (
                  <Send aria-hidden="true" />
                )}
              </button>
            </footer>
          </div>

          {error && (
            <p className={styles.feedComposerError} role="alert">
              {error}
            </p>
          )}
          <Image
            className={styles.feedWriterDivider}
            src="/community/feed-writer-divider.webp"
            width={900}
            height={300}
            alt=""
            aria-hidden="true"
          />
        </div>
      )}
    </dialog>
  );
}

function CommentsSheet({
  post,
  campaign,
  actor,
  master,
  identities,
  cosmetics,
  equipment,
  urls,
  close,
  act,
  changed,
}: {
  post: FeedPost;
  campaign: string;
  actor: string;
  master: boolean;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  close: () => void;
  act: (op: string, details: Row) => Promise<Row>;
  changed: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<FeedComment | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const loadComments = useCallback(async () => {
    const response = await retryNetworkRead(() =>
      browserDb().rpc("community_post_comments", {
        c: campaign,
        target_post: post.id,
        requested_actor: actor,
      }),
    );
    if (response.error) setError(readableErrorMessage(response.error));
    else
      setComments(
        (response.data || []).map((comment: Row) => ({
          ...comment,
          like_count: Number(comment.like_count || 0),
        })),
      );
  }, [actor, campaign, post.id]);

  useEffect(() => {
    ref.current?.showModal();
    void loadComments();
    return () => ref.current?.close();
  }, [loadComments]);

  useEffect(() => {
    const channel = browserDb()
      .channel(`community-comments:${campaign}:${post.id}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_events",
          filter: `campaign_id=eq.${campaign}`,
        },
        (payload) => {
          const event = payload.new as Row;
          if (
            event.scope !== "feed" ||
            !["comment", "delete_comment"].includes(
              String(event.event_kind || ""),
            ) ||
            String(event.entity_id || "") !== post.id ||
            String(event.actor_id || "") === actor
          )
            return;
          void loadComments();
        },
      )
      .subscribe();

    return () => {
      void browserDb().removeChannel(channel);
    };
  }, [actor, campaign, loadComments, post.id]);

  const roots = useMemo(
    () => comments.filter((comment) => !comment.parent_id),
    [comments],
  );
  const replies = useMemo(() => {
    const grouped = new Map<string, FeedComment[]>();
    comments.forEach((comment) => {
      if (!comment.parent_id) return;
      grouped.set(comment.parent_id, [
        ...(grouped.get(comment.parent_id) || []),
        comment,
      ]);
    });
    return grouped;
  }, [comments]);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy("comment");
    setError("");
    try {
      await act("comment", {
        post_id: post.id,
        parent_id: replyingTo?.id || null,
        body: body.trim(),
      });
      setBody("");
      setReplyingTo(null);
      await Promise.all([loadComments(), changed()]);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const toggleLike = async (comment: FeedComment) => {
    if (busy) return;
    setBusy(comment.id);
    setError("");
    try {
      const result = await act("comment_like", { comment_id: comment.id });
      setComments((current) =>
        current.map((entry) =>
          entry.id === comment.id
            ? {
                ...entry,
                viewer_liked: Boolean(result?.active),
                like_count: Math.max(
                  0,
                  entry.like_count + (result?.active ? 1 : -1),
                ),
              }
            : entry,
        ),
      );
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const removeComment = async (comment: FeedComment) => {
    if (busy) return;
    setBusy(comment.id);
    setError("");
    try {
      const response = await browserDb().rpc("community_comment_action", {
        c: campaign,
        op: "delete_comment",
        d: { actor_id: actor, comment_id: comment.id },
      });
      if (response.error) throw response.error;
      if (replyingTo?.id === comment.id) setReplyingTo(null);
      await Promise.all([loadComments(), changed()]);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusy("");
    }
  };

  const renderComment = (comment: FeedComment, reply = false) => {
    const author = identities.find(
      (identity) => identity.id === comment.author_id,
    );
    if (!author) return null;
    return (
      <article
        className={`${styles.comment} ${reply ? styles.commentReply : ""}`}
        key={comment.id}
      >
        <IdentityAvatar
          identity={author}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          size={reply ? 34 : 40}
        />
        <div className={styles.commentBody}>
          <p>
            <strong>{author.name}</strong> {comment.body}
          </p>
          <div>
            <span>{comment.like_count} curtidas</span>
            {!reply && (
              <button type="button" onClick={() => setReplyingTo(comment)}>
                Responder
              </button>
            )}
            {(master || comment.author_id === actor) && (
              <button
                type="button"
                className={styles.commentDelete}
                disabled={busy === comment.id}
                onClick={() => void removeComment(comment)}
              >
                {busy === comment.id ? "Excluindo..." : "Excluir comentário"}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`${styles.commentLike} ${
            comment.viewer_liked ? styles.liked : ""
          }`}
          aria-label={
            comment.viewer_liked ? "Remover curtida" : "Curtir comentário"
          }
          aria-pressed={comment.viewer_liked}
          disabled={busy === comment.id}
          onClick={() => void toggleLike(comment)}
        >
          <Heart aria-hidden="true" fill="currentColor" />
        </button>
      </article>
    );
  };

  return (
    <dialog
      ref={ref}
      className={styles.commentsSheet}
      aria-labelledby="community-comments-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className={styles.sheetHandle} />
      <header className={styles.sheetHeader}>
        <h2 id="community-comments-title">Comentários</h2>
        <button type="button" aria-label="Fechar comentários" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className={styles.commentList}>
        {!roots.length && (
          <p className={styles.noComments}>Seja o primeiro a comentar.</p>
        )}
        {roots.map((comment) => (
          <div className={styles.commentThread} key={comment.id}>
            {renderComment(comment)}
            {(replies.get(comment.id) || []).map((reply) =>
              renderComment(reply, true),
            )}
          </div>
        ))}
      </div>
      {replyingTo && (
        <div className={styles.replyingTo}>
          Respondendo a{" "}
          <strong>
            {identities.find((identity) => identity.id === replyingTo.author_id)
              ?.name || "comentário"}
          </strong>
          <button
            type="button"
            aria-label="Cancelar resposta"
            onClick={() => setReplyingTo(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={styles.commentComposer}>
        <textarea
          value={body}
          maxLength={1000}
          rows={1}
          placeholder={
            replyingTo ? "Escreva uma resposta..." : "Adicione um comentário..."
          }
          onChange={(event) => setBody(event.target.value)}
        />
        <button
          type="button"
          aria-label={replyingTo ? "Enviar resposta" : "Enviar comentário"}
          disabled={!body.trim() || busy === "comment"}
          onClick={() => void submit()}
        >
          <Send aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}
