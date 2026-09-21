"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Compass,
  Copy,
  Crown,
  Eye,
  Feather,
  Flame,
  Gem,
  Heart,
  KeyRound,
  Leaf,
  Lock,
  Moon,
  Pencil,
  Power,
  RotateCcw,
  Shield,
  Sparkles,
  Star,
  Sun,
  Swords,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import type { Row } from "@/lib/types";
import AvatarFrame from "./AvatarFrame";

const names: Record<string, string> = {
  frame: "Molduras",
  title: "Títulos",
  medal: "Medalhas",
};
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
const originNames: Record<string, string> = {
  free: "Gratuita",
  achievement: "Conquista",
  session: "Sessão",
  event: "Evento",
  supporter: "Apoiador",
  gift: "Presente de Pink",
  exclusive: "Exclusiva",
  manual: "Manual",
};
const effectNames: Record<string, string> = {
  glow: "Glow",
  shine: "Brilho deslizante",
  pulse: "Pulso",
  aura: "Aura",
  particles: "Partículas",
  runes: "Runas girando",
};
const icons = {
  star: Star,
  crown: Crown,
  shield: Shield,
  flame: Flame,
  moon: Moon,
  sword: Swords,
  sparkles: Sparkles,
  compass: Compass,
  book: BookOpen,
  eye: Eye,
  heart: Heart,
  leaf: Leaf,
  sun: Sun,
  gem: Gem,
  feather: Feather,
  key: KeyRound,
};

