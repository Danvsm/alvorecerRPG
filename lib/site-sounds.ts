"use client";

type AlvorecerSound = "message" | "notification";

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
