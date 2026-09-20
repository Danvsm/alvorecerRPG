"use client";

import { useCallback, useEffect, useState } from "react";
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
  async function addReward() {
    const isValueReward = type === "xp" || type === "dracmas";
    if ((!isValueReward && !chosen) || (isValueReward && amount <= 0)) return;
    await act("reward_save", {
      rarity,
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
          <h4>Entregar Gemas</h4>
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
            <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
              {Object.entries(rarityNames).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
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
        {data?.rewards?.map((r: Row) => (
          <div className={styles.reward} key={r.id}>
            <div>
              <strong>{r.label}</strong>
              <small>
                {rarityNames[r.rarity]} · peso {r.weight} · {r.reward_type}
              </small>
            </div>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() =>
                act("reward_toggle", { id: r.id, active: !r.active })
              }
            >
              {r.active ? "Pausar" : "Ativar"}
            </button>
          </div>
        ))}
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