export function CosmeticIcon({
  item,
  url,
}: {
  item: Row;
  url?: string;
}) {
  if (item.kind === "medal" && url) {
    return <img className="cosmetic-medal-image" src={url} alt="" />;
  }
  const Icon = icons[item.icon as keyof typeof icons] || Star;
  return <Icon size={28} style={{ color: item.color }} />;
}
function FrameEditor({
  frame,
  collections,
  identities,
  avatarUrl,
  frameUrl,
  busy,
  upload,
  save,
  close,
}: {
  frame?: Row;
  collections: Row[];
  identities: Row[];
  avatarUrl?: string;
  frameUrl?: string;
  busy: boolean;
  upload: (file: File) => Promise<string>;
  save: (data: Row) => Promise<unknown>;
  close: () => void;
}) {
  const [draft, setDraft] = useState<Row>(() => ({
    id: frame?.id || "",
    name: frame?.name || "",
    description: frame?.description || "",
    asset_path: frame?.asset_path || "",
    rarity: frame?.rarity || "common",
    collection_id: frame?.collection_id || "",
    acquisition_origin: frame?.acquisition_origin || "manual",
    visible: frame?.visible ?? true,
    secret: frame?.secret ?? false,
    active: frame?.active ?? true,
    display_order: frame?.display_order ?? 0,
    scale: frame?.scale ?? 1,
    offset_x: frame?.offset_x ?? 0,
    offset_y: frame?.offset_y ?? 0,
    exclusive_identity_id: frame?.exclusive_identity_id || "",
    effects: Array.isArray(frame?.effects) ? frame.effects : [],
  }));
  const [file, setFile] = useState<File>();
  const [localUrl, setLocalUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
    [localUrl],
  );
  const update = (key: string, value: unknown) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setEffect = (index: number, key: string, value: unknown) => {
    const effects = [...draft.effects];
    effects[index] = { ...effects[index], [key]: value };
    update("effects", effects);
  };
  const addEffect = () =>
    draft.effects.length < 2 &&
    update("effects", [
      ...draft.effects,
      {
        type: "glow",
        color: "#c855ff",
        intensity: 1,
        speed: 2.4,
        opacity: 0.75,
        quantity: 6,
        size: 1,
      },
    ]);
  return (
    <section className="panel frame-editor">
      <div className="spread">
        <h2>{frame ? `Editar ${frame.name}` : "Nova moldura"}</h2>
        <button type="button" onClick={close}>
          Fechar
        </button>
      </div>
      <form
        className="frame-editor-layout"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            const assetPath = file ? await upload(file) : draft.asset_path;
            if (!assetPath)
              throw new Error("Selecione uma arte para a moldura");
            await save({ ...draft, asset_path: assetPath });
            close();
          } catch (reason) {
            setError((reason as Error).message);
          }
        }}
      >
        <div className="frame-editor-preview">
          <AvatarFrame
            avatarUrl={avatarUrl}
            avatarAlt="Preview"
            frame={draft}
            frameUrl={localUrl || frameUrl}
            size="min(70vw, 260px)"
          />
        </div>
        <div className="frame-editor-controls">
          <label>
            Nome
            <input
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label>
            Arte PNG ou WebP
            <input
              type="file"
              accept="image/png,image/webp"
              required={!draft.asset_path}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (!selected) return;
                if (localUrl) URL.revokeObjectURL(localUrl);
                setFile(selected);
                setLocalUrl(URL.createObjectURL(selected));
              }}
            />
          </label>
          <label className="wide">
            Descrição
            <textarea
              maxLength={2000}
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </label>
          <label>
            Raridade
            <select
              value={draft.rarity}
              onChange={(e) => update("rarity", e.target.value)}
            >
              {Object.entries(rarityNames).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Coleção
            <select
              value={draft.collection_id}
              onChange={(e) => update("collection_id", e.target.value)}
            >
              <option value="">Sem coleção</option>
              {collections
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Origem
            <select
              value={draft.acquisition_origin}
              onChange={(e) => update("acquisition_origin", e.target.value)}
            >
              {Object.entries(originNames).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Exclusiva de
            <select
              value={draft.exclusive_identity_id}
              onChange={(e) => update("exclusive_identity_id", e.target.value)}
            >
              <option value="">Sem jogador exclusivo</option>
              {identities
                .filter((i) => i.active && i.kind !== "npc")
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Ordem
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => update("display_order", Number(e.target.value))}
            />
          </label>
          <label>
            Escala: {Number(draft.scale).toFixed(2)}
            <input
              type="range"
              min="0.25"
              max="3"
              step="0.05"
              value={draft.scale}
              onChange={(e) => update("scale", Number(e.target.value))}
            />
          </label>
          <label>
            Posição X: {draft.offset_x}%
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={draft.offset_x}
              onChange={(e) => update("offset_x", Number(e.target.value))}
            />
          </label>
          <label>
            Posição Y: {draft.offset_y}%
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={draft.offset_y}
              onChange={(e) => update("offset_y", Number(e.target.value))}
            />
          </label>
          <fieldset className="wide">
            <legend>Apresentação</legend>
            <label>
              <input
                type="checkbox"
                checked={draft.visible}
                onChange={(e) => update("visible", e.target.checked)}
              />{" "}
              Visível para jogadores
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.secret}
                onChange={(e) => update("secret", e.target.checked)}
              />{" "}
              Secreta
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => update("active", e.target.checked)}
              />{" "}
              Ativa
            </label>
          </fieldset>
          <fieldset className="wide">
            <legend>Efeitos, máximo 2</legend>
            {draft.effects.map((effect: Row, index: number) => (
              <div className="frame-effect-editor" key={index}>
                <label>
                  Tipo
                  <select
                    value={effect.type}
                    onChange={(e) => setEffect(index, "type", e.target.value)}
                  >
                    {Object.entries(effectNames).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Cor
                  <input
                    type="color"
                    value={effect.color || "#c855ff"}
                    onChange={(e) => setEffect(index, "color", e.target.value)}
                  />
                </label>
                <label>
                  Intensidade
                  <input
                    type="range"
                    min="0.2"
                    max="2"
                    step="0.1"
                    value={effect.intensity ?? 1}
                    onChange={(e) =>
                      setEffect(index, "intensity", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Velocidade
                  <input
                    type="range"
                    min="0.4"
                    max="8"
                    step="0.2"
                    value={effect.speed ?? 2.4}
                    onChange={(e) =>
                      setEffect(index, "speed", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Opacidade
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={effect.opacity ?? 0.75}
                    onChange={(e) =>
                      setEffect(index, "opacity", Number(e.target.value))
                    }
                  />
                </label>
                {effect.type === "particles" && (
                  <label>
                    Partículas
                    <input
                      type="range"
                      min="1"
                      max="12"
                      value={effect.quantity ?? 6}
                      onChange={(e) =>
                        setEffect(index, "quantity", Number(e.target.value))
                      }
                    />
                  </label>
                )}
                <label>
                  Tamanho
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={effect.size ?? 1}
                    onChange={(e) =>
                      setEffect(index, "size", Number(e.target.value))
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "effects",
                      draft.effects.filter((_: Row, i: number) => i !== index),
                    )
                  }
                >
                  Remover efeito
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={draft.effects.length >= 2}
              onClick={addEffect}
            >
              <Sparkles size={16} /> Adicionar efeito
            </button>
          </fieldset>
          {error && (
            <p className="error wide" role="alert">
              {error}
            </p>
          )}
          <div className="actions wide">
            <button type="button" onClick={close}>
              Cancelar
            </button>
            <button className="primary" disabled={busy}>
              Salvar moldura
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

export default function CosmeticsPanel({
  identity,
  cosmetics,
  grants,
  equipment,
  identities,
  profiles,
  collections,
  urls,
  master,
  adminOnly = false,
  save,
  upload,
  removeAsset,
}: {
  identity?: Row;
  cosmetics: Row[];
  grants: Row[];
  equipment: Row[];
  identities: Row[];
  profiles: Row[];
  collections: Row[];
  urls: Record<string, string>;
  master: boolean;
  adminOnly?: boolean;
  save: (operation: string, data: Row) => Promise<any>;
  upload: (file: File) => Promise<string>;
  removeAsset: (path: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Row | null | undefined>(undefined);
  const [selected, setSelected] = useState("");
  const [testFrame, setTestFrame] = useState("");
  const [grantFrame, setGrantFrame] = useState("");
  const [deleteFrameId, setDeleteFrameId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [rarity, setRarity] = useState("all");
  const [collection, setCollection] = useState("all");
  const [status, setStatus] = useState("all");
  const [origin, setOrigin] = useState("all");
  const execute = async (op: string, data: Row, success?: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await save(op, data);
      if (success) setMessage(success);
      return result;
    } catch (reason) {
      setError((reason as Error).message);
      throw reason;
    } finally {
      setBusy(false);
    }
  };
  const run = (
    op: string,
    data: Row,
    success?: string,
    afterSuccess?: (result: any) => void | Promise<void>,
  ) =>
    execute(op, data, success)
      .then(afterSuccess)
      .catch((reason) => setError((reason as Error).message));
  const frames = cosmetics.filter((item) => item.kind === "frame");
  const ownedIds = new Set(
    [
      ...grants
        .filter((g) => g.identity_id === identity?.id && !g.removed_at)
        .map((g) => g.cosmetic_id),
      ...frames.filter((frame) => frame.owned).map((frame) => frame.id),
    ].filter(Boolean),
  );
  const equippedId = equipment.find(
    (e) => e.identity_id === identity?.id && e.kind === "frame",
  )?.cosmetic_id;
  const chosen = frames.find((frame) => frame.id === (selected || equippedId));
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const adminFrames = useMemo(
    () =>
      frames.filter(
        (frame) =>
          normalize(`${frame.name} ${frame.description}`).includes(
            normalize(search),
          ) &&
          (rarity === "all" || frame.rarity === rarity) &&
          (collection === "all" ||
            (collection === "none"
              ? !frame.collection_id
              : frame.collection_id === collection)) &&
          (origin === "all" || frame.acquisition_origin === origin) &&
          (status === "all" ||
            (status === "active" && frame.active && !frame.archived_at) ||
            (status === "inactive" && !frame.active && !frame.archived_at) ||
            (status === "archived" && frame.archived_at)),
      ),
    [frames, search, rarity, collection, status, origin],
  );
  const activeGrants = (frameId: string) =>
    grants.filter((g) => g.cosmetic_id === frameId && !g.removed_at);
  const playerLabel = (id: string) => {
    const player = identities.find((i) => i.id === id);
    const username = profiles.find(
      (profile) => profile.id === player?.user_id,
    )?.username;
    if (!player) return username || "Jogador";
    if (!username || player.name.toLocaleLowerCase("pt-BR") === username)
      return player.name;
    return `${player.name} (@${username})`;
  };
  const deleteFrame = frames.find((frame) => frame.id === deleteFrameId);
  const deleteOwners = deleteFrame ? activeGrants(deleteFrame.id) : [];
  const deleteEquipped = deleteFrame
    ? equipment.filter((entry) => entry.cosmetic_id === deleteFrame.id)
    : [];
  if (editor !== undefined)
    return (
      <FrameEditor
        frame={editor || undefined}
        collections={collections}
        identities={identities}
        avatarUrl={urls[identity?.avatar_id]}
        frameUrl={editor?.id ? urls[editor.id] : undefined}
        busy={busy}
        upload={upload}
        save={(data) => execute("save", data, "Moldura salva")}
        close={() => setEditor(undefined)}
      />
    );
  return (
    <>
      {!adminOnly && (
        <section className="panel">
          <div className="spread">
          <div>
            <h2>Editar moldura</h2>
            <p>Equipe uma moldura recebida ou continue com o avatar normal.</p>
          </div>
        </div>
        {chosen && (
          <div className="frame-card-preview">
            <AvatarFrame
              avatarUrl={urls[identity?.avatar_id]}
              avatarAlt={identity?.name}
              frame={chosen}
              frameUrl={urls[chosen.id]}
              size="min(56vw, 180px)"
            />
          </div>
        )}
        <div className="frame-collection-grid">
          <button
            className={`frame-card${!equippedId ? " selected" : ""}`}
            disabled={busy}
            onClick={() => setSelected("")}
          >
            <span className="locked-frame">Sem moldura</span>
            <strong>Avatar normal</strong>
          </button>
          {frames
            .filter(
              (frame) =>
                frame.active &&
                ((ownedIds.has(frame.id) || frame.owned) ||
                  (!frame.archived_at && frame.visible && !frame.chest_only)),
            )
            .map((frame) => {
              const owned = ownedIds.has(frame.id) || Boolean(frame.owned);
              const equipped = equippedId === frame.id;
              return (
                <button
                  key={frame.id}
                  className={`frame-card${equipped ? " selected" : ""}`}
                  disabled={busy || !owned}
                  onClick={() => owned && setSelected(frame.id)}
                >
                  {frame.secret && !owned ? (
                    <span className="locked-frame">
                      <Lock />
                      <strong>???</strong>
                    </span>
                  ) : (
                    <div className="frame-card-preview">
                      <AvatarFrame
                        avatarUrl={urls[identity?.avatar_id]}
                        avatarAlt=""
                        frame={frame}
                        frameUrl={urls[frame.id]}
                        size={112}
                      />
                    </div>
                  )}
                  <strong>{frame.name}</strong>
                  <small>{rarityNames[frame.rarity] || frame.rarity}</small>
                  <small>
                    {equipped ? "Equipada" : owned ? "Disponível" : "Bloqueada"}
                  </small>
                  {frame.archived_at && owned && <small>Arquivada · sua</small>}
                </button>
              );
            })}
        </div>
        <div className="actions">
          <button
            disabled={busy || !equippedId}
            onClick={() =>
              run("unequip", { identity_id: identity?.id }, "Moldura removida")
            }
          >
            Usar sem moldura
          </button>
          <button
            className="primary"
            disabled={busy || !chosen || !ownedIds.has(chosen.id)}
            onClick={() =>
              run(
                "equip",
                { identity_id: identity?.id, frame_id: chosen?.id },
                "Moldura equipada",
              )
            }
          >
            Equipar
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        </section>
      )}
      {master && (
        <section className="panel frame-admin">
          <div className="spread">
            <div>
              <h2>Painel do Mestre · Molduras</h2>
              <p>Cadastre, organize, conceda e acompanhe as molduras.</p>
            </div>
            <button className="primary" onClick={() => setEditor(null)}>
              Nova moldura
            </button>
          </div>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              run(
                "collection_save",
                { name: new FormData(form).get("collection_name") },
                "Coleção criada",
                () => form.reset(),
              );
            }}
          >
            <label>
              Nova coleção
              <input
                name="collection_name"
                required
                maxLength={80}
                placeholder="Alvorecer"
              />
            </label>
            <button disabled={busy}>Criar coleção</button>
          </form>
          {testFrame && (
            <div className="frame-card-preview">
              <AvatarFrame
                avatarUrl={urls[identity?.avatar_id]}
                avatarAlt="Pink"
                frame={frames.find((f) => f.id === testFrame)}
                frameUrl={urls[testFrame]}
                size="min(56vw, 180px)"
              />
              <strong>Preview em Pink</strong>
            </div>
          )}
          <div className="frame-filters">
            <label>
              Busca
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Raridade
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value)}
              >
                <option value="all">Todas</option>
                {Object.entries(rarityNames).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Coleção
              <select
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="none">Sem coleção</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">Todos</option>
                <option value="active">Ativas</option>
                <option value="inactive">Desativadas</option>
                <option value="archived">Arquivadas</option>
              </select>
            </label>
            <label>
              Origem
              <select
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              >
                <option value="all">Todas</option>
                {Object.entries(originNames).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="frame-admin-grid">
            {adminFrames.map((frame) => {
              const owners = activeGrants(frame.id);
              const equipped = equipment.filter(
                (e) => e.cosmetic_id === frame.id,
              );
              return (
                <article className="frame-card" key={frame.id}>
                  <div className="frame-card-preview">
                    <AvatarFrame
                      avatarUrl={urls[identity?.avatar_id]}
                      avatarAlt=""
                      frame={frame}
                      frameUrl={urls[frame.id]}
                      size={120}
                    />
                  </div>
                  <strong>{frame.name}</strong>
                  <div className="frame-statuses">
                    <span>{rarityNames[frame.rarity]}</span>
                    <span>{frame.collection_name || "Sem coleção"}</span>
                    <span>
                      {frame.archived_at
                        ? "Arquivada"
                        : frame.active
                          ? "Ativa"
                          : "Desativada"}
                    </span>
                    {frame.secret && <span>Secreta</span>}
                  </div>
                  <p>
                    <Users size={14} /> {owners.length} dono(s) ·{" "}
                    {equipped.length} usando
                  </p>
                  {owners.length > 0 && (
                    <details>
                      <summary>Ver jogadores</summary>
                      {owners.map((grant) => (
                        <div className="spread" key={grant.identity_id}>
                          <small>
                            {playerLabel(grant.identity_id)}
                            {equipment.some(
                              (e) =>
                                e.identity_id === grant.identity_id &&
                                e.cosmetic_id === frame.id,
                            )
                              ? " · usando"
                              : ""}
                          </small>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(
                                "revoke",
                                {
                                  frame_id: frame.id,
                                  identity_id: grant.identity_id,
                                },
                                "Concessão removida",
                              )
                            }
                          >
                            <UserMinus size={14} /> Remover
                          </button>
                        </div>
                      ))}
                    </details>
                  )}
                  <div className="frame-actions">
                    <button onClick={() => setEditor(frame)}>
                      <Pencil size={14} /> Editar
                    </button>
                    <button onClick={() => setTestFrame(frame.id)}>
                      <Eye size={14} /> Testar em Pink
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run("duplicate", { frame_id: frame.id }, "Cópia criada")
                      }
                    >
                      <Copy size={14} /> Duplicar
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          frame.archived_at ? "reactivate" : "archive",
                          { frame_id: frame.id },
                          frame.archived_at
                            ? "Moldura reativada"
                            : "Moldura arquivada",
                        )
                      }
                    >
                      {frame.archived_at ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Archive size={14} />
                      )}{" "}
                      {frame.archived_at ? "Reativar" : "Arquivar"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(
                          frame.active ? "disable" : "enable",
                          { frame_id: frame.id },
                          frame.active
                            ? "Moldura desativada para todos"
                            : "Uso da moldura ativado",
                        )
                      }
                    >
                      <Power size={14} />{" "}
                      {frame.active ? "Desativar para todos" : "Ativar uso"}
                    </button>
                    <button
                      disabled={busy}
                      title="Excluir cadastro e arte"
                      onClick={() => setDeleteFrameId(frame.id)}
                    >
                      <Trash2 size={14} /> Excluir
                    </button>
                    <button
                      className="primary"
                      onClick={() => setGrantFrame(frame.id)}
                    >
                      Conceder
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!adminFrames.length && (
            <p className="empty">Nenhuma moldura encontrada.</p>
          )}
          {grantFrame && (
            <div className="modal-backdrop">
              <section className="modal" role="dialog" aria-modal="true">
                <h2>
                  Conceder {frames.find((f) => f.id === grantFrame)?.name}
                </h2>
                <div className="frame-player-list">
                  {identities
                    .filter((i) => i.active && i.kind !== "npc")
                    .map((player) => (
                      <label key={player.id}>
                        <input
                          type="checkbox"
                          checked={recipients.includes(player.id)}
                          onChange={(e) =>
                            setRecipients((current) =>
                              e.target.checked
                                ? [...current, player.id]
                                : current.filter((id) => id !== player.id),
                            )
                          }
                        />{" "}
                        {player.name}
                      </label>
                    ))}
                </div>
                <div className="actions">
                  <button
                    onClick={() => {
                      setGrantFrame("");
                      setRecipients([]);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !recipients.length}
                    onClick={() =>
                      run(
                        "grant",
                        { frame_id: grantFrame, identity_ids: recipients },
                        "Moldura concedida",
                        () => {
                          setGrantFrame("");
                          setRecipients([]);
                        },
                      )
                    }
                  >
                    Conceder para {recipients.length}
                  </button>
                </div>
              </section>
            </div>
          )}
          {deleteFrame && (
            <div className="modal-backdrop">
              <section
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-frame-title"
                aria-describedby="delete-frame-impact"
              >
                <h2 id="delete-frame-title">
                  Excluir definitivamente “{deleteFrame.name}”?
                </h2>
                <div id="delete-frame-impact">
                  {deleteOwners.length || deleteEquipped.length ? (
                    <>
                      <p>
                        Esta moldura pertence a {deleteOwners.length}{" "}
                        {deleteOwners.length === 1 ? "jogador" : "jogadores"} e
                        está equipada por {deleteEquipped.length} deles.
                      </p>
                      <p>
                        <strong>Donos:</strong>{" "}
                        {deleteOwners.length
                          ? deleteOwners
                              .map((grant) => playerLabel(grant.identity_id))
                              .join(", ")
                          : "Nenhum"}
                      </p>
                      <p>
                        <strong>Usando agora:</strong>{" "}
                        {deleteEquipped.length
                          ? deleteEquipped
                              .map((entry) => playerLabel(entry.identity_id))
                              .join(", ")
                          : "Ninguém"}
                      </p>
                      <p className="error">
                        Se você excluir esta moldura, ela será removida de todos
                        e quem estiver usando ficará sem moldura até escolher
                        outra ou receber uma nova.
                      </p>
                    </>
                  ) : (
                    <p>
                      Ninguém possui ou está usando esta moldura. O cadastro e a
                      arte serão removidos definitivamente.
                    </p>
                  )}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteFrameId("")}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        "delete",
                        { frame_id: deleteFrame.id },
                        undefined,
                        async (result) => {
                          if (result?.asset_path)
                            await removeAsset(result.asset_path);
                          setDeleteFrameId("");
                          setMessage("Moldura excluída definitivamente");
                        },
                      )
                    }
                  >
                    {deleteOwners.length || deleteEquipped.length
                      ? "Excluir mesmo assim"
                      : "Excluir"}
                  </button>
                </div>
              </section>
            </div>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      {!adminOnly && (
        <section className="panel">
          <h2>Outros cosméticos</h2>
        {Object.entries(names)
          .filter(([kind]) => kind !== "frame")
          .map(([kind, label]) => (
            <details key={kind}>
              <summary>{label}</summary>
              <div className="avatar-grid">
                {cosmetics
                  .filter((c) => c.kind === kind && c.active)
                  .map((item) => {
                    const owned = grants.some(
                      (g) =>
                        g.identity_id === identity?.id &&
                        g.cosmetic_id === item.id &&
                        !g.removed_at,
                    );
                    const equipped = equipment.some(
                      (e) =>
                        e.identity_id === identity?.id &&
                        e.cosmetic_id === item.id,
                    );
                    return (
                      <button
                        key={item.id}
                        className={
                          equipped ? "avatar-option selected" : "avatar-option"
                        }
                        disabled={!owned || busy}
                        onClick={() =>
                          run("cosmetic_equip", {
                            identity_id: identity?.id,
                            cosmetic_id: item.id,
                          })
                        }
                      >
                        <CosmeticIcon item={item} />
                        <strong>{item.name}</strong>
                        <small>
                          {equipped ? (
                            "Equipado"
                          ) : owned ? (
                            "Equipar"
                          ) : (
                            <>
                              <Lock size={12} /> Bloqueado
                            </>
                          )}
                        </small>
                      </button>
                    );
                  })}
              </div>
            </details>
          ))}
        </section>
      )}
    </>
  );
}
