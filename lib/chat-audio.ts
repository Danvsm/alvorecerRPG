export const MAX_CHAT_AUDIO_MS = 5 * 60 * 1000;
export const MAX_CHAT_AUDIO_BYTES = 3 * 1024 * 1024;
export const CHAT_AUDIO_BITRATE = 24_000;

export type ChatAudioFormat = {
  recorderMime: string;
  storageMime: "audio/webm" | "audio/ogg" | "audio/mp4";
};

export type ChatAudioPayload = {
  blob: Blob;
  mimeType: "audio/webm" | "audio/ogg" | "audio/mp4";
  durationMs: number;
  waveform: number[];
};

const CHAT_AUDIO_FORMATS: ChatAudioFormat[] = [
  { recorderMime: "audio/webm;codecs=opus", storageMime: "audio/webm" },
  { recorderMime: "audio/ogg;codecs=opus", storageMime: "audio/ogg" },
  { recorderMime: "audio/mp4;codecs=mp4a.40.2", storageMime: "audio/mp4" },
  { recorderMime: "audio/mp4", storageMime: "audio/mp4" },
];

export function selectChatAudioFormat(
  supported: (mime: string) => boolean,
): ChatAudioFormat | null {
  return CHAT_AUDIO_FORMATS.find((format) => supported(format.recorderMime)) || null;
}

export function formatAudioDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function compactWaveform(samples: number[], points = 48) {
  if (!samples.length) return Array(points).fill(18) as number[];
  const result: number[] = [];
  for (let index = 0; index < points; index++) {
    const start = Math.floor((index * samples.length) / points);
    const end = Math.max(start + 1, Math.floor(((index + 1) * samples.length) / points));
    const slice = samples.slice(start, end);
    const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    result.push(Math.max(4, Math.min(100, Math.round(average))));
  }
  return result;
}
