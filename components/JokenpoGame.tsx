"use client";

import { useEffect, useRef, useState } from "react";
import { formatDracmas } from "@/lib/currency";
import styles from "./JokenpoGame.module.css";

type Choice = "pedra" | "papel" | "tesoura";
type Outcome = "vitoria" | "derrota" | "empate";
type Phase = "intro" | "choice" | "counting" | "result" | "reaction" | "replay";

export type JokenpoRound = {
  tavern_choice: Choice;
  outcome: Outcome;
  bet_cents: number;
  net_delta_cents: number;
  balance_after: number;
};

type JokenpoGameProps = {
  balanceCents: number;
  unavailableReason?: string;
  playRound: (
    choice: Choice,
    betCents: number,
    requestId: string,
  ) => Promise<JokenpoRound>;
};

const choices: Choice[] = ["pedra", "papel", "tesoura"];
const labels: Record<Choice, string> = {
  pedra: "Pedra",
  papel: "Papel",
  tesoura: "Tesoura",
};
const assets = [
  "intro",
  "escolha",
  "jo",
  "ken",
  "po",
  "subida-meio",
  "subida-topo",
  "descida-meio",
  "contato",
  "pedra",
  "papel",
  "tesoura",
  "personagem-vence",
  "personagem-perde",
  "empate",
  "reacao-vitoria",
  "reacao-derrota",
  "reacao-empate",
  "revanche",
].map((name) => `/jokenpo/${name}.webp`);

function reactionFrames(outcome: Outcome) {
  if (outcome === "vitoria") {
    return ["/jokenpo/reacao-vitoria.webp", "/jokenpo/personagem-perde.webp"];
  }
  if (outcome === "derrota") {
    return ["/jokenpo/reacao-derrota.webp", "/jokenpo/personagem-vence.webp"];
  }
  return ["/jokenpo/reacao-empate.webp", "/jokenpo/empate.webp"];
}

