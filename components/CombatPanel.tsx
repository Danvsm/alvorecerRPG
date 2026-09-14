import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Heart,
  History,
  Settings,
  Shield,
  Skull,
  Sparkles,
  Swords,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { Row } from "@/lib/types";
import IdentityBadge from "./IdentityBadge";
import ItemThumbnail from "./ItemThumbnail";
import ConsumableActions from "./ConsumableActions";
import { Empty } from "./Common";

type Side = "ally" | "enemy";

type CombatPanelProps = {
  rooms: Row[];
  selectedRoomId: string;
  participants: Row[];
  characters: Row[];
  identities: Row[];
  cosmetics: Row[];
  equipment: Row[];
  avatarUrls: Record<string, string>;
  inventory: Row[];
  items: Row[];
  effects: Row[];
  isMaster: boolean;
  userId: string;
  busy: boolean;
  onSelectRoom: (roomId: string) => void;
  onHistory: () => void;
  onCreateRoom: () => void;
  onRenameRoom: (room: Row) => void;
  onAddCharacter: (room: Row) => void;
  onAddCreature: (room: Row, side: Side) => void;
  onEndRoom: (room: Row) => void;
  onRemoveParticipant: (participant: Row) => void;
  onRevealParticipant: (participant: Row, reveal: boolean) => void;
  onAdjustLife: (participant: Row, delta: number) => Promise<void>;
  onConsume: (data: Row) => void;
};

const resourceMeta = {
  life: { label: "Vida", Icon: Heart, color: "life" },
  mana: { label: "Mana", Icon: Sparkles, color: "mana" },
  stamina: { label: "Fôlego", Icon: Zap, color: "stamina" },
} as const;

function statusFor(participant: Row) {
  if (participant.state === "zero") return "Vida zerada";
  if (participant.side === "enemy" && participant.state === "green")
    return "Hostil";
  if (participant.state === "yellow" || participant.state === "red")
    return "Ferido";
  return "Ativo";
}

function statusClass(participant: Row) {
  return participant.state === "zero"
    ? "is-zero"
    : participant.state === "red"
      ? "is-red"
      : participant.state === "yellow"
        ? "is-yellow"
        : participant.side === "enemy"
          ? "is-hostile"
          : "is-active";
}

function resourceRatio(current: number, maximum: number) {
  if (!maximum) return 0;
  return Math.max(0, Math.min(100, (current / maximum) * 100));
}

function CombatResource({
  resource,
  current,
  maximum,
}: {
  resource: keyof typeof resourceMeta;
  current: number;
  maximum: number;
}) {
  const { label, Icon, color } = resourceMeta[resource];
  return (
    <div className="combat-stat">
      <div className="combat-stat-line">
        <span>
          <Icon aria-hidden="true" size={12} />
          {label}
        </span>
        <strong>
          {current}
          <small>/{maximum}</small>
        </strong>
      </div>
      <div className="combat-stat-track" aria-hidden="true">
        <span
          className={`combat-stat-fill is-${color}`}
          style={{ width: `${resourceRatio(current, maximum)}%` }}
        />
      </div>
    </div>
  );
}

function ParticipantIdentity({
  participant,
  identities,
  cosmetics,
  equipment,
  avatarUrls,
}: Pick<
  CombatPanelProps,
  "identities" | "cosmetics" | "equipment" | "avatarUrls"
> & { participant: Row }) {
  const identity = identities.find(
    (item) => item.id === participant.identity_id,
  );
  if (participant.identity_id) {
    return (
      <IdentityBadge
        identity={{
          ...identity,
          id: participant.identity_id,
          name: participant.name,
        }}
        cosmetics={cosmetics}
        equipment={equipment}
        urls={avatarUrls}
      />
    );
  }
  return (
    <div className="identity-badge combat-creature-identity">
      <span className="combat-creature-photo" aria-hidden="true">
        {participant.side === "enemy" ? (
          <Skull size={22} />
        ) : (
          <Shield size={22} />
        )}
        <ItemThumbnail path={participant.image_path} name={participant.name} />
      </span>
      <span>
        <strong>{participant.name}</strong>
        <small>{participant.side === "enemy" ? "Criatura" : "Aliado"}</small>
      </span>
    </div>
  );
}

