"use client";

import { Mic, Pause, Play, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CHAT_AUDIO_BITRATE,
  compactWaveform,
  formatAudioDuration,
  MAX_CHAT_AUDIO_BYTES,
  MAX_CHAT_AUDIO_MS,
  selectChatAudioFormat,
  type ChatAudioPayload,
} from "@/lib/chat-audio";
import { readableErrorMessage } from "@/lib/network";

export default function VoiceRecorder({
  disabled,
  onClose,
  onSend,
}: {
  disabled?: boolean;
  onClose: () => void;
  onSend: (payload: ChatAudioPayload) => Promise<void>;
}) {
  const [state, setState] = useState<
    "ready" | "requesting" | "recording" | "preview" | "uploading"
  >("ready");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const samplesRef = useRef<number[]>([]);
  const payloadRef = useRef<ChatAudioPayload | null>(null);
  const cancelledRef = useRef(false);
  const startedRef = useRef(false);

  const releaseInput = () => {
    if (intervalRef.current != null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  };

  const resetPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    payloadRef.current = null;
    setElapsed(0);
    setPreviewPlaying(false);
    setPreviewProgress(0);
    setError("");
  };

  const stopRecording = (cancelled = false) => {
    cancelledRef.current = cancelled;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else releaseInput();
  };

  useEffect(() => {
    const hidden = () => {
      if (document.hidden && recorderRef.current?.state === "recording") {
        stopRecording(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      if (intervalRef.current != null)
        window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const start = async () => {
    if (disabled || state !== "ready") return;
    setState("requesting");
    setError("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        throw new Error("Este navegador não oferece gravação de voz.");
      }
      const format = selectChatAudioFormat((mime) =>
        MediaRecorder.isTypeSupported(mime),
      );
      if (!format)
        throw new Error("Nenhum formato de áudio compatível foi encontrado.");

      const nativeAndroid = Boolean(window.AlvorecerNative);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: nativeAndroid
            ? true
            : {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
        });
      } catch (firstError) {
        if (
          firstError instanceof DOMException &&
          firstError.name === "NotAllowedError"
        ) {
          throw firstError;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;
      chunksRef.current = [];
      samplesRef.current = [];
      cancelledRef.current = false;

      const recorder = new MediaRecorder(stream, {
        mimeType: format.recorderMime,
        audioBitsPerSecond: CHAT_AUDIO_BITRATE,
      });
      recorderRef.current = recorder;

      try {
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = context;
        analyserRef.current = analyser;
      } catch {
        analyserRef.current = null;
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Math.min(
          MAX_CHAT_AUDIO_MS,
          Math.max(0, Date.now() - startedAtRef.current),
        );
        const blob = new Blob(chunksRef.current, { type: format.storageMime });
        releaseInput();
        recorderRef.current = null;
        if (cancelledRef.current) {
          chunksRef.current = [];
          setState("ready");
          return;
        }
        if (durationMs < 250 || blob.size < 1) {
          setError("O áudio ficou curto demais. Tente novamente.");
          setState("ready");
          return;
        }
        if (blob.size > MAX_CHAT_AUDIO_BYTES) {
          setError("O áudio ultrapassou o limite de 3 MB.");
          setState("ready");
          return;
        }
        const payload = {
          blob,
          mimeType: format.storageMime,
          durationMs,
          waveform: compactWaveform(samplesRef.current),
        };
        payloadRef.current = payload;
        setElapsed(durationMs);
        setPreviewUrl(URL.createObjectURL(blob));
        setState("preview");
      };

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      intervalRef.current = window.setInterval(() => {
        const next = Math.min(
          MAX_CHAT_AUDIO_MS,
          Date.now() - startedAtRef.current,
        );
        setElapsed(next);
        const analyser = analyserRef.current;
        if (analyser) {
          const data = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(data);
          const level =
            data.reduce((sum, sample) => sum + Math.abs(sample - 128), 0) /
            data.length;
          samplesRef.current.push(Math.min(100, Math.max(4, level * 5)));
        }
        if (next >= MAX_CHAT_AUDIO_MS) stopRecording(false);
      }, 250);
    } catch (reason) {
      releaseInput();
      setState("ready");
      setError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Permita o uso do microfone para gravar um áudio."
          : readableErrorMessage(reason),
      );
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
    // A gravação começa uma única vez quando a barra substitui o campo de texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    const payload = payloadRef.current;
    if (!payload || state !== "preview") return;
    setState("uploading");
    setError("");
    try {
      await onSend(payload);
      resetPreview();
      onClose();
    } catch (reason) {
      setState("preview");
      setError(readableErrorMessage(reason));
    }
  };

  const togglePreview = async () => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  return (
    <section className="voice-recorder" aria-label="Gravar mensagem de voz">
      {state === "ready" || state === "requesting" ? (
        <div className="voice-requesting-row" aria-live="polite">
          <button type="button" onClick={onClose} aria-label="Cancelar áudio">
            <X />
          </button>
          <Mic />
          <span>
            {state === "requesting"
              ? "Abrindo microfone..."
              : "Preparando áudio..."}
          </span>
        </div>
      ) : state === "recording" ? (
        <div className="voice-recording-row">
          <button
            type="button"
            onClick={() => {
              stopRecording(true);
              onClose();
            }}
            aria-label="Cancelar gravação"
          >
            <X />
          </button>
          <span className="voice-recording-dot" aria-hidden="true" />
          <strong>{formatAudioDuration(elapsed)}</strong>
          <span className="voice-recording-wave" aria-hidden="true">
            {Array.from({ length: 15 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
          <button
            type="button"
            className="voice-stop-button"
            onClick={() => stopRecording(false)}
            aria-label="Parar gravação"
          >
            <Square />
          </button>
        </div>
      ) : (
        <div className="voice-preview-row">
          <audio
            ref={previewAudioRef}
            src={previewUrl}
            preload="metadata"
            onPlay={() => setPreviewPlaying(true)}
            onPause={() => setPreviewPlaying(false)}
            onEnded={() => {
              setPreviewPlaying(false);
              setPreviewProgress(0);
            }}
            onTimeUpdate={(event) => {
              const audio = event.currentTarget;
              setPreviewProgress(
                audio.duration > 0 ? audio.currentTime / audio.duration : 0,
              );
            }}
          />
          <button
            type="button"
            onClick={() => {
              resetPreview();
              setState("ready");
            }}
            disabled={state === "uploading"}
            aria-label="Descartar áudio"
          >
            <Trash2 />
          </button>
          <button
            type="button"
            className="voice-preview-play"
            onClick={togglePreview}
            disabled={state === "uploading"}
            aria-label={previewPlaying ? "Pausar áudio" : "Ouvir áudio"}
          >
            {previewPlaying ? <Pause /> : <Play />}
          </button>
          <span className="voice-preview-wave" aria-hidden="true">
            {(payloadRef.current?.waveform || [])
              .slice(0, 28)
              .map((height, index, points) => (
                <i
                  key={index}
                  className={
                    index / Math.max(1, points.length - 1) <= previewProgress
                      ? "played"
                      : ""
                  }
                  style={{
                    height: `${Math.max(5, Math.round(height * 0.24))}px`,
                  }}
                />
              ))}
          </span>
          <small>{formatAudioDuration(elapsed)}</small>
          <button
            type="button"
            className="primary"
            onClick={send}
            disabled={state === "uploading"}
          >
            <Send />
            <span className="visually-hidden">
              {state === "uploading" ? "Enviando áudio" : "Enviar áudio"}
            </span>
          </button>
        </div>
      )}
      {error && <p className="voice-recorder-error">{error}</p>}
    </section>
  );
}