export default function JokenpoGame({
  balanceCents,
  unavailableReason,
  playRound,
}: JokenpoGameProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [frame, setFrame] = useState("/jokenpo/intro.webp");
  const [status, setStatus] = useState("O taverneiro espera pelo seu desafio.");
  const [player, setPlayer] = useState<Choice>();
  const [character, setCharacter] = useState<Choice>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [burstWord, setBurstWord] = useState("");
  const [betDracmas, setBetDracmas] = useState(200);
  const [displayBalance, setDisplayBalance] = useState(balanceCents);
  const [roundDelta, setRoundDelta] = useState<number>();
  const [roundBet, setRoundBet] = useState<number>();
  const [roundError, setRoundError] = useState("");
  const runRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const musicRef = useRef<HTMLAudioElement>(null);
  const fadeRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const maximumBetCents = Math.min(
    200000,
    Math.max(20000, Math.floor(displayBalance / 1000) * 100),
  );
  const selectedBetCents = betDracmas * 100;
  const canBet =
    !unavailableReason &&
    displayBalance >= 20000 &&
    selectedBetCents >= 20000 &&
    selectedBetCents <= maximumBetCents &&
    selectedBetCents <= displayBalance;

  useEffect(() => {
    assets.forEach((src) => {
      const image = new window.Image();
      image.src = src;
    });
    const timers = timersRef.current;
    return () => {
      runRef.current += 1;
      timers.forEach(clearTimeout);
      timers.clear();
      if (fadeRef.current) clearInterval(fadeRef.current);
      musicRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    setDisplayBalance(balanceCents);
  }, [balanceCents]);

  async function startMusic() {
    const music = musicRef.current;
    if (!music || !music.paused) return;
    if (fadeRef.current) clearInterval(fadeRef.current);
    music.volume = 0;
    music.loop = true;
    try {
      await music.play();
      fadeRef.current = setInterval(() => {
        if (!musicRef.current) return;
        musicRef.current.volume = Math.min(0.12, musicRef.current.volume + 0.015);
        if (musicRef.current.volume >= 0.12 && fadeRef.current) {
          clearInterval(fadeRef.current);
          fadeRef.current = undefined;
        }
      }, 90);
    } catch {}
  }

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        resolve();
      }, ms);
      timersRef.current.add(timer);
    });
  }

  function cancelTimeline() {
    runRef.current += 1;
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    setBurstWord("");
  }

  async function show(
    run: number,
    src: string,
    text: string,
    duration: number,
  ) {
    if (runRef.current !== run) return false;
    setFrame(src);
    setStatus(text);
    await wait(duration);
    return runRef.current === run;
  }

  async function bounce(run: number, cycles = 1) {
    const steps: Array<[string, number]> = [
      ["subida-meio", 90],
      ["subida-topo", 125],
      ["descida-meio", 90],
      ["contato", 110],
    ];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      for (const [name, duration] of steps) {
        const active = await show(
          run,
          `/jokenpo/${name}.webp`,
          cycle > 0 ? "O suspense aumenta..." : "A mão sobe e desce...",
          duration,
        );
        if (!active) return false;
      }
    }
    return true;
  }

  async function play(choice: Choice) {
    cancelTimeline();
    const run = runRef.current;
    setRoundError("");
    setPhase("counting");
    setStatus("O taverneiro registra a aposta...");

    let settledRound: JokenpoRound;
    try {
      settledRound = await playRound(
        choice,
        selectedBetCents,
        crypto.randomUUID(),
      );
    } catch (caught) {
      if (runRef.current !== run) return;
      setPhase("choice");
      setRoundError(
        caught instanceof Error ? caught.message : "Não foi possível registrar a aposta.",
      );
      setStatus("A rodada não começou. Revise a aposta e tente novamente.");
      return;
    }

    const opponent = settledRound.tavern_choice;
    const roundOutcome = settledRound.outcome;
    if (!choices.includes(opponent) || !["vitoria", "derrota", "empate"].includes(roundOutcome)) {
      setPhase("choice");
      setRoundError("O resultado recebido é inválido. Nenhuma nova aposta foi iniciada.");
      return;
    }
    setPlayer(choice);
    setCharacter(opponent);
    setOutcome(roundOutcome);
    setRoundBet(Number(settledRound.bet_cents));
    setRoundDelta(Number(settledRound.net_delta_cents));
    setDisplayBalance(Number(settledRound.balance_after));

    if (!(await show(run, "/jokenpo/jo.webp", "JÓ...", 650))) return;
    if (!(await bounce(run))) return;
    if (!(await show(run, "/jokenpo/ken.webp", "KEN...", 650))) return;
    if (!(await bounce(run, 4))) return;
    if (!(await show(run, "/jokenpo/po.webp", "PÔ!", 120))) return;
    setBurstWord("PÔ!");
    if (!(await show(run, "/jokenpo/po.webp", "PÔ!", 610))) return;
    setBurstWord("");

    setPhase("result");
    setBurstWord(labels[opponent].toUpperCase());
    if (
      !(await show(
        run,
        `/jokenpo/${opponent}.webp`,
        `Você escolheu ${labels[choice]}. O taverneiro revelou ${labels[opponent]}.`,
        1950,
      ))
    )
      return;
    setBurstWord("");
    if (
      !(await show(
        run,
        `/jokenpo/${opponent}.webp`,
        `Você escolheu ${labels[choice]}. O taverneiro revelou ${labels[opponent]}.`,
        900,
      ))
    )
      return;

    const [silentReaction, spokenReaction] = reactionFrames(roundOutcome);
    setPhase("reaction");
    if (
      !(await show(
        run,
        silentReaction,
        "O taverneiro reage ao resultado...",
        480,
      ))
    )
      return;
    const resultText =
      roundOutcome === "vitoria"
        ? "Você venceu a rodada!"
        : roundOutcome === "derrota"
          ? "O taverneiro venceu a rodada."
          : "A rodada terminou empatada.";
    if (!(await show(run, spokenReaction, resultText, 1900))) return;
    setPhase("replay");
    setFrame("/jokenpo/revanche.webp");
    setStatus(resultText);
  }

  function openChoices() {
    cancelTimeline();
    setRoundError("");
    setPhase("choice");
    setFrame("/jokenpo/escolha.webp");
    setStatus(
      "Escolha sua jogada. A escolha do taverneiro permanece escondida.",
    );
    setPlayer(undefined);
    setCharacter(undefined);
    setOutcome(undefined);
  }

  function reset() {
    cancelTimeline();
    setPhase("intro");
    setFrame("/jokenpo/intro.webp");
    setStatus("O taverneiro espera pelo seu desafio.");
    setPlayer(undefined);
    setCharacter(undefined);
    setOutcome(undefined);
    setRoundDelta(undefined);
    setRoundBet(undefined);
    setRoundError("");
  }

  function stop() {
    const music = musicRef.current;
    if (music) {
      music.pause();
      music.currentTime = 0;
    }
    reset();
  }

  return (
    <section className={styles.game} aria-label="Minijogo Jokenpô">
      <audio ref={musicRef} src="/audio/jokenpo.mp3" preload="metadata" />
      <div className={styles.stage}>
        <img
          src={frame}
          width="1199"
          height="1312"
          alt="Taverneiro jogando Jokenpô"
        />
        {burstWord ? (
          <div
            className={`${styles.wordBurst}${burstWord.length > 4 ? ` ${styles.longWord}` : ""}`}
            aria-hidden="true"
          >
            <span>{burstWord}</span>
            <span>{burstWord}</span>
            <span>{burstWord}</span>
            <span>{burstWord}</span>
            <span>{burstWord}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.panel}>
        <p className={styles.eyebrow}>Taverna do Alvorecer</p>
        <h2>Jokenpô</h2>
        <p className={styles.status} aria-live="polite">
          {status}
        </p>

        {phase === "intro" && (
          <div className={styles.betPanel}>
            <label htmlFor="jokenpo-bet">Aposta em Dracmas</label>
            <div className={styles.betInput}>
              <input
                id="jokenpo-bet"
                type="number"
                min={200}
                max={Math.max(1, Math.floor(maximumBetCents / 100))}
                step={1}
                value={betDracmas}
                onChange={(event) =>
                  setBetDracmas(Math.max(0, Number(event.target.value) || 0))
                }
              />
              <span>Dracmas</span>
            </div>
            <div className={styles.quickBets} aria-label="Apostas rápidas">
              {[200, 500, 1000, 2000].map((amount) => (
                <button
                  key={amount}
                  type="button"
                  disabled={displayBalance < 20000 || betDracmas >= Math.floor(Math.min(maximumBetCents, displayBalance) / 100)}
                  onClick={() =>
                    setBetDracmas((current) =>
                      Math.min(
                        Math.floor(Math.min(maximumBetCents, displayBalance) / 100),
                        current + amount,
                      ),
                    )
                  }
                >
                  +{amount.toLocaleString("pt-BR")}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setBetDracmas(0)}
                disabled={betDracmas === 0}
              >
                Zerar
              </button>
            </div>
            <p className={styles.odds}>
              Vitória: +80% · Derrota: −100% · Empate: aposta devolvida
            </p>
            <small>
              Máximo nesta rodada: {formatDracmas(Math.min(maximumBetCents, displayBalance))}.
              Limite de 50.000 Dracmas ganhos a cada 24 horas. Perdas sem limite diário.
            </small>
            {unavailableReason ? <p className={styles.betError}>{unavailableReason}</p> : null}
            {!unavailableReason && displayBalance < 20000 ? (
              <p className={styles.betError}>Você precisa de pelo menos 200 Dracmas para entrar.</p>
            ) : null}
            {!unavailableReason && displayBalance >= 20000 && selectedBetCents < 20000 ? (
              <p className={styles.betError}>A aposta mínima é 200 Dracmas.</p>
            ) : null}
            {!unavailableReason && selectedBetCents > maximumBetCents ? (
              <p className={styles.betError}>Reduza a aposta para respeitar o limite da carteira.</p>
            ) : null}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={!canBet}
                onClick={() => {
                  void startMusic();
                  openChoices();
                }}
              >
                Entrar na rodada
              </button>
            </div>
          </div>
        )}

        {phase === "choice" && (
          <div>
            <p className={styles.activeBet}>
              Aposta ativa: <strong>{formatDracmas(selectedBetCents)}</strong>
            </p>
            <div className={styles.choices} aria-label="Escolha sua jogada">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => void play(choice)}
                >
                  {labels[choice]}
                </button>
              ))}
            </div>
            {roundError ? <p className={styles.betError} role="alert">{roundError}</p> : null}
          </div>
        )}

        {["counting", "result", "reaction"].includes(phase) && (
          <div className={styles.choices} aria-hidden="true">
            {choices.map((choice) => (
              <button key={choice} disabled>
                {labels[choice]}
              </button>
            ))}
          </div>
        )}

        {player && character && outcome && phase === "replay" && (
          <div className={styles.result}>
            <strong
              className={
                outcome === "vitoria"
                  ? styles.resultWin
                  : outcome === "derrota"
                    ? styles.resultLoss
                    : styles.resultDraw
              }
            >
              {outcome === "vitoria"
                ? "Vitória"
                : outcome === "derrota"
                  ? "Derrota"
                  : "Empate"}
            </strong>
            <small>
              Você: {labels[player]} · Taverneiro: {labels[character]}
            </small>
            {roundBet !== undefined && roundDelta !== undefined ? (
              <small>
                Aposta: {formatDracmas(roundBet)} · Resultado: {roundDelta > 0 ? "+" : ""}
                {formatDracmas(roundDelta)}
              </small>
            ) : null}
          </div>
        )}

        {phase === "replay" && (
          <div className={styles.actions}>
            <button type="button" onClick={openChoices}>
              Repetir aposta
            </button>
            <button type="button" onClick={reset}>
              Alterar aposta
            </button>
            <button type="button" onClick={stop}>
              Encerrar partida
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
