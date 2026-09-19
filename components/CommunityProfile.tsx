"use client";

import Image from "next/image";
import {
  Award,
  BadgeCheck,
  Frame,
  Heart,
  LoaderCircle,
  Medal,
  MessageCircle,
  Pencil,
  Save,
  Send,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import AvatarFrame from "./AvatarFrame";
import { CosmeticIcon } from "./CosmeticsPanel";
import IdentityAvatar from "./IdentityAvatar";
import styles from "./CommunityProfile.module.css";

type ProfileSummary = {
  identity_id: string;
  username: string | null;
  bio: string;
  post_count: number;
  session_count: number;
  achievement_count: number;
  medal_count: number;
  wealth_rank: number | null;
  viewer_following: boolean;
  can_edit: boolean;
};

type ProfilePost = {
  id: string;
  image_path: string | null;
  caption: string;
  created_at: string;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
};

type ProfileCollectible = {
  cosmetic_id: string;
  kind: "frame" | "title" | "medal";
  equipped: boolean;
  earned_at: string;
};

type ProfileTab = "wall" | "achievements" | "frames" | "medals";

const PROFILE_PAGE_SIZE = 6;
const DEFAULT_BIO =
  "Entre ruínas e recomeços, ainda escolho acreditar no amanhã.";
const postDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const rarityLabel: Record<string, string> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Rara",
  epic: "Épica",
  legendary: "Lendária",
  event: "Evento",
  supporter: "Apoiador",
  master: "Mestre",
};

function normalizedSummary(row: Row): ProfileSummary {
  return {
    identity_id: String(row.identity_id),
    username: row.username ? String(row.username) : null,
    bio: String(row.bio || ""),
    post_count: Number(row.post_count || 0),
    session_count: Number(row.session_count || 0),
    achievement_count: Number(row.achievement_count || 0),
    medal_count: Number(row.medal_count || 0),
    wealth_rank: row.wealth_rank == null ? null : Number(row.wealth_rank),
    viewer_following: Boolean(row.viewer_following),
    can_edit: Boolean(row.can_edit),
  };
}

function normalizedPost(row: Row): ProfilePost {
  return {
    id: String(row.id),
    image_path: row.image_path ? String(row.image_path) : null,
    caption: String(row.caption || ""),
    created_at: String(row.created_at),
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    viewer_liked: Boolean(row.viewer_liked),
  };
}

function CollectionTile({
  item,
  frame,
  avatarUrl,
  frameUrl,
  equipped,
}: {
  item?: Row;
  frame: boolean;
  avatarUrl?: string;
  frameUrl?: string;
  equipped: boolean;
}) {
  return (
    <article className={styles.collectionTile}>
      <div className={styles.collectionArt}>
        {frame ? (
          <AvatarFrame
            avatarUrl={avatarUrl}
            avatarAlt=""
            frame={item}
            frameUrl={frameUrl}
            size={82}
          />
        ) : item ? (
          <CosmeticIcon item={item} />
        ) : (
          <Award aria-hidden="true" />
        )}
      </div>
      <strong>{item?.name || "Em desenvolvimento"}</strong>
      <small style={item?.color ? { color: item.color } : undefined}>
        {equipped
          ? "Equipada"
          : item
            ? rarityLabel[item.rarity] || "Conquista"
            : "Em breve"}
      </small>
    </article>
  );
}

