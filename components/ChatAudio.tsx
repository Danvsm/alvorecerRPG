"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browserDb } from "@/lib/client";
import { formatAudioDuration } from "@/lib/chat-audio";

type AudioMedia = {
  storage_path: string;
  duration_ms: number;
  waveform: number[] | null;
  expires_at: string;
  deleted_at: string | null;
};

export default function ChatAudio({ id }: { id: string }) {
  const [media, setMedia] = useState<AudioMedia | null>(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const playWhenReady = useRef(false);

  useEffect(() => {
    let valid = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    browserDb()
      .from("chat_media")
      .select("storage_path,duration_ms,waveform,expires_at,deleted_at")
      .eq("id", id)
      .eq("media_type", "audio")
      .single()
      .then((result) => {
        if (!valid) return;
        setLoading(false);
        if (result.error) {
          setError("Áudio indisponível");
          return;
        }
        const remaining = Date.parse(result.data.expires_at) - Date.now();
        if (result.data.deleted_at || remaining <= 0) {
          setExpired(true);
          return;
        }
        setMedia(result.data as AudioMedia);
        expiryTimer = setTimeout(() => {
          if (!valid) return;
          setExpired(true);
          setUrl("");
        }, Math.min(remaining, 2_147_000_000));
      });
    return () => {
      valid = false;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [id]);

  useEffect(() => {
    if (!url || !playWhenReady.current || !audioRef.current) return;
    playWhenReady.current = false;
    void audioRef.current.play().catch(() => setError("Toque novamente para ouvir."));
  }, [url]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!media || expired) return;
    if (audio && !audio.paused) {
      audio.pause();
      return;
    }
    if (!url) {
      setLoading(true);
      setError("");
      const remaining = Date.parse(media.expires_at) - Date.now();
      const signed = await browserDb().storage
        .from("chat-audio")
        .createSignedUrl(
          media.storage_path,
          Math.max(1, Math.min(600, Math.floor(remaining / 1000))),
        );
      setLoading(false);
      if (signed.error) {
        setError("Não foi possível abrir o áudio.");
        return;
      }
      playWhenReady.current = true;
      setUrl(signed.data.signedUrl);
      return;
    }
    await audio?.play().catch(() => setError("Não foi possível reproduzir o áudio."));
  };

  if (expired) return <p>Áudio expirado</p>;
  if (error && !media) return <p>{error}</p>;

  const waveform = media?.waveform?.length ? media.waveform : Array(32).fill(24);
  const duration = media?.duration_ms || 0;
  return (
    <div className="chat-audio" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        disabled={!media || loading}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <div className="chat-audio-track" aria-hidden="true">
        {waveform.map((height, index) => (
          <span
            key={index}
            className={duration > 0 && index / waveform.length <= progress / duration ? "played" : ""}
            style={{ height: `${Math.max(12, Number(height))}%` }}
          />
        ))}
      </div>
      <small>{formatAudioDuration(progress || duration)}</small>
      <audio
        ref={audioRef}
        src={url || undefined}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) =>
          setProgress(Math.round(event.currentTarget.currentTime * 1000))
        }
      />
      {error && <span className="chat-audio-error">{error}</span>}
    </div>
  );
}
