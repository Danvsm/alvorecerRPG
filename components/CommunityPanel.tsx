"use client";

import Image from "next/image";
import {
  ArrowLeft,
  ChevronRight,
  Compass,
  Crown,
  Home,
  Menu,
  MoreVertical,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Trophy,
  UserCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { orderCommunityIdentities } from "@/lib/community";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import CommunityArchives from "./CommunityArchives";
import CommunityFeed from "./CommunityFeed";
import CommunityStories from "./CommunityStories";
import CommunityInbox from "./CommunityInbox";
import CommunityProfile from "./CommunityProfile";
import IdentityAvatar from "./IdentityAvatar";
import NotificationBell from "./NotificationBell";
import styles from "./CommunityPanel.module.css";

type CommunityView =
  "home" | "explore" | "create" | "messages" | "profile" | "archives";
type CommunityFilter = "all" | "online" | "players" | "world";

const profileCaption = (identity: Row) => {
  if (identity.subtitle) return identity.subtitle;
  if (identity.kind === "master") return "Mestre do Alvorecer";
  if (identity.kind === "npc") return "Personagem do Mundo";
  return "Aventureiro do Alvorecer";
};

const profileLine = (identity: Row) => {
  if (identity.kind === "master") return "Guiando histórias ao amanhecer.";
  if (identity.kind === "npc") return "Uma presença viva neste mundo.";
  return "Uma história em construção.";
};

function RankMedal({ rank }: { rank: number }) {
  if (rank > 5) return <strong className={styles.rankNumber}>{rank}º</strong>;
  return (
    <span className={styles.rankMedal} title={`${rank}º lugar`}>
      <Image
        src={`/community/rank-${rank}.webp`}
        width={56}
        height={56}
        alt={`${rank}º lugar`}
      />
      <strong>{rank}º</strong>
    </span>
  );
}

function OnlineDot({ online }: { online: boolean }) {
  if (!online) return null;
  return (
    <span
      className={styles.onlineDot}
      title="Online agora"
      role="img"
      aria-label="Online agora"
    />
  );
}

export default function CommunityPanel({
  campaign,
  identities,
  cosmetics,
  equipment,
  avatars,
  urls,
  actor,
  master,
  notifications,
  openMenu,
  saveNotification,
  refreshVisuals,
  unreadMessages,
  message,
  changeActor,
  createWorldCharacter,
  deleteWorldCharacter,
  initialView = "home",
}: {
  campaign: string;
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  avatars: Row[];
  urls: Record<string, string>;
  actor: string;
  master: boolean;
  notifications: Row[];
  openMenu: () => void;
  saveNotification: (op: string, details: Row) => Promise<unknown>;
  refreshVisuals: () => Promise<void>;
  unreadMessages: number;
  message: (id: string) => void;
  changeActor?: (id: string) => void;
  createWorldCharacter?: () => void;
  deleteWorldCharacter?: (id: string) => Promise<void>;
  initialView?: "home" | "archives";
}) {
  const [selected, setSelected] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<CommunityView>(initialView);
  const [profileActionsOpen, setProfileActionsOpen] = useState(false);
  const [profileFollowing, setProfileFollowing] = useState(false);
  const [profileCanEdit, setProfileCanEdit] = useState<boolean | null>(null);
  const [profileFollowBusy, setProfileFollowBusy] = useState(false);
  const [profileFollowSignal, setProfileFollowSignal] = useState(0);
  const handleProfileFollowState = useCallback(
    ({
      following,
      canEdit,
      busy,
    }: {
      following: boolean;
      canEdit: boolean;
      busy: boolean;
    }) => {
      setProfileFollowing(following);
      setProfileCanEdit(canEdit);
      setProfileFollowBusy(busy);
    },
    [],
  );

  const [rankingMode, setRankingMode] = useState(false);
  const [filter, setFilter] = useState<CommunityFilter>("all");
  const [visibleCount, setVisibleCount] = useState(12);
  const [ranking, setRanking] = useState<Row[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const communityRef = useRef<HTMLDivElement>(null);
  const directoryRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!campaign) return;

    let active = true;
    setError("");
    const loadRanking = async () => {
      const response = await retryNetworkRead(() =>
        browserDb().rpc("wealth_ranking", { c: campaign }),
      );
      if (!active) return;
      if (response.error) setError(readableErrorMessage(response.error));
      else {
        setRanking(response.data || []);
        setError("");
      }
    };
    void loadRanking();
    return () => {
      active = false;
    };
  }, [campaign, identities]);

  useEffect(() => {
    if (!campaign) return;

    let active = true;
    const refreshPresence = async () => {
      const response = await retryNetworkRead(() =>
        browserDb().rpc("community_presence", {
          c: campaign,
        }),
      );
      if (!active) return;
      if (response.error) {
        setError(readableErrorMessage(response.error));
        return;
      }
      setOnlineUserIds(
        new Set(
          (response.data || [])
            .filter((entry: Row) => entry.online)
            .map((entry: Row) => entry.user_id),
        ),
      );
      setError("");
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refreshPresence();
    };
    const presenceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ campaign?: string }>).detail;
      if (detail?.campaign === campaign) void refreshPresence();
    };
    void refreshPresence();
    const interval = window.setInterval(refreshPresence, 30000);
    window.addEventListener("focus", resume);
    window.addEventListener("alvorecer:presence-updated", presenceUpdated);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      window.removeEventListener("alvorecer:presence-updated", presenceUpdated);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [campaign]);

  useEffect(() => setVisibleCount(12), [search, filter, rankingMode, view]);

  const activeIdentities = useMemo(
    () => identities.filter((identity) => identity.active),
    [identities],
  );
  const storyActor = master
    ? activeIdentities.find(
        (identity) => identity.kind === "master" && identity.user_id,
      )?.id || actor
    : actor;
  const rankByIdentity = useMemo(
    () =>
      new Map(ranking.map((entry) => [entry.identity_id, Number(entry.rank)])),
    [ranking],
  );
  const current = activeIdentities.find((identity) => identity.id === selected);
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const matchesSearch = (identity: Row) =>
    !normalizedSearch ||
    `${identity.name} ${identity.subtitle || ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(normalizedSearch);
  const isOnline = (identity: Row) =>
    Boolean(identity.user_id && onlineUserIds.has(identity.user_id));

  const directory = useMemo(() => {
    const byName = orderCommunityIdentities(
      activeIdentities,
      rankByIdentity,
      onlineUserIds,
      "alphabetical",
    );
    const byWealth = orderCommunityIdentities(
      activeIdentities,
      rankByIdentity,
      onlineUserIds,
      "wealth",
    );
    const byOnline = orderCommunityIdentities(
      activeIdentities,
      rankByIdentity,
      onlineUserIds,
      "online",
    );
    const byRank = ranking
      .map((entry) =>
        activeIdentities.find((identity) => identity.id === entry.identity_id),
      )
      .filter(Boolean) as Row[];
    const source = rankingMode
      ? byRank
      : view === "messages"
        ? byOnline
        : filter === "all" || filter === "online"
          ? byWealth
          : byName;
    return source.filter((identity) => {
      if (!matchesSearch(identity)) return false;
      if (view === "messages" && identity.id === actor) return false;
      if (filter === "online" && !isOnline(identity)) return false;
      if (filter === "players" && !["player", "master"].includes(identity.kind))
        return false;
      if (filter === "world" && identity.kind !== "npc") return false;
      return true;
    });
  }, [
    activeIdentities,
    actor,
    filter,
    normalizedSearch,
    onlineUserIds,
    rankingMode,
    ranking,
    view,
  ]);

  const revealSearch = () => {
    setView("explore");
    setRankingMode(false);
    setSelected("");
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  const revealCreate = () => {
    if (!actor) return;
    setSelected("");
    setView("create");
  };

  const revealProfile = (identityId: string) => {
    setProfileActionsOpen(false);
    setProfileCanEdit(null);
    setProfileFollowing(false);
    setProfileFollowBusy(false);
    setProfileFollowSignal(0);
    setSelected(identityId);
    setView("profile");
    window.requestAnimationFrame(() =>
      profileRef.current?.scrollIntoView({ behavior: "smooth" }),
    );
  };

  return (
    <div className={styles.community} ref={communityRef}>
      {view === "profile" && current ? (
        <header className={`${styles.socialHeader} ${styles.profileHeader}`}>
          <div className={styles.headerShade} />
          <button
            type="button"
            className={styles.headerButton}
            aria-label="Voltar ao início"
            onClick={() => {
              setProfileActionsOpen(false);
              setSelected("");
              setView("home");
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <strong className={styles.profileHeaderTitle}>{current.name}</strong>
          <div className={styles.headerActions}>
            <NotificationBell
              notifications={notifications}
              save={saveNotification}
            />
            {profileCanEdit === false && current && (
              <button
                type="button"
                className={styles.headerButton}
                aria-label="Enviar mensagem"
                onClick={() => message(current.id)}
              >
                <Send aria-hidden="true" />
              </button>
            )}
            {profileCanEdit === false && (
              <button
                type="button"
                className={`${styles.headerButton} ${styles.profileFollowButton} ${
                  profileFollowing ? styles.profileFollowing : ""
                }`}
                aria-label={
                  profileFollowing ? "Deixar de seguir" : "Seguir perfil"
                }
                aria-pressed={profileFollowing}
                disabled={profileFollowBusy}
                onClick={() =>
                  setProfileFollowSignal((signal) => signal + 1)
                }
              >
                {profileFollowing ? (
                  <UserCheck aria-hidden="true" />
                ) : (
                  <UserPlus aria-hidden="true" />
                )}
              </button>
            )}
            <button
              type="button"
              className={styles.headerButton}
              aria-label="Opções do perfil"
              aria-haspopup="menu"
              aria-controls="profile-actions-menu"
              aria-expanded={profileActionsOpen}
              onClick={() => setProfileActionsOpen((open) => !open)}
            >
              <MoreVertical aria-hidden="true" />
            </button>
          </div>
        </header>
      ) : view !== "messages" ? (
        <header className={styles.socialHeader}>
          <div className={styles.headerShade} />
          <button
            type="button"
            className={styles.headerButton}
            aria-label="Abrir menu"
            onClick={openMenu}
          >
            <Menu aria-hidden="true" />
          </button>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.headerButton}
              aria-label="Pesquisar na comunidade"
              aria-expanded={searchOpen}
              onClick={revealSearch}
            >
              <Search aria-hidden="true" />
            </button>
            <NotificationBell
              notifications={notifications}
              save={saveNotification}
            />
          </div>
        </header>
      ) : null}

      {view !== "messages" && <div
        className={`${styles.searchDock} ${
          view === "explore" && (searchOpen || search) ? styles.searchOpen : ""
        }`}
      >
        <label className={styles.search}>
          <Search aria-hidden="true" />
          <span className="visually-hidden">Buscar jogador</span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => {
              if (!search) setSearchOpen(false);
            }}
            placeholder="Buscar jogador"
          />
        </label>
      </div>}

      {view === "home" && actor && (
        <CommunityStories
          campaign={campaign}
          actor={storyActor}
          master={master}
          identities={identities}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
        />
      )}

      {(view === "home" || view === "create") && actor && (
        <CommunityFeed
          campaign={campaign}
          actor={actor}
          master={master}
          identities={identities}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          composerOpen={view === "create"}
          closeComposer={() => setView("home")}
          changeActor={changeActor}
          createWorldCharacter={createWorldCharacter}
        />
      )}

      {view === "archives" && master && (
        <CommunityArchives campaign={campaign} />
      )}

      {current && view === "profile" && (
        <div ref={profileRef}>
          <CommunityProfile
            campaign={campaign}
            actor={actor}
            identity={current}
            online={isOnline(current)}
            cosmetics={cosmetics}
            equipment={equipment}
            avatars={avatars}
            urls={urls}
            actionsOpen={profileActionsOpen}
            closeActions={() => setProfileActionsOpen(false)}
            followSignal={profileFollowSignal}
            onFollowState={handleProfileFollowState}
            onVisualChange={refreshVisuals}
            requestDelete={
              master &&
              deleteWorldCharacter &&
              current.kind === "npc" &&
              current.user_id == null
                ? () => setPendingDelete(current)
                : undefined
            }
          />
        </div>
      )}

      {view === "messages" && (
        <CommunityInbox
          campaign={campaign}
          actor={actor}
          identities={identities}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          onlineUserIds={onlineUserIds}
          openConversation={message}
        />
      )}

      {view === "explore" && (
        <section className={styles.directory} ref={directoryRef}>
          <div className={styles.sectionHeading}>
            <h2>
              {rankingMode ? (
                <Trophy aria-hidden="true" />
              ) : (
                <Compass aria-hidden="true" />
              )}
              {rankingMode ? "Ranking de riqueza" : "Explorar jogadores"}
            </h2>
            <div className={styles.directoryTools}>
              {(
                <button
                  type="button"
                  className={rankingMode ? styles.activeRanking : ""}
                  aria-pressed={rankingMode}
                  onClick={() => setRankingMode((active) => !active)}
                >
                  <Trophy aria-hidden="true" />
                  Ranking
                </button>
              )}
              <label className={styles.filter}>
                <SlidersHorizontal aria-hidden="true" />
                <span className="visually-hidden">Filtrar perfis</span>
                <select
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value as CommunityFilter)
                  }
                >
                  <option value="all">Todos</option>
                  <option value="online">Online agora</option>
                  <option value="players">Jogadores e Mestre</option>
                  <option value="world">Personagens do Mundo</option>
                </select>
              </label>
            </div>
          </div>

          <div className={styles.directoryGrid}>
            {directory.slice(0, visibleCount).map((identity) => {
              const rank = rankByIdentity.get(identity.id);
              return (
                <article className={styles.profileRow} key={identity.id}>
                  <button
                    type="button"
                    className={styles.profileTrigger}
                    onClick={() => revealProfile(identity.id)}
                  >
                    <span className={styles.avatarWrap}>
                      <IdentityAvatar
                        identity={identity}
                        cosmetics={cosmetics}
                        equipment={equipment}
                        urls={urls}
                        size={66}
                      />
                      <OnlineDot online={isOnline(identity)} />
                    </span>
                    <span className={styles.profileMeta}>
                      <strong>{identity.name}</strong>
                      <small>{profileCaption(identity)}</small>
                      <em>“{profileLine(identity)}”</em>
                    </span>
                  </button>
                  {rank ? (
                    <RankMedal rank={rank} />
                  ) : identity.kind === "master" ? (
                    <span className={styles.masterMark} title="Mestre">
                      <Crown aria-hidden="true" />
                    </span>
                  ) : null}
                  <ChevronRight
                    className={styles.rowChevron}
                    aria-hidden="true"
                  />
                </article>
              );
            })}
          </div>

          {!directory.length && (
            <p className={styles.empty}>Nenhum perfil encontrado.</p>
          )}
          {visibleCount < directory.length && (
            <button
              type="button"
              className={styles.loadMore}
              onClick={() => setVisibleCount((count) => count + 12)}
            >
              Mostrar mais
            </button>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {view !== "messages" && (
        <footer className={styles.footer}>
          MAIS QUE UM JOGO, UM NOVO AMANHECER.
        </footer>
      )}

      <nav className={styles.bottomNav} aria-label="Navegação da comunidade">
        <button
          type="button"
          className={view === "home" ? styles.activeBottomItem : ""}
          onClick={() => {
            setView("home");
            setSelected("");
            setRankingMode(false);
            communityRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Home aria-hidden="true" />
          <span>Início</span>
        </button>
        <button
          type="button"
          className={view === "explore" ? styles.activeBottomItem : ""}
          onClick={() => {
            setView("explore");
            setSelected("");
            setRankingMode(false);
            window.requestAnimationFrame(() =>
              directoryRef.current?.scrollIntoView({ behavior: "smooth" }),
            );
          }}
        >
          <Compass aria-hidden="true" />
          <span>Explorar</span>
        </button>
        <button
          type="button"
          className={`${styles.createButton} ${
            view === "create" ? styles.activeBottomItem : ""
          }`}
          onClick={revealCreate}
        >
          <Plus aria-hidden="true" />
          <span>Criar</span>
        </button>
        <button
          type="button"
          className={view === "messages" ? styles.activeBottomItem : ""}
          aria-label={
            unreadMessages > 0
              ? `Conversar, ${unreadMessages} mensagens não lidas`
              : "Conversar"
          }
          onClick={() => {
            setView("messages");
            setSelected("");
            setRankingMode(false);
            window.requestAnimationFrame(() =>
              directoryRef.current?.scrollIntoView({ behavior: "smooth" }),
            );
          }}
        >
          <span className={styles.bottomIcon}>
            <Send aria-hidden="true" />
            {unreadMessages > 0 && (
              <strong className={styles.messageBadge}>
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </strong>
            )}
          </span>
          <span>Conversar</span>
        </button>
        <button
          type="button"
          className={view === "profile" ? styles.activeBottomItem : ""}
          disabled={!actor}
          onClick={() => actor && revealProfile(actor)}
        >
          <UserRound aria-hidden="true" />
          <span>Perfil</span>
        </button>
      </nav>

      {pendingDelete && deleteWorldCharacter && (
        <DeleteWorldCharacterDialog
          character={pendingDelete}
          close={() => setPendingDelete(null)}
          remove={async () => {
            await deleteWorldCharacter(pendingDelete.id);
            setSelected("");
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

function DeleteWorldCharacterDialog({
  character,
  close,
  remove,
}: {
  character: Row;
  close: () => void;
  remove: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-world-character-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2 id="delete-world-character-title">
        Excluir {character.name} definitivamente?
      </h2>
      <p>
        Conversas, mensagens, comentários, mídias temporárias e cosméticos
        vinculados também serão removidos. Esta ação não pode ser desfeita.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await remove();
            } catch (reason) {
              setError(readableErrorMessage(reason));
              setBusy(false);
            }
          }}
        >
          {busy ? "Excluindo..." : "Excluir"}
        </button>
      </div>
    </dialog>
  );
}