export default function CommunityProfile({
  campaign,
  actor,
  identity,
  online,
  cosmetics,
  equipment,
  urls,
  openMessage,
  requestDelete,
}: {
  campaign: string;
  actor: string;
  identity: Row;
  online: boolean;
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  openMessage: () => void;
  requestDelete?: () => void;
}) {
  const [summary, setSummary] = useState<ProfileSummary>();
  const [collectibles, setCollectibles] = useState<ProfileCollectible[]>([]);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [postUrls, setPostUrls] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<ProfileTab>("wall");
  const [bioDraft, setBioDraft] = useState("");
  const [editingBio, setEditingBio] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const cursorRef = useRef<{ createdAt: string; id: string } | undefined>(
    undefined,
  );
  const generationRef = useRef(0);

  const cosmeticById = useMemo(
    () => new Map(cosmetics.map((item) => [item.id, item])),
    [cosmetics],
  );

  const signPostMedia = useCallback(async (page: ProfilePost[]) => {
    const media = page.filter((post) => post.image_path);
    if (!media.length) return {};
    const signed = await browserDb()
      .storage.from("community-posts")
      .createSignedUrls(
        media.map((post) => post.image_path as string),
        3600,
      );
    if (signed.error) throw signed.error;
    return Object.fromEntries(
      media.map((post, index) => [
        post.id,
        signed.data?.[index]?.signedUrl || "",
      ]),
    );
  }, []);

  const loadMorePosts = useCallback(async () => {
    if (!cursorRef.current || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const cursor = cursorRef.current;
      const response = await retryNetworkRead(() =>
        browserDb().rpc("community_profile_posts", {
          c: campaign,
          requested_actor: actor,
          target_identity: identity.id,
          cursor_created_at: cursor.createdAt,
          cursor_id: cursor.id,
          page_size: PROFILE_PAGE_SIZE,
        }),
      );
      if (response.error) throw response.error;
      const page = (response.data || []).map(normalizedPost);
      const signed = await signPostMedia(page);
      setPosts((current) => [...current, ...page]);
      setPostUrls((current) => ({ ...current, ...signed }));
      setHasMore(page.length === PROFILE_PAGE_SIZE);
      const last = page.at(-1);
      cursorRef.current = last
        ? { createdAt: last.created_at, id: last.id }
        : undefined;
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  }, [actor, campaign, identity.id, loadingMore, signPostMedia]);

  useEffect(() => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError("");
    setSummary(undefined);
    setCollectibles([]);
    setPosts([]);
    setPostUrls({});
    setTab("wall");
    setEditingBio(false);
    cursorRef.current = undefined;

    void (async () => {
      try {
        const [summaryResponse, collectionResponse, postsResponse] =
          await Promise.all([
            retryNetworkRead(() =>
              browserDb().rpc("community_profile", {
                c: campaign,
                requested_actor: actor,
                target_identity: identity.id,
              }),
            ),
            retryNetworkRead(() =>
              browserDb().rpc("community_profile_collectibles", {
                c: campaign,
                requested_actor: actor,
                target_identity: identity.id,
              }),
            ),
            retryNetworkRead(() =>
              browserDb().rpc("community_profile_posts", {
                c: campaign,
                requested_actor: actor,
                target_identity: identity.id,
                cursor_created_at: null,
                cursor_id: null,
                page_size: PROFILE_PAGE_SIZE,
              }),
            ),
          ]);
        if (summaryResponse.error) throw summaryResponse.error;
        if (collectionResponse.error) throw collectionResponse.error;
        if (postsResponse.error) throw postsResponse.error;
        const loadedSummary = normalizedSummary(
          summaryResponse.data?.[0] || {},
        );
        const loadedPosts = (postsResponse.data || []).map(normalizedPost);
        const signed = await signPostMedia(loadedPosts);
        if (generation !== generationRef.current) return;
        setSummary(loadedSummary);
        setBioDraft(loadedSummary.bio);
        setCollectibles(
          (collectionResponse.data || []).map((row: Row) => ({
            cosmetic_id: String(row.cosmetic_id),
            kind: row.kind,
            equipped: Boolean(row.equipped),
            earned_at: String(row.earned_at),
          })),
        );
        setPosts(loadedPosts);
        setPostUrls(signed);
        setHasMore(loadedPosts.length === PROFILE_PAGE_SIZE);
        const last = loadedPosts.at(-1);
        cursorRef.current = last
          ? { createdAt: last.created_at, id: last.id }
          : undefined;
      } catch (reason) {
        if (generation === generationRef.current)
          setError(readableErrorMessage(reason));
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    })();
  }, [actor, campaign, identity.id, signPostMedia]);

  const saveBio = async () => {
    if (!summary) return;
    setBusyAction("bio");
    setError("");
    try {
      const response = await browserDb().rpc("community_profile_action", {
        c: campaign,
        op: "bio",
        d: { actor_id: actor, bio: bioDraft },
      });
      if (response.error) throw response.error;
      const bio = String(response.data?.bio || "");
      setSummary((current) => (current ? { ...current, bio } : current));
      setBioDraft(bio);
      setEditingBio(false);
    } catch (reason) {
      setError(readableErrorMessage(reason));
    } finally {
      setBusyAction("");
    }
  };

  const toggleFollow = async () => {
    if (!summary || summary.can_edit) return;
    const previous = summary.viewer_following;
    setSummary({ ...summary, viewer_following: !previous });
    setBusyAction("follow");
    setError("");
    try {
      const response = await browserDb().rpc("community_profile_action", {
        c: campaign,
        op: "follow",
        d: { actor_id: actor, target_id: identity.id },
      });
      if (response.error) throw response.error;
      setSummary((current) =>
        current
          ? { ...current, viewer_following: Boolean(response.data?.active) }
          : current,
      );
    } catch (reason) {
      setSummary((current) =>
        current ? { ...current, viewer_following: previous } : current,
      );
      setError(readableErrorMessage(reason));
    } finally {
      setBusyAction("");
    }
  };

  const togglePostLike = async (post: ProfilePost) => {
    const nextLiked = !post.viewer_liked;
    const nextCount = Math.max(0, post.like_count + (nextLiked ? 1 : -1));
    setBusyAction(post.id);
    setPosts((current) =>
      current.map((entry) =>
        entry.id === post.id
          ? { ...entry, viewer_liked: nextLiked, like_count: nextCount }
          : entry,
      ),
    );
    try {
      const response = await browserDb().rpc("community_feed_action", {
        c: campaign,
        op: "post_like",
        d: { actor_id: actor, post_id: post.id },
      });
      if (response.error) throw response.error;
      const active = Boolean(response.data?.active);
      setPosts((current) =>
        current.map((entry) =>
          entry.id === post.id
            ? {
                ...entry,
                viewer_liked: active,
                like_count:
                  active === nextLiked
                    ? entry.like_count
                    : Math.max(0, entry.like_count + (active ? 1 : -1)),
              }
            : entry,
        ),
      );
    } catch (reason) {
      setPosts((current) =>
        current.map((entry) => (entry.id === post.id ? post : entry)),
      );
      setError(readableErrorMessage(reason));
    } finally {
      setBusyAction("");
    }
  };

  const owned = useMemo(
    () =>
      collectibles.map((entry) => ({
        ...entry,
        item: cosmeticById.get(entry.cosmetic_id),
      })),
    [collectibles, cosmeticById],
  );
  const titles = owned.filter((entry) => entry.kind === "title");
  const frames = owned.filter((entry) => entry.kind === "frame");
  const medals = owned.filter((entry) => entry.kind === "medal");
  const equippedFrameId = equipment.find(
    (entry) => entry.identity_id === identity.id && entry.kind === "frame",
  )?.cosmetic_id;
  const equippedFrame = cosmeticById.get(equippedFrameId);
  const principalMedals = [...medals]
    .sort((left, right) => Number(right.equipped) - Number(left.equipped))
    .slice(0, 3);
  const displayedTitles = titles.slice(0, 2);
  const bio = summary?.bio || DEFAULT_BIO;

  const tabs: Array<{ id: ProfileTab; label: string; Icon: typeof Award }> = [
    { id: "wall", label: "Mural", Icon: MessageCircle },
    { id: "achievements", label: "Conquistas", Icon: Trophy },
    { id: "frames", label: "Molduras", Icon: Frame },
    { id: "medals", label: "Medalhas", Icon: Medal },
  ];

  return (
    <section
      className={styles.profile}
      aria-label={`Perfil de ${identity.name}`}
    >
      <div className={styles.hero}>
        <div className={styles.heroShade} />
        <div className={styles.identityBlock}>
          <span className={styles.avatarShell}>
            <IdentityAvatar
              identity={identity}
              cosmetics={cosmetics}
              equipment={equipment}
              urls={urls}
              size="clamp(126px, 32vw, 176px)"
            />
            {identity.user_id && (
              <i
                className={online ? styles.online : styles.offline}
                title={online ? "Online agora" : "Offline"}
              />
            )}
          </span>
          <div className={styles.identityCopy}>
            <h1>{identity.name}</h1>
            <span className={styles.username}>
              {summary?.username
                ? `@${summary.username}`
                : identity.kind === "npc"
                  ? "Personagem do Mundo"
                  : "@aventureiro"}
            </span>
            <span className={styles.role}>
              <BadgeCheck aria-hidden="true" />
              {identity.subtitle ||
                (identity.kind === "master"
                  ? "Mestre do Alvorecer"
                  : "Aventureiro do Alvorecer")}
            </span>
            {editingBio ? (
              <div className={styles.bioEditor}>
                <textarea
                  autoFocus
                  maxLength={240}
                  value={bioDraft}
                  aria-label="Biografia do perfil"
                  onChange={(event) => setBioDraft(event.target.value)}
                />
                <span>{bioDraft.length}/240</span>
                <button
                  type="button"
                  aria-label="Salvar biografia"
                  disabled={busyAction === "bio"}
                  onClick={() => void saveBio()}
                >
                  <Save aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Cancelar edição"
                  onClick={() => {
                    setBioDraft(summary?.bio || "");
                    setEditingBio(false);
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className={styles.bioLine}>
                <p>“{bio}”</p>
                {summary?.can_edit && (
                  <button
                    type="button"
                    aria-label="Editar biografia"
                    onClick={() => setEditingBio(true)}
                  >
                    <Pencil aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={styles.titleRow} aria-label="Títulos do personagem">
          {(displayedTitles.length
            ? displayedTitles
            : [
                {
                  cosmetic_id: "planned-flame",
                  item: {
                    name: "Portador da Chama",
                    icon: "flame",
                    color: "#efb65e",
                  },
                },
                {
                  cosmetic_id: "planned-clan",
                  item: {
                    name: "Clã Nascente",
                    icon: "shield",
                    color: "#c9c2b7",
                  },
                },
              ]
          ).map((entry) => (
            <span
              key={entry.cosmetic_id}
              title={entry.item ? undefined : "Em desenvolvimento"}
            >
              {entry.item && <CosmeticIcon item={entry.item} />}
              {entry.item?.name || "Título em desenvolvimento"}
            </span>
          ))}
        </div>

        <div className={styles.stats} aria-label="Estatísticas do perfil">
          <span>
            <strong>{summary?.post_count ?? 0}</strong>
            <small>Posts</small>
          </span>
          <span title="Contador de sessões em desenvolvimento">
            <strong>{summary?.session_count ?? 0}</strong>
            <small>Sessões</small>
          </span>
          <span>
            <strong>{summary?.achievement_count ?? 0}</strong>
            <small>Conquistas</small>
          </span>
          <span>
            <strong>{summary?.medal_count ?? 0}</strong>
            <small>Medalhas</small>
          </span>
          <span>
            <strong>
              {summary?.wealth_rank ? `#${summary.wealth_rank}` : "—"}
            </strong>
            <small>Ranking</small>
          </span>
        </div>

        <div className={styles.actions}>
          {summary?.can_edit ? (
            <button type="button" onClick={() => setEditingBio(true)}>
              <Pencil aria-hidden="true" /> Editar perfil
            </button>
          ) : (
            <>
              <button type="button" onClick={openMessage}>
                <Send aria-hidden="true" /> Mensagem
              </button>
              <button
                type="button"
                className={summary?.viewer_following ? styles.following : ""}
                disabled={busyAction === "follow" || !summary}
                aria-pressed={summary?.viewer_following || false}
                onClick={() => void toggleFollow()}
              >
                {summary?.viewer_following ? (
                  <UserCheck aria-hidden="true" />
                ) : (
                  <UserPlus aria-hidden="true" />
                )}
                {summary?.viewer_following ? "Seguindo" : "Seguir"}
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Conteúdo do perfil"
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.activeTab : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className={styles.status}>
          <LoaderCircle aria-hidden="true" /> Carregando perfil...
        </p>
      ) : tab === "wall" ? (
        <div className={styles.wall} role="tabpanel">
          <div className={styles.showcase}>
            <section>
              <h2>Moldura equipada</h2>
              <div className={styles.equippedFrame}>
                <IdentityAvatar
                  identity={identity}
                  cosmetics={cosmetics}
                  equipment={equipment}
                  urls={urls}
                  size={104}
                />
                <span>
                  <strong>
                    {equippedFrame?.name || "Sem moldura equipada"}
                  </strong>
                  <small
                    style={
                      equippedFrame?.color
                        ? { color: equippedFrame.color }
                        : undefined
                    }
                  >
                    {equippedFrame
                      ? rarityLabel[equippedFrame.rarity] || "Conquista"
                      : "Escolha uma moldura na coleção"}
                  </small>
                </span>
              </div>
            </section>
            <section>
              <h2>Principais medalhas</h2>
              <div className={styles.principalMedals}>
                {(principalMedals.length
                  ? principalMedals
                  : [undefined, undefined, undefined]
                ).map((entry, index) => (
                  <div key={entry?.cosmetic_id || `planned-${index}`}>
                    <span>
                      {entry?.item ? (
                        <CosmeticIcon item={entry.item} />
                      ) : (
                        <Medal aria-hidden="true" />
                      )}
                    </span>
                    <strong>{entry?.item?.name || "Em desenvolvimento"}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className={styles.postList} aria-label="Publicações do perfil">
            {posts.map((post) => (
              <article className={styles.post} key={post.id}>
                <header>
                  <IdentityAvatar
                    identity={identity}
                    cosmetics={cosmetics}
                    equipment={equipment}
                    urls={urls}
                    size={48}
                  />
                  <span>
                    <strong>{identity.name}</strong>
                    <small>
                      {summary?.username
                        ? `@${summary.username}`
                        : "Personagem"}
                      {" · "}
                      {postDate.format(new Date(post.created_at))}
                    </small>
                  </span>
                </header>
                {post.caption && <p>{post.caption}</p>}
                {postUrls[post.id] && (
                  <Image
                    src={postUrls[post.id]}
                    alt={`Publicação de ${identity.name}`}
                    width={1400}
                    height={1400}
                    sizes="(max-width: 760px) 100vw, 820px"
                    loading="lazy"
                    unoptimized
                  />
                )}
                <footer>
                  <button
                    type="button"
                    className={post.viewer_liked ? styles.liked : ""}
                    aria-label={
                      post.viewer_liked ? "Remover curtida" : "Curtir"
                    }
                    aria-pressed={post.viewer_liked}
                    disabled={busyAction === post.id}
                    onClick={() => void togglePostLike(post)}
                  >
                    <Heart aria-hidden="true" fill="currentColor" />{" "}
                    {post.like_count}
                  </button>
                  <span>
                    <MessageCircle aria-hidden="true" /> {post.comment_count}
                  </span>
                </footer>
              </article>
            ))}
            {!posts.length && (
              <p className={styles.empty}>
                Nenhuma publicação neste mural ainda.
              </p>
            )}
            {hasMore && (
              <button
                type="button"
                className={styles.loadMore}
                disabled={loadingMore}
                onClick={() => void loadMorePosts()}
              >
                {loadingMore ? "Carregando..." : "Ver mais publicações"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.collectionGrid} role="tabpanel">
          {(tab === "achievements"
            ? titles
            : tab === "frames"
              ? frames
              : medals
          ).map((entry) => (
            <CollectionTile
              key={entry.cosmetic_id}
              item={entry.item}
              frame={entry.kind === "frame"}
              avatarUrl={
                identity.avatar_id ? urls[identity.avatar_id] : undefined
              }
              frameUrl={entry.item?.id ? urls[entry.item.id] : undefined}
              equipped={entry.equipped}
            />
          ))}
          {!(
            tab === "achievements" ? titles : tab === "frames" ? frames : medals
          ).length && (
            <div className={styles.emptyCollection}>
              <Award aria-hidden="true" />
              <strong>Em desenvolvimento</strong>
              <p>As próximas conquistas deste personagem aparecerão aqui.</p>
            </div>
          )}
        </div>
      )}

      {requestDelete && (
        <button
          type="button"
          className={styles.deleteProfile}
          onClick={requestDelete}
        >
          <Trash2 aria-hidden="true" /> Excluir personagem definitivamente
        </button>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
