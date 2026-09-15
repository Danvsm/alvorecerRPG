"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Swords,
  Shield,
  Heart,
  Zap,
  Sparkles,
  Coins,
  Star,
  BookOpen,
  Users,
  Settings,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Eye,
  Link as LinkIcon,
  ScrollText,
  Package,
  Skull,
  ChevronRight,
  X,
  KeyRound,
  WalletCards,
  UserRound,
  MoreHorizontal,
} from "lucide-react";
import { browserDb, configured } from "@/lib/client";
import { Brand, Empty } from "./Common";
import ResourceConfiguration from "./ResourceConfiguration";
import ConsumableActions from "./ConsumableActions";
import ShopPanel from "./ShopPanel";
import ItemThumbnail from "./ItemThumbnail";
import AvatarGallery from "./AvatarGallery";
import AvatarPickerDialog from "./AvatarPickerDialog";
import CosmeticsPanel from "./CosmeticsPanel";
import CommunityPanel from "./CommunityPanel";
import IdentityBadge from "./IdentityBadge";
import DirectChat from "./DirectChat";
import NotificationBell from "./NotificationBell";
import RewardsPanel from "./RewardsPanel";
import PlayerDataDetails, { ageFromDate } from "./PlayerDataDetails";
import CharacterSheet from "./CharacterSheet";
import InventoryPanel from "./InventoryPanel";
import WalletPanel from "./WalletPanel";
import ActivityTracker from "./ActivityTracker";
import {
  ActivityDashboard,
  FeedbackDashboard,
  FeedbackPrompt,
} from "./SessionInsights";
import CleanupPanel from "./CleanupPanel";
import CombatPanel from "./CombatPanel";
import { uploadAvatarImage, uploadItemImage } from "@/lib/media";
import {
  avatarSelectionRequest,
  characterAvatarIdentityId,
  type AvatarPolicyOperation,
  type AvatarSelectionTarget,
} from "@/lib/avatar";
import { combatLifeCommand } from "@/lib/combat";
import { formatDracmas, parseDracmas } from "@/lib/currency";
import FormDialog from "./FormDialog";
import type { Row, Field, Form } from "@/lib/types";
import type { Session } from "@supabase/supabase-js";
const tables = [
  "resource_rules",
  "item_effects",
  "shops",
  "shop_products",
  "characters",
  "character_resources",
  "attributes",
  "character_attributes",
  "advantages",
  "character_advantages",
  "items",
  "character_items",
  "creature_templates",
  "combat_rooms",
  "audit_logs",
  "invites",
  "profiles",
  "campaign_members",
  "campaign_avatars",
  "dracma_transactions",
  "dracma_charges",
  "activity_sessions",
  "session_feedback",
  "social_identities",
  "cosmetics",
  "cosmetic_grants",
  "cosmetic_equipment",
  "notifications",
];
const resourceNames: Row = {
  life: "Vida",
  consume: "Consumível utilizado",
  purchase: "Compra na loja",
  resource_maximum: "Máximo recalculado",
  resource_config: "Configuração do recurso",
  campaign_rule: "Regra da campanha",
  mana: "Mana",
  stamina: "Fôlego",
};
const historyActions: Row = {
  attribute_purchase: "Atributo evoluído",
  progression_adjustment: "Progressão ajustada",
  reward: "Recompensa recebida",
  player_data_changed: "Dados do jogador atualizados",
  social_message: "Mensagem enviada",
  social_image: "Imagem enviada",
  social_conversation: "Conversa iniciada",
  creature_image: "Imagem da criatura alterada",
  life: "Vida alterada",
  mana: "Mana alterada",
  stamina: "Fôlego alterado",
  balance: "Saldo alterado",
  notes: "Anotações atualizadas",
  buy_advantage: "Vantagem adquirida",
  credential_view: "Credencial consultada",
  credential_change: "Senha de jogador alterada",
  self_password_change: "Senha da conta alterada",
  create_player: "Jogador criado",
  avatar: "Avatar cadastrado ou atualizado",
  avatar_select: "Avatar alterado",
  avatar_delete: "Avatar excluído",
  avatar_block: "Avatar bloqueado",
  avatar_unblock: "Avatar desbloqueado",
  avatar_share: "Avatar compartilhável",
  avatar_unshare: "Avatar com uso único",
  avatar_exclusive: "Avatar exclusivo definido",
  avatar_clear_exclusive: "Exclusividade de avatar removida",
  dracma_transfer: "Transferência de Dracmas",
  dracma_adjustment: "Ajuste de Dracmas",
  dracma_charge_created: "Cobrança enviada",
  dracma_charge_paid: "Cobrança paga",
  dracma_charge_refused: "Cobrança recusada",
  dracma_reward_distributed: "Recompensa distribuída",
  dracma_reversal: "Movimentação estornada",
  purchase: "Compra realizada",
  consume: "Consumível utilizado",
  resource_maximum: "Máximo do recurso recalculado",
  resource_config: "Regra de recurso alterada",
  campaign_rule: "Padrão de recurso alterado",
  session_feedback: "Feedback enviado",
  player_disabled: "Acesso de jogador desativado",
  player_enabled: "Acesso de jogador reativado",
  player_delete_prepared: "Jogador excluído",
  invite_deleted: "Convite expirado removido",
  character_deleted: "Personagem excluído",
  creature_deleted: "Modelo de criatura excluído",
  creature_archived: "Modelo de criatura arquivado",
  creature_restored: "Modelo de criatura reativado",
  character_archived: "Personagem arquivado",
  character_restored: "Personagem reativado",
};
const masterMenu = [
  ["Visão Geral", LayoutDashboard],
  ["Dados", Users],
  ["Personagens", Shield],
  ["Combate", Swords],
  ["Carteira", WalletCards],
  ["Criaturas", Skull],
  ["Vantagens", Sparkles],
  ["Itens", Package],
  ["Lojas", Coins],
  ["Campanha", BookOpen],
  ["Histórico", ScrollText],
  ["Convites", LinkIcon],
  ["Configurações", Settings],
  ["Perfil", UserRound],
  ["Comunidade", Users],
] as const;
const playerMenu = [
  ["Início", LayoutDashboard],
  ["Minha Ficha", Shield],
  ["Combate", Swords],
  ["Carteira", WalletCards],
  ["Inventário", Package],
  ["Vantagens", Sparkles],
  ["Lojas", Coins],
  ["Histórico", ScrollText],
  ["Perfil", UserRound],
  ["Comunidade", Users],
] as const;
function formatHistoryValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(formatHistoryValue).join(", ");
  if (typeof value === "object") {
    const labels: Record<string, string> = {
      xp: "XP disponível",
      xp_total: "XP total",
      level: "Nível",
      username: "Username",
      full_name: "Nome",
      email: "E-mail",
      birth_date: "Nascimento",
    };
    return Object.entries(value)
      .map(
        ([key, entry]) => `${labels[key] || key}: ${formatHistoryValue(entry)}`,
      )
      .join(", ");
  }
  return String(value);
}

