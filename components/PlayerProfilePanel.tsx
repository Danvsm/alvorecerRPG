"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  ChevronRight,
  KeyRound,
  Lock,
  LogOut,
  Medal,
  Shield,
  Trophy,
  WalletCards,
  X,
} from "lucide-react";
import type { Row } from "@/lib/types";
import AvatarFrame from "./AvatarFrame";
import IdentityAvatar from "./IdentityAvatar";
import { CosmeticIcon } from "./CosmeticsPanel";
import styles from "./PlayerProfilePanel.module.css";

const rarityNames: Record<string, string> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Rara",
  epic: "Épica",
  legendary: "Lendária",
  event: "Evento",
  supporter: "Apoiador",
  master: "Mestre",
};

type CosmeticKind = "title" | "medal";

export default function PlayerProfilePanel({
  identity,
  profile,
  character,
  cosmetics,
  grants,
  equipment,
  urls,
  busy: externalBusy,
  changeAvatar,
  openWallet,
  changePassword,
  signOut,
  save,
}: {
  identity: Row;
  profile?: Row;
  character?: Row;
  cosmetics: Row[];
  grants: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  busy?: boolean;
  changeAvatar: () => void;
  openWallet: () => void;
  changePassword: () => void;
  signOut: () => void;
  save: (operation: string, data: Row) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedFrameId, setSelectedFrameId] = useState("");
  const [frameModalOpen, setFrameModalOpen] = useState(false);
  const [cosmeticModal, setCosmeticModal] = useState<CosmeticKind | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const frames = useMemo(
    () => cosmetics.filter((item) => item.kind === "frame"),
    [cosmetics],
  );
  const ownedIds = useMemo(
    () =>
      new Set(
        [
          ...grants
            .filter(
              (grant) =>
                grant.identity_id === identity.id && !grant.removed_at,
            )
            .map((grant) => grant.cosmetic_id),
          ...frames.filter((frame) => frame.owned).map((frame) => frame.id),
        ].filter(Boolean),
      ),
    [frames, grants, identity.id],
  );

  const equippedFrameId =
    equipment.find(
      (entry) => entry.identity_id === identity.id && entry.kind === "frame",
    )?.cosmetic_id || "";

  const equippedFrame = frames.find((frame) => frame.id === equippedFrameId);

  useEffect(() => {
    setSelectedFrameId(equippedFrameId);
  }, [equippedFrameId]);

  const frameIsOwned = (frame?: Row) =>
    Boolean(frame && (ownedIds.has(frame.id) || frame.owned));

  const visibleFrames = useMemo(
    () =>
      frames
        .filter(
          (frame) =>
            (frame.active && !frame.archived_at && frame.visible) ||
            frameIsOwned(frame),
        )
        .sort((left, right) => {
          if (left.id === equippedFrameId) return -1;
          if (right.id === equippedFrameId) return 1;
          const leftOwned = frameIsOwned(left) ? 0 : 1;
          const rightOwned = frameIsOwned(right) ? 0 : 1;
          if (leftOwned !== rightOwned) return leftOwned - rightOwned;
          return (
            Number(left.display_order || 0) - Number(right.display_order || 0)
          );
        }),
    [frames, ownedIds, equippedFrameId],
  );

  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId);
  const previewOwned = selectedFrameId ? frameIsOwned(selectedFrame) : true;
  const username = String(profile?.username || identity.name || "jogador");
  const displayName = String(character?.name || username || identity.name);
  const working = Boolean(externalBusy || busy);

  const run = async (
    operation: string,
    data: Row,
    success: string,
    closeFrameModal = false,
  ) => {
    if (working) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await save(operation, data);
      setMessage(success);
      if (closeFrameModal) setFrameModalOpen(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const equipSelectedFrame = () => {
    if (!selectedFrame || !previewOwned) return;
    void run(
      "equip",
      { identity_id: identity.id, frame_id: selectedFrame.id },
      "Moldura equipada",
      frameModalOpen,
    );
  };

  const useWithoutFrame = () =>
    void run(
      "unequip",
      { identity_id: identity.id },
      "Moldura removida",
      frameModalOpen,
    );

  const ownedCosmetics = (kind: CosmeticKind): Row[] =>
    cosmetics
      .filter((item) => item.kind === kind && item.active)
      .map(
        (item): Row => ({
          ...item,
          owned:
            Boolean(item.owned) ||
            grants.some(
              (grant) =>
                grant.identity_id === identity.id &&
                grant.cosmetic_id === item.id &&
                !grant.removed_at,
            ),
          equipped: equipment.some(
            (entry) =>
              entry.identity_id === identity.id &&
              entry.kind === kind &&
              entry.cosmetic_id === item.id,
          ),
        }),
      );

  const equipCosmetic = (item: Row) => {
    if (!item.owned || working) return;
    void run(
      "cosmetic_equip",
      { identity_id: identity.id, cosmetic_id: item.id },
      `${item.kind === "title" ? "Título" : "Medalha"} equipado`,
    );
  };

  const featuredFrames = visibleFrames.slice(0, 4);

  return (
    <section className={styles.profile}>
      <div className={styles.hero}>
        <div className={styles.heroShade} />
        <div className={styles.avatarWrap}>
          <IdentityAvatar
            identity={identity}
            cosmetics={cosmetics}
            equipment={equipment}
            urls={urls}
            size="clamp(150px, 38vw, 220px)"
          />
        </div>
        <h1>{displayName}</h1>
        <p className={styles.username}>@{username}</p>
        <div className={styles.adventurer}>
          <span />
          <strong>AVENTUREIRO DO ALVORECER</strong>
          <span />
        </div>

        <div className={styles.accountActions}>
          <button type="button" onClick={changeAvatar}>
            <Camera aria-hidden="true" />
            <span>Trocar avatar</span>
          </button>
          <button type="button" onClick={openWallet}>
            <WalletCards aria-hidden="true" />
            <span>Abrir carteira</span>
          </button>
          <button type="button" onClick={changePassword}>
            <KeyRound aria-hidden="true" />
            <span>Alterar senha</span>
          </button>
          <button
            type="button"
            className={styles.signOut}
            onClick={signOut}
          >
            <LogOut aria-hidden="true" />
            <span>Sair da conta</span>
          </button>
        </div>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionEmblem}>
              <Shield aria-hidden="true" />
            </span>
            <div>
              <h2>Molduras</h2>
              <p>
                Equipe uma moldura recebida ou continue com o avatar normal.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={styles.seeAll}
            onClick={() => setFrameModalOpen(true)}
          >
            Ver todas <ChevronRight aria-hidden="true" />
          </button>
        </header>

        <article className={styles.currentFrameCard}>
          <div className={styles.currentAvatar}>
            <AvatarFrame
              avatarUrl={urls[identity.avatar_id]}
              avatarAlt={displayName}
              frame={equippedFrame}
              frameUrl={equippedFrame ? urls[equippedFrame.id] : undefined}
              size="clamp(110px, 25vw, 150px)"
            />
          </div>
          <div>
            <small>ATUAL</small>
            <strong>{equippedFrame?.name || "Avatar normal"}</strong>
            <p>
              {equippedFrame
                ? rarityNames[String(equippedFrame.rarity)] ||
                  "Moldura equipada"
                : "Sem moldura"}
            </p>
          </div>
        </article>

        <div className={styles.frameStrip}>
          <button
            type="button"
            className={
              !selectedFrameId
                ? `${styles.frameChoice} ${styles.selected}`
                : styles.frameChoice
            }
            disabled={working}
            onClick={() => setSelectedFrameId("")}
          >
            <span className={styles.noFrameIcon}>∅</span>
            <strong>Sem moldura</strong>
            <small>{!equippedFrameId ? "Atual" : "Normal"}</small>
          </button>

          {featuredFrames.map((frame) => {
            const owned = frameIsOwned(frame);
            const equipped = equippedFrameId === frame.id;
            const selected = selectedFrameId === frame.id;
            return (
              <button
                type="button"
                key={frame.id}
                className={
                  selected
                    ? `${styles.frameChoice} ${styles.selected}`
                    : styles.frameChoice
                }
                disabled={working || !owned}
                onClick={() => owned && setSelectedFrameId(frame.id)}
              >
                <span className={styles.frameThumb}>
                  {frame.secret && !owned ? (
                    <Lock aria-hidden="true" />
                  ) : (
                    <AvatarFrame
                      avatarUrl={urls[identity.avatar_id]}
                      avatarAlt=""
                      frame={frame}
                      frameUrl={urls[frame.id]}
                      size={76}
                    />
                  )}
                </span>
                <strong>
                  {frame.secret && !owned ? "???" : String(frame.name || "Moldura")}
                </strong>
                <small className={owned ? styles.available : styles.locked}>
                  {equipped
                    ? "Equipada"
                    : owned
                      ? rarityNames[String(frame.rarity)] || "Disponível"
                      : "Bloqueada"}
                </small>
                {!owned && <Lock className={styles.lockBadge} aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        <div className={styles.frameActions}>
          <button
            type="button"
            disabled={working || !equippedFrameId}
            onClick={useWithoutFrame}
          >
            Usar sem moldura
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={
              working ||
              !selectedFrameId ||
              !selectedFrame ||
              !previewOwned ||
              selectedFrameId === equippedFrameId
            }
            onClick={equipSelectedFrame}
          >
            <Shield aria-hidden="true" />
            Equipar
          </button>
        </div>
      </section>

      <div className={styles.divider} aria-hidden="true" />

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionEmblem}>
              <Trophy aria-hidden="true" />
            </span>
            <div>
              <h2>Outros cosméticos</h2>
            </div>
          </div>
        </header>

        <div className={styles.cosmeticLinks}>
          <button type="button" onClick={() => setCosmeticModal("title")}>
            <span><Trophy aria-hidden="true" /></span>
            <strong>Títulos</strong>
            <ChevronRight aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setCosmeticModal("medal")}>
            <span><Medal aria-hidden="true" /></span>
            <strong>Medalhas</strong>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.divider} aria-hidden="true" />
        <p>MAIS QUE UM JOGO,<br />UMA HISTÓRIA.</p>
      </footer>

      {frameModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !working)
              setFrameModalOpen(false);
          }}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-frames-title"
          >
            <header>
              <div>
                <small>COLEÇÃO</small>
                <h2 id="all-frames-title">Todas as molduras</h2>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                disabled={working}
                onClick={() => setFrameModalOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            <div className={styles.modalFrames}>
              <button
                type="button"
                className={
                  !selectedFrameId
                    ? `${styles.modalFrame} ${styles.selected}`
                    : styles.modalFrame
                }
                onClick={() => setSelectedFrameId("")}
              >
                <span className={styles.modalNoFrame}>∅</span>
                <strong>Sem moldura</strong>
                <small>Avatar normal</small>
              </button>

              {visibleFrames.map((frame) => {
                const owned = frameIsOwned(frame);
                const selected = selectedFrameId === frame.id;
                const secret = frame.secret && !owned;
                return (
                  <button
                    type="button"
                    key={frame.id}
                    className={
                      selected
                        ? `${styles.modalFrame} ${styles.selected}`
                        : styles.modalFrame
                    }
                    disabled={working || !owned}
                    onClick={() => owned && setSelectedFrameId(frame.id)}
                  >
                    <span className={styles.modalFrameArt}>
                      {secret ? (
                        <Lock aria-hidden="true" />
                      ) : (
                        <AvatarFrame
                          avatarUrl={urls[identity.avatar_id]}
                          avatarAlt=""
                          frame={frame}
                          frameUrl={urls[frame.id]}
                          size={92}
                        />
                      )}
                    </span>
                    <strong>{secret ? "???" : String(frame.name)}</strong>
                    <small className={owned ? styles.available : styles.locked}>
                      {owned
                        ? equippedFrameId === frame.id
                          ? "Equipada"
                          : rarityNames[String(frame.rarity)] || "Disponível"
                        : "Bloqueada"}
                    </small>
                  </button>
                );
              })}
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                disabled={working || !equippedFrameId}
                onClick={useWithoutFrame}
              >
                Usar sem moldura
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={
                  working ||
                  !selectedFrameId ||
                  !selectedFrame ||
                  !previewOwned ||
                  selectedFrameId === equippedFrameId
                }
                onClick={equipSelectedFrame}
              >
                Equipar moldura
              </button>
            </div>
          </section>
        </div>
      )}

      {cosmeticModal && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !working)
              setCosmeticModal(null);
          }}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cosmetics-title"
          >
            <header>
              <div>
                <small>COLEÇÃO</small>
                <h2 id="cosmetics-title">
                  {cosmeticModal === "title" ? "Títulos" : "Medalhas"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                disabled={working}
                onClick={() => setCosmeticModal(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            <div className={styles.cosmeticGrid}>
              {ownedCosmetics(cosmeticModal).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={
                    item.equipped
                      ? `${styles.cosmeticCard} ${styles.selected}`
                      : styles.cosmeticCard
                  }
                  disabled={working || !item.owned}
                  onClick={() => equipCosmetic(item)}
                >
                  <span className={styles.cosmeticIcon}>
                    <CosmeticIcon item={item} url={urls[item.id]} />
                  </span>
                  <strong>{String(item.name)}</strong>
                  <small className={item.owned ? styles.available : styles.locked}>
                    {item.equipped
                      ? "Equipado"
                      : item.owned
                        ? "Equipar"
                        : "Bloqueado"}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {message && <p className={styles.feedback} role="status">{message}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
