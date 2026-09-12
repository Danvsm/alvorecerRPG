"use client";

import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Coins,
  Copy,
  HandCoins,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatDracmas, parseDracmas } from "@/lib/currency";
import type { Row } from "@/lib/types";

type Draft = {
  type: "send" | "charge";
  recipient: Row;
  sourceCharacterId?: string;
  amountCents: number;
  reason: string;
};

const transactionLabels: Row = {
  transfer: "Transferência",
  admin_adjustment: "Ajuste administrativo",
  purchase: "Compra",
  charge_payment: "Cobrança paga",
  reward: "Recompensa",
  reversal: "Estorno",
};
const chargeLabels: Row = {
  pending: "Pendente",
  paid: "Paga",
  refused: "Recusada",
  cancelled: "Cancelada",
};

export default function WalletPanel({
  master,
  currentUserId,
  masterBalance,
  characters,
  recipients,
  transactions,
  charges,
  avatarUrls,
  busy,
  transfer,
  wallet,
  adjust,
}: {
  master: boolean;
  currentUserId: string;
  masterBalance: number | string;
  characters: Row[];
  recipients: Row[];
  transactions: Row[];
  charges: Row[];
  avatarUrls: Record<string, string>;
  busy: boolean;
  transfer: (data: Row) => Promise<Row>;
  wallet: (operation: string, data: Row) => Promise<Row>;
  adjust: (data: Row) => Promise<Row>;
}) {
  const [mode, setMode] = useState<"send" | "charge" | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [recipientKey, setRecipientKey] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [proof, setProof] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(10);
  const [filter, setFilter] = useState("all");
  const [rewardCharacters, setRewardCharacters] = useState<string[]>([]);
  const [rewardMode, setRewardMode] = useState("each");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rewardReason, setRewardReason] = useState("");
  const [adjustTarget, setAdjustTarget] = useState("master");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const ownCharacters = useMemo(
    () =>
      characters.filter((character) => character.owner_id === currentUserId),
    [characters, currentUserId],
  );
  const source =
    ownCharacters.find((character) => character.id === sourceId) ||
    ownCharacters[0];
  const options = recipients.filter((recipient) => {
    if (recipient.user_id === currentUserId) return false;
    return master ? recipient.recipient_type === "player" : true;
  });
  const recipient =
    options.find(
      (option) =>
        `${option.recipient_type}:${option.character_id || option.user_id}` ===
        recipientKey,
    ) || options[0];
  const balance = master
    ? Number(masterBalance || 0)
    : Number(source?.dracmas_cents || 0);
  const incomingCharges = charges.filter(
    (charge) =>
      charge.target_user_id === currentUserId &&
      charge.status === "pending" &&
      !charge.archived_at,
  );
  const ownCharges = charges.filter(
    (charge) =>
      charge.requester_user_id === currentUserId ||
      charge.target_user_id === currentUserId,
  );
  const statement = transactions.filter((transaction) => {
    if (filter === "all") return true;
    const incoming = transaction.to_user_id === currentUserId;
    return filter === "in" ? incoming : !incoming;
  });

  const resetForm = () => {
    setAmount("");
    setReason("");
    setDraft(null);
    setError("");
  };
  const chooseMode = (next: "send" | "charge") => {
    resetForm();
    setMode(next);
  };
  const selectedRecipientUrl = recipient?.avatar_id
    ? avatarUrls[recipient.avatar_id]
    : "";

  return (
    <div className="wallet-page">
      <section className="wallet-hero">
        <div>
          <p className="eyebrow">CARTEIRA DE DRACMAS</p>
          <small>Saldo disponível</small>
          <strong>{formatDracmas(balance)}</strong>
        </div>
        <Coins size={34} />
        <div className="wallet-primary-actions">
          <button
            className={mode === "send" ? "primary" : ""}
            onClick={() => chooseMode("send")}
          >
            <Send size={17} /> Enviar
          </button>
          <button
            className={mode === "charge" ? "primary" : ""}
            onClick={() => chooseMode("charge")}
          >
            <HandCoins size={17} /> Cobrar
          </button>
        </div>
      </section>

      {proof && (
        <section className="panel wallet-proof" role="status">
          <div className="proof-mark">
            <Check size={22} />
          </div>
          <div>
            <p className="eyebrow">COMPROVANTE</p>
            <h2>
              {proof.kind === "reversal"
                ? "Estorno concluído"
                : "Movimentação concluída"}
            </h2>
            <p>
              {proof.from || "Sistema"} <ArrowRight size={14} />{" "}
              {proof.to || "Sistema"}
            </p>
            <strong>{formatDracmas(proof.amount_cents)}</strong>
            <small>
              {new Date(proof.created_at || Date.now()).toLocaleString("pt-BR")}
            </small>
            {proof.from_balance_after !== undefined &&
              proof.from_balance_after !== null && (
                <small>
                  Saldo após a operação:{" "}
                  {formatDracmas(proof.from_balance_after)}
                </small>
              )}
          </div>
          <div className="proof-actions">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(
                  `Comprovante Alvorecer\n${proof.from || "Sistema"} → ${proof.to || "Sistema"}\n${formatDracmas(proof.amount_cents)}\n${new Date(proof.created_at || Date.now()).toLocaleString("pt-BR")}`,
                );
              }}
            >
              <Copy size={15} /> Copiar
            </button>
            <button
              aria-label="Fechar comprovante"
              onClick={() => setProof(null)}
            >
              <X size={16} />
            </button>
          </div>
        </section>
      )}

      {mode && !proof && (
        <section className="panel wallet-operation">
          <div className="spread">
            <div>
              <p className="eyebrow">
                {mode === "send" ? "NOVA TRANSFERÊNCIA" : "NOVA COBRANÇA"}
              </p>
              <h2>{mode === "send" ? "Enviar Dracmas" : "Cobrar Dracmas"}</h2>
            </div>
            <button aria-label="Fechar" onClick={() => setMode(null)}>
              <X size={17} />
            </button>
          </div>
          {!draft ? (
            <form
              className="transfer-form"
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                try {
                  if (!recipient)
                    throw new Error("Nenhum destinatário disponível");
                  if (!master && !source)
                    throw new Error("Carteira indisponível");
                  const amountCents = parseDracmas(amount);
                  if (mode === "send" && amountCents > balance)
                    throw new Error("Saldo insuficiente");
                  setDraft({
                    type: mode,
                    recipient,
                    sourceCharacterId: source?.id,
                    amountCents,
                    reason: reason.trim(),
                  });
                } catch (caught) {
                  setError((caught as Error).message);
                }
              }}
            >
              {!master && ownCharacters.length > 1 && (
                <label>
                  Carteira
                  <select
                    value={source?.id || ""}
                    onChange={(event) => setSourceId(event.target.value)}
                  >
                    {ownCharacters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name} ·{" "}
                        {formatDracmas(character.dracmas_cents)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Destinatário
                <select
                  value={
                    recipient
                      ? `${recipient.recipient_type}:${recipient.character_id || recipient.user_id}`
                      : ""
                  }
                  onChange={(event) => setRecipientKey(event.target.value)}
                  required
                >
                  {options.map((option) => (
                    <option
                      key={`${option.recipient_type}:${option.character_id || option.user_id}`}
                      value={`${option.recipient_type}:${option.character_id || option.user_id}`}
                    >
                      {option.display_name} · @{option.username}
                    </option>
                  ))}
                </select>
              </label>
              {recipient && (
                <div className="wallet-recipient">
                  {selectedRecipientUrl ? (
                    <img src={selectedRecipientUrl} alt="" />
                  ) : (
                    <span>{recipient.display_name?.[0]}</span>
                  )}
                  <div>
                    <strong>{recipient.display_name}</strong>
                    <small>
                      @{recipient.username}
                      {recipient.recipient_type === "master" ? " · Mestre" : ""}
                    </small>
                  </div>
                </div>
              )}
              <label>
                Valor
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="25,50"
                  required
                />
              </label>
              <label className="transfer-reason">
                Descrição (opcional)
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={240}
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary" disabled={busy || !options.length}>
                Revisar {mode === "send" ? "transferência" : "cobrança"}
              </button>
            </form>
          ) : (
            <div className="transfer-review">
              <p className="eyebrow">CONFIRME OS DADOS</p>
              <div className="transfer-route">
                <div>
                  <small>De</small>
                  <strong>
                    {draft.type === "send"
                      ? master
                        ? "Pink"
                        : source?.name
                      : draft.recipient.display_name}
                  </strong>
                </div>
                <ArrowRight />
                <div>
                  <small>Para</small>
                  <strong>
                    {draft.type === "send"
                      ? draft.recipient.display_name
                      : master
                        ? "Pink"
                        : source?.name}
                  </strong>
                </div>
              </div>
              <strong className="transfer-amount">
                {formatDracmas(draft.amountCents)}
              </strong>
              {draft.reason && <p>{draft.reason}</p>}
              {draft.type === "send" && (
                <div className="balance-preview">
                  <span>
                    Saldo atual <b>{formatDracmas(balance)}</b>
                  </span>
                  <span>
                    Saldo após envio{" "}
                    <b>{formatDracmas(balance - draft.amountCents)}</b>
                  </span>
                </div>
              )}
              <div className="actions">
                <button disabled={busy} onClick={() => setDraft(null)}>
                  Voltar
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setError("");
                    try {
                      if (draft.type === "send") {
                        const result = await transfer({
                          source_character_id: draft.sourceCharacterId,
                          recipient_type: draft.recipient.recipient_type,
                          recipient_character_id: draft.recipient.character_id,
                          amount_cents: draft.amountCents,
                          reason: draft.reason,
                          request_id: crypto.randomUUID(),
                        });
                        setProof({
                          ...result,
                          kind: "transfer",
                          created_at: new Date().toISOString(),
                        });
                      } else {
                        await wallet("create_charge", {
                          source_character_id: draft.sourceCharacterId,
                          recipient_type: draft.recipient.recipient_type,
                          recipient_character_id: draft.recipient.character_id,
                          amount_cents: draft.amountCents,
                          reason: draft.reason,
                        });
                      }
                      resetForm();
                      if (draft.type === "charge") setMode(null);
                    } catch (caught) {
                      setError((caught as Error).message);
                    }
                  }}
                >
                  {draft.type === "send"
                    ? "Confirmar transferência"
                    : "Enviar cobrança"}
                </button>
              </div>
              {error && <p className="error">{error}</p>}
            </div>
          )}
        </section>
      )}

      {incomingCharges.length > 0 && (
        <section className="panel charge-inbox">
          <div className="spread">
            <div>
              <p className="eyebrow">A PAGAR</p>
              <h2>Cobranças recebidas</h2>
            </div>
            <span className="badge">{incomingCharges.length}</span>
          </div>
          {incomingCharges.map((charge) => (
            <div className="charge-row" key={charge.id}>
              <div>
                <strong>{charge.requester_label}</strong>
                <small>@{charge.requester_username}</small>
                <p>{charge.reason || "Sem descrição"}</p>
              </div>
              <b>{formatDracmas(charge.amount_cents)}</b>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    const result = await wallet("pay_charge", {
                      charge_id: charge.id,
                      request_id: crypto.randomUUID(),
                    });
                    setProof({
                      ...result,
                      kind: "charge_payment",
                      created_at: new Date().toISOString(),
                    });
                  }}
                >
                  Pagar
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void wallet("refuse_charge", { charge_id: charge.id })
                  }
                >
                  Recusar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {master && (
        <div className="wallet-admin-grid">
          <details className="panel reward-panel">
            <summary>
              <HandCoins size={18} /> Distribuir recompensa
            </summary>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const amountCents = parseDracmas(rewardAmount);
                if (!rewardCharacters.length)
                  return setError("Selecione ao menos um personagem");
                const description =
                  rewardMode === "split"
                    ? `Dividir ${formatDracmas(amountCents)} entre ${rewardCharacters.length} personagens?`
                    : `Dar ${formatDracmas(amountCents)} para cada personagem selecionado?`;
                if (!confirm(description)) return;
                await wallet("distribute_reward", {
                  character_ids: rewardCharacters,
                  mode: rewardMode,
                  amount_cents: amountCents,
                  reason: rewardReason,
                  request_id: crypto.randomUUID(),
                });
                setRewardAmount("");
                setRewardReason("");
                setRewardCharacters([]);
              }}
            >
              <div className="reward-grid">
                {characters
                  .filter((character) => !character.archived)
                  .map((character) => (
                    <label className="check-line" key={character.id}>
                      <input
                        type="checkbox"
                        checked={rewardCharacters.includes(character.id)}
                        onChange={(event) =>
                          setRewardCharacters((current) =>
                            event.target.checked
                              ? [...current, character.id]
                              : current.filter((id) => id !== character.id),
                          )
                        }
                      />{" "}
                      {character.name}
                    </label>
                  ))}
              </div>
              <div className="transfer-form">
                <label>
                  Forma
                  <select
                    value={rewardMode}
                    onChange={(event) => setRewardMode(event.target.value)}
                  >
                    <option value="each">Dar para cada selecionado</option>
                    <option value="split">Dividir igualmente</option>
                  </select>
                </label>
                <label>
                  Valor
                  <input
                    value={rewardAmount}
                    onChange={(event) => setRewardAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="1.000,00"
                    required
                  />
                </label>
                <label className="transfer-reason">
                  Motivo
                  <input
                    value={rewardReason}
                    onChange={(event) => setRewardReason(event.target.value)}
                    maxLength={240}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Distribuir
                </button>
              </div>
            </form>
          </details>
          <details className="panel reward-panel">
            <summary>
              <Coins size={18} /> Ajuste administrativo
            </summary>
            <form
              className="transfer-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const deltaCents = parseDracmas(adjustAmount, true);
                if (!deltaCents)
                  return setError("Informe um valor diferente de zero");
                if (
                  deltaCents < 0 &&
                  !confirm(`Remover ${formatDracmas(Math.abs(deltaCents))}?`)
                )
                  return;
                await adjust({
                  target_type:
                    adjustTarget === "master" ? "master" : "character",
                  target_character_id:
                    adjustTarget === "master" ? undefined : adjustTarget,
                  delta_cents: deltaCents,
                  reason: adjustReason,
                  request_id: crypto.randomUUID(),
                });
                setAdjustAmount("");
                setAdjustReason("");
              }}
            >
              <label>
                Carteira
                <select
                  value={adjustTarget}
                  onChange={(event) => setAdjustTarget(event.target.value)}
                >
                  <option value="master">Pink · Mestre</option>
                  {characters
                    .filter((character) => !character.archived)
                    .map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Adicionar ou remover
                <input
                  value={adjustAmount}
                  onChange={(event) => setAdjustAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="100,00 ou -25,50"
                  required
                />
              </label>
              <label className="transfer-reason">
                Motivo
                <input
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  required
                  maxLength={240}
                />
              </label>
              <button className="primary" disabled={busy}>
                Aplicar ajuste
              </button>
            </form>
          </details>
        </div>
      )}

      <section className="panel wallet-statement">
        <div className="spread">
          <div>
            <p className="eyebrow">EXTRATO</p>
            <h2>Últimas movimentações</h2>
          </div>
          <select
            aria-label="Filtrar extrato"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setVisible(10);
            }}
          >
            <option value="all">Todas</option>
            <option value="in">Entradas</option>
            <option value="out">Saídas</option>
          </select>
        </div>
        {statement.slice(0, visible).map((transaction) => {
          const incoming = transaction.to_user_id === currentUserId;
          return (
            <div className="statement-row" key={transaction.id}>
              <span
                className={`statement-icon ${incoming ? "income" : "expense"}`}
              >
                {incoming ? (
                  <ArrowDownLeft size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </span>
              <div>
                <strong>
                  {transactionLabels[transaction.kind] || "Movimentação"}
                </strong>
                <p>
                  {transaction.reason ||
                    `${transaction.from_label || "Sistema"} → ${transaction.to_label || "Sistema"}`}
                </p>
                <small>
                  {new Date(transaction.created_at).toLocaleString("pt-BR")}
                </small>
              </div>
              <b className={incoming ? "income-text" : "expense-text"}>
                {incoming ? "+" : "−"}
                {formatDracmas(transaction.amount_cents)}
              </b>
              {master &&
                !["reversal", "purchase"].includes(transaction.kind) &&
                !transaction.reversed_at && (
                  <button
                    className="icon-action"
                    aria-label="Estornar movimentação"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !confirm(
                          `Estornar ${formatDracmas(transaction.amount_cents)}? A movimentação original será preservada.`,
                        )
                      )
                        return;
                      const result = await wallet("reverse_transaction", {
                        transaction_id: transaction.id,
                        reason: "Estorno pelo Mestre",
                        request_id: crypto.randomUUID(),
                      });
                      setProof({
                        ...result,
                        kind: "reversal",
                        created_at: new Date().toISOString(),
                      });
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
            </div>
          );
        })}
        {!statement.length && (
          <p className="muted">Nenhuma movimentação registrada.</p>
        )}
        {visible < statement.length && (
          <button
            className="load-more"
            onClick={() => setVisible((value) => value + 10)}
          >
            Carregar mais
          </button>
        )}
      </section>

      {ownCharges.length > 0 && (
        <details className="panel charge-history">
          <summary>Histórico de cobranças</summary>
          {ownCharges.slice(0, 20).map((charge) => (
            <div className="list-row" key={charge.id}>
              <div>
                <strong>
                  {charge.requester_label} → {charge.target_label}
                </strong>
                <p>{charge.reason}</p>
              </div>
              <span>
                <b>{formatDracmas(charge.amount_cents)}</b> ·{" "}
                {chargeLabels[charge.status]}
              </span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
