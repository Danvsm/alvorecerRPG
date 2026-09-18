"use client";

import Image from "next/image";
import {
  Camera,
  Eye,
  Heart,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { uploadCommunityStoryImage } from "@/lib/media";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import styles from "./CommunityPanel.module.css";

type CommunityStory = Row & {
  id: string;
  author_id: string;
  image_path: string;
  created_at: string;
  expires_at: string;
  viewer_seen: boolean;
  viewer_liked: boolean;
  like_count: number;
  view_count: number;
};

type StoryAudienceMember = Row & {
  identity_id: string;
  name: string;
  username: string | null;
  viewed_at: string | null;
  liked_at: string | null;
};

type StoryGroup = {
  author: Row;
  stories: CommunityStory[];
  seen: boolean;
};

type ViewerPosition = {
  group: number;
  story: number;
};

const STORY_DURATION = 6000;

function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "há 1 h" : `há ${hours} h`;
}

export default function CommunityStories({
  campaign,
  actor,
  master,
  identities,
  cosmetics,
  equipment,
  urls,
}: {
  campaign: string;
  actor: string;
  master: boolean;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
}) {
  const [stories, setStories] = useState<CommunityStory[]>([]);
  const [storyUrls, setStoryUrls] = useState<Record<string, string>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const act = useCallback(
    async (op: string, details: Row) => {
      const response = await browserDb().rpc("community_story_action", {
        c: campaign,
        op,
        d: { ...details, actor_id: actor },
      });
      if (response.error) throw response.error;
      return response.data as Row;
    },
    [actor, campaign],
  );

  const loadStories = useCallback(async () => {
    if (!campaign || !actor) return;
    setLoading(true);
    const response = await retryNetworkRead(() =>
      browserDb().rpc("community_stories", {
        c: campaign,
        requested_actor: actor,
      }),
    );
    if (response.error) {
      setError(readableErrorMessage(response.error));
      setLoading(false);
      return;
    }
    const loaded = ((response.data || []) as CommunityStory[]).map((story) => ({
      ...story,
      like_count: Number(story.like_count || 0),
      view_count: Number(story.view_count || 0),
    }));
    setStories(loaded);
    if (!loaded.length) {
      setStoryUrls({});
      setLoading(false);
      return;
    }
    const signed = await browserDb()
      .storage.from("community-stories")
      .createSignedUrls(
        loaded.map((story) => story.image_path),
        3600,
      );
    if (signed.error) setError(readableErrorMessage(signed.error));
    else
      setStoryUrls(
        Object.fromEntries(
          loaded.map((story, index) => [
            story.id,
            signed.data?.[index]?.signedUrl || "",
          ]),
        ),
      );
    setLoading(false);
  }, [actor, campaign]);

  useEffect(() => {
    void loadStories();
  }, [loadStories, identities]);

  useEffect(() => {
    if (!stories.length) return;
    const nextExpiry = Math.min(
      ...stories.map((story) => Date.parse(story.expires_at)),
    );
    const timer = window.setTimeout(
      () => void loadStories(),
      Math.max(50, nextExpiry - Date.now() + 50),
    );
    return () => window.clearTimeout(timer);
  }, [loadStories, stories]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadStories();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadStories]);

  const groups = useMemo(() => {
    const grouped = new Map<string, CommunityStory[]>();
    stories.forEach((story) => {
      grouped.set(story.author_id, [
        ...(grouped.get(story.author_id) || []),
        story,
      ]);
    });
    return Array.from(grouped.entries()).flatMap(([authorId, items]) => {
      const author = identities.find((identity) => identity.id === authorId);
      return author
        ? [
            {
              author,
              stories: items,
              seen: items.every((story) => story.viewer_seen),
            },
          ]
        : [];
    });
  }, [identities, stories]);

  const openGroup = (group: number) => {
    const firstUnseen = groups[group].stories.findIndex(
      (story) => !story.viewer_seen,
    );
    setViewer({ group, story: firstUnseen < 0 ? 0 : firstUnseen });
  };

  const markViewed = useCallback(
    async (story: CommunityStory) => {
      if (story.viewer_seen) return;
      setStories((current) =>
        current.map((entry) =>
          entry.id === story.id
            ? {
                ...entry,
                viewer_seen: true,
                view_count:
                  entry.author_id === actor || master
                    ? entry.view_count + 1
                    : entry.view_count,
              }
            : entry,
        ),
      );
      try {
        await act("view_story", { story_id: story.id });
      } catch (reason) {
        setError(readableErrorMessage(reason));
      }
    },
    [act, actor, master],
  );

  const toggleLike = useCallback(
    async (story: CommunityStory) => {
      const liked = !story.viewer_liked;
      const count = Math.max(0, story.like_count + (liked ? 1 : -1));
      setStories((current) =>
        current.map((entry) =>
          entry.id === story.id
            ? { ...entry, viewer_liked: liked, like_count: count }
            : entry,
        ),
      );
      try {
        const result = await act("like_story", { story_id: story.id });
        const active = Boolean(result.active);
        setStories((current) =>
          current.map((entry) =>
            entry.id === story.id
              ? {
                  ...entry,
                  viewer_liked: active,
                  like_count:
                    active === liked
                      ? entry.like_count
                      : Math.max(0, entry.like_count + (active ? 1 : -1)),
                }
              : entry,
          ),
        );
      } catch (reason) {
        setStories((current) =>
          current.map((entry) =>
            entry.id === story.id
              ? {
                  ...entry,
                  viewer_liked: story.viewer_liked,
                  like_count: story.like_count,
                }
              : entry,
          ),
        );
        throw reason;
      }
    },
    [act],
  );

  const removeStory = async (story: CommunityStory) => {
    const result = await act("delete_story", { story_id: story.id });
    setViewer(null);
    setStories((current) => current.filter((entry) => entry.id !== story.id));
    const imagePath = String(result.image_path || story.image_path);
    const deletion = await browserDb()
      .storage.from("community-stories")
      .remove([imagePath]);
    if (deletion.error) {
      setError(
        "Story excluído. A imagem será removida pela limpeza automática.",
      );
    } else {
      try {
        await act("confirm_story_cleanup", { image_path: imagePath });
      } catch {
        // The minute-by-minute server cleanup is the fallback for this queue.
      }
    }
    await loadStories();
  };

  return (
    <section className={styles.featured} aria-label="Stories">
      <div className={styles.featuredRail}>
        <button
          type="button"
          className={`${styles.featuredProfile} ${styles.createStory}`}
          aria-label="Adicionar Story"
          onClick={() => setComposerOpen(true)}
        >
          <span className={styles.storyPlus}>
            <Plus aria-hidden="true" />
          </span>
          <strong>Seu story</strong>
        </button>

        {groups.map((group, index) => (
          <button
            type="button"
            className={styles.featuredProfile}
            aria-label={`Ver Stories de ${group.author.name}`}
            key={group.author.id}
            onClick={() => openGroup(index)}
          >
            <span
              className={`${styles.storyRing} ${
                group.seen ? styles.storySeen : styles.storyUnseen
              }`}
            >
              <IdentityAvatar
                identity={group.author}
                cosmetics={cosmetics}
                equipment={equipment}
                urls={urls}
                size={78}
                className={styles.featuredAvatar}
              />
            </span>
            <strong>{group.author.name}</strong>
          </button>
        ))}

        {loading && !stories.length && (
          <span className={styles.storyLoading} aria-label="Carregando Stories">
            <LoaderCircle aria-hidden="true" />
          </span>
        )}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {composerOpen && (
        <StoryComposer
          campaign={campaign}
          actor={actor}
          close={() => setComposerOpen(false)}
          publish={async (imagePath) => {
            await act("create_story", { image_path: imagePath });
            setComposerOpen(false);
            await loadStories();
          }}
        />
      )}

      {viewer && groups[viewer.group]?.stories[viewer.story] && (
        <StoryViewer
          group={groups[viewer.group]}
          storyIndex={viewer.story}
          storyUrl={storyUrls[groups[viewer.group].stories[viewer.story].id]}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          canDelete={master || groups[viewer.group].author.id === actor}
          canViewAudience={master || groups[viewer.group].author.id === actor}
          campaign={campaign}
          actor={actor}
          identities={identities}
          close={() => setViewer(null)}
          viewed={markViewed}
          toggleLike={toggleLike}
          remove={removeStory}
          previous={() =>
            setViewer((current) => {
              if (!current) return null;
              if (current.story > 0)
                return { ...current, story: current.story - 1 };
              if (current.group > 0) {
                const previousGroup = groups[current.group - 1];
                return {
                  group: current.group - 1,
                  story: previousGroup.stories.length - 1,
                };
              }
              return current;
            })
          }
          next={() =>
            setViewer((current) => {
              if (!current) return null;
              const currentGroup = groups[current.group];
              if (current.story < currentGroup.stories.length - 1)
                return { ...current, story: current.story + 1 };
              if (current.group < groups.length - 1)
                return { group: current.group + 1, story: 0 };
              return null;
            })
          }
        />
      )}
    </section>
  );
}

