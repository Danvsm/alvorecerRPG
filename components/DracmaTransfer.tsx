"use client";

import { ArrowRight, Coins, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDracmas, parseDracmas } from "@/lib/currency";
import type { Row } from "@/lib/types";

type Review = {
  recipient: Row;
  sourceCharacterId?: string;
  amountCents: number;
  reason: string;
};

export default function DracmaTransfer({
  master,
  currentUserId,
  masterBalance,
  characters,
  recipients,
  transactions,
  busy,
  send,
}: {
  master: boolean;
  currentUserId: string;
  masterBalance: number | string;
  characters: Row[];
  recipients: Row[];
  transactions: Row[];
  busy: boolean;
  send: (data: Row) => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState("");
  const [recipientKey, setRecipientKey] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");

  const ownCharacters = useMemo(
    () => characters.filter((ch) => ch.owner_id === currentUserId),
    [characters, currentUserId],
  );
  const source =
    ownCharacters.find((ch) => ch.id === sourceId) || ownCharacters[0];
  const options = useMemo(
    () =>
      recipients.filter((recipient) => {
        if (recipient.user_id === currentUserId) return false;
        return master ? recipient.recipient_type === "player" : true;
      }),
    [recipients, currentUserId, master],
  );
  const recipient =
    options.find(
      (option) =>
        `${option.recipient_type}:${option.character_id || option.user_id}` ===
        recipientKey,
    ) || options[0];
  const balance = master
    ? Number(masterBalance || 0)
    : Number(source?.dracmas_cents || 0);

  useEffect(() => {
    if (!sourceId && ownCharacters[0]) setSourceId(ownCharacters[0].id);
  }, [sourceId, ownCharacters]);
  useEffect(() => {
    if (!recipientKey && options[0])
      setRecipientKey(
        `${options[0].recipient_type}:${options[0].character_id || options[0].user_id}`,
      );
  }, [recipientKey, options]);

  return (
    <section className="panel dracma-panel">
      <div className="spread">
        <div>
          <p className="eyebrow">CARTEIRA</p>
          <h2>Transferir Dracmas</h2>
        </div>
        <div className="wallet-balance">
          <Coins size={20} />
          <strong>{formatDracmas(balance)}</strong>
        </div>
      </div>

      {!review ? (
        <form
          className="transfer-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            try {
              if (!recipient) throw new Error("Nenhum destinatário disponível");
              if (!master && !source)
                throw new Error("Conta de origem indisponível");
              const amountCents = parseDracmas(amount);
              if (amountCents <= 0)
                throw new Error("Informe um valor maior que zero");
              if (amountCents > balance) throw new Error("Saldo insuficiente");
              setReview({
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
              Enviar de
              <select
                value={source?.id || ""}
                onChange={(event) => setSourceId(event.target.value)}
              >
                {ownCharacters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name} · {formatDracmas(character.dracmas_cents)}
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
                  {option.display_name}
                  {option.recipient_type === "master" ? " · Mestre" : ""}
                </option>
              ))}
            </select>
          </label>
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
            Motivo ou descrição (opcional)
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={240}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy || !options.length}>
            <Send size={17} /> Revisar transferência
          </button>
        </form>
      ) : (
        <div className="transfer-review">
          <p className="eyebrow">CONFIRME ANTES DE ENVIAR</p>
          <div className="transfer-route">
            <div>
              <small>De</small>
              <strong>{master ? "Pink" : source?.name}</strong>
            </div>
            <ArrowRight />
            <div>
              <small>Para</small>
              <strong>{review.recipient.display_name}</strong>
            </div>
          </div>
          <strong className="transfer-amount">
            {formatDracmas(review.amountCents)}
          </strong>
          {review.reason && <p>{review.reason}</p>}
          <div className="actions">
            <button disabled={busy} onClick={() => setReview(null)}>
              Voltar
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  await send({
                    source_character_id: review.sourceCharacterId,
                    recipient_type: review.recipient.recipient_type,
                    recipient_character_id: review.recipient.character_id,
                    amount_cents: review.amountCents,
                    reason: review.reason,
                    request_id: crypto.randomUUID(),
                  });
                  setAmount("");
                  setReason("");
                  setReview(null);
                } catch (caught) {
                  setError((caught as Error).message);
                }
              }}
            >
              Confirmar transferência
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      <div className="transfer-history">
        <h3>Últimas movimentações</h3>
        {transactions.slice(0, 10).map((transaction) => (
          <div className="transfer-history-row" key={transaction.id}>
            <div>
              <strong>
                {transaction.from_label || "Sistema"} <ArrowRight size={14} />{" "}
                {transaction.to_label || "Sistema"}
              </strong>
              <small>
                {new Date(transaction.created_at).toLocaleString("pt-BR")}
              </small>
              {transaction.reason && <p>{transaction.reason}</p>}
            </div>
            <b>{formatDracmas(transaction.amount_cents)}</b>
          </div>
        ))}
        {!transactions.length && (
          <p className="muted">Nenhuma movimentação registrada.</p>
        )}
      </div>
    </section>
  );
}
