"use client";

import Image from "next/image";
import {
  Award,
  ArrowLeft,
  CalendarCheck2,
  ChevronRight,
  Coins,
  Compass,
  Home,
  Medal,
  Menu,
  MoreVertical,
  Plus,
  Search,
  Send,
  Trophy,
  UserCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import CommunityArchives from "./CommunityArchives";
import CommunityFeed from "./CommunityFeed";
import CommunityStories from "./CommunityStories";
import CommunityInbox from "./CommunityInbox";
import CommunityLibrary, {
  editorialCategories,
  type EditorialCategory,
} from "./CommunityLibrary";
import CommunityProfile from "./CommunityProfile";
import IdentityAvatar from "./IdentityAvatar";
import NotificationBell from "./NotificationBell";
import styles from "./CommunityPanel.module.css";

type CommunityView =
  | "home"
  | "explore"
  | "library"
  | "create"
  | "messages"
  | "profile"
  | "archives";
type RankingMetric = "wealth" | "sessions" | "achievements" | "medals";

const rankingFields: Record<
  RankingMetric,
  {
    rank: "wealth_rank" | "session_rank" | "achievement_rank" | "medal_rank";
    count: "session_count" | "achievement_count" | "medal_count" | null;
  }
> = {
  wealth: { rank: "wealth_rank", count: null },
  sessions: { rank: "session_rank", count: "session_count" },
  achievements: { rank: "achievement_rank", count: "achievement_count" },
  medals: { rank: "medal_rank", count: "medal_count" },
};

const exploreCategories = [
  {
    id: "world_legends",
    title: "Lendas do Mundo",
    eyebrow: "Descubra o passado",
    image: "/community/lendas-do-mundo.webp",
  },
  {
    id: "players",
    title: "Jogadores",
    eyebrow: "Conheça aventureiros",
    image: "/community/jogadores.webp",
  },
  {
    id: "character_stories",
    title: "Histórias dos personagens",
    eyebrow: "Leia e compartilhe",
    image: "/community/historias-dos-personagens.webp",
  },
] as const;

const profileCaption = (identity: Row) => {
  if (identity.subtitle) return identity.subtitle;
  if (identity.kind === "master") return "Mestre do Alvorecer";
  if (identity.kind === "npc") return "Personagem do Mundo";
  return "Aventureiro do Alvorecer";
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
      {rank <= 2 && <strong>{rank}º</strong>}
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
  currentUserId,
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
  currentUserId: string;
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
  const [selectedCategory, setSelectedCategory] =
    useState<EditorialCategory>("world_legends");
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

  const [rankingMetric, setRankingMetric] = useState<RankingMetric>("wealth");
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
        browserDb().rpc("community_rankings", { c: campaign }),
      );
      if (!active) return;
      if (response.error) setError(readableErrorMessage(response.error));
      else {
        setRanking(response.data || []);
        setError("");
      }
    };
    void loadRanking();
    const channel = browserDb()
      .channel(`community-rankings:${campaign}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "campaign_events",
          filter: `campaign_id=eq.${campaign}`,
        },
        () => void loadRanking(),
      )
      .subscribe();
    return () => {
      active = false;
      void browserDb().removeChannel(channel);
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

  useEffect(() => setVisibleCount(12), [search, rankingMetric, view]);

  const activeIdentities = useMemo(
    () => identities.filter((identity) => identity.active),
    [identities],
  );
  const storyActor = master
    ? activeIdentities.find(
        (identity) => identity.kind === "master" && identity.user_id,
      )?.id || actor
    : actor;
  const selectedRanking = rankingFields[rankingMetric];
  const rankByIdentity = useMemo(
    () =>
      new Map(
        ranking.map((entry) => [
          entry.identity_id,
          Number(entry[selectedRanking.rank]),
        ]),
      ),
    [ranking, selectedRanking.rank],
  );
  const countByIdentity = useMemo(
    () =>
      new Map(
        ranking.map((entry) => [
          entry.identity_id,
          selectedRanking.count
            ? Number(entry[selectedRanking.count] || 0)
            : null,
        ]),
      ),
    [ranking, selectedRanking.count],
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
    const ranked = [...ranking]
      .sort(
        (left, right) =>
          Number(left[selectedRanking.rank]) -
          Number(right[selectedRanking.rank]),
      )
      .map((entry) =>
        activeIdentities.find((identity) => identity.id === entry.identity_id),
      )
      .filter(Boolean) as Row[];
    const rankedIds = new Set(ranked.map((identity) => identity.id));
    const fallback = activeIdentities
      .filter(
        (identity) =>
          identity.user_id &&
          ["master", "player"].includes(identity.kind) &&
          !rankedIds.has(identity.id),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

    return [...ranked, ...fallback].filter(matchesSearch);
  }, [activeIdentities, normalizedSearch, ranking, selectedRanking.rank]);

  const rankingSummary = (identityId: string) => {
    const count = countByIdentity.get(identityId) || 0;
    if (rankingMetric === "wealth") return "Posição no ranking de Dracmas";
    if (rankingMetric === "sessions")
      return `${count} ${count === 1 ? "sessão" : "sessões"}`;
    if (rankingMetric === "achievements")
      return `${count} ${count === 1 ? "conquista" : "conquistas"}`;
    return `${count} ${count === 1 ? "medalha" : "medalhas"}`;
  };

  const revealSearch = () => {
    setView("explore");
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

  const revealLibrary = (category: EditorialCategory) => {
    setSelected("");
    setSelectedCategory(category);
    setView("library");
    communityRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className={styles.community} ref={communityRef}>
      {view === "library" ? (
        <header className={`${styles.socialHeader} ${styles.profileHeader}`}>
          <div className={styles.headerShade} />
          <button
            type="button"
            className={styles.headerButton}
            aria-label="Voltar para Explorar"
            onClick={() => setView("explore")}
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <strong className={styles.profileHeaderTitle}>
            {editorialCategories[selectedCategory].title}
          </strong>
          <div className={styles.headerActions}>
            <NotificationBell
              notifications={notifications}
              save={saveNotification}
            />
          </div>
        </header>
      ) : view === "profile" && current ? (
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
                onClick={() => setProfileFollowSignal((signal) => signal + 1)}
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
        <header
          className={`${styles.socialHeader} ${
            view === "explore" ? styles.exploreHeader : ""
          }`}
        >
          <div className={styles.headerShade} />
          <button
            type="button"
            className={styles.headerButton}
            aria-label="Abrir menu"
            onClick={openMenu}
          >
            <Menu aria-hidden="true" />
          </button>
          {view === "explore" && (
            <strong className={styles.exploreHeaderTitle}>Explorar</strong>
          )}
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

      {view !== "messages" && view !== "library" && (
        <div
          className={`${styles.searchDock} ${
            view === "explore" || searchOpen || search ? styles.searchOpen : ""
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
              placeholder={
                view === "explore"
                  ? "Buscar jogadores, histórias, clãs..."
                  : "Buscar jogador"
              }
            />
            {view === "explore" && (
              <Compass
                className={styles.exploreSearchMark}
                aria-hidden="true"
              />
            )}
          </label>
        </div>
      )}

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
          openProfile={revealProfile}
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
          master={master}
          identities={identities}
          cosmetics={cosmetics}
          equipment={equipment}
          urls={urls}
          onlineUserIds={onlineUserIds}
          openConversation={message}
        />
      )}

      {view === "library" && (
        <CommunityLibrary
          campaign={campaign}
          category={selectedCategory}
          currentUserId={currentUserId}
          master={master}
        />
      )}

      {view === "explore" && (
        <section
          className={`${styles.directory} ${styles.exploreDirectory}`}
          ref={directoryRef}
        >
          <div className={styles.exploreCategories}>
            {exploreCategories.map((category) => (
              <button
                type="button"
                className={styles.exploreCategoryCard}
                key={category.title}
                style={{ backgroundImage: `url("${category.image}")` }}
                onClick={() => revealLibrary(category.id as EditorialCategory)}
              >
                <span className={styles.exploreCategoryShade} />
                <span className={styles.exploreCategoryCopy}>
                  <strong>{category.title}</strong>
                  <small>{category.eyebrow}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            ))}
          </div>

          <article className={styles.exploreLoreBanner}>
            <div className={styles.exploreLoreShade} />
            <div className={styles.exploreLoreCopy}>
              <h2>História do mundo</h2>
              <p>
                Descubra os reinos, lendas e acontecimentos que moldaram o
                universo de Alvorecer.
              </p>
              <button
                type="button"
                onClick={() => revealLibrary("world_history")}
              >
                Explorar a lore
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
            <span className={styles.exploreLoreSeal}>
              Toda lenda
              <br />
              tem um começo
            </span>
          </article>

          <div className={styles.explorePeopleHeading}>
            <span className={styles.explorePeopleIcon}>
              <Trophy aria-hidden="true" />
            </span>
            <div>
              <h2>Ranking de aventureiros</h2>
              <p>Compare jornadas sem expor valores privados.</p>
            </div>
            <button type="button" onClick={() => setVisibleCount(999)}>
              Ver todos <ChevronRight aria-hidden="true" />
            </button>
          </div>

          <div className={styles.exploreFilterPills}>
            <button
              type="button"
              className={
                rankingMetric === "wealth" ? styles.explorePillActive : ""
              }
              aria-pressed={rankingMetric === "wealth"}
              onClick={() => setRankingMetric("wealth")}
            >
              <Coins aria-hidden="true" />
              Riqueza
            </button>
            <button
              type="button"
              className={
                rankingMetric === "sessions" ? styles.explorePillActive : ""
              }
              aria-pressed={rankingMetric === "sessions"}
              onClick={() => setRankingMetric("sessions")}
            >
              <CalendarCheck2 aria-hidden="true" />
              Sessões
            </button>
            <button
              type="button"
              className={
                rankingMetric === "achievements" ? styles.explorePillActive : ""
              }
              aria-pressed={rankingMetric === "achievements"}
              onClick={() => setRankingMetric("achievements")}
            >
              <Award aria-hidden="true" />
              Conquistas
            </button>
            <button
              type="button"
              className={
                rankingMetric === "medals" ? styles.explorePillActive : ""
              }
              aria-pressed={rankingMetric === "medals"}
              onClick={() => setRankingMetric("medals")}
            >
              <Medal aria-hidden="true" />
              Medalhas
            </button>
          </div>

          <div
            className={`${styles.directoryGrid} ${styles.exploreDirectoryGrid}`}
          >
            {directory
              .slice(0, visibleCount >= 999 ? directory.length : 4)
              .map((identity, index) => {
                const rank = rankByIdentity.get(identity.id) || index + 1;
                return (
                  <article
                    className={`${styles.profileRow} ${styles.exploreProfileRow}`}
                    key={identity.id}
                  >
                    <span className={styles.exploreRank}>
                      <RankMedal rank={rank} />
                    </span>
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
                          size={58}
                        />
                        <OnlineDot online={isOnline(identity)} />
                      </span>
                      <span className={styles.profileMeta}>
                        <strong>{identity.name}</strong>
                        <small>{profileCaption(identity)}</small>
                        <em>{rankingSummary(identity.id)}</em>
                      </span>
                    </button>
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
            communityRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Home aria-hidden="true" />
          <span>Início</span>
        </button>
        <button
          type="button"
          className={
            view === "explore" || view === "library"
              ? styles.activeBottomItem
              : ""
          }
          onClick={() => {
            setView("explore");
            setSelected("");
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