export default function Game({ invite }: { invite?: string }) {
  const [speakingAs, setSpeakingAs] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [expandedPlayer, setExpandedPlayer] = useState("");
  const [chatPeer, setChatPeer] = useState<{ id: string; nonce: number }>();
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [members, setMembers] = useState<Row[]>([]),
    [campaign, setCampaign] = useState(""),
    [campaigns, setCampaigns] = useState<Row[]>([]),
    [data, setData] = useState<Record<string, Row[]>>({}),
    [participants, setParticipants] = useState<Row[]>([]),
    [page, setPage] = useState("Visão Geral"),
    [selected, setSelected] = useState(""),
    [room, setRoom] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [form, setForm] = useState<Form | null>(null),
    [menu, setMenu] = useState(false),
    [connection, setConnection] = useState("Conectando"),
    [passwords, setPasswords] = useState<Record<string, string>>({}),
    [inviteUrl, setInviteUrl] = useState(""),
    [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({}),
    [recipients, setRecipients] = useState<Row[]>([]),
    [avatarPickerTarget, setAvatarPickerTarget] =
      useState<AvatarSelectionTarget | null>(null),
    [historyLimit, setHistoryLimit] = useState(20),
    [catalogFilter, setCatalogFilter] = useState("active");
  const requestVersion = useRef(0);
  const onboardingPrompted = useRef(false);
  const isMaster =
    members.find((m) => m.campaign_id === campaign)?.role === "master";
  useEffect(() => {
    setPage(isMaster ? "Visão Geral" : "Início");
  }, [campaign, isMaster]);
  const currentCampaign = campaigns.find((c) => c.id === campaign);
  const rows = (t: string) => data[t] || [];
  const chars = rows("characters").filter((c) => !c.archived);
  const character = chars.find((c) => c.id === selected) || chars[0];
  const ownProfile = rows("profiles").find((p) => p.id === session?.user.id);
  const ownIdentity = rows("social_identities").find(
    (p) => p.user_id === session?.user.id && p.campaign_id === campaign,
  );
  const characterIdentityId = characterAvatarIdentityId(
    campaign,
    character,
    rows("social_identities"),
  );
  const profileAvatar =
    ownIdentity?.avatar_id || (!isMaster ? character?.avatar_id : null);
  const socialActor =
    (isMaster &&
    rows("social_identities").some(
      (i) => i.id === speakingAs && i.kind === "npc" && i.active,
    )
      ? speakingAs
      : ownIdentity?.id) || "";
  const displayName =
    ownProfile?.display_name || ownProfile?.username || "Conta";
  const ownMember = rows("campaign_members").find(
    (member) => member.user_id === session?.user.id,
  );
  const avatarPlayers = rows("campaign_members")
    .filter(
      (member) =>
        member.campaign_id === campaign &&
        member.role === "player" &&
        member.access_active &&
        !member.archived_at,
    )
    .map((member) => {
      const profile = rows("profiles").find(
        (entry) => entry.id === member.user_id,
      );
      return {
        id: member.user_id,
        username: profile?.username || "jogador",
        name:
          profile?.display_name || profile?.username || "Jogador sem nome",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }
    const db = browserDb();
    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: s } = db.auth.onAuthStateChange((_, s) => {
      setSession(s);
      if (!s) {
        setChatPeer(undefined);
        setSpeakingAs("");
        setData({});
        setCampaign("");
        setMembers([]);
        setPasswords({});
        setAvatarPickerTarget(null);
      }
    });
    return () => {
      s.subscription.unsubscribe();
    };
  }, []);
  const load = useCallback(async (c: string, strict = false) => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const db = browserDb();
      const [result, snapshot, directory, visuals, avatarCatalog] = await Promise.all([
        Promise.all(
          tables.map((t) => {
            let q = db.from(t).select("*");
            if (
              [
                "characters",
                "attributes",
                "advantages",
                "items",
                "creature_templates",
                "combat_rooms",
                "audit_logs",
                "invites",
                "campaign_members",
                "campaign_avatars",
                "dracma_transactions",
                "dracma_charges",
                "activity_sessions",
                "session_feedback",
                "social_identities",
                "cosmetics",
                "notifications",
              ].includes(t)
            )
              q = q.eq("campaign_id", c);
            if (t === "audit_logs")
              q = q.order("created_at", { ascending: false }).limit(200);
            if (t === "dracma_transactions")
              q = q.order("created_at", { ascending: false }).limit(200);
            if (t === "dracma_charges" || t === "session_feedback")
              q = q.order("created_at", { ascending: false }).limit(200);
            if (t === "activity_sessions")
              q = q.order("started_at", { ascending: false }).limit(200);
            return q;
          }),
        ),
        db.rpc("combat_snapshot", { c }),
        db.rpc("transfer_recipients", { c }),
        db.rpc("combat_identities", { c }),
        db.rpc("avatar_catalog", { c }),
      ]);
      const failed = result.findIndex((r) => r.error);
      if (failed !== -1)
        throw new Error(
          `Não foi possível carregar ${tables[failed]}: ${result[failed].error?.message}`,
        );
      if (snapshot.error) throw snapshot.error;
      if (directory.error) throw directory.error;
      if (visuals.error) throw visuals.error;
      if (avatarCatalog.error) throw avatarCatalog.error;
      if (version !== requestVersion.current) return;
      setData({
        ...Object.fromEntries(result.map((r, i) => [tables[i], r.data || []])),
        campaign_avatars: avatarCatalog.data || [],
      });
      setParticipants(
        (snapshot.data || []).map((p: Row) => ({
          ...p,
          ...(visuals.data || []).find((v: Row) => v.participant_id === p.id),
        })),
      );
      setRecipients(directory.data || []);
    } catch (e) {
      setError((e as Error).message);
      if (strict) throw e;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!session) return;
    const db = browserDb();
    Promise.all([
      db.from("campaign_members").select("*").eq("user_id", session.user.id),
      db.from("campaigns").select("*"),
    ]).then(([m, c]) => {
      if (m.error || c.error) {
        setError(
          "Não foi possível carregar campanhas. Verifique as migrations.",
        );
        return;
      }
      setMembers(m.data || []);
      setCampaigns(c.data || []);
      setCampaign((old) => old || m.data?.[0]?.campaign_id || "");
    });
  }, [session]);
  useEffect(() => {
    if (!campaign || !session) return;
    setData({});
    setParticipants([]);
    setSelected("");
    setRoom("");
    setChatPeer(undefined);
    setSpeakingAs("");
    setPasswords({});
    onboardingPrompted.current = false;
    load(campaign);
    let timer: ReturnType<typeof setTimeout>;
    const channel = browserDb()
      .channel(`campaign:${campaign}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaign_events",
          filter: `campaign_id=eq.${campaign}`,
        },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => load(campaign), 100);
        },
      )
      .subscribe((status) => {
        setConnection(
          status === "SUBSCRIBED"
            ? "Tempo real ativo"
            : status === "CHANNEL_ERROR" || status === "TIMED_OUT"
              ? "Reconectando"
              : "Conectando",
        );
        if (status === "SUBSCRIBED") load(campaign);
      });
    const refresh = () => load(campaign);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      requestVersion.current++;
      clearTimeout(timer);
      browserDb().removeChannel(channel);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [campaign, session?.user.id, load]);
  useEffect(() => {
    if (
      !campaign ||
      loading ||
      isMaster ||
      !character ||
      !ownIdentity ||
      character.avatar_id ||
      onboardingPrompted.current
    )
      return;
    onboardingPrompted.current = true;
    setPage("Perfil");
    setAvatarPickerTarget({
      kind: "profile",
      identityId: ownIdentity.id,
    });
  }, [campaign, loading, isMaster, character, ownIdentity?.id]);
  useEffect(() => {
    let valid = true;
    Promise.all(
      rows("campaign_avatars").map(async (avatar) => {
        const { data } = await browserDb()
          .storage.from("portraits")
          .createSignedUrl(avatar.storage_path, 3600);
        return [avatar.id, data?.signedUrl || ""];
      }),
    ).then((r) => {
      if (valid) setAvatarUrls(Object.fromEntries(r));
    });
    return () => {
      valid = false;
    };
  }, [data.campaign_avatars]);
  useEffect(() => {
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!Object.keys(passwords).length) return;
    const timer = setTimeout(() => setPasswords({}), 30000);
    return () => clearTimeout(timer);
  }, [passwords]);
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function perform<T>(fn: () => Promise<T>): Promise<T> {
    if (busy) throw new Error("Aguarde a operação atual");
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (caught) {
      setError((caught as Error).message);
      throw caught;
    } finally {
      setBusy(false);
    }
  }
  async function action(op: string, d: Row) {
    const { data: result, error } = await browserDb().rpc("game_action", {
      c: campaign,
      op,
      d,
    });
    if (error) throw new Error(error.message);
    await load(campaign, true);
    setMessage("Alteração salva");
    return result || {};
  }
  async function walletAction(op: string, d: Row) {
    const { data: result, error } = await browserDb().rpc("wallet_action", {
      c: campaign,
      op,
      d,
    });
    if (error) throw new Error(error.message);
    await load(campaign, true);
    setMessage("Carteira atualizada");
    return result || {};
  }
  async function lifecycle(op: string, d: Row) {
    const { data: result, error } = await browserDb().rpc("lifecycle_action", {
      c: campaign,
      op,
      d,
    });
    if (error) throw new Error(error.message);
    await load(campaign, true);
    setMessage(op === "delete" ? "Registro excluído" : "Alteração salva");
    return result || {};
  }
  function quick(id: string) {
    return (
      <ConsumableActions
        characterId={id}
        inventory={rows("character_items")}
        items={rows("items")}
        effects={rows("item_effects")}
        busy={busy}
        use={(d) => run(() => action("consume", d))}
      />
    );
  }
  function configureItem(item: Row) {
    setForm({
      title: "Tipo e efeitos do item",
      fields: [
        {
          key: "kind",
          label: "Tipo",
          value: item.kind,
          options: [
            { id: "consumable", name: "Consumível" },
            { id: "equipment", name: "Equipamento" },
            { id: "material", name: "Material" },
            { id: "common", name: "Item comum" },
            { id: "quest", name: "Item de missão" },
            { id: "other", name: "Outro" },
          ],
        },
        ...["life", "mana", "stamina"].map((key) => ({
          key,
          label: "Recuperar " + resourceNames[key],
          type: "number",
          value:
            rows("item_effects").find(
              (e) => e.item_id === item.id && e.resource_key === key,
            )?.amount || 0,
        })),
      ],
      submit: async (d) => {
        await action("item_config", {
          item_id: item.id,
          kind: d.kind,
          image: item.image,
          effects: { life: d.life, mana: d.mana, stamina: d.stamina },
        });
        setForm(null);
      },
    });
  }
  async function command(op: string, d: Row) {
    const { error } = await browserDb().rpc("game_command", {
      c: campaign,
      op,
      d,
    });
    if (error) throw new Error(error.message);
    await load(campaign, true);
    setMessage("Alteração salva");
  }
  async function admin(action: string, d: Row = {}) {
    const s = await browserDb().auth.getSession();
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.data.session?.access_token}`,
      },
      body: JSON.stringify({ action, campaign, ...d }),
    });
    const v = await r.json();
    if (!r.ok) throw new Error(v.error);
    return v;
  }
  function edit(title: string, fields: Field[], op: string, extra: Row = {}) {
    setForm({
      title,
      fields,
      submit: async (d) => {
        await command(op, { ...extra, ...d });
        setForm(null);
      },
    });
  }
  function navigate(name: string) {
    setPage(name);
    setMenu(false);
    setPasswords({});
    setInviteUrl("");
  }
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    await run(async () => {
      if (invite && d.password !== d.confirm)
        throw new Error("As senhas não coincidem");
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: invite ? "invite" : "login",
          username: d.username,
          password: d.password,
          token: invite,
          fullName: d.fullName,
          email: d.email,
          birthDate: d.birthDate,
          characterName: d.characterName,
          characterClass: d.characterClass,
          characterRace: d.characterRace,
        }),
      });
      const s = await r.json();
      if (!r.ok) throw new Error(s.error);
      const { error } = await browserDb().auth.setSession(s);
      if (error) throw error;
      if (invite) location.assign("/");
    });
  }
  const resources = (id: string) =>
    rows("character_resources").filter((r) => r.character_id === id);
  function resourcePanel(
    id: string,
    r: Row,
    combatId?: string,
    editable = true,
  ) {
    const ratio = r.maximum ? r.current / r.maximum : 0;
    const color =
      r.key === "life"
        ? ratio > 0.6
          ? "green"
          : ratio >= 0.3
            ? "yellow"
            : "red"
        : r.key === "mana"
          ? "purple"
          : "gold";
    return (
      <div
        className={`resource${combatId ? " combat-resource" : ""}`}
        key={r.key}
      >
        <div className="spread">
          <span>
            {r.key === "life" ? (
              <Heart size={16} />
            ) : r.key === "mana" ? (
              <Sparkles size={16} />
            ) : (
              <Zap size={16} />
            )}{" "}
            {resourceNames[r.key]}
          </span>
          <strong>
            {r.current}
            <small> / {r.maximum}</small>
          </strong>
        </div>
        <div className="track">
          <div className={color} style={{ width: `${ratio * 100}%` }} />
        </div>
        {editable && (
          <div className="stepper">
            {(combatId
              ? [-5, -1, ...(isMaster ? [1, 5] : [])]
              : [-10, -5, -1, ...(isMaster ? [1, 5, 10] : [])]
            ).map((n) => (
              <button
                disabled={busy}
                key={n}
                onClick={() =>
                  run(() =>
                    command(
                      combatId ? "combat_update" : "resource",
                      combatId
                        ? { id: combatId, key: r.key, delta: n }
                        : { character_id: id, key: r.key, delta: n },
                    ),
                  )
                }
              >
                {n > 0 ? "+" : ""}
                {n}
              </button>
            ))}
            <button
              aria-label={`Digitar alteração de ${resourceNames[r.key]}`}
              disabled={busy}
              onClick={() =>
                edit(
                  `Alterar ${resourceNames[r.key]}`,
                  [
                    {
                      key: "delta",
                      label: isMaster
                        ? "Quantidade (negativa para gastar)"
                        : "Quantidade negativa para gastar",
                      type: "number",
                      required: true,
                    },
                    { key: "reason", label: "Motivo" },
                  ],
                  combatId ? "combat_update" : "resource",
                  combatId
                    ? { id: combatId, key: r.key }
                    : { character_id: id, key: r.key },
                )
              }
            >
              ...
            </button>
          </div>
        )}
      </div>
    );
  }
  function newPlayer() {
    setForm({
      title: "Criar jogador",
      fields: [
        { key: "username", label: "Username", required: true },
        {
          key: "password",
          label: "Senha inicial",
          type: "password",
          required: true,
        },
        { key: "fullName", label: "Nome completo da pessoa" },
        { key: "email", label: "E-mail da pessoa", type: "email" },
        {
          key: "birthDate",
          label: "Data de nascimento",
          type: "date",
          required: true,
        },
        { key: "name", label: "Nome do personagem", required: true },
        { key: "class", label: "Classe" },
        { key: "race", label: "Raça" },
        { key: "level", label: "Nível", type: "number", value: 1 },
        ...["life", "mana", "stamina"].flatMap((k) => [
          {
            key: k,
            label: `${resourceNames[k]} máxima`,
            type: "number",
            value: 0,
          },
          {
            key: k + "_current",
            label: `${resourceNames[k]} atual`,
            type: "number",
            value: 0,
          },
        ]),
        { key: "xp", label: "XP", type: "number", value: 0 },
        {
          key: "dracmas",
          label: "Dracmas (ex: 25,50)",
          value: "0,00",
        },
        ...rows("attributes")
          .filter((a) => !a.character_id && a.active)
          .map((a) => ({
            key: "attr_" + a.id,
            label: a.name,
            type: "number",
            value: 0,
          })),
        {
          key: "information",
          label: "Informações adicionais",
          type: "json",
          value: {},
        },
      ],
      submit: async (d) => {
        const {
          username,
          password,
          dracmas,
          fullName,
          email,
          birthDate,
          ...ch
        } = d;
        ch.dracmas_cents = parseDracmas(String(dracmas));
        ch.person = { full_name: fullName, email, birth_date: birthDate };
        ch.attributes = Object.fromEntries(
          Object.entries(ch)
            .filter(([k]) => k.startsWith("attr_"))
            .map(([k, v]) => [k.slice(5), v]),
        );
        await admin("create", { username, password, character: ch });
        await load(campaign, true);
        setForm(null);
        setMessage("Jogador criado. Escolha um avatar na ficha.");
      },
    });
  }
  function characterHeader(ch: Row) {
    return (
      <div className="character-heading">
        {avatarUrls[ch.avatar_id] ? (
          <img
            className="portrait"
            src={avatarUrls[ch.avatar_id]}
            alt={ch.name}
          />
        ) : (
          <div className="portrait empty-portrait">
            <Shield size={35} />
          </div>
        )}
        <div>
          <h2>{ch.name}</h2>
          <p>
            {ch.class || "Classe não definida"} ·{" "}
            {ch.race || "Raça não definida"}
          </p>
        </div>
      </div>
    );
  }
  function history(id?: string) {
    const records = rows("audit_logs")
      .filter((log) => !id || log.character_id === id)
      .slice(0, historyLimit);
    return (
      <div className="list">
        {records.map((l) => (
          <div className="history-row" key={l.id}>
            <time>{new Date(l.created_at).toLocaleString("pt-BR")}</time>
            <div>
              <b>
                {chars.find((c) => c.id === l.character_id)?.name ||
                  l.character_label ||
                  "Campanha"}
              </b>
              <p>
                {historyActions[l.action] ||
                  "Informação da campanha atualizada"}{" "}
                {l.detail.delta !== undefined
                  ? `${l.detail.delta > 0 ? "+" : ""}${l.detail.delta}`
                  : ""}
                {l.detail.delta_cents !== undefined
                  ? ` ${l.detail.delta_cents > 0 ? "+" : ""}${formatDracmas(l.detail.delta_cents)}`
                  : ""}
                {l.detail.before !== undefined
                  ? ` (${formatHistoryValue(l.detail.before)} → ${formatHistoryValue(l.detail.after)})`
                  : ""}{" "}
                {l.detail.before_cents !== undefined
                  ? ` (${formatDracmas(l.detail.before_cents)} → ${formatDracmas(l.detail.after_cents)})`
                  : ""}{" "}
                {l.detail.reason ||
                  (l.action !== "avatar_select" ? l.detail.name : "") ||
                  ""}
                {l.detail.recovered &&
                  Object.entries(l.detail.recovered)
                    .map(
                      ([key, value]) =>
                        ` +${value} ${resourceNames[key] || key}`,
                    )
                    .join(", ")}
              </p>
            </div>
            <small>
              {(() => {
                const actor = rows("profiles").find((p) => p.id === l.actor_id);
                return (
                  actor?.display_name ||
                  actor?.username ||
                  l.actor_label ||
                  "Sistema"
                );
              })()}
            </small>
          </div>
        ))}
        {!rows("audit_logs").length && (
          <Empty text="As alterações da sessão aparecerão aqui." />
        )}
        {records.length <
          rows("audit_logs").filter((log) => !id || log.character_id === id)
            .length && (
          <button
            className="load-more"
            onClick={() => setHistoryLimit((limit) => limit + 20)}
          >
            Carregar mais
          </button>
        )}
      </div>
    );
  }
  const activeRooms = rows("combat_rooms").filter((r) => r.active);
  const currentRoom = activeRooms.find((r) => r.id === room) || activeRooms[0];
  if (!ready)
    return (
      <main className="auth">
        <p>Carregando Alvorecer...</p>
      </main>
    );
  if (!session)
    return (
      <main className="auth">
        <div className={`auth-panel${invite ? " invite-auth" : ""}`}>
          <Brand />
          <div className="auth-symbol">
            <Swords size={40} />
          </div>
          <p className="eyebrow">A PROMESSA DO AMANHECER</p>
          <h1>
            {invite
              ? "Bem-vindo ao Alvorecer"
              : "Sua próxima sessão começa aqui."}
          </h1>
          <p>
            {invite
              ? "Crie suas credenciais para acessar sua ficha."
              : "Entre para acompanhar sua ficha e sua campanha."}
          </p>
          {!configured ? (
            <div className="notice">
              <strong>Configuração inicial necessária</strong>
              <p>
                O aplicativo precisa ser conectado ao projeto Supabase antes de
                receber jogadores.
              </p>
              <p>O guia de instalação acompanha o código.</p>
            </div>
          ) : (
            <form onSubmit={login}>
              {invite && (
                <fieldset className="invite-section">
                  <legend>Seus dados</legend>
                  <label>
                    Nome completo
                    <input
                      name="fullName"
                      required
                      minLength={3}
                      maxLength={160}
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    E-mail
                    <input
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    Data de nascimento
                    <input
                      name="birthDate"
                      type="date"
                      autoComplete="bday"
                      required
                    />
                  </label>
                </fieldset>
              )}
              {invite && (
                <fieldset className="invite-section">
                  <legend>Seu personagem</legend>
                  <label>
                    Nome do personagem
                    <input name="characterName" required maxLength={120} />
                  </label>
                  <div className="invite-pair">
                    <label>
                      Classe
                      <input name="characterClass" maxLength={120} />
                    </label>
                    <label>
                      Raça
                      <input name="characterRace" maxLength={120} />
                    </label>
                  </div>
                </fieldset>
              )}
              {invite && (
                <p className="eyebrow invite-credentials-title">
                  CREDENCIAIS DE ACESSO
                </p>
              )}
              <label>
                Username
                <input
                  name="username"
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_]+"
                  autoComplete="username"
                />
              </label>
              <label>
                Senha
                <input
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  maxLength={72}
                  autoComplete={invite ? "new-password" : "current-password"}
                />
              </label>
              {invite && (
                <>
                  <label>
                    Confirmar senha
                    <input
                      name="confirm"
                      type="password"
                      required
                      autoComplete="new-password"
                    />
                  </label>
                </>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? "Entrando..."
                  : invite
                    ? "Entrar no Alvorecer"
                    : "Entrar"}
                <ChevronRight size={18} />
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small className="muted">Universo Alvorecer</small>
        </div>
      </main>
    );
  return (
    <div
      className="app"
      style={
        {
          "--primary": currentCampaign?.theme?.primary || "#9E1B32",
          "--highlight": currentCampaign?.theme?.highlight || "#D02A43",
          "--background": currentCampaign?.theme?.background || "#09090B",
        } as React.CSSProperties
      }
    >
      <ActivityTracker campaign={campaign} userId={session.user.id} />
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <Brand logo={currentCampaign?.theme?.logo} />
        <div className="campaign-switch">
          <small>CAMPANHA</small>
          <select
            aria-label="Campanha"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <nav>
          {(isMaster ? masterMenu : playerMenu).map(([name, Icon]) => (
            <button
              className={page === name ? "active" : ""}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={18} />
              {name}
            </button>
          ))}
          {!isMaster && (
            <>
              <span className="coming">
                Runas <small>Em breve</small>
              </span>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <button
            className="sidebar-account"
            onClick={() => navigate("Perfil")}
          >
            {avatarUrls[profileAvatar] ? (
              <img src={avatarUrls[profileAvatar]} alt="" />
            ) : (
              <span className="sidebar-avatar">
                <UserRound size={16} />
              </span>
            )}
            <span>
              <strong>{displayName}</strong>
              <small>
                {isMaster ? "Mestre" : `@${ownProfile?.username || "jogador"}`}
              </small>
            </span>
          </button>
          <button onClick={() => browserDb().auth.signOut()}>
            <LogOut size={17} />
            <span className="visually-hidden">Sair</span>
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="scrim"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label="Abrir menu"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <span>
            ALVORECER <span className="divider">/</span>{" "}
            {currentCampaign?.name || "Campanha"}
          </span>
          <small
            className={connection === "Tempo real ativo" ? "online" : "muted"}
          >
            {connection}
          </small>
          <NotificationBell
            notifications={rows("notifications")}
            save={async (op, d) => {
              const r = await browserDb().rpc("identity_action", {
                c: campaign,
                op,
                d,
              });
              if (r.error) throw new Error(r.error.message);
              await load(campaign, true);
            }}
          />
        </header>
        <main className="content">
          {page !== "Combate" && (
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {isMaster ? "PAINEL DO MESTRE" : "ÁREA DO JOGADOR"}
                </p>
                <h1>{!isMaster && page === "Visão Geral" ? "Início" : page}</h1>
              </div>
              {loading && (
                <span className="muted" role="status">
                  Atualizando...
                </span>
              )}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Fechar erro" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {message && (
            <div className="success" role="status">
              {message}
            </div>
          )}
          {!campaign && (
            <Empty text="Sua conta ainda não está associada a uma campanha." />
          )}
          {campaign && ["Visão Geral", "Início"].includes(page) && (
            <>
              <div className="overview-title">
                <div>
                  <p className="eyebrow">CAMPANHA ATUAL</p>
                  <h2>{currentCampaign?.name}</h2>
                  <p>
                    {isMaster
                      ? "Sua mesa, em um só lugar."
                      : "Sua ficha e os acontecimentos da sessão."}
                  </p>
                </div>
                <Swords size={48} />
              </div>
              <div className="stats">
                {[
                  [
                    Users,
                    "Jogadores",
                    rows("campaign_members").filter((m) => m.role === "player")
                      .length,
                  ],
                  [Shield, "Personagens", chars.length],
                  [Swords, "Combates ativos", activeRooms.length],
                  [
                    LinkIcon,
                    "Convites pendentes",
                    rows("invites").filter(
                      (i) =>
                        !i.used_by &&
                        !i.cancelled &&
                        Date.parse(i.expires_at) > Date.now(),
                    ).length,
                  ],
                ]
                  .filter((_, i) => isMaster || i === 1 || i === 2)
                  .map(([Icon, label, n]: any) => (
                    <div className="stat" key={label}>
                      <Icon size={20} />
                      <span>{label}</span>
                      <strong>{n}</strong>
                    </div>
                  ))}
              </div>
              {isMaster && (
                <div className="actions">
                  <button className="primary" onClick={newPlayer}>
                    <Plus size={18} />
                    Criar jogador
                  </button>
                  <button
                    onClick={() =>
                      edit(
                        "Abrir combate",
                        [
                          {
                            key: "name",
                            label: "Nome do combate",
                            required: true,
                          },
                        ],
                        "room",
                      )
                    }
                  >
                    <Swords size={18} />
                    Abrir combate
                  </button>
                  <button onClick={() => navigate("Convites")}>
                    <LinkIcon size={18} />
                    Gerar convite
                  </button>
                </div>
              )}
              {isMaster ? (
                <div className="insights-grid">
                  <ActivityDashboard
                    sessions={rows("activity_sessions")}
                    profiles={rows("profiles")}
                    characters={chars}
                  />
                  <FeedbackDashboard feedback={rows("session_feedback")} />
                </div>
              ) : (
                <FeedbackPrompt
                  feedback={rows("session_feedback").find(
                    (item) =>
                      item.user_id === session.user.id &&
                      new Date(
                        item.feedback_date + "T12:00:00",
                      ).toDateString() === new Date().toDateString(),
                  )}
                  submit={async (rating, comment) => {
                    const { error } = await browserDb().rpc(
                      "submit_session_feedback",
                      {
                        c: campaign,
                        score: rating,
                        note: comment,
                      },
                    );
                    if (error) throw new Error(error.message);
                    await load(campaign, true);
                  }}
                />
              )}
              <h2>
                {isMaster ? "Personagens da campanha" : "Meus personagens"}
              </h2>
              <div className="cards">
                {chars.map((c) => (
                  <button
                    className="character-card"
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      navigate(isMaster ? "Personagens" : "Minha Ficha");
                    }}
                  >
                    {characterHeader(c)}
                    {resources(c.id).map((r) => (
                      <div className="spread" key={r.key}>
                        <span>{resourceNames[r.key]}</span>
                        <b>
                          {r.current} / {r.maximum}
                        </b>
                      </div>
                    ))}
                  </button>
                ))}
              </div>
              {!chars.length && (
                <Empty
                  text={
                    isMaster
                      ? "Crie o primeiro jogador para iniciar sua campanha."
                      : "O mestre ainda não cadastrou seu personagem."
                  }
                />
              )}
              <h2>Últimas alterações</h2>
              {history()}
            </>
          )}
          {page === "Personagens" && isMaster && (
            <>
              <div className="toolbar">
                <select
                  aria-label="Personagem"
                  value={character?.id || ""}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {chars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {isMaster && (
                  <button
                    onClick={() =>
                      setForm({
                        title: "Novo personagem",
                        fields: [
                          { key: "name", label: "Nome", required: true },
                          {
                            key: "owner_id",
                            label: "Jogador",
                            options: rows("profiles")
                              .filter((p) =>
                                rows("campaign_members").some(
                                  (m) =>
                                    m.user_id === p.id &&
                                    m.role === "player" &&
                                    m.access_active &&
                                    !m.archived_at,
                                ),
                              )
                              .map((p) => ({
                                id: p.id,
                                name: p.username,
                              })),
                            required: true,
                          },
                          { key: "class", label: "Classe" },
                          { key: "race", label: "Raça" },
                        ],
                        submit: async (d) => {
                          await command("new_character", d);
                          setForm(null);
                        },
                      })
                    }
                  >
                    <Plus size={17} />
                    Personagem
                  </button>
                )}
              </div>
              {character ? (
                <>
                  <section className="panel">
                    {characterHeader(character)}
                    <div className="actions">
                      {isMaster && (
                        <>
                          <button
                            onClick={() =>
                              edit(
                                "Editar personagem",
                                [
                                  {
                                    key: "name",
                                    label: "Nome",
                                    value: character.name,
                                    required: true,
                                  },
                                  {
                                    key: "class",
                                    label: "Classe",
                                    value: character.class,
                                  },
                                  {
                                    key: "race",
                                    label: "Raça",
                                    value: character.race,
                                  },
                                  {
                                    key: "information",
                                    label: "Informações adicionais",
                                    type: "json",
                                    value: character.information,
                                  },
                                ],
                                "character",
                                { character_id: character.id },
                              )
                            }
                          >
                            Editar ficha
                          </button>
                          <button
                            onClick={() =>
                              setAvatarPickerTarget({
                                kind: "character",
                                characterId: character.id,
                                identityId: characterIdentityId,
                              })
                            }
                          >
                            Alterar avatar
                          </button>
                        </>
                      )}
                    </div>
                    {isMaster && (
                      <ResourceConfiguration
                        character={character}
                        resources={resources(character.id)}
                        rules={rows("resource_rules").filter(
                          (r) => r.campaign_id === campaign,
                        )}
                        attributes={rows("attributes")}
                        values={rows("character_attributes")}
                        save={action}
                        busy={busy}
                      />
                    )}
                    {quick(character.id)}
                    <div className="resource-grid">
                      {resources(character.id).map((r) =>
                        resourcePanel(character.id, r),
                      )}
                    </div>
                    <div className="balances">
                      <div>
                        <Star size={20} />
                        <span>XP</span>
                        <strong>{character.xp.toLocaleString("pt-BR")}</strong>
                        {isMaster && (
                          <button
                            onClick={() =>
                              edit(
                                "Alterar XP",
                                [
                                  {
                                    key: "delta",
                                    label: "Quantidade a adicionar ou remover",
                                    type: "number",
                                    required: true,
                                  },
                                  {
                                    key: "reason",
                                    label: "Motivo",
                                    required: true,
                                  },
                                ],
                                "balance",
                                { character_id: character.id, key: "xp" },
                              )
                            }
                          >
                            Alterar
                          </button>
                        )}
                      </div>
                      <div>
                        <Coins size={20} />
                        <span>Dracmas</span>
                        <strong>
                          {formatDracmas(character.dracmas_cents)}
                        </strong>
                        {isMaster && (
                          <button
                            onClick={() =>
                              setForm({
                                title: `Alterar Dracmas de ${character.name}`,
                                fields: [
                                  {
                                    key: "delta",
                                    label:
                                      "Valor a adicionar ou remover (ex: 25,50 ou -10,00)",
                                    required: true,
                                  },
                                  {
                                    key: "reason",
                                    label: "Motivo",
                                    required: true,
                                  },
                                ],
                                submit: async (values) => {
                                  const deltaCents = parseDracmas(
                                    String(values.delta),
                                    true,
                                  );
                                  if (!deltaCents)
                                    throw new Error(
                                      "Informe um valor diferente de zero",
                                    );
                                  await action("adjust_dracmas", {
                                    target_type: "character",
                                    target_character_id: character.id,
                                    delta_cents: deltaCents,
                                    reason: values.reason,
                                    request_id: crypto.randomUUID(),
                                  });
                                  setForm(null);
                                },
                              })
                            }
                          >
                            Alterar
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <h2>Atributos</h2>
                    <div className="attribute-grid">
                      {rows("attributes")
                        .filter(
                          (a) =>
                            a.active &&
                            (!a.character_id ||
                              a.character_id === character.id),
                        )
                        .sort((a, b) => a.position - b.position)
                        .map((a) => (
                          <div className="attribute" key={a.id}>
                            <span>{a.name}</span>
                            <strong>
                              {rows("character_attributes").find(
                                (v) =>
                                  v.character_id === character.id &&
                                  v.attribute_id === a.id,
                              )?.value || 0}
                            </strong>
                            {isMaster && (
                              <button
                                aria-label={`Alterar ${a.name}`}
                                onClick={() =>
                                  edit(
                                    a.name,
                                    [
                                      {
                                        key: "value",
                                        label: "Valor",
                                        type: "number",
                                        required: true,
                                        value:
                                          rows("character_attributes").find(
                                            (v) =>
                                              v.character_id === character.id &&
                                              v.attribute_id === a.id,
                                          )?.value || 0,
                                      },
                                    ],
                                    "attribute_value",
                                    {
                                      character_id: character.id,
                                      attribute_id: a.id,
                                    },
                                  )
                                }
                              >
                                Editar
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                    {isMaster && (
                      <button
                        onClick={() =>
                          edit(
                            "Atributo individual",
                            [{ key: "name", label: "Nome", required: true }],
                            "attribute",
                            { character_id: character.id },
                          )
                        }
                      >
                        Adicionar atributo individual
                      </button>
                    )}
                  </section>
                  <section className="panel">
                    <h2>Vantagens</h2>
                    {rows("character_advantages")
                      .filter((v) => v.character_id === character.id)
                      .map((v) => (
                        <div className="list-row" key={v.advantage_id}>
                          <span>
                            {
                              rows("advantages").find(
                                (a) => a.id === v.advantage_id,
                              )?.name
                            }
                          </span>
                          {isMaster && (
                            <button
                              onClick={() =>
                                run(() =>
                                  command("grant_advantage", {
                                    character_id: character.id,
                                    advantage_id: v.advantage_id,
                                    remove: true,
                                  }),
                                )
                              }
                            >
                              Remover
                            </button>
                          )}
                        </div>
                      ))}
                    {isMaster && (
                      <button
                        onClick={() =>
                          edit(
                            "Conceder vantagem",
                            [
                              {
                                key: "advantage_id",
                                label: "Vantagem",
                                options: rows("advantages"),
                                required: true,
                              },
                            ],
                            "grant_advantage",
                            { character_id: character.id },
                          )
                        }
                      >
                        Adicionar vantagem
                      </button>
                    )}
                  </section>
                  <section className="panel">
                    <h2>Inventário</h2>
                    {rows("character_items")
                      .filter((i) => i.character_id === character.id)
                      .map((i) => (
                        <div className="list-row" key={i.id}>
                          <div>
                            <b>
                              {
                                rows("items").find((a) => a.id === i.item_id)
                                  ?.name
                              }{" "}
                              × {i.quantity}
                            </b>
                            <p>{i.notes}</p>
                          </div>
                          {isMaster && (
                            <button
                              onClick={() =>
                                edit(
                                  "Alterar item",
                                  [
                                    {
                                      key: "quantity",
                                      label: "Quantidade (0 remove)",
                                      type: "number",
                                      value: i.quantity,
                                    },
                                    {
                                      key: "notes",
                                      label: "Observações",
                                      value: i.notes,
                                    },
                                  ],
                                  "inventory",
                                  {
                                    character_id: character.id,
                                    id: i.id,
                                    item_id: i.item_id,
                                  },
                                )
                              }
                            >
                              Editar
                            </button>
                          )}
                        </div>
                      ))}
                    {isMaster && (
                      <button
                        onClick={() =>
                          edit(
                            "Adicionar item",
                            [
                              {
                                key: "item_id",
                                label: "Item",
                                options: rows("items"),
                                required: true,
                              },
                              {
                                key: "quantity",
                                label: "Quantidade",
                                type: "number",
                                value: 1,
                              },
                              { key: "notes", label: "Observações" },
                            ],
                            "inventory",
                            { character_id: character.id },
                          )
                        }
                      >
                        Adicionar item
                      </button>
                    )}
                  </section>
                  <section className="panel">
                    <h2>Informações</h2>
                    {Object.entries(character.information || {}).map(
                      ([k, v]) => (
                        <p key={k}>
                          <b>{k}: </b>
                          {String(v)}
                        </p>
                      ),
                    )}
                    <h2>Anotações</h2>
                    <p className="notes">
                      {character.notes || "Nenhuma anotação."}
                    </p>
                    <button
                      onClick={() =>
                        edit(
                          "Anotações",
                          [
                            {
                              key: "notes",
                              label: "Texto",
                              type: "textarea",
                              value: character.notes,
                            },
                          ],
                          "notes",
                          { character_id: character.id },
                        )
                      }
                    >
                      Editar anotações
                    </button>
                  </section>
                  <h2>Histórico do personagem</h2>
                  {history(character.id)}
                  <details className="danger-more panel">
                    <summary>
                      <MoreHorizontal size={17} /> Mais ações
                    </summary>
                    <div className="actions">
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Arquivar ${character.name}? Ele sairá das listas principais.`,
                            )
                          )
                            void run(() =>
                              lifecycle("archive", {
                                entity: "character",
                                id: character.id,
                              }),
                            );
                        }}
                      >
                        Arquivar personagem
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            const { data: preview, error: previewError } =
                              await browserDb().rpc("lifecycle_preview", {
                                c: campaign,
                                entity: "character",
                                target: character.id,
                              });
                            if (previewError)
                              throw new Error(previewError.message);
                            setForm({
                              title: `Excluir ${preview.name}?`,
                              fields: [
                                {
                                  key: "confirmation",
                                  label: `Digite EXCLUIR para confirmar. Inventário: ${preview.inventory}. Transações preservadas: ${preview.transactions}.`,
                                  required: true,
                                },
                              ],
                              submit: async (values) => {
                                if (values.confirmation !== "EXCLUIR")
                                  throw new Error(
                                    "Digite EXCLUIR para confirmar",
                                  );
                                await lifecycle("delete", {
                                  entity: "character",
                                  id: character.id,
                                });
                                setForm(null);
                              },
                            });
                          })
                        }
                      >
                        Excluir definitivamente
                      </button>
                    </div>
                  </details>
                </>
              ) : (
                <Empty text="Nenhum personagem cadastrado." />
              )}
            </>
          )}
          {page === "Minha Ficha" &&
            !isMaster &&
            (character ? (
              <>
                {chars.length > 1 && (
                  <div className="toolbar compact-toolbar">
                    <select
                      aria-label="Personagem"
                      value={character.id}
                      onChange={(event) => setSelected(event.target.value)}
                    >
                      {chars.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <CharacterSheet
                  character={character}
                  avatarUrl={avatarUrls[character.avatar_id]}
                  resources={resources(character.id)}
                  attributes={rows("attributes")}
                  values={rows("character_attributes")}
                  advantages={rows("advantages")}
                  ownedAdvantages={rows("character_advantages")}
                  resourceControl={(resource) =>
                    resourcePanel(character.id, resource)
                  }
                  openWallet={() => navigate("Carteira")}
                  refresh={() => load(campaign, true)}
                />
              </>
            ) : (
              <Empty text="O mestre ainda não cadastrou seu personagem." />
            ))}
          {page === "Inventário" &&
            !isMaster &&
            (character ? (
              <>
                {chars.length > 1 && (
                  <div className="toolbar compact-toolbar">
                    <select
                      aria-label="Personagem"
                      value={character.id}
                      onChange={(event) => setSelected(event.target.value)}
                    >
                      {chars.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <InventoryPanel
                  character={character}
                  inventory={rows("character_items")}
                  items={rows("items")}
                  effects={rows("item_effects")}
                  busy={busy}
                  master={false}
                  useItem={async (entry) => {
                    await run(() =>
                      action("consume", {
                        character_id: character.id,
                        inventory_id: entry.id,
                        request_id: crypto.randomUUID(),
                      }),
                    );
                  }}
                  editNotes={() =>
                    edit(
                      "Anotações",
                      [
                        {
                          key: "notes",
                          label: "Pistas, lugares, NPCs, missões e descobertas",
                          type: "textarea",
                          value: character.notes,
                        },
                      ],
                      "notes",
                      { character_id: character.id },
                    )
                  }
                />
              </>
            ) : (
              <Empty text="Nenhum inventário disponível." />
            ))}
          {page === "Dados" && isMaster && (
            <>
              <RewardsPanel
                campaign={campaign}
                characters={chars}
                cosmetics={rows("cosmetics")}
                refresh={() => load(campaign, true)}
              />
              <div className="toolbar">
                <h2>Dados dos jogadores</h2>
                <button className="primary" onClick={newPlayer}>
                  <Plus size={18} />
                  Criar jogador
                </button>
              </div>
              <label>
                Buscar por nome, username, personagem ou e-mail
                <input
                  type="search"
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                />
              </label>
              {rows("campaign_members")
                .filter((m) => m.role === "player")
                .filter((m) => {
                  const p = rows("profiles").find((p) => p.id === m.user_id);
                  return [
                    p?.full_name,
                    p?.username,
                    p?.personal_email,
                    ...chars
                      .filter((ch) => ch.owner_id === m.user_id)
                      .map((ch) => ch.name),
                  ]
                    .join(" ")
                    .toLocaleLowerCase("pt-BR")
                    .includes(playerSearch.toLocaleLowerCase("pt-BR"));
                })
                .map((m) => {
                  const p = rows("profiles").find((p) => p.id === m.user_id);
                  return (
                    <section className="panel" key={m.user_id}>
                      <button
                        className="spread"
                        aria-expanded={expandedPlayer === m.user_id}
                        onClick={() =>
                          setExpandedPlayer(
                            expandedPlayer === m.user_id ? "" : m.user_id,
                          )
                        }
                      >
                        {rows("social_identities").find(
                          (i) => i.user_id === m.user_id,
                        ) && (
                          <IdentityBadge
                            identity={rows("social_identities").find(
                              (i) => i.user_id === m.user_id,
                            )!}
                            cosmetics={rows("cosmetics")}
                            equipment={rows("cosmetic_equipment")}
                            urls={avatarUrls}
                          />
                        )}
                        <span>
                          {p?.full_name || p?.username} · @{p?.username}
                        </span>
                        <small>
                          {ageFromDate(p?.birth_date) ?? "Idade não informada"}
                        </small>
                        <span>{m.access_active ? "Ativo" : "Desativado"}</span>
                      </button>
                      <small>
                        {chars
                          .filter((ch) => ch.owner_id === m.user_id)
                          .map((ch) => ch.name)
                          .join(", ") || "Sem personagem"}
                      </small>
                      {expandedPlayer === m.user_id && (
                        <>
                          {p && (
                            <PlayerDataDetails
                              profile={p}
                              campaign={campaign}
                              characters={chars.filter(
                                (ch) => ch.owner_id === m.user_id,
                              )}
                              resources={rows("character_resources")}
                              open={(f) =>
                                setForm({
                                  ...f,
                                  submit: async (d) => {
                                    await f.submit(d);
                                    setForm(null);
                                  },
                                })
                              }
                              refresh={() => load(campaign, true)}
                              editCharacter={(id) => {
                                setSelected(id);
                                navigate("Personagens");
                              }}
                            />
                          )}
                          <details>
                            <summary>Conta</summary>
                            <div className="spread">
                              <div>
                                <h2>{p?.full_name || p?.username}</h2>
                                <small>@{p?.username}</small>
                              </div>
                              <span
                                className={`badge${m.access_active ? "" : " disabled-badge"}`}
                              >
                                {m.access_active
                                  ? "Ativo"
                                  : "Acesso desativado"}
                              </span>
                            </div>
                            <p>
                              {chars
                                .filter((c) => c.owner_id === m.user_id)
                                .map((c) => c.name)
                                .join(", ") || "Sem personagem"}
                            </p>
                            {(p?.personal_email || p?.birth_date) && (
                              <p className="private-data">
                                {p.personal_email && (
                                  <span>E-mail: {p.personal_email}</span>
                                )}
                                {p.birth_date && (
                                  <span>
                                    Nascimento:{" "}
                                    {new Date(
                                      p.birth_date + "T12:00:00",
                                    ).toLocaleDateString("pt-BR")}
                                  </span>
                                )}
                              </p>
                            )}
                            <div className="credential">
                              <code>{passwords[m.user_id] || "••••••••"}</code>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    if (passwords[m.user_id])
                                      setPasswords((p) => ({
                                        ...p,
                                        [m.user_id]: "",
                                      }));
                                    else {
                                      const v = await admin("show", {
                                        userId: m.user_id,
                                      });
                                      setPasswords((p) => ({
                                        ...p,
                                        [m.user_id]: v.password,
                                      }));
                                    }
                                  })
                                }
                              >
                                <Eye size={16} />
                                {passwords[m.user_id] ? "Ocultar" : "Mostrar"}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    const v = await admin("show", {
                                      userId: m.user_id,
                                    });
                                    await navigator.clipboard.writeText(
                                      `Username: ${p?.username}\nSenha: ${v.password}`,
                                    );
                                    setMessage("Credenciais copiadas");
                                  })
                                }
                              >
                                Copiar
                              </button>
                              <button
                                onClick={() =>
                                  setForm({
                                    title: `Alterar senha de ${p?.username}`,
                                    fields: [
                                      {
                                        key: "password",
                                        label: "Nova senha",
                                        type: "password",
                                        required: true,
                                      },
                                    ],
                                    submit: async (d) => {
                                      await admin("password", {
                                        userId: m.user_id,
                                        password: d.password,
                                      });
                                      setPasswords({});
                                      setForm(null);
                                      setMessage("Senha alterada");
                                    },
                                  })
                                }
                              >
                                Alterar senha
                              </button>
                            </div>
                          </details>
                          <details className="danger-more">
                            <summary>
                              <MoreHorizontal size={16} /> Administração
                            </summary>
                            <div className="actions">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await admin(
                                      m.access_active
                                        ? "disable_player"
                                        : "enable_player",
                                      { userId: m.user_id },
                                    );
                                    await load(campaign, true);
                                  })
                                }
                              >
                                {m.access_active
                                  ? "Desativar acesso"
                                  : "Reativar acesso"}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  const linked = chars.filter(
                                    (item) => item.owner_id === m.user_id,
                                  );
                                  setForm({
                                    title: `Excluir o jogador @${p?.username}?`,
                                    fields: [
                                      {
                                        key: "mode",
                                        label: `Personagens vinculados: ${linked.map((item) => item.name).join(", ") || "nenhum"}`,
                                        options: [
                                          {
                                            id: "keep",
                                            name: "Excluir conta e manter personagens",
                                          },
                                          {
                                            id: "delete",
                                            name: "Excluir conta e personagens",
                                          },
                                        ],
                                      },
                                    ],
                                    submit: async (values) => {
                                      await admin("delete_player", {
                                        userId: m.user_id,
                                        deleteCharacters:
                                          values.mode === "delete",
                                        confirmation: "EXCLUIR",
                                      });
                                      await load(campaign, true);
                                      setForm(null);
                                      setMessage(
                                        "Jogador excluído; o histórico financeiro foi preservado",
                                      );
                                    },
                                  });
                                }}
                              >
                                Excluir jogador
                              </button>
                            </div>
                          </details>
                        </>
                      )}
                    </section>
                  );
                })}
            </>
          )}
          {page === "Combate" && (
            <CombatPanel
              rooms={activeRooms}
              selectedRoomId={currentRoom?.id || ""}
              participants={participants}
              characters={chars}
              identities={rows("social_identities")}
              cosmetics={rows("cosmetics")}
              equipment={rows("cosmetic_equipment")}
              avatarUrls={avatarUrls}
              inventory={rows("character_items")}
              items={rows("items")}
              effects={rows("item_effects")}
              isMaster={Boolean(isMaster)}
              userId={session.user.id}
              busy={busy}
              onSelectRoom={setRoom}
              onHistory={() => setPage("Histórico")}
              onCreateRoom={() =>
                edit(
                  "Criar nova sala de combate",
                  [{ key: "name", label: "Nome", required: true }],
                  "room",
                )
              }
              onRenameRoom={(targetRoom) =>
                edit(
                  "Renomear sala de combate",
                  [
                    {
                      key: "name",
                      label: "Nome",
                      value: targetRoom.name,
                      required: true,
                    },
                  ],
                  "room",
                  { id: targetRoom.id },
                )
              }
              onAddCharacter={(targetRoom) =>
                edit(
                  "Adicionar personagem/aliado",
                  [
                    {
                      key: "character_id",
                      label: "Personagem",
                      options: chars,
                      required: true,
                    },
                  ],
                  "participant",
                  { room_id: targetRoom.id, side: "ally" },
                )
              }
              onAddCreature={(targetRoom, side) =>
                edit(
                  side === "ally"
                    ? "Adicionar criatura aliada"
                    : "Adicionar monstro/inimigo",
                  [
                    {
                      key: "template_id",
                      label: "Modelo",
                      options: rows("creature_templates").filter(
                        (template) => template.active,
                      ),
                      required: true,
                    },
                    { key: "name", label: "Nome desta instância" },
                  ],
                  "participant",
                  { room_id: targetRoom.id, side },
                )
              }
              onEndRoom={(targetRoom) =>
                setForm({
                  title: `Encerrar ${targetRoom.name}?`,
                  fields: [],
                  submit: async () => {
                    await command("room", {
                      id: targetRoom.id,
                      active: false,
                    });
                    setForm(null);
                  },
                })
              }
              onRemoveParticipant={(participant) =>
                run(() =>
                  command("combat_update", {
                    id: participant.id,
                    remove: true,
                  }),
                )
              }
              onRevealParticipant={(participant, reveal) =>
                run(() =>
                  command("combat_update", { id: participant.id, reveal }),
                )
              }
              onAdjustLife={(participant, delta) =>
                perform(async () => {
                  const request = combatLifeCommand({
                    participant,
                    delta,
                    isMaster: Boolean(isMaster),
                    userId: session.user.id,
                    characters: chars,
                  });
                  await command(request.op, request.data);
                })
              }
              onConsume={(payload) => run(() => action("consume", payload))}
            />
          )}
          {["Vantagens", "Itens", "Criaturas"].includes(page) && (
            <>
              {!isMaster && page === "Vantagens" && (
                <div className="toolbar">
                  <label>
                    Comprar para
                    <select
                      value={character?.id || ""}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      {chars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.xp} XP
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {isMaster && (
                <div className="toolbar">
                  <select
                    aria-label="Filtrar conteúdo"
                    value={catalogFilter}
                    onChange={(event) => setCatalogFilter(event.target.value)}
                  >
                    <option value="active">Ativos</option>
                    <option value="archived">Arquivados</option>
                    <option value="all">Todos</option>
                  </select>
                  <button className="primary" onClick={() => catalogForm(page)}>
                    <Plus size={18} />
                    Criar{" "}
                    {page === "Vantagens"
                      ? "vantagem"
                      : page === "Itens"
                        ? "item"
                        : "criatura"}
                  </button>
                </div>
              )}
              <div className="cards">
                {rows(
                  page === "Vantagens"
                    ? "advantages"
                    : page === "Itens"
                      ? "items"
                      : "creature_templates",
                )
                  .filter((a) =>
                    !isMaster
                      ? a.active
                      : catalogFilter === "all"
                        ? true
                        : catalogFilter === "active"
                          ? a.active
                          : !a.active,
                  )
                  .map((a) => (
                    <article className="panel catalog-card" key={a.id}>
                      <div className="spread">
                        <h2>{a.name}</h2>
                        {!a.active && <span className="badge">Arquivado</span>}
                      </div>
                      {page === "Criaturas" && isMaster && (
                        <>
                          <ItemThumbnail path={a.image_path} name={a.name} />
                          <label className="button-label">
                            Imagem da criatura
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              disabled={busy}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file)
                                  void run(async () => {
                                    const path = await uploadItemImage(
                                      file,
                                      campaign,
                                    );
                                    const r = await browserDb().rpc(
                                      "set_creature_image",
                                      { c: campaign, target: a.id, path },
                                    );
                                    if (r.error)
                                      throw new Error(r.error.message);
                                    await load(campaign, true);
                                  });
                              }}
                            />
                          </label>
                        </>
                      )}
                      {page === "Itens" && (
                        <>
                          <ItemThumbnail path={a.image} name={a.name} />
                          <div className="actions">
                            <button onClick={() => configureItem(a)}>
                              Tipo e efeitos
                            </button>
                            <label className="button-label">
                              Imagem
                              <input
                                hidden
                                type="file"
                                accept="image/webp,image/png,image/jpeg"
                                disabled={busy}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f)
                                    run(async () => {
                                      const image = await uploadItemImage(
                                        f,
                                        campaign,
                                      );
                                      await action("item_config", {
                                        item_id: a.id,
                                        kind: a.kind,
                                        image,
                                        effects: Object.fromEntries(
                                          rows("item_effects")
                                            .filter((ef) => ef.item_id === a.id)
                                            .map((ef) => [
                                              ef.resource_key,
                                              ef.amount,
                                            ]),
                                        ),
                                      });
                                    });
                                }}
                              />
                            </label>
                          </div>
                        </>
                      )}
                      <p>{a.description || a.notes || "Sem descrição."}</p>
                      {page === "Criaturas" && (
                        <p>
                          Vida {a.life} · Mana {a.mana} · Fôlego {a.stamina}
                        </p>
                      )}
                      {page === "Vantagens" && (
                        <>
                          <strong className="xp-price">
                            <Star size={17} />
                            {a.cost} XP
                          </strong>
                          {a.requirements && (
                            <p className="notice">
                              Requisitos: {a.requirements}. Concessão pelo
                              mestre.
                            </p>
                          )}
                        </>
                      )}
                      <div className="actions">
                        {isMaster ? (
                          <>
                            <button onClick={() => catalogForm(page, a)}>
                              Editar
                            </button>
                            <button
                              onClick={() =>
                                run(() =>
                                  lifecycle(a.active ? "archive" : "restore", {
                                    entity:
                                      page === "Vantagens"
                                        ? "advantage"
                                        : page === "Itens"
                                          ? "item"
                                          : "creature",
                                    id: a.id,
                                  }),
                                )
                              }
                            >
                              {a.active ? "Arquivar" : "Reativar"}
                            </button>
                            <details className="inline-more">
                              <summary aria-label="Mais ações">
                                <MoreHorizontal size={16} />
                              </summary>
                              <button
                                onClick={() =>
                                  void run(async () => {
                                    const entity =
                                      page === "Vantagens"
                                        ? "advantage"
                                        : page === "Itens"
                                          ? "item"
                                          : "creature";
                                    const {
                                      data: preview,
                                      error: previewError,
                                    } = await browserDb().rpc(
                                      "lifecycle_preview",
                                      { c: campaign, entity, target: a.id },
                                    );
                                    if (previewError)
                                      throw new Error(previewError.message);
                                    const dependencies = Object.entries(preview)
                                      .filter(([key]) => key !== "name")
                                      .map(([key, value]) => `${key}: ${value}`)
                                      .join(" · ");
                                    if (
                                      !confirm(
                                        `Excluir definitivamente ${preview.name}? ${dependencies}`,
                                      )
                                    )
                                      return;
                                    await lifecycle("delete", {
                                      entity,
                                      id: a.id,
                                    });
                                  })
                                }
                              >
                                Excluir definitivamente
                              </button>
                            </details>
                          </>
                        ) : (
                          page === "Vantagens" && (
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                !character ||
                                !!a.requirements ||
                                character.xp < a.cost ||
                                rows("character_advantages").some(
                                  (v) =>
                                    v.character_id === character?.id &&
                                    v.advantage_id === a.id,
                                )
                              }
                              onClick={() =>
                                setForm({
                                  title: `Comprar ${a.name} por ${a.cost} XP?`,
                                  fields: [],
                                  submit: async () => {
                                    await command("buy", {
                                      character_id: character.id,
                                      advantage_id: a.id,
                                    });
                                    setForm(null);
                                  },
                                })
                              }
                            >
                              Comprar
                            </button>
                          )
                        )}
                      </div>
                    </article>
                  ))}
              </div>
            </>
          )}
          {page === "Histórico" && history()}
          {page === "Comunidade" && (
            <>
              {isMaster && (
                <section className="panel">
                  <label>
                    Falar como
                    <select
                      value={socialActor}
                      onChange={(e) => setSpeakingAs(e.target.value)}
                    >
                      <option value={ownIdentity?.id}>Pink</option>
                      {rows("social_identities")
                        .filter((i) => i.kind === "npc" && i.active)
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      setForm({
                        title: "Personagem do Mundo",
                        fields: [
                          { key: "name", label: "Nome", required: true },
                          { key: "subtitle", label: "Função / título" },
                          {
                            key: "avatar_id",
                            label: "Avatar",
                            options: rows("campaign_avatars").filter(
                              (a) => a.active,
                            ),
                          },
                        ],
                        submit: async (d) => {
                          const r = await browserDb().rpc("identity_action", {
                            c: campaign,
                            op: "npc",
                            d,
                          });
                          if (r.error) throw new Error(r.error.message);
                          await load(campaign, true);
                          setForm(null);
                        },
                      })
                    }
                  >
                    Criar Personagem do Mundo
                  </button>
                </section>
              )}
              <CommunityPanel
                campaign={campaign}
                identities={rows("social_identities")}
                cosmetics={rows("cosmetics")}
                grants={rows("cosmetic_grants")}
                equipment={rows("cosmetic_equipment")}
                urls={avatarUrls}
                actor={socialActor}
                master={Boolean(isMaster)}
                message={(id) => setChatPeer({ id, nonce: Date.now() })}
                deleteWorldCharacter={
                  isMaster
                    ? async (id) => {
                        await admin("delete_world_character", {
                          identityId: id,
                        });
                        await load(campaign, true);
                        setMessage("Personagem do Mundo excluído");
                      }
                    : undefined
                }
              />
            </>
          )}
          {page === "Convites" && isMaster && (
            <>
              <div className="toolbar">
                <p>Links de uso único</p>
                <button
                  className="primary"
                  onClick={() =>
                    setForm({
                      title: "Gerar convite",
                      fields: [
                        {
                          key: "hours",
                          label: "Validade em horas (1 a 720)",
                          type: "number",
                          value: 24,
                          required: true,
                        },
                      ],
                      submit: async (d) => {
                        const v = await admin("invite", d);
                        setInviteUrl(v.url);
                        setForm(null);
                        await load(campaign, true);
                      },
                    })
                  }
                >
                  <LinkIcon size={18} />
                  Gerar link de convite
                </button>
              </div>
              {inviteUrl && (
                <div className="notice">
                  <p>Copie este link antes de sair da página.</p>
                  <input
                    readOnly
                    value={inviteUrl}
                    aria-label="Link do convite"
                  />
                  <button
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(inviteUrl);
                        setMessage("Link copiado");
                      })
                    }
                  >
                    Copiar link
                  </button>
                </div>
              )}
              {rows("invites").map((i) => (
                <div className="panel list-row" key={i.id}>
                  <div>
                    <b>
                      {i.used_by
                        ? "Usado"
                        : i.cancelled
                          ? "Cancelado"
                          : Date.parse(i.expires_at) < Date.now()
                            ? "Expirado"
                            : i.claim_id
                              ? "Cadastro em andamento"
                              : "Ativo"}
                    </b>
                    <p>
                      Validade: {new Date(i.expires_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  {!i.used_by && !i.cancelled && (
                    <button
                      onClick={() =>
                        run(async () => {
                          await admin("cancel_invite", { inviteId: i.id });
                          await load(campaign, true);
                        })
                      }
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
          {page === "Lojas" && (
            <ShopPanel
              shops={rows("shops").filter((s) => s.campaign_id === campaign)}
              products={rows("shop_products")}
              items={rows("items")}
              characters={chars}
              master={isMaster}
              campaign={campaign}
              busy={busy}
              save={action}
              open={(f) =>
                setForm({
                  ...f,
                  submit: async (d) => {
                    await f.submit(d);
                    setForm(null);
                  },
                })
              }
            />
          )}
          {page === "Carteira" && (
            <WalletPanel
              master={Boolean(isMaster)}
              currentUserId={session.user.id}
              masterBalance={ownMember?.dracmas_cents || 0}
              characters={chars}
              recipients={recipients}
              transactions={rows("dracma_transactions")}
              charges={rows("dracma_charges")}
              avatarUrls={avatarUrls}
              busy={busy}
              transfer={(values) =>
                perform(() => action("transfer_dracmas", values))
              }
              wallet={(operation, values) =>
                perform(() => walletAction(operation, values))
              }
              adjust={(values) =>
                perform(() => action("adjust_dracmas", values))
              }
            />
          )}
          {page === "Configurações" && isMaster && (
            <>
              <AvatarGallery
                manager
                avatars={rows("campaign_avatars")}
                urls={avatarUrls}
                players={avatarPlayers}
                busy={busy}
                onUpload={(file, name) =>
                  perform(async () => {
                    const path = await uploadAvatarImage(file, campaign);
                    try {
                      await action("avatar", {
                        name,
                        storage_path: path,
                      });
                    } catch (caught) {
                      const saved = await browserDb()
                        .from("campaign_avatars")
                        .select("id")
                        .eq("storage_path", path)
                        .maybeSingle();
                      if (!saved.error && !saved.data)
                        await browserDb()
                          .storage.from("portraits")
                          .remove([path]);
                      throw caught;
                    }
                  })
                }
                onRename={(avatar) =>
                  setForm({
                    title: "Editar nome do avatar",
                    fields: [
                      {
                        key: "name",
                        label: "Nome",
                        required: true,
                        value: avatar.name,
                      },
                    ],
                    submit: async (values) => {
                      await action("avatar", {
                        id: avatar.id,
                        name: values.name,
                      });
                      setForm(null);
                    },
                  })
                }
                onArchive={(avatar) =>
                  run(() =>
                    action("avatar", { id: avatar.id, active: !avatar.active }),
                  )
                }
                onDelete={(avatar) =>
                  run(async () => {
                    await admin("delete_avatar", { avatarId: avatar.id });
                    await load(campaign, true);
                    setMessage("Avatar excluído");
                  })
                }
                onPolicy={(
                  avatar,
                  avatarOperation: AvatarPolicyOperation,
                  exclusiveUserId,
                ) =>
                  perform(async () => {
                    await admin("avatar_policy", {
                      avatarId: avatar.id,
                      avatarOperation,
                      exclusiveUserId,
                    });
                    await load(campaign, true);
                    setMessage("Regra do avatar atualizada");
                  })
                }
              />
              <ResourceConfiguration
                campaign
                resources={[]}
                rules={rows("resource_rules").filter(
                  (r) => r.campaign_id === campaign,
                )}
                attributes={rows("attributes")}
                values={[]}
                save={action}
                busy={busy}
              />
              <section className="panel">
                <div className="spread">
                  <h2>Atributos</h2>
                  <button
                    onClick={() =>
                      edit(
                        "Novo atributo",
                        [
                          { key: "name", label: "Nome", required: true },
                          {
                            key: "position",
                            label: "Ordem",
                            type: "number",
                            value: rows("attributes").length,
                          },
                        ],
                        "attribute",
                      )
                    }
                  >
                    Criar atributo
                  </button>
                </div>
                {rows("attributes")
                  .filter((a) => !a.character_id)
                  .sort((a, b) => a.position - b.position)
                  .map((a) => (
                    <div className="list-row" key={a.id}>
                      <span>
                        {a.name} {!a.active && <small>Arquivado</small>}
                      </span>
                      <div className="actions">
                        <button
                          onClick={() =>
                            edit(
                              "Editar atributo",
                              [
                                {
                                  key: "name",
                                  label: "Nome",
                                  value: a.name,
                                  required: true,
                                },
                                {
                                  key: "position",
                                  label: "Ordem",
                                  type: "number",
                                  value: a.position,
                                },
                                {
                                  key: "cost",
                                  label: "Custo futuro de evolução",
                                  type: "number",
                                  value: a.cost || 0,
                                },
                              ],
                              "attribute",
                              { id: a.id },
                            )
                          }
                        >
                          Editar / ordenar
                        </button>
                        <button
                          onClick={() =>
                            run(() =>
                              command("attribute", {
                                id: a.id,
                                active: !a.active,
                              }),
                            )
                          }
                        >
                          {a.active ? "Desativar" : "Reativar"}
                        </button>
                      </div>
                    </div>
                  ))}
              </section>
              <section className="panel">
                <h2>Recursos e permissões</h2>
                <p>
                  Jogadores podem gastar vida, mana e fôlego próprios.
                  Recuperação, XP, dinheiro, atributos e inventário são
                  administrados pelo mestre.
                </p>
                <p>
                  Vida acima de 60%: verde. De 30% a 60%: amarelo. Abaixo de
                  30%: vermelho.
                </p>
                <p className="muted">
                  Regras configuráveis de recuperação, lojas e runas ficam para
                  uma próxima versão.
                </p>
              </section>
              <section className="panel">
                <h2>Aparência</h2>
                <button
                  onClick={() =>
                    setForm({
                      title: "Aparência da campanha",
                      fields: [
                        {
                          key: "primary",
                          label: "Vermelho principal",
                          type: "color",
                          value: currentCampaign?.theme?.primary || "#9E1B32",
                        },
                        {
                          key: "highlight",
                          label: "Vermelho de destaque",
                          type: "color",
                          value: currentCampaign?.theme?.highlight || "#D02A43",
                        },
                        {
                          key: "background",
                          label: "Fundo",
                          type: "color",
                          value:
                            currentCampaign?.theme?.background || "#09090B",
                        },
                        {
                          key: "logo",
                          label: "URL HTTPS da logo oficial",
                          value: currentCampaign?.theme?.logo || "",
                        },
                      ],
                      submit: async (d) => {
                        if (d.logo && !String(d.logo).startsWith("https://"))
                          throw new Error("Use uma URL HTTPS para a logo");
                        await command("campaign", { theme: d });
                        setCampaigns((cs) =>
                          cs.map((c) =>
                            c.id === campaign ? { ...c, theme: d } : c,
                          ),
                        );
                        setForm(null);
                      },
                    })
                  }
                >
                  Alterar tema e logo
                </button>
              </section>
              <CleanupPanel
                busy={busy}
                preview={() =>
                  perform(async () => {
                    const { data: result, error: previewError } =
                      await browserDb().rpc("cleanup_preview", { c: campaign });
                    if (previewError) throw new Error(previewError.message);
                    return result || {};
                  })
                }
                remove={(entries) =>
                  perform(async () => {
                    for (const entry of entries) {
                      if (entry.entity === "avatar") {
                        await admin("delete_avatar", { avatarId: entry.id });
                      } else if (entry.entity === "invite") {
                        await admin("delete_invite", {
                          inviteId: entry.id,
                          confirmation: "EXCLUIR",
                        });
                      } else {
                        const { error: lifecycleError } = await browserDb().rpc(
                          "lifecycle_action",
                          {
                            c: campaign,
                            op: "delete",
                            d: { entity: entry.entity, id: entry.id },
                          },
                        );
                        if (lifecycleError)
                          throw new Error(lifecycleError.message);
                      }
                    }
                    await load(campaign, true);
                    setMessage(`${entries.length} registro(s) removido(s)`);
                  })
                }
              />
            </>
          )}
          {page === "Campanha" && (
            <section className="panel">
              <Brand logo={currentCampaign?.theme?.logo} />
              <h2>{currentCampaign?.name}</h2>
              <p>Universo: Alvorecer</p>
              {isMaster && (
                <button
                  onClick={() =>
                    setForm({
                      title: "Nome da campanha",
                      fields: [
                        {
                          key: "name",
                          label: "Nome",
                          value: currentCampaign?.name,
                          required: true,
                        },
                      ],
                      submit: async (d) => {
                        await command("campaign", d);
                        setCampaigns((cs) =>
                          cs.map((c) =>
                            c.id === campaign ? { ...c, ...d } : c,
                          ),
                        );
                        setForm(null);
                      },
                    })
                  }
                >
                  Editar campanha
                </button>
              )}
            </section>
          )}
          {page === "Perfil" && (
            <>
              <section className="panel profile-card">
                {ownIdentity && (
                  <IdentityBadge
                    identity={ownIdentity}
                    cosmetics={rows("cosmetics")}
                    equipment={rows("cosmetic_equipment")}
                    urls={avatarUrls}
                  />
                )}
                <p>
                  @{ownProfile?.username} {isMaster && "· Mestre"}
                </p>
                <div className="actions">
                  {ownIdentity && (
                    <button
                      onClick={() =>
                        setAvatarPickerTarget({
                          kind: "profile",
                          identityId: ownIdentity.id,
                        })
                      }
                    >
                      Trocar foto
                    </button>
                  )}
                  <button onClick={() => navigate("Carteira")}>
                    Abrir Carteira
                  </button>
                  <button
                    onClick={() =>
                      setForm({
                        title: "Alterar minha senha",
                        fields: [
                          {
                            key: "currentPassword",
                            label: "Senha atual",
                            type: "password",
                            required: true,
                          },
                          {
                            key: "password",
                            label: "Nova senha",
                            type: "password",
                            required: true,
                          },
                          {
                            key: "confirm",
                            label: "Confirmar nova senha",
                            type: "password",
                            required: true,
                          },
                        ],
                        submit: async (values) => {
                          if (values.password !== values.confirm)
                            throw new Error("As novas senhas não coincidem");
                          await admin("self_password", {
                            currentPassword: values.currentPassword,
                            password: values.password,
                          });
                          setForm(null);
                          setMessage("Sua senha foi alterada");
                        },
                      })
                    }
                  >
                    <KeyRound size={17} /> Alterar minha senha
                  </button>
                  <button onClick={() => browserDb().auth.signOut()}>
                    <LogOut size={17} /> Sair da conta
                  </button>
                </div>
              </section>
              <CosmeticsPanel
                identity={ownIdentity}
                cosmetics={rows("cosmetics")}
                grants={rows("cosmetic_grants")}
                equipment={rows("cosmetic_equipment")}
                identities={rows("social_identities")}
                master={Boolean(isMaster)}
                save={async (op, d) => {
                  const result = await browserDb().rpc("identity_action", {
                    c: campaign,
                    op,
                    d,
                  });
                  if (result.error) throw new Error(result.error.message);
                  await load(campaign, true);
                }}
              />
            </>
          )}
        </main>
      </div>
      {form && (
        <FormDialog
          form={form}
          close={() => setForm(null)}
          busy={busy}
          run={run}
          generate={() => admin("generate")}
        />
      )}
      {ownIdentity && (
        <DirectChat
          key={`${session?.user.id}:${campaign}:${socialActor}`}
          campaign={campaign}
          identities={rows("social_identities")}
          actor={socialActor}
          master={Boolean(isMaster)}
          revision={data}
          requestedPeer={chatPeer}
          docked={page === "Combate"}
        />
      )}
      {avatarPickerTarget && (
        <AvatarPickerDialog
          open
          avatars={rows("campaign_avatars")}
          urls={avatarUrls}
          selectedId={
            avatarPickerTarget.kind === "character"
              ? chars.find(
                  (entry) => entry.id === avatarPickerTarget.characterId,
                )?.avatar_id
              : profileAvatar
          }
          subject={
            avatarPickerTarget.kind === "character"
              ? chars.find(
                  (entry) => entry.id === avatarPickerTarget.characterId,
                )?.name
              : ownIdentity?.name
          }
          targetUserId={
            avatarPickerTarget.kind === "character"
              ? chars.find(
                  (entry) => entry.id === avatarPickerTarget.characterId,
                )?.owner_id
              : ownIdentity?.user_id
          }
          targetIsMaster={
            rows("campaign_members").find(
              (member) =>
                member.user_id ===
                (avatarPickerTarget.kind === "character"
                  ? chars.find(
                      (entry) => entry.id === avatarPickerTarget.characterId,
                    )?.owner_id
                  : ownIdentity?.user_id),
            )?.role === "master"
          }
          busy={busy}
          close={() => setAvatarPickerTarget(null)}
          select={(avatarId) =>
            perform(async () => {
              const request = avatarSelectionRequest(
                campaign,
                avatarPickerTarget,
                avatarId,
              );
              const result = await browserDb().rpc(request.rpc, request.params);
              if (result.error) throw new Error(result.error.message);
              await load(campaign, true);
              setMessage(
                avatarPickerTarget.kind === "character"
                  ? "ficha atualizada"
                  : "Avatar alterado",
              );
            })
          }
        />
      )}
    </div>
  );
  function catalogForm(name: string, a: Row = {}) {
    const fields: Field[] = [
      { key: "name", label: "Nome", value: a.name, required: true },
    ];
    if (name === "Criaturas")
      fields.push(
        {
          key: "kind",
          label: "Tipo",
          value: a.kind || "creature",
          options: [
            { id: "creature", name: "Criatura / inimigo" },
            { id: "npc", name: "NPC" },
            { id: "minion", name: "Minion" },
          ],
        },
        ...["life", "mana", "stamina"].map((k) => ({
          key: k,
          label: resourceNames[k],
          type: "number",
          value: a[k] || 0,
        })),
        {
          key: "notes",
          label: "Observações",
          type: "textarea",
          value: a.notes,
        },
        {
          key: "attributes",
          label: "Atributos adicionais",
          type: "json",
          value: a.attributes || {},
        },
      );
    else
      fields.push({
        key: "description",
        label: "Descrição",
        type: "textarea",
        value: a.description,
      });
    if (name === "Vantagens")
      fields.push(
        {
          key: "cost",
          label: "Custo em XP",
          type: "number",
          value: a.cost || 0,
        },
        {
          key: "requirements",
          label: "Requisitos (concessão pelo mestre)",
          value: a.requirements,
        },
      );
    edit(
      a.id ? "Editar" : "Cadastrar",
      fields,
      name === "Vantagens"
        ? "advantage"
        : name === "Itens"
          ? "item"
          : "creature",
      a.id ? { id: a.id } : {},
    );
  }
}
