"use client";

import { Mic, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CHAT_AUDIO_BITRATE,
  compactWaveform,
  formatAudioDuration,
  MAX_CHAT_AUDIO_BYTES,
  MAX_CHAT_AUDIO_MS,
  selectChatAudioFormat,
  type ChatAudioPayload,
  type ChatAudioFormat,
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const intervalRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const samplesRef = useRef<number[]>([]);
  const payloadRef = useRef<ChatAudioPayload | null>(null);
  const formatRef = useRef<ChatAudioFormat | null>(null);
  const cancelledRef = useRef(false);

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
      if (intervalRef.current != null) window.clearInterval(intervalRef.current);
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
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Este navegador não oferece gravação de voz.");
      }
      const format = selectChatAudioFormat((mime) =>
        MediaRecorder.isTypeSupported(mime),
      );
      if (!format) throw new Error("Nenhum formato de áudio compatível foi encontrado.");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      formatRef.current = format;
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
        const next = Math.min(MAX_CHAT_AUDIO_MS, Date.now() - startedAtRef.current);
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

  return (
    <section className="voice-recorder" aria-label="Gravar mensagem de voz">
      <div className="voice-recorder-topline">
        <strong>Mensagem de voz</strong>
        <button
          type="button"
          onClick={() => {
            if (state === "recording") stopRecording(true);
            resetPreview();
            onClose();
          }}
          aria-label="Fechar gravador"
          disabled={state === "uploading"}
        >
          <X />
        </button>
      </div>

      {state === "ready" || state === "requesting" ? (
        <button
          type="button"
          className="voice-start-button"
          onClick={start}
          disabled={disabled || state === "requesting"}
        >
          <Mic />
          {state === "requesting" ? "Abrindo microfone..." : "Começar a gravar"}
        </button>
      ) : state === "recording" ? (
        <div className="voice-recording-row">
          <span className="voice-recording-dot" aria-hidden="true" />
          <strong>{formatAudioDuration(elapsed)}</strong>
          <span>/ 5:00</span>
          <button type="button" onClick={() => stopRecording(true)}>
            <Trash2 /> Cancelar
          </button>
          <button type="button" className="primary" onClick={() => stopRecording(false)}>
            <Square /> Concluir
          </button>
        </div>
      ) : (
        <div className="voice-preview-row">
          <audio src={previewUrl} controls preload="metadata" />
          <small>{formatAudioDuration(elapsed)}</small>
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
            className="primary"
            onClick={send}
            disabled={state === "uploading"}
          >
            <Send /> {state === "uploading" ? "Enviando..." : "Enviar"}
          </button>
        </div>
      )}
      {error && <p className="voice-recorder-error">{error}</p>}
      <small className="voice-recorder-limit">Limite de 5 minutos</small>
    </section>
  );
}