function LifeDialog({
  participant,
  canGain,
  busy,
  close,
  adjust,
}: {
  participant: Row;
  canGain: boolean;
  busy: boolean;
  close: () => void;
  adjust: (delta: number) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  async function submit(direction: -1 | 1) {
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 1) {
      setError("Digite uma quantidade inteira maior que zero");
      return;
    }
    setError("");
    try {
      await adjust(direction * value);
      close();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <dialog
      ref={ref}
      className="combat-sheet combat-life-sheet"
      aria-labelledby="combat-life-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="combat-sheet-heading">
        <div>
          <small>Ajuste rápido</small>
          <h2 id="combat-life-title">Vida de {participant.name}</h2>
        </div>
        <button
          className="combat-icon-button"
          aria-label="Fechar"
          disabled={busy}
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <label className="combat-amount-field">
        Quantidade
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          placeholder="37"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit(-1);
            }
          }}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={`combat-life-actions${canGain ? " can-gain" : ""}`}>
        <button
          className="combat-life-loss"
          disabled={busy}
          onClick={() => void submit(-1)}
        >
          <Heart size={17} />
          {busy ? "Salvando..." : "Perdeu Vida"}
        </button>
        {canGain && (
          <button
            className="combat-life-gain"
            disabled={busy}
            onClick={() => void submit(1)}
          >
            <Heart size={17} />
            {busy ? "Salvando..." : "Ganhou Vida"}
          </button>
        )}
      </div>
      {!canGain && (
        <p className="combat-sheet-note">
          A recuperação manual de Vida é reservada ao Mestre. Consumíveis
          continuam disponíveis nas ações do personagem.
        </p>
      )}
    </dialog>
  );
}

function RosterDialog({
  roomParticipants,
  close,
}: {
  roomParticipants: Row[];
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="combat-sheet"
      aria-labelledby="combat-roster-title"
      onCancel={close}
    >
      <div className="combat-sheet-heading">
        <div>
          <small>Visão rápida</small>
          <h2 id="combat-roster-title">Participantes</h2>
        </div>
        <button
          className="combat-icon-button"
          aria-label="Fechar"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <div className="combat-roster-list">
        {(["ally", "enemy"] as Side[]).map((side) => {
          const sideParticipants = roomParticipants.filter(
            (item) => item.side === side,
          );
          return (
            <section key={side}>
              <h3>
                {side === "ally" ? "Aliados" : "Inimigos"}{" "}
                <small>{sideParticipants.length}</small>
              </h3>
              {sideParticipants.map((participant) => (
                <div className="combat-roster-row" key={participant.id}>
                  <span>{participant.name}</span>
                  <small className={statusClass(participant)}>
                    {statusFor(participant)}
                  </small>
                </div>
              ))}
              {!sideParticipants.length && (
                <p className="muted">Nenhum participante.</p>
              )}
            </section>
          );
        })}
      </div>
    </dialog>
  );
}

