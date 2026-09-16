"use client";

import Image from "next/image";
import {
  Bookmark,
  ChevronRight,
  Compass,
  Crown,
  Heart,
  Home,
  Menu,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { orderCommunityIdentities } from "@/lib/community";
import type { Row } from "@/lib/types";
import { CosmeticIcon } from "./CosmeticsPanel";
import IdentityAvatar from "./IdentityAvatar";
import NotificationBell from "./NotificationBell";
import ProfileWall from "./ProfileWall";
import styles from "./CommunityPanel.module.css";

type CommunityTab = "discover" | "messages" | "ranking";
type CommunityFilter = "all" | "online" | "players" | "world";

const tabs: Array<{
  id: CommunityTab;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: "discover", label: "Descobrir", icon: Sparkles },
  { id: "messages", label: "Mensagens", icon: MessageCircle },
  { id: "ranking", label: "Ranking", icon: Trophy },
];

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
  grants,
  equipment,
  urls,
  actor,
  master,
  notifications,
  openMenu,
  saveNotification,
  navigate,
  message,
  changeActor,
  createWorldCharacter,
  deleteWorldCharacter,
}: {
  campaign: string;
  identities: Row[];
  cosmetics: Row[];
  grants: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  actor: string;
  master: boolean;
  notifications: Row[];
  openMenu: () => void;
  saveNotification: (op: string, details: Row) => Promise<unknown>;
  navigate: (page: string) => void;
  message: (id: string) => void;
  changeActor?: (id: string) => void;
  createWorldCharacter?: () => void;
  deleteWorldCharacter?: (id: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTab] = useState<CommunityTab>("discover");
  const [bottomActive, setBottomActive] = useState("home");
  const [filter, setFilter] = useState<CommunityFilter>("all");
  const [visibleCount, setVisibleCount] = useState(12);
  const [ranking, setRanking] = useState<Row[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const communityRef = useRef<HTMLDivElement>(null);
  const directoryRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const loadRanking = async () => {
      const response = await browserDb().rpc("wealth_ranking", { c: campaign });
      if (!active) return;
      if (response.error) setError(response.error.message);
      else setRanking(response.data || []);
    };
    void loadRanking();
    return () => {
      active = false;
    };
  }, [campaign, identities]);

  useEffect(() => {
    let active = true;
    const refreshPresence = async () => {
      const response = await browserDb().rpc("community_presence", {
        c: campaign,
      });
      if (!active) return;
      if (response.error) {
        setError(response.error.message);
        return;
      }
      setOnlineUserIds(
        new Set(
          (response.data || [])
            .filter((entry: Row) => entry.online)
            .map((entry: Row) => entry.user_id),
        ),
      );
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

  useEffect(() => setVisibleCount(12), [search, filter, tab]);

  const activeIdentities = useMemo(
    () => identities.filter((identity) => identity.active),
    [identities],
  );
  const rankByIdentity = useMemo(
    () =>
      new Map(ranking.map((entry) => [entry.identity_id, Number(entry.rank)])),
    [ranking],
  );
  const current = activeIdentities.find((identity) => identity.id === selected);
  const actorIdentity = activeIdentities.find(
    (identity) => identity.id === actor,
  );
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const matchesSearch = (identity: Row) =>
    !normalizedSearch ||
    `${identity.name} ${identity.subtitle || ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(normalizedSearch);
  const isOnline = (identity: Row) =>
    Boolean(identity.user_id && onlineUserIds.has(identity.user_id));

  const featured = useMemo(
    () =>
      activeIdentities
        .filter((identity) => identity.user_id)
        .sort((left, right) => {
          const leftRank = rankByIdentity.get(left.id) ?? 999;
          const rightRank = rankByIdentity.get(right.id) ?? 999;
          return (
            leftRank - rightRank || left.name.localeCompare(right.name, "pt-BR")
          );
        })
        .slice(0, 6),
    [activeIdentities, rankByIdentity],
  );
  const feedIdentity = actorIdentity || featured[0];

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
    const source =
      tab === "ranking"
        ? byRank
        : tab === "messages"
          ? byOnline
          : filter === "all" || filter === "online"
            ? byWealth
            : byName;
    return source.filter((identity) => {
      if (!matchesSearch(identity)) return false;
      if (tab === "messages" && identity.id === actor) return false;
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
    ranking,
    tab,
  ]);

  const selectTab = (nextTab: CommunityTab) => {
    setTab(nextTab);
    setSelected("");
    setBottomActive(nextTab === "messages" ? "messages" : "explore");
  };

  const revealSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  const revealProfile = () => {
    if (!actor) return;
    setSelected(actor);
    setBottomActive("create");
    window.requestAnimationFrame(() =>
      profileRef.current?.scrollIntoView({ behavior: "smooth" }),
    );
  };

  return (
    <div className={styles.community} ref={communityRef}>
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
        <Image
          className={styles.logo}
          src="/community/orkutista-logo.webp"
          width={480}
          height={160}
          sizes="(max-width: 480px) 190px, 260px"
          alt="Orkutista, seu mundo"
          priority
        />
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

      <div
        className={`${styles.searchDock} ${searchOpen || search ? styles.searchOpen : ""}`}
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
      </div>

      {featured.length > 0 && (
        <section className={styles.featured}>
          <div className={styles.sectionHeading}>
            <h2>
              <Sparkles aria-hidden="true" />
              Em destaque
            </h2>
            <button
              type="button"
              onClick={() => directoryRef.current?.scrollIntoView()}
            >
              Ver todos <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className={styles.featuredRail}>
            <button
              type="button"
              className={`${styles.featuredProfile} ${styles.createStory}`}
              onClick={revealProfile}
            >
              <span className={styles.storyPlus}>
                <Plus aria-hidden="true" />
              </span>
              <strong>Seu story</strong>
              <small>Compartilhe</small>
            </button>
            {featured.map((identity) => (
              <button
                type="button"
                className={styles.featuredProfile}
                key={identity.id}
                onClick={() => setSelected(identity.id)}
              >
                <span className={styles.avatarWrap}>
                  <IdentityAvatar
                    identity={identity}
                    cosmetics={cosmetics}
                    equipment={equipment}
                    urls={urls}
                    size="clamp(104px, 23vw, 118px)"
                    className={styles.featuredAvatar}
                  />
                  <OnlineDot online={isOnline(identity)} />
                </span>
                <strong>{identity.name}</strong>
                <small>{profileCaption(identity)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <nav
        className={styles.tabs}
        aria-label="Seções da Comunidade"
        role="tablist"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.activeTab : ""}
            onClick={() => selectTab(id)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      {master && changeActor && createWorldCharacter && (
        <section className={styles.masterBar} aria-label="Controles do Mestre">
          <Crown aria-hidden="true" />
          <label>
            <span>Publicar como</span>
            <select
              value={actor}
              onChange={(event) => changeActor(event.target.value)}
            >
              {activeIdentities
                .filter((identity) => ["master", "npc"].includes(identity.kind))
                .map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" onClick={createWorldCharacter}>
            Criar Personagem do Mundo
          </button>
        </section>
      )}

      {tab === "discover" && feedIdentity && (
        <section className={styles.feed} aria-label="Início da comunidade">
          <article className={styles.feedCard}>
            <header className={styles.feedAuthor}>
              <span className={styles.avatarWrap}>
                <IdentityAvatar
                  identity={feedIdentity}
                  cosmetics={cosmetics}
                  equipment={equipment}
                  urls={urls}
                  size={56}
                />
                <OnlineDot online={isOnline(feedIdentity)} />
              </span>
              <span>
                <strong>{feedIdentity.name}</strong>
                <small>{profileCaption(feedIdentity)}</small>
              </span>
              <MoreVertical aria-hidden="true" />
            </header>
            <p className={styles.feedText}>
              Grandes histórias também são vividas juntas. O mundo de Alvorecer
              continua em cada novo encontro.
            </p>
            <div className={styles.feedArtwork}>
              <Image
                src="/community/community-wallpaper.webp"
                width={1536}
                height={700}
                sizes="(max-width: 760px) 100vw, 820px"
                alt="Castelo de Alvorecer sob um eclipse vermelho"
              />
              <span>UM SÓ MUNDO. MUITAS HISTÓRIAS.</span>
            </div>
            <div
              className={styles.feedActions}
              aria-label="Ações da publicação"
            >
              <span title="Curtir">
                <Heart aria-hidden="true" />
              </span>
              <span title="Comentar">
                <MessageCircle aria-hidden="true" />
              </span>
              <span title="Compartilhar">
                <Send aria-hidden="true" />
              </span>
              <span title="Salvar">
                <Bookmark aria-hidden="true" />
              </span>
            </div>
          </article>
        </section>
      )}

      {current && (
        <section className={styles.publicProfile} ref={profileRef}>
          <div className={styles.profileHeading}>
            <span className={styles.avatarWrap}>
              <IdentityAvatar
                identity={current}
                cosmetics={cosmetics}
                equipment={equipment}
                urls={urls}
                size={108}
              />
              <OnlineDot online={isOnline(current)} />
            </span>
            <div>
              <small>PERFIL PÚBLICO</small>
              <h2>{current.name}</h2>
              <p>{profileCaption(current)}</p>
              {current.user_id && (
                <span className={styles.presenceLabel}>
                  <i className={isOnline(current) ? styles.online : ""} />
                  {isOnline(current) ? "Online agora" : "Offline"}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setSelected("")}>
              Fechar
            </button>
          </div>
          <div className={styles.profileActions}>
            {current.id !== actor && (
              <button type="button" onClick={() => message(current.id)}>
                <MessageCircle aria-hidden="true" /> Mensagem
              </button>
            )}
            {master &&
              deleteWorldCharacter &&
              current.kind === "npc" &&
              current.user_id == null && (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setPendingDelete(current)}
                >
                  Excluir definitivamente
                </button>
              )}
          </div>
          <div className={styles.collection}>
            {grants
              .filter((grant) => grant.identity_id === current.id)
              .map((grant) => {
                const item = cosmetics.find(
                  (cosmetic) => cosmetic.id === grant.cosmetic_id,
                );
                return (
                  item && (
                    <span key={item.id} title={item.name}>
                      <CosmeticIcon item={item} />
                      {item.name}
                    </span>
                  )
                );
              })}
          </div>
          <ProfileWall
            campaign={campaign}
            profile={current.id}
            actor={actor}
            master={master}
            identities={identities}
            cosmetics={cosmetics}
            equipment={equipment}
            urls={urls}
            revision={identities}
          />
        </section>
      )}

      <section className={styles.directory} ref={directoryRef}>
        <div className={styles.sectionHeading}>
          <h2>
            {tab === "ranking" ? (
              <Trophy aria-hidden="true" />
            ) : tab === "messages" ? (
              <MessageCircle aria-hidden="true" />
            ) : (
              <Users aria-hidden="true" />
            )}
            {tab === "ranking"
              ? "Ranking de riqueza"
              : tab === "messages"
                ? "Escolha com quem conversar"
                : "Todos os jogadores"}
          </h2>
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

        <div className={styles.directoryGrid}>
          {directory.slice(0, visibleCount).map((identity) => {
            const rank = rankByIdentity.get(identity.id);
            return (
              <article className={styles.profileRow} key={identity.id}>
                <button
                  type="button"
                  className={styles.profileTrigger}
                  onClick={() => setSelected(identity.id)}
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
                {tab === "messages" && identity.id !== actor ? (
                  <button
                    type="button"
                    className={styles.messageAction}
                    aria-label={`Conversar com ${identity.name}`}
                    onClick={() => message(identity.id)}
                  >
                    <MessageCircle aria-hidden="true" />
                  </button>
                ) : rank ? (
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
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>

      <footer className={styles.footer}>
        MAIS QUE UM JOGO, UM NOVO AMANHECER.
      </footer>

      <nav className={styles.bottomNav} aria-label="Navegação da comunidade">
        <button
          type="button"
          className={bottomActive === "home" ? styles.activeBottomItem : ""}
          onClick={() => {
            setTab("discover");
            setSelected("");
            setBottomActive("home");
            communityRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Home aria-hidden="true" />
          <span>Início</span>
        </button>
        <button
          type="button"
          className={bottomActive === "explore" ? styles.activeBottomItem : ""}
          onClick={() => {
            setTab("discover");
            setBottomActive("explore");
            directoryRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Compass aria-hidden="true" />
          <span>Explorar</span>
        </button>
        <button
          type="button"
          className={`${styles.createButton} ${
            bottomActive === "create" ? styles.activeBottomItem : ""
          }`}
          onClick={revealProfile}
        >
          <Plus aria-hidden="true" />
          <span>Criar</span>
        </button>
        <button
          type="button"
          className={bottomActive === "messages" ? styles.activeBottomItem : ""}
          onClick={() => {
            setTab("messages");
            setSelected("");
            setBottomActive("messages");
            directoryRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Send aria-hidden="true" />
          <span>Conversar</span>
        </button>
        <button
          type="button"
          className={bottomActive === "profile" ? styles.activeBottomItem : ""}
          onClick={() => {
            setBottomActive("profile");
            navigate("Perfil");
          }}
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
              setError((reason as Error).message);
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
