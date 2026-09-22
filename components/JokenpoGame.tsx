"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./JokenpoGame.module.css";

type Choice = "pedra" | "papel" | "tesoura";
type Outcome = "vitoria" | "derrota" | "empate";
type Phase = "intro" | "choice" | "counting" | "result" | "reaction" | "replay";

const choices: Choice[] = ["pedra", "papel", "tesoura"];
const labels: Record<Choice, string> = {
  pedra: "Pedra",
  papel: "Papel",
  tesoura: "Tesoura",
};
const beats: Record<Choice, Choice> = {
  pedra: "tesoura",
  papel: "pedra",
  tesoura: "papel",
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

function outcomeFor(player: Choice, character: Choice): Outcome {
  if (player === character) return "empate";
  return beats[player] === character ? "vitoria" : "derrota";
}

function reactionFrames(outcome: Outcome) {
  if (outcome === "vitoria") {
    return ["/jokenpo/reacao-vitoria.webp", "/jokenpo/personagem-perde.webp"];
  }
  if (outcome === "derrota") {
    return ["/jokenpo/reacao-derrota.webp", "/jokenpo/personagem-vence.webp"];
  }
  return ["/jokenpo/reacao-empate.webp", "/jokenpo/empate.webp"];
}

export default function JokenpoGame() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [frame, setFrame] = useState("/jokenpo/intro.webp");
  const [status, setStatus] = useState("O taverneiro espera pelo seu desafio.");
  const [player, setPlayer] = useState<Choice>();
  const [character, setCharacter] = useState<Choice>();
  const [outcome, setOutcome] = useState<Outcome>();
  const [burstWord, setBurstWord] = useState("");
  const runRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

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
    };
  }, []);

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
    const opponent = choices[Math.floor(Math.random() * choices.length)];
    const roundOutcome = outcomeFor(choice, opponent);
    setPlayer(choice);
    setCharacter(opponent);
    setOutcome(roundOutcome);
    setPhase("counting");

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
  }

  return (
    <section className={styles.game} aria-label="Minijogo Jokenpô">
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
          <div className={styles.actions}>
            <button type="button" onClick={openChoices}>
              Desafiar o taverneiro
            </button>
          </div>
        )}

        {phase === "choice" && (
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
            <strong>
              {outcome === "vitoria"
                ? "Vitória"
                : outcome === "derrota"
                  ? "Derrota"
                  : "Empate"}
            </strong>
            <small>
              Você: {labels[player]} · Taverneiro: {labels[character]}
            </small>
          </div>
        )}

        {phase === "replay" && (
          <div className={styles.actions}>
            <button type="button" onClick={openChoices}>
              Jogar novamente
            </button>
            <button type="button" onClick={reset}>
              Encerrar partida
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
