"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Gift, Sparkles, X } from "lucide-react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";
import { playChestReveal } from "@/lib/site-sounds";
import styles from "./TreasureChest.module.css";

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type Dashboard = {
  gems: number;
  pending_xp: number;
  pending_dracmas: number;
  cost_gems: number;
  enabled: boolean;
  odds: { rarity: Rarity; weight_bp: number }[];
  characters: { id: string; name: string }[];
  recipients: { user_id: string; name: string }[];
  gifts: {
    id: string;
    message: string;
    sender_name: string;
    created_at: string;
  }[];
  history: Opening[];
};
type Opening = {
  id: string;
  rarity: Rarity;
  reward_type: string;
  reward_label: string;
  reward_amount?: number;
  cost_gems: number;
  created_at: string;
  gifted?: boolean;
  gems?: number;
  pending?: boolean;
  avatar_id?: string;
  cosmetic_id?: string;
};
const rarityName: Record<Rarity, string> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Raro",
  epic: "Épico",
  legendary: "Lendário",
};

export default function TreasureChest({
  campaign,
  urls,
  onChanged,
}: {
  campaign: string;
  urls: Record<string, string>;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "shaking" | "opened">("idle");
  const [result, setResult] = useState<Opening | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [character, setCharacter] = useState("");
  const load = useCallback(async () => {
    const response = await browserDb().rpc("chest_dashboard", { c: campaign });
    if (response.error) throw response.error;
    const next = response.data as Dashboard;
    setData(next);
    setCharacter((v) => v || next.characters?.[0]?.id || "");
  }, [campaign]);
  useEffect(() => {
    load().catch((e) => setError(readableErrorMessage(e)));
  }, [load]);
  const canOpen = Boolean(
    data?.enabled && !busy && (data?.gems || 0) >= (data?.cost_gems || 30),
  );
  const remaining = useMemo(
    () => Math.max(0, (data?.cost_gems || 30) - (data?.gems || 0)),
    [data],
  );
  const isCosmeticReward =
    result?.reward_type === "avatar" || result?.reward_type === "frame";
  const rewardAssetId =
    result?.reward_type === "avatar"
      ? result.avatar_id
      : result?.reward_type === "frame"
        ? result.cosmetic_id
        : undefined;
  const rewardImage = rewardAssetId ? urls[rewardAssetId] : undefined;
  async function openChest(giftId?: string) {
    setBusy(true);
    setError("");
    setResult(null);
    setPhase("shaking");
    try {
      const requestId = crypto.randomUUID();
      const [response] = await Promise.all([
        browserDb().rpc("chest_open", {
          c: campaign,
          selected_character: character || null,
          gift: giftId || null,
          request_id: requestId,
        }),
        new Promise((r) => setTimeout(r, 1450)),
      ]);
      if (response.error) throw response.error;
      const won = response.data as Opening;
      setResult(won);
      setPhase("opened");
      void playChestReveal(won.rarity);
      await load();
      onChanged?.();
    } catch (e) {
      setPhase("idle");
      setError(readableErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendGift() {
    if (!recipient) return;
    setBusy(true);
    setError("");
    try {
      const response = await browserDb().rpc("chest_gift", {
        c: campaign,
        recipient,
        gift_message: message,
        request_id: crypto.randomUUID(),
      });
      if (response.error) throw response.error;
      setGiftOpen(false);
      setRecipient("");
      setMessage("");
      await load();
      onChanged?.();
    } catch (e) {
      setError(readableErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setResult(null);
    setPhase("idle");
  }
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Tesouros de Alvorecer</p>
        <h2 className={styles.title}>Baú Dourado</h2>
        <div className={styles.balance}>
          <Image
            src="/treasure/gems.webp"
            width={34}
            height={28}
            alt=""
            aria-hidden="true"
            priority
          />
          {data?.gems ?? "—"} Gemas
        </div>
        <div
          className={`${styles.chestStage} ${styles[phase]} ${result?.rarity === defaultLegendary ? styles.legendary : ""}`}
        >
          <div className={styles.glow} />
          <div className={styles.particles}>
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className={styles.chest} aria-label="Baú dourado">
            <div className={styles.lid} />
            <div className={styles.base} />
            <div className={styles.band} />
            <div className={styles.lock} />
          </div>
          {result && (
            <div
              className={`${styles.result} ${isCosmeticReward ? styles.cosmeticResult : ""}`}
            >
              {isCosmeticReward && (
                <>
                  <div className={styles.prizeRays} aria-hidden="true" />
                  <div className={styles.prizeSparkles} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </>
              )}
              <button
                className={styles.close}
                onClick={reset}
                aria-label="Fechar"
              >
                <X />
              </button>
              <span className={`${styles.rarity} ${styles[result.rarity]}`}>
                {rarityName[result.rarity]}
              </span>
              {isCosmeticReward && (
                <strong className={styles.extraordinary}>
                  Prêmio extraordinário
                </strong>
              )}
              {isCosmeticReward && rewardImage && (
                // URLs do Storage podem mudar de origem, então a prévia usa img.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className={styles.prizeImage}
                  src={rewardImage}
                  alt={result.reward_label}
                />
              )}
              <h3>{result.reward_label}</h3>
              <p>
                {result.pending
                  ? "Prêmio guardado na sua conta até você possuir um personagem."
                  : "O prêmio já foi entregue."}
              </p>
            </div>
          )}
        </div>
        {data && data.characters.length > 1 && (
          <label className={styles.characterSelect}>
            <select
              value={character}
              onChange={(e) => setCharacter(e.target.value)}
              aria-label="Personagem que receberá o prêmio"
            >
              {data.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={!canOpen}
            onClick={() => openChest()}
          >
            <Sparkles size={18} />{" "}
            {result
              ? `Abrir outro por ${data?.cost_gems} Gemas`
              : `Abrir por ${data?.cost_gems ?? 30} Gemas`}
          </button>
          <button
            className={styles.secondary}
            disabled={
              busy ||
              !data?.enabled ||
              (data?.gems || 0) < (data?.cost_gems || 30)
            }
            onClick={() => setGiftOpen(true)}
          >
            <Gift size={18} /> Presentear
          </button>
        </div>
        <p className={styles.hint}>
          {!data?.characters?.length
            ? "Você pode abrir normalmente. XP e Dracmas ficarão guardados até você possuir um personagem."
            : remaining > 0
              ? `Faltam ${remaining} Gemas para a próxima abertura.`
              : "Cada abertura entrega um prêmio imediatamente. Cosméticos não se repetem."}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      {Boolean(data?.pending_xp || data?.pending_dracmas) && (
        <section className={styles.section}>
          <h3>Prêmios guardados</h3>
          <p className={styles.hint}>
            {data?.pending_xp
              ? `${data.pending_xp.toLocaleString("pt-BR")} XP`
              : ""}
            {data?.pending_xp && data?.pending_dracmas ? " · " : ""}
            {data?.pending_dracmas
              ? `${data.pending_dracmas.toLocaleString("pt-BR")} Dracmas`
              : ""}
          </p>
          <p className={styles.hint}>
            A entrega será automática quando um personagem for vinculado à sua
            conta.
          </p>
        </section>
      )}
      {!!data?.gifts?.length && (
        <section className={styles.section}>
          <h3>Presentes esperando por você</h3>
          {data.gifts.map((g) => (
            <div className={styles.gift} key={g.id}>
              <div>
                <strong>Baú de {g.sender_name}</strong>
                {g.message && <p>“{g.message}”</p>}
              </div>
              <button
                className={styles.small}
                disabled={busy}
                onClick={() => openChest(g.id)}
              >
                Abrir grátis
              </button>
            </div>
          ))}
        </section>
      )}
      <section className={styles.section}>
        <h3>Chances por raridade</h3>
        <div className={styles.odds}>
          {data?.odds?.map((o) => (
            <div key={o.rarity}>
              <span className={styles[o.rarity]}>{rarityName[o.rarity]}</span>
              <strong>
                {(o.weight_bp / 100).toFixed(o.weight_bp % 100 ? 2 : 0)}%
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.section}>
        <h3>Seus tesouros recentes</h3>
        <div className={styles.history}>
          {data?.history?.length ? (
            data.history.map((h) => (
              <div className={styles.historyItem} key={h.id}>
                <div>
                  <strong>{h.reward_label}</strong>
                  <small>
                    {new Date(h.created_at).toLocaleDateString("pt-BR")}
                    {h.gifted ? " · presente" : ""}
                  </small>
                </div>
                <span className={`${styles.rarity} ${styles[h.rarity]}`}>
                  {rarityName[h.rarity]}
                </span>
              </div>
            ))
          ) : (
            <p className={styles.hint}>
              Seu primeiro tesouro ainda espera por você.
            </p>
          )}
        </div>
      </section>
      {giftOpen && (
        <div className={styles.modal} role="dialog" aria-modal="true">
          <div className={styles.sheet}>
            <button
              className={styles.close}
              onClick={() => setGiftOpen(false)}
              aria-label="Fechar"
            >
              <X />
            </button>
            <h3>Presentear um Baú</h3>
            <p className={styles.hint}>
              O presente custa {data?.cost_gems} Gemas agora. Quem receber abre
              sem pagar.
            </p>
            <label>
              Jogador
              <select
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              >
                <option value="">Selecione</option>
                {data?.recipients?.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mensagem
              <textarea
                maxLength={300}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Uma mensagem para acompanhar o presente…"
              />
            </label>
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                onClick={() => setGiftOpen(false)}
              >
                Cancelar
              </button>
              <button
                className={styles.primary}
                disabled={!recipient || busy}
                onClick={sendGift}
              >
                Enviar por {data?.cost_gems} Gemas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const defaultLegendary = "legendary";