function StoryComposer({
  campaign,
  actor,
  close,
  publish,
}: {
  campaign: string;
  actor: string;
  close: () => void;
  publish: (imagePath: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
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
    if (!file || busy) return;
    setBusy(true);
    setError("");
    let imagePath = "";
    try {
      imagePath = await uploadCommunityStoryImage(file, campaign, actor);
      await publish(imagePath);
    } catch (reason) {
      if (imagePath)
        await browserDb().storage.from("community-stories").remove([imagePath]);
      setError(readableErrorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className={styles.composer}
      aria-labelledby="story-composer-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className={styles.sheetHandle} />
      <header className={styles.sheetHeader}>
        <div>
          <small>ADICIONAR STORY</small>
          <h2 id="story-composer-title">Compartilhe uma imagem</h2>
        </div>
        <button type="button" aria-label="Cancelar Story" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </header>

      <label className={styles.photoPicker}>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        {preview ? (
          <Image
            src={preview}
            width={1080}
            height={1920}
            alt="Prévia do Story"
            unoptimized
          />
        ) : (
          <span>
            <Camera aria-hidden="true" />
            <strong>Selecionar imagem</strong>
            <small>JPG, PNG ou WebP</small>
          </span>
        )}
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={styles.composerActions}>
        <button type="button" disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className={styles.publishButton}
          disabled={busy || !file}
          onClick={() => void submit()}
        >
          {busy ? "Publicando..." : "Publicar Story"}
        </button>
      </div>
    </dialog>
  );
}

function StoryViewer({
  group,
  storyIndex,
  storyUrl,
  cosmetics,
  equipment,
  urls,
  canDelete,
  canViewAudience,
  campaign,
  actor,
  identities,
  close,
  viewed,
  toggleLike,
  remove,
  previous,
  next,
}: {
  group: StoryGroup;
  storyIndex: number;
  storyUrl: string;
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  canDelete: boolean;
  canViewAudience: boolean;
  campaign: string;
  actor: string;
  identities: Row[];
  close: () => void;
  viewed: (story: CommunityStory) => Promise<void>;
  toggleLike: (story: CommunityStory) => Promise<void>;
  remove: (story: CommunityStory) => Promise<void>;
  previous: () => void;
  next: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audience, setAudience] = useState<StoryAudienceMember[]>([]);
  const story = group.stories[storyIndex];

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  useEffect(() => {
    void viewed(story);
    if (audienceOpen) return;
    const timer = window.setTimeout(next, STORY_DURATION);
    return () => window.clearTimeout(timer);
  }, [audienceOpen, next, story, viewed]);

  useEffect(() => {
    setAudienceOpen(false);
    setAudience([]);
  }, [story.id]);

  const openAudience = async () => {
    if (!canViewAudience) return;
    setAudienceOpen(true);
    setAudienceLoading(true);
    setError("");
    const response = await browserDb().rpc("community_story_audience", {
      c: campaign,
      target_story: story.id,
      requested_actor: actor,
    });
    if (response.error) setError(readableErrorMessage(response.error));
    else setAudience((response.data || []) as StoryAudienceMember[]);
    setAudienceLoading(false);
  };

  return (
    <dialog
      ref={ref}
      className={styles.storyViewer}
      aria-label={`Story de ${group.author.name}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className={styles.storyProgress} aria-hidden="true">
        {group.stories.map((item, index) => (
          <span key={item.id}>
            <i
              className={
                index < storyIndex
                  ? styles.storyProgressDone
                  : index === storyIndex
                    ? styles.storyProgressActive
                    : ""
              }
            />
          </span>
        ))}
      </div>

      <header className={styles.storyViewerHeader}>
        <IdentityAvatar
          identity={group.author}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          size={48}
        />
        <span>
          <strong>{group.author.name}</strong>
          <small>{relativeTime(story.created_at)}</small>
        </span>
        {canDelete && (
          <button
            type="button"
            aria-label="Excluir Story"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void remove(story).catch((reason) => {
                setError(readableErrorMessage(reason));
                setBusy(false);
              });
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
        <button type="button" aria-label="Fechar Story" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </header>

      <div className={styles.storyStage}>
        {storyUrl ? (
          <Image
            src={storyUrl}
            alt={`Story de ${group.author.name}`}
            fill
            sizes="100vw"
            unoptimized
          />
        ) : (
          <LoaderCircle className={styles.storySpinner} aria-hidden="true" />
        )}
      </div>

      <button
        type="button"
        className={`${styles.storyTapZone} ${styles.storyTapPrevious}`}
        aria-label="Story anterior"
        onClick={previous}
      />
      <button
        type="button"
        className={`${styles.storyTapZone} ${styles.storyTapNext}`}
        aria-label="Próximo Story"
        onClick={next}
      />

      <div className={styles.storyViewerActions}>
        <button
          type="button"
          className={story.viewer_liked ? styles.storyLiked : ""}
          aria-label={story.viewer_liked ? "Remover curtida" : "Curtir Story"}
          aria-pressed={story.viewer_liked}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void toggleLike(story)
              .catch((reason) => setError(readableErrorMessage(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <Heart aria-hidden="true" />
          <span>{story.viewer_liked ? "Curtido" : "Curtir"}</span>
          {canViewAudience && <small>{story.like_count}</small>}
        </button>
        {canViewAudience && (
          <button
            type="button"
            aria-label="Ver quem visualizou e curtiu"
            aria-expanded={audienceOpen}
            onClick={() => void openAudience()}
          >
            <Eye aria-hidden="true" />
            <span>Atividade</span>
            <small>{story.view_count}</small>
          </button>
        )}
      </div>

      {audienceOpen && (
        <section
          className={styles.storyAudiencePanel}
          aria-labelledby="story-audience-title"
        >
          <header>
            <span>
              <strong id="story-audience-title">Atividade do Story</strong>
              <small>
                {story.view_count} visualizações · {story.like_count} curtidas
              </small>
            </span>
            <button
              type="button"
              aria-label="Fechar atividade"
              onClick={() => setAudienceOpen(false)}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          {audienceLoading ? (
            <p className={styles.storyAudienceEmpty}>Carregando...</p>
          ) : audience.length ? (
            <ul>
              {audience.map((member) => {
                const identity = identities.find(
                  (item) => item.id === member.identity_id,
                );
                return (
                  <li key={member.identity_id}>
                    {identity && (
                      <IdentityAvatar
                        identity={identity}
                        cosmetics={cosmetics}
                        equipment={equipment}
                        urls={urls}
                        size={44}
                      />
                    )}
                    <span>
                      <strong>{member.name}</strong>
                      {member.username && <small>@{member.username}</small>}
                    </span>
                    <div>
                      {member.viewed_at && <small>Visualizou</small>}
                      {member.liked_at && <small>Curtiu</small>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.storyAudienceEmpty}>
              Ninguém visualizou ou curtiu ainda.
            </p>
          )}
        </section>
      )}

      {error && (
        <p className={styles.storyError} role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