function AdminDialog({
  room,
  roomParticipants,
  busy,
  close,
  onCreateRoom,
  onRenameRoom,
  onAddCharacter,
  onAddCreature,
  onEndRoom,
  onRemoveParticipant,
  onRevealParticipant,
}: {
  room?: Row;
  roomParticipants: Row[];
  busy: boolean;
  close: () => void;
} & Pick<
  CombatPanelProps,
  | "onCreateRoom"
  | "onRenameRoom"
  | "onAddCharacter"
  | "onAddCreature"
  | "onEndRoom"
  | "onRemoveParticipant"
  | "onRevealParticipant"
>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  const openForm = (action: () => void) => {
    close();
    action();
  };
  return (
    <dialog
      ref={ref}
      className="combat-sheet combat-admin-sheet"
      aria-labelledby="combat-admin-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="combat-sheet-heading">
        <div className="combat-master-title">
          <Image
            src="/combat/master-crown.webp"
            width={36}
            height={36}
            alt=""
          />
          <span>
            <small>Controles do Mestre</small>
            <h2 id="combat-admin-title">Gerenciar combate</h2>
          </span>
        </div>
        <button
          className="combat-icon-button"
          aria-label="Fechar"
          disabled={busy}
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <div className="combat-admin-actions">
        <button onClick={() => openForm(onCreateRoom)}>
          <Swords size={18} />
          Criar nova sala
        </button>
        {room && (
          <>
            <button onClick={() => openForm(() => onAddCharacter(room))}>
              <UserPlus size={18} />
              Adicionar personagem/aliado
            </button>
            <button onClick={() => openForm(() => onAddCreature(room, "ally"))}>
              <Shield size={18} />
              Adicionar criatura aliada
            </button>
            <button
              onClick={() => openForm(() => onAddCreature(room, "enemy"))}
            >
              <Skull size={18} />
              Adicionar monstro/inimigo
            </button>
            <button onClick={() => openForm(() => onRenameRoom(room))}>
              <Settings size={18} />
              Renomear sala
            </button>
          </>
        )}
      </div>
      {room && (
        <details className="combat-manage-list">
          <summary>
            Gerenciar participantes <small>{roomParticipants.length}</small>
          </summary>
          <div>
            {roomParticipants.map((participant) => (
              <div className="combat-manage-row" key={participant.id}>
                <span>
                  <strong>{participant.name}</strong>
                  <small>
                    {participant.side === "ally" ? "Aliado" : "Inimigo"}
                  </small>
                </span>
                <label title="Mostrar valores aos jogadores">
                  <input
                    type="checkbox"
                    checked={Boolean(participant.reveal)}
                    disabled={busy}
                    onChange={(event) =>
                      onRevealParticipant(participant, event.target.checked)
                    }
                  />
                  <Eye size={16} />
                </label>
                <button
                  disabled={busy}
                  onClick={() => onRemoveParticipant(participant)}
                >
                  Retirar
                </button>
              </div>
            ))}
            {!roomParticipants.length && (
              <p className="muted">Nenhum aliado ou inimigo nesta sala.</p>
            )}
          </div>
        </details>
      )}
      {room && (
        <button
          className="combat-end-button"
          disabled={busy}
          onClick={() => openForm(() => onEndRoom(room))}
        >
          Encerrar combate
        </button>
      )}
    </dialog>
  );
}

