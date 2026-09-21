"use client";

type AlvorecerSound = "message" | "notification";
type ChestRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

let audioContext: AudioContext | null = null;
let unlocked = false;
let listenersInstalled = false;

function context() {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  return audioContext;
}

async function unlock() {
  const ctx = context();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") await ctx.resume();
    unlocked = ctx.state === "running";
  } catch {
    unlocked = false;
  }
}

export function installAlvorecerSoundUnlock() {
  if (typeof window === "undefined" || listenersInstalled) return;
  listenersInstalled = true;

  const handleFirstInteraction = () => {
    void unlock();
  };

  window.addEventListener("pointerdown", handleFirstInteraction, {
    passive: true,
  });
  window.addEventListener("keydown", handleFirstInteraction);
  window.addEventListener("touchstart", handleFirstInteraction, {
    passive: true,
  });
}

function tone(
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  gainValue: number,
  type: OscillatorType,
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    start + Math.max(0.04, duration),
  );

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(start);
  oscillator.stop(start + duration + 0.025);
}

export async function playAlvorecerSound(sound: AlvorecerSound) {
  if (typeof window === "undefined") return false;

  installAlvorecerSoundUnlock();

  const ctx = context();
  if (!ctx) return false;

  if (!unlocked || ctx.state !== "running") {
    await unlock();
  }
  if (!unlocked || ctx.state !== "running") return false;

  const now = ctx.currentTime + 0.012;

  if (sound === "message") {
    tone(ctx, 660, now, 0.12, 0.055, "sine");
    tone(ctx, 880, now + 0.085, 0.16, 0.045, "sine");
    return true;
  }

  tone(ctx, 523.25, now, 0.16, 0.05, "sine");
  tone(ctx, 659.25, now + 0.09, 0.18, 0.045, "sine");
  tone(ctx, 783.99, now + 0.18, 0.24, 0.04, "triangle");
  return true;
}

export async function playChestReveal(rarity: ChestRarity) {
  if (typeof window === "undefined") return false;
  installAlvorecerSoundUnlock();
  const ctx = context();
  if (!ctx) return false;
  if (!unlocked || ctx.state !== "running") await unlock();
  if (!unlocked || ctx.state !== "running") return false;
  const now = ctx.currentTime + 0.012;
  const notes: Record<ChestRarity, number[]> = {
    common: [392, 523.25],
    uncommon: [392, 523.25, 659.25],
    rare: [440, 587.33, 739.99],
    epic: [440, 554.37, 659.25, 880],
    legendary: [392, 523.25, 659.25, 783.99, 1046.5],
  };
  notes[rarity].forEach((frequency, index) =>
    tone(
      ctx,
      frequency,
      now + index * 0.09,
      0.26,
      0.045,
      index === notes[rarity].length - 1 ? "triangle" : "sine",
    ),
  );
  return true;
}

export async function startChestSuspense() {
  const noop = () => {};
  if (typeof window === "undefined") return noop;

  installAlvorecerSoundUnlock();
  const ctx = context();
  if (!ctx) return noop;
  if (!unlocked || ctx.state !== "running") await unlock();
  if (!unlocked || ctx.state !== "running") return noop;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const sources: AudioScheduledSourceNode[] = [];

  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.055, now + 0.45);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(430, now);
  filter.Q.setValueAtTime(2.8, now);
  filter.connect(master);
  master.connect(ctx.destination);

  [55, 58.27, 82.41].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = index === 2 ? "triangle" : "sawtooth";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(index === 2 ? 0.16 : 0.24, now);
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(now);
    sources.push(oscillator);
  });

  const pulse = ctx.createOscillator();
  const pulseDepth = ctx.createGain();
  pulse.type = "sine";
  pulse.frequency.setValueAtTime(0.72, now);
  pulseDepth.gain.setValueAtTime(0.012, now);
  pulse.connect(pulseDepth);
  pulseDepth.connect(master.gain);
  pulse.start(now);
  sources.push(pulse);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const stopAt = ctx.currentTime + 0.42;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(
      Math.max(master.gain.value, 0.0001),
      ctx.currentTime,
    );
    master.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    window.setTimeout(() => {
      sources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // O áudio já terminou.
        }
      });
      filter.disconnect();
      master.disconnect();
    }, 460);
  };
}
