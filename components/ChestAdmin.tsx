"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage } from "@/lib/network";
import styles from "./ChestAdmin.module.css";

type Row = Record<string, any>;
const rarityNames: Record<string, string> = {
  common: "Comum",
  uncommon: "Incomum",
  rare: "Rara",
  epic: "Épica",
  legendary: "Lendária",
};
const typeNames: Record<string, string> = {
  frame: "Moldura",
  avatar: "Avatar",
  xp: "XP",
  dracmas: "Dracmas",
};
export default function ChestAdmin({ campaign }: { campaign: string }) {
  const [data, setData] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [cost, setCost] = useState(30),
    [enabled, setEnabled] = useState(true),
    [odds, setOdds] = useState<Record<string, number>>({});
  const [player, setPlayer] = useState(""),
    [delta, setDelta] = useState(30),
    [type, setType] = useState("frame"),
    [asset, setAsset] = useState(""),
    [rarity, setRarity] = useState("rare"),
    [weight, setWeight] = useState(1),
    [amount, setAmount] = useState(100);
  const [rewardSearch, setRewardSearch] = useState(""),
    [rewardRarity, setRewardRarity] = useState("all"),
    [rewardType, setRewardType] = useState("all"),
    [rewardStatus, setRewardStatus] = useState("all");
  const load = useCallback(async () => {
    const r = await browserDb().rpc("chest_admin_dashboard", { c: campaign });
    if (r.error) throw r.error;
    setData(r.data);
    setCost(r.data.settings.cost_gems);
    setEnabled(r.data.settings.enabled);
    setOdds(
      Object.fromEntries(
        r.data.odds.map((o: Row) => [o.rarity, o.weight_bp / 100]),
      ),
    );
  }, [campaign]);
  useEffect(() => {
    load().catch((e) => setError(readableErrorMessage(e)));
  }, [load]);
  async function act(op: string, d: Row) {
    setBusy(true);
    setError("");
    try {
      const r = await browserDb().rpc("chest_admin_action", {
        c: campaign,
        op,
        d,
      });
      if (r.error) throw r.error;
      await load();
    } catch (e) {
      setError(readableErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveConfig() {
    await act("settings", { cost_gems: cost, enabled });
  }
  async function saveOdds() {
    await act(
      "odds",
      Object.fromEntries(
        Object.entries(odds).map(([k, v]) => [k, Math.round(Number(v) * 100)]),
      ),
    );
  }
  const assets = type === "avatar" ? data?.avatars || [] : data?.frames || [];
  const chosen = assets.find((a: Row) => a.id === asset);
  const itemRarity = chosen?.rarity || rarity;
  const rewards = useMemo(() => data?.rewards || [], [data?.rewards]);
  const rarityWeightTotals = useMemo(
    () =>
      rewards.reduce((totals: Record<string, number>, reward: Row) => {
        if (reward.active) {
          totals[reward.rarity] =
            (totals[reward.rarity] || 0) + Number(reward.weight || 0);
        }
        return totals;
      }, {}),
    [rewards],
  );
  const filteredRewards = useMemo(() => {
    const query = rewardSearch.trim().toLocaleLowerCase("pt-BR");
    return rewards.filter((reward: Row) => {
      const matchesSearch =
        !query || reward.label.toLocaleLowerCase("pt-BR").includes(query);
      const matchesRarity =
        rewardRarity === "all" || reward.rarity === rewardRarity;
      const matchesType =
        rewardType === "all" || reward.reward_type === rewardType;
      const matchesStatus =
        rewardStatus === "all" ||
        (rewardStatus === "active" && reward.active) ||
        (rewardStatus === "paused" && !reward.active && !reward.claimed_at) ||
        (rewardStatus === "claimed" && Boolean(reward.claimed_at));
      return matchesSearch && matchesRarity && matchesType && matchesStatus;
    });
  }, [rewardRarity, rewardSearch, rewardStatus, rewardType, rewards]);
  function rewardChance(reward: Row) {
    if (!reward.active) return 0;
    const total = rarityWeightTotals[reward.rarity] || 0;
    if (!total) return 0;
    return ((odds[reward.rarity] || 0) * Number(reward.weight || 0)) / total;
  }
  async function addReward() {
    const isValueReward = type === "xp" || type === "dracmas";
    if ((!isValueReward && !chosen) || (isValueReward && amount <= 0)) return;
    await act("reward_save", {
      rarity: itemRarity,
      reward_type: type,
      label: isValueReward
        ? `${amount.toLocaleString("pt-BR")} ${type === "xp" ? "XP" : "Dracmas"}`
        : chosen.name,
      amount: isValueReward ? amount : null,
      weight,
      avatar_id: type === "avatar" ? asset : null,
      cosmetic_id: type === "frame" ? asset : null,
    });
    setAsset("");
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        <section className={styles.card}>
          <h4>Funcionamento</h4>
          <label className={styles.field}>
            Custo por abertura
            <input
              type="number"
              min="1"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
            />
          </label>
          <label className={styles.row}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Baú disponível
          </label>
          <p>
            <button
              className={styles.button}
              disabled={busy}
              onClick={saveConfig}
            >
              Salvar funcionamento
            </button>
          </p>
        </section>
        <section className={styles.card}>
          <div className={styles.gemHeading}>
            <Image
              src="/treasure/gems.webp"
              width={72}
              height={59}
              alt="Gemas"
              priority
            />
            <div>
              <h4>Entregar Gemas</h4>
              <small>Moeda exclusiva do Baú Dourado</small>
            </div>
          </div>
          <label className={styles.field}>
            Jogador
            <select value={player} onChange={(e) => setPlayer(e.target.value)}>
              <option value="">Selecione</option>
              {data?.players?.map((p: Row) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name} · {p.gems} Gemas
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Quantidade (+ entrega, − remove)
            <input
              type="number"
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
            />
          </label>
          <button
            className={styles.button}
            disabled={busy || !player || !delta}
            onClick={() => act("adjust_gems", { user_id: player, delta })}
          >
            Aplicar ajuste
          </button>
        </section>
      </div>
      <section className={styles.card}>
        <h4>Probabilidade por raridade</h4>
        <div className={styles.odds}>
          {Object.keys(rarityNames).map((r) => (
            <label className={styles.field} key={r}>
              {rarityNames[r]} (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={odds[r] ?? 0}
                onChange={(e) =>
                  setOdds((o) => ({ ...o, [r]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
        </div>
        <div className={styles.row}>
          <button className={styles.button} disabled={busy} onClick={saveOdds}>
            Salvar probabilidades
          </button>
          <small>
            Total:{" "}
            {Object.values(odds)
              .reduce((a, b) => a + Number(b), 0)
              .toFixed(2)}
            %
          </small>
        </div>
      </section>
      <section className={styles.card}>
        <h4>Prêmios que podem sair</h4>
        <p>Evento, Apoiador e Mestre são bloqueados automaticamente.</p>
        <div className={styles.grid}>
          <label className={styles.field}>
            Tipo
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setAsset("");
              }}
            >
              <option value="frame">Moldura</option>
              <option value="avatar">Avatar</option>
              <option value="xp">XP</option>
              <option value="dracmas">Dracmas</option>
            </select>
          </label>
          {type === "xp" || type === "dracmas" ? (
            <label className={styles.field}>
              Quantidade
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>
          ) : (
            <label className={styles.field}>
              Item
              <select value={asset} onChange={(e) => setAsset(e.target.value)}>
                <option value="">Selecione</option>
                {assets.map((a: Row) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.rarity ? ` · ${rarityNames[a.rarity] || a.rarity}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.field}>
            Raridade do prêmio
            <select
              value={type === "frame" || type === "avatar" ? itemRarity : rarity}
              disabled={type === "frame" || type === "avatar"}
              onChange={(e) => setRarity(e.target.value)}
            >
              {Object.entries(rarityNames).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
            {(type === "frame" || type === "avatar") && (
              <small>A raridade vem da galeria do item.</small>
            )}
          </label>
          <label className={styles.field}>
            Peso dentro da raridade
            <input
              type="number"
              min="1"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          className={styles.button}
          disabled={
            busy ||
            ((type === "avatar" || type === "frame") && !asset) ||
            ((type === "xp" || type === "dracmas") && amount <= 0)
          }
          onClick={addReward}
        >
          Adicionar ao Baú
        </button>
      </section>
      <section className={styles.card}>
        <h4>Prêmios configurados</h4>
        <div className={styles.filters}>
          <label className={styles.field}>
            Buscar
            <input
              type="search"
              placeholder="Nome do prêmio"
              value={rewardSearch}
              onChange={(event) => setRewardSearch(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            Raridade
            <select
              value={rewardRarity}
              onChange={(event) => setRewardRarity(event.target.value)}
            >
              <option value="all">Todas</option>
              {Object.entries(rarityNames).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Tipo
            <select
              value={rewardType}
              onChange={(event) => setRewardType(event.target.value)}
            >
              <option value="all">Todos</option>
              {Object.entries(typeNames).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Status
            <select
              value={rewardStatus}
              onChange={(event) => setRewardStatus(event.target.value)}
            >
              <option value="all">Todos</option>
              <option value="active">Ativos</option>
              <option value="paused">Pausados</option>
              <option value="claimed">Conquistados</option>
            </select>
          </label>
        </div>
        <p className={styles.probabilityNote}>
          Chance base considera a raridade e o peso do prêmio. Para cosméticos,
          a chance individual pode aumentar quando itens já possuídos saem do
          sorteio.
        </p>
        {filteredRewards.map((r: Row) => (
          <div className={styles.reward} key={r.id}>
            <div className={styles.rewardName}>
              <strong>{r.label}</strong>
              <small>
                {rarityNames[r.rarity]} · peso {r.weight}
              </small>
              {r.claimed_at && (
                <small>
                  Conquistado por {r.claimed_name || r.claimed_username} em{" "}
                  {new Date(r.claimed_at).toLocaleDateString("pt-BR")}
                </small>
              )}
            </div>
            <div className={styles.rewardInfo}>
              <span className={styles.badge}>{typeNames[r.reward_type]}</span>
              <span className={styles.chance}>
                <strong>
                  {rewardChance(r).toLocaleString("pt-BR", {
                    maximumFractionDigits: 3,
                  })}
                  %
                </strong>
                chance base
              </span>
            </div>
            <div className={styles.rewardActions}>
              <button
                className={styles.button}
                disabled={busy || Boolean(r.claimed_at)}
                onClick={() =>
                  act("reward_toggle", { id: r.id, active: !r.active })
                }
              >
                {r.active ? "Pausar" : "Ativar"}
              </button>
              {r.claimed_at && r.rarity === "legendary" && (
                <button
                  className={styles.button}
                  disabled={busy}
                  onClick={() => act("reward_release", { id: r.id })}
                >
                  Liberar novamente
                </button>
              )}
              <button
                className={styles.deleteButton}
                disabled={busy}
                onClick={() => act("reward_delete", { id: r.id })}
                aria-label={`Excluir ${r.label}`}
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
        {!filteredRewards.length && (
          <p className={styles.empty}>Nenhum prêmio corresponde aos filtros.</p>
        )}
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