export default function CombatPanel(props: CombatPanelProps) {
  const {
    rooms,
    selectedRoomId,
    participants,
    characters,
    identities,
    cosmetics,
    equipment,
    avatarUrls,
    inventory,
    items,
    effects,
    isMaster,
    userId,
    busy,
    onSelectRoom,
    onHistory,
    onAdjustLife,
    onConsume,
  } = props;
  const [lifeTarget, setLifeTarget] = useState<Row>();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const room = rooms.find((item) => item.id === selectedRoomId) || rooms[0];
  const roomParticipants = participants.filter(
    (participant) =>
      participant.room_id === room?.id &&
      (participant.side === "ally" || participant.side === "enemy"),
  );

  return (
    <div className="combat-page">
      <header className="combat-hero">
        <Image
          className="combat-hero-image"
          src="/combat/combat-header.webp"
          fill
          priority
          sizes="(max-width: 760px) 100vw, 1100px"
          alt=""
        />
        <div className="combat-hero-shade" />
        <div className="combat-hero-content">
          <div className="combat-title">
            <Image
              src="/combat/crossed-swords.webp"
              width={58}
              height={58}
              alt=""
            />
            <div>
              <h1>Combate</h1>
              <small>{room?.name || "Nenhuma sala ativa"}</small>
            </div>
          </div>
          <nav className="combat-hero-actions" aria-label="Ações do combate">
            <button
              aria-label="Ver participantes"
              title="Participantes"
              disabled={!room}
              onClick={() => setRosterOpen(true)}
            >
              <Users size={20} />
            </button>
            <button
              aria-label="Abrir histórico"
              title="Histórico"
              onClick={onHistory}
            >
              <History size={20} />
            </button>
            {isMaster && (
              <button
                aria-label="Configurações do combate"
                title="Configurações"
                onClick={() => setAdminOpen(true)}
              >
                <Settings size={20} />
              </button>
            )}
          </nav>
        </div>
      </header>

      {rooms.length > 0 && (
        <div className="combat-room-picker">
          <label htmlFor="combat-room">Sala ativa</label>
          <select
            id="combat-room"
            value={room?.id || ""}
            onChange={(event) => onSelectRoom(event.target.value)}
          >
            {rooms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {room ? (
        <div id="combat-roster" className="combat-battlefield">
          {(["ally", "enemy"] as Side[]).map((side) => {
            const sideParticipants = roomParticipants.filter(
              (participant) => participant.side === side,
            );
            const allies = side === "ally";
            return (
              <section className={`combat-side combat-side-${side}`} key={side}>
                <div className="combat-side-heading">
                  <Image
                    src={
                      allies
                        ? "/combat/allies-banner.webp"
                        : "/combat/enemies-banner.webp"
                    }
                    width={44}
                    height={44}
                    alt=""
                  />
                  <h2>{allies ? "Aliados" : "Inimigos"}</h2>
                  <small>{sideParticipants.length}</small>
                </div>
                <div className="combat-participant-grid">
                  {sideParticipants.map((participant) => {
                    const ownCharacter = characters.some(
                      (character) =>
                        character.id === participant.character_id &&
                        character.owner_id === userId,
                    );
                    const canAdjust =
                      participant.life !== null && (isMaster || ownCharacter);
                    const canConsume = Boolean(
                      participant.character_id && (isMaster || ownCharacter),
                    );
                    return (
                      <article
                        className={`combat-participant-card is-${side}`}
                        key={participant.id}
                      >
                        <div className="combat-card-heading">
                          <div className="combat-identity">
                            <ParticipantIdentity
                              participant={participant}
                              identities={identities}
                              cosmetics={cosmetics}
                              equipment={equipment}
                              avatarUrls={avatarUrls}
                            />
                          </div>
                          <span
                            className={`combat-status ${statusClass(participant)}`}
                          >
                            {statusFor(participant)}
                          </span>
                        </div>
                        {participant.life === null ? (
                          <div className="combat-hidden-life">
                            <div>
                              <EyeOff size={14} />
                              <span>Vida exata não revelada</span>
                            </div>
                            <div
                              className={`combat-hidden-track ${statusClass(participant)}`}
                            >
                              <span />
                            </div>
                          </div>
                        ) : (
                          <div className="combat-stats">
                            <CombatResource
                              resource="life"
                              current={participant.life}
                              maximum={participant.life_max}
                            />
                            <CombatResource
                              resource="mana"
                              current={participant.mana}
                              maximum={participant.mana_max}
                            />
                            <CombatResource
                              resource="stamina"
                              current={participant.stamina}
                              maximum={participant.stamina_max}
                            />
                          </div>
                        )}
                        {canAdjust && (
                          <button
                            className="combat-adjust-button"
                            disabled={busy}
                            onClick={() => setLifeTarget(participant)}
                          >
                            <Heart size={14} />
                            Ajustar Vida
                          </button>
                        )}
                        {canConsume && (
                          <details className="combat-consumables">
                            <summary>Consumíveis</summary>
                            <ConsumableActions
                              characterId={participant.character_id}
                              inventory={inventory}
                              items={items}
                              effects={effects}
                              busy={busy}
                              use={onConsume}
                            />
                          </details>
                        )}
                      </article>
                    );
                  })}
                </div>
                {!sideParticipants.length && (
                  <div className="combat-side-empty">
                    Nenhum {allies ? "aliado" : "inimigo"} nesta sala.
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="combat-empty">
          <Image
            src="/combat/combat-crest.webp"
            width={88}
            height={88}
            alt=""
          />
          <Empty
            text={
              isMaster
                ? "Crie uma sala na engrenagem para iniciar o combate."
                : "Nenhum combate está aberto no momento."
            }
          />
        </div>
      )}

      {lifeTarget && (
        <LifeDialog
          key={lifeTarget.id}
          participant={lifeTarget}
          canGain={isMaster}
          busy={busy}
          close={() => setLifeTarget(undefined)}
          adjust={(delta) => onAdjustLife(lifeTarget, delta)}
        />
      )}
      {rosterOpen && (
        <RosterDialog
          roomParticipants={roomParticipants}
          close={() => setRosterOpen(false)}
        />
      )}
      {adminOpen && isMaster && (
        <AdminDialog
          room={room}
          roomParticipants={roomParticipants}
          busy={busy}
          close={() => setAdminOpen(false)}
          onCreateRoom={props.onCreateRoom}
          onRenameRoom={props.onRenameRoom}
          onAddCharacter={props.onAddCharacter}
          onAddCreature={props.onAddCreature}
          onEndRoom={props.onEndRoom}
          onRemoveParticipant={props.onRemoveParticipant}
          onRevealParticipant={props.onRevealParticipant}
        />
      )}
    </div>
  );
}
