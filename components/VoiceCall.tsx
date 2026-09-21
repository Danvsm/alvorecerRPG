"use client";

import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { browserDb } from "@/lib/client";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import type { Row } from "@/lib/types";
import IdentityAvatar from "./IdentityAvatar";
import styles from "./VoiceCall.module.css";

type CallStatus =
  | "ringing"
  | "active"
  | "ended"
  | "declined"
  | "cancelled"
  | "missed"
  | "failed";

type DirectCall = {
  id: string;
  campaign_id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  status: CallStatus;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  ended_by: string | null;
  failure_reason: string | null;
};

type CallSignal = {
  id: number;
  call_id: string;
  sender_id: string;
  kind: "offer" | "answer" | "ice";
  payload: Record<string, unknown>;
};

export type VoiceCallHandle = {
  start: (conversationId: string) => Promise<void>;
};

const TERMINAL = new Set<CallStatus>([
  "ended",
  "declined",
  "cancelled",
  "missed",
  "failed",
]);

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function normalizedCall(row: Row): DirectCall {
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    conversation_id: String(row.conversation_id),
    caller_id: String(row.caller_id),
    callee_id: String(row.callee_id),
    status: String(row.status) as CallStatus,
    created_at: String(row.created_at),
    answered_at: row.answered_at ? String(row.answered_at) : null,
    ended_at: row.ended_at ? String(row.ended_at) : null,
    ended_by: row.ended_by ? String(row.ended_by) : null,
    failure_reason: row.failure_reason ? String(row.failure_reason) : null,
  };
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.max(0, seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

const VoiceCall = forwardRef<
  VoiceCallHandle,
  {
    campaign: string;
    actor: string;
    identities: Row[];
    cosmetics: Row[];
    equipment: Row[];
    urls: Record<string, string>;
  }
>(function VoiceCall(
  { campaign, actor, identities, cosmetics, equipment, urls },
  ref,
) {
  const [call, setCall] = useState<DirectCall | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const callRef = useRef<DirectCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const processedSignalsRef = useRef<Set<number>>(new Set());
  const offerSentRef = useRef(false);
  const endingRef = useRef(false);
  const disconnectTimerRef = useRef<number | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const speakerMutedRef = useRef(false);

  const updateCall = useCallback((next: DirectCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const clearPeer = useCallback(
    (stopLocal = true) => {
      if (disconnectTimerRef.current !== null) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (ringTimerRef.current !== null) {
        window.clearTimeout(ringTimerRef.current);
        ringTimerRef.current = null;
      }
      peerRef.current?.close();
      peerRef.current = null;
      remoteStreamRef.current = null;
      pendingCandidatesRef.current = [];
      processedSignalsRef.current.clear();
      offerSentRef.current = false;
      endingRef.current = false;
      setElapsed(0);
      setMuted(false);
      setSpeakerMuted(false);
      speakerMutedRef.current = false;
      setNeedsAudioTap(false);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.muted = false;
      }
      if (stopLocal) stopLocalStream();
    },
    [stopLocalStream],
  );

  const prepareLocalMedia = useCallback(async () => {
    const current = localStreamRef.current;
    if (current?.getAudioTracks().some((track) => track.readyState === "live")) {
      return current;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não oferece chamadas de voz.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const callAction = useCallback(
    async (target: DirectCall, op: string, detail?: string) => {
      const response = await browserDb().rpc("direct_call_action", {
        c: campaign,
        actor_id: actor,
        call_id: target.id,
        op,
        detail: detail || null,
      });
      if (response.error) throw response.error;
      const next = normalizedCall(response.data as Row);
      updateCall(next);
      return next;
    },
    [actor, campaign, updateCall],
  );

  const sendSignal = useCallback(
    async (
      target: DirectCall,
      kind: "offer" | "answer" | "ice",
      payload: Record<string, unknown>,
    ) => {
      const response = await browserDb().rpc("direct_call_signal", {
        c: campaign,
        actor_id: actor,
        call_id: target.id,
        signal_kind: kind,
        signal_payload: payload,
      });
      if (response.error) throw response.error;
    },
    [actor, campaign],
  );

  const failCall = useCallback(
    async (reason: string) => {
      const target = callRef.current;
      if (!target || TERMINAL.has(target.status) || endingRef.current) return;
      endingRef.current = true;
      try {
        await callAction(target, "fail", reason);
      } catch {
        clearPeer();
        updateCall(null);
      }
    },
    [callAction, clearPeer, updateCall],
  );

  const ensurePeer = useCallback(async () => {
    if (peerRef.current) return peerRef.current;

    const target = callRef.current;
    if (!target || target.status !== "active") {
      throw new Error("A chamada ainda não está ativa.");
    }

    const localStream = await prepareLocalMedia();
    const peer = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 2,
    });

    for (const track of localStream.getTracks()) {
      peer.addTrack(track, localStream);
    }

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.muted = speakerMutedRef.current;
    }

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      for (const track of stream?.getTracks() || [event.track]) {
        if (!remoteStream.getTracks().some((item) => item.id === track.id)) {
          remoteStream.addTrack(track);
        }
      }
      const audio = remoteAudioRef.current;
      if (!audio) return;
      audio.srcObject = remoteStream;
      audio.muted = speakerMutedRef.current;
      if (!speakerMutedRef.current) {
        void audio.play().then(
          () => setNeedsAudioTap(false),
          () => setNeedsAudioTap(true),
        );
      }
    };

    peer.onicecandidate = (event) => {
      const current = callRef.current;
      if (!event.candidate || !current || current.status !== "active") return;
      void sendSignal(
        current,
        "ice",
        event.candidate.toJSON() as unknown as Record<string, unknown>,
      ).catch((reason) => {
        setError(readableErrorMessage(reason));
      });
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        if (disconnectTimerRef.current !== null) {
          window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        setError("");
        return;
      }
      if (peer.connectionState === "failed") {
        void failCall("Falha na conexão WebRTC");
        return;
      }
      if (peer.connectionState === "disconnected") {
        if (disconnectTimerRef.current !== null) {
          window.clearTimeout(disconnectTimerRef.current);
        }
        disconnectTimerRef.current = window.setTimeout(() => {
          if (
            peer.connectionState === "disconnected" ||
            peer.connectionState === "failed"
          ) {
            void failCall("Conexão interrompida");
          }
        }, 8000);
      }
    };

    peerRef.current = peer;
    return peer;
  }, [failCall, prepareLocalMedia, sendSignal]);

  const drainCandidates = useCallback(async (peer: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.splice(0);
    for (const candidate of pending) {
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        // Candidatos incompatíveis são ignorados; outros ainda podem conectar.
      }
    }
  }, []);

  const processSignal = useCallback(
    async (signal: CallSignal) => {
      if (processedSignalsRef.current.has(signal.id)) return;
      processedSignalsRef.current.add(signal.id);
      if (signal.sender_id === actor) return;

      const target = callRef.current;
      if (!target || target.id !== signal.call_id || target.status !== "active")
        return;

      try {
        const peer = await ensurePeer();

        if (signal.kind === "offer" && actor === target.callee_id) {
          await peer.setRemoteDescription(
            signal.payload as unknown as RTCSessionDescriptionInit,
          );
          await drainCandidates(peer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendSignal(
            target,
            "answer",
            peer.localDescription?.toJSON() as unknown as Record<
              string,
              unknown
            >,
          );
          return;
        }

        if (signal.kind === "answer" && actor === target.caller_id) {
          await peer.setRemoteDescription(
            signal.payload as unknown as RTCSessionDescriptionInit,
          );
          await drainCandidates(peer);
          return;
        }

        if (signal.kind === "ice") {
          const candidate = signal.payload as unknown as RTCIceCandidateInit;
          if (peer.remoteDescription) await peer.addIceCandidate(candidate);
          else pendingCandidatesRef.current.push(candidate);
        }
      } catch (reason) {
        setError(readableErrorMessage(reason));
        void failCall("Falha durante a negociação da chamada");
      }
    },
    [actor, drainCandidates, ensurePeer, failCall, sendSignal],
  );

  const notifyIncomingCall = useCallback(
    async (target: DirectCall) => {
      try {
        const sessionResult = await browserDb().auth.getSession();
        const token = sessionResult.data.session?.access_token;
        if (!token) return;
        await fetch("/api/push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "chat_call",
            campaign,
            conversationId: target.conversation_id,
            actorId: actor,
            callId: target.id,
          }),
          keepalive: true,
        });
      } catch {
        // Realtime continua funcionando mesmo se o push não puder ser entregue.
      }
    },
    [actor, campaign],
  );

  const start = useCallback(
    async (conversationId: string) => {
      if (!conversationId || busy) return;
      if (callRef.current && !TERMINAL.has(callRef.current.status)) {
        setError("Você já está em uma chamada.");
        return;
      }

      setBusy(true);
      setError("");
      clearPeer();

      try {
        await prepareLocalMedia();
        const response = await browserDb().rpc("direct_call_start", {
          c: campaign,
          actor_id: actor,
          conversation_id: conversationId,
        });
        if (response.error) throw response.error;
        const next = normalizedCall(response.data as Row);
        updateCall(next);
        void notifyIncomingCall(next);
      } catch (reason) {
        stopLocalStream();
        const message = readableErrorMessage(reason);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [
      actor,
      busy,
      campaign,
      clearPeer,
      notifyIncomingCall,
      prepareLocalMedia,
      stopLocalStream,
      updateCall,
    ],
  );

  useImperativeHandle(ref, () => ({ start }), [start]);

  useEffect(() => {
    if (!campaign || !actor) return;

    let valid = true;
    const db = browserDb();

    retryNetworkRead(() =>
      db
        .from("direct_calls")
        .select("*")
        .eq("campaign_id", campaign)
        .or(`caller_id.eq.${actor},callee_id.eq.${actor}`)
        .in("status", ["ringing", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ).then((response) => {
      if (!valid || response.error || !response.data) return;
      updateCall(normalizedCall(response.data as Row));
    });

    const channel = db
      .channel(`direct-calls:${campaign}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_calls",
          filter: `campaign_id=eq.${campaign}`,
        },
        (payload) => {
          const row = normalizedCall((payload.new || payload.old) as Row);
          if (actor !== row.caller_id && actor !== row.callee_id) return;

          const current = callRef.current;
          if (
            current &&
            current.id !== row.id &&
            !TERMINAL.has(current.status)
          ) {
            return;
          }
          updateCall(row);
        },
      )
      .subscribe();

    return () => {
      valid = false;
      clearPeer();
      updateCall(null);
      void db.removeChannel(channel);
    };
  }, [actor, campaign, clearPeer, updateCall]);

  useEffect(() => {
    if (!call || call.status !== "active") return;

    let valid = true;
    const db = browserDb();

    const loadExisting = async () => {
      const response = await retryNetworkRead(() =>
        db
          .from("direct_call_signals")
          .select("id,call_id,sender_id,kind,payload")
          .eq("call_id", call.id)
          .order("id", { ascending: true }),
      );
      if (!valid || response.error) return;
      for (const row of response.data || []) {
        if (!valid) break;
        await processSignal({
          ...row,
          id: Number(row.id),
        } as CallSignal);
      }
    };

    const channel = db
      .channel(`direct-call-signals:${call.id}:${actor}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_call_signals",
          filter: `call_id=eq.${call.id}`,
        },
        (payload) => {
          const row = payload.new as Row;
          void processSignal({
            id: Number(row.id),
            call_id: String(row.call_id),
            sender_id: String(row.sender_id),
            kind: String(row.kind) as CallSignal["kind"],
            payload: (row.payload || {}) as Record<string, unknown>,
          });
        },
      )
      .subscribe();

    void loadExisting();

    return () => {
      valid = false;
      void db.removeChannel(channel);
    };
  }, [actor, call?.id, call?.status, processSignal]);

  useEffect(() => {
    if (!call || call.status !== "active") return;

    let active = true;
    const begin = async () => {
      try {
        const peer = await ensurePeer();
        if (
          active &&
          actor === call.caller_id &&
          !offerSentRef.current
        ) {
          offerSentRef.current = true;
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await sendSignal(
            call,
            "offer",
            peer.localDescription?.toJSON() as unknown as Record<
              string,
              unknown
            >,
          );
        }
      } catch (reason) {
        if (!active) return;
        setError(readableErrorMessage(reason));
        void failCall("Microfone ou conexão indisponível");
      }
    };
    void begin();
    return () => {
      active = false;
    };
  }, [actor, call?.id, call?.status, ensurePeer, failCall, sendSignal]);

  useEffect(() => {
    if (!call || call.status !== "ringing") return;
    const age = Date.now() - new Date(call.created_at).getTime();
    const remaining = Math.max(0, 45_000 - age);

    if (ringTimerRef.current !== null) {
      window.clearTimeout(ringTimerRef.current);
    }

    ringTimerRef.current = window.setTimeout(() => {
      const current = callRef.current;
      if (!current || current.id !== call.id || current.status !== "ringing")
        return;

      if (actor === current.caller_id) {
        void callAction(current, "timeout").catch(() => {
          clearPeer();
          updateCall(null);
        });
      } else {
        clearPeer();
        updateCall(null);
      }
    }, remaining);

    return () => {
      if (ringTimerRef.current !== null) {
        window.clearTimeout(ringTimerRef.current);
        ringTimerRef.current = null;
      }
    };
  }, [actor, call?.created_at, call?.id, call?.status, callAction, clearPeer, updateCall]);

  useEffect(() => {
    if (!call || call.status !== "active" || !call.answered_at) {
      setElapsed(0);
      return;
    }

    const update = () => {
      setElapsed(
        Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(call.answered_at as string).getTime()) /
              1000,
          ),
        ),
      );
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [call?.answered_at, call?.id, call?.status]);

  useEffect(() => {
    if (!call || !TERMINAL.has(call.status)) return;
    clearPeer();
    const timer = window.setTimeout(() => {
      if (callRef.current?.id === call.id) updateCall(null);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [call?.id, call?.status, clearPeer, updateCall]);

  const peerIdentity = useMemo(() => {
    if (!call) return undefined;
    const peerId = call.caller_id === actor ? call.callee_id : call.caller_id;
    return identities.find((identity) => identity.id === peerId);
  }, [actor, call, identities]);

  const incoming = Boolean(
    call && call.status === "ringing" && call.callee_id === actor,
  );

  const statusText = useMemo(() => {
    if (!call) return "";
    if (call.status === "ringing") {
      return incoming
        ? "Chamada de voz recebida"
        : `Ligando para ${peerIdentity?.name || "contato"}...`;
    }
    if (call.status === "active") return durationLabel(elapsed);
    if (call.status === "declined") return "Chamada recusada";
    if (call.status === "cancelled") return "Chamada cancelada";
    if (call.status === "missed") return "Chamada não atendida";
    if (call.status === "failed")
      return call.failure_reason || "Não foi possível conectar";
    return "Chamada encerrada";
  }, [call, elapsed, incoming, peerIdentity?.name]);

  const accept = async () => {
    if (!call || call.status !== "ringing" || !incoming || busy) return;
    setBusy(true);
    setError("");
    try {
      await prepareLocalMedia();
      await callAction(call, "accept");
    } catch (reason) {
      setError(readableErrorMessage(reason));
      stopLocalStream();
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!call || busy) return;
    setBusy(true);
    try {
      await callAction(call, incoming ? "decline" : "cancel");
    } catch (reason) {
      setError(readableErrorMessage(reason));
      clearPeer();
      updateCall(null);
    } finally {
      setBusy(false);
    }
  };

  const hangUp = async () => {
    if (!call || busy) return;
    setBusy(true);
    endingRef.current = true;
    try {
      await callAction(call, "end");
    } catch (reason) {
      setError(readableErrorMessage(reason));
      clearPeer();
      updateCall(null);
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    const next = !muted;
    track.enabled = !next;
    setMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speakerMutedRef.current;
    speakerMutedRef.current = next;
    setSpeakerMuted(next);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = next;
      if (!next) {
        void remoteAudioRef.current.play().then(
          () => setNeedsAudioTap(false),
          () => setNeedsAudioTap(true),
        );
      }
    }
  };

  if (!call) return <audio ref={remoteAudioRef} autoPlay />;

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.call}
        role="dialog"
        aria-modal="true"
        aria-label="Chamada de voz"
      >
        <audio ref={remoteAudioRef} autoPlay />

        <div className={styles.topline}>
          <Phone size={16} aria-hidden="true" />
          <span>Chamada de voz</span>
        </div>

        <div className={styles.identity}>
          <IdentityAvatar
            identity={peerIdentity}
            identityId={
              call.caller_id === actor ? call.callee_id : call.caller_id
            }
            avatarAlt={peerIdentity?.name}
            cosmetics={cosmetics}
            equipment={equipment}
            urls={urls}
            size={116}
          />
          <h2>{peerIdentity?.name || "Contato"}</h2>
          <p>{statusText}</p>
        </div>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {needsAudioTap && call.status === "active" && (
          <button
            type="button"
            className={styles.audioResume}
            onClick={() => {
              if (!remoteAudioRef.current) return;
              void remoteAudioRef.current.play().then(() =>
                setNeedsAudioTap(false),
              );
            }}
          >
            Ativar áudio
          </button>
        )}

        {call.status === "ringing" ? (
          <div className={styles.ringingActions}>
            {incoming && (
              <button
                type="button"
                className={styles.decline}
                disabled={busy}
                onClick={() => void decline()}
                aria-label="Recusar chamada"
              >
                <PhoneOff aria-hidden="true" />
                <span>Recusar</span>
              </button>
            )}
            {!incoming && (
              <button
                type="button"
                className={styles.decline}
                disabled={busy}
                onClick={() => void decline()}
                aria-label="Cancelar chamada"
              >
                <PhoneOff aria-hidden="true" />
                <span>Cancelar</span>
              </button>
            )}
            {incoming && (
              <button
                type="button"
                className={styles.accept}
                disabled={busy}
                onClick={() => void accept()}
                aria-label="Atender chamada"
              >
                <Phone aria-hidden="true" />
                <span>{busy ? "Abrindo..." : "Atender"}</span>
              </button>
            )}
          </div>
        ) : call.status === "active" ? (
          <div className={styles.activeActions}>
            <button
              type="button"
              className={muted ? styles.controlActive : styles.control}
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Ativar microfone" : "Silenciar microfone"}
            >
              {muted ? <MicOff /> : <Mic />}
              <span>{muted ? "Mudo" : "Microfone"}</span>
            </button>

            <button
              type="button"
              className={
                speakerMuted ? styles.controlActive : styles.control
              }
              onClick={toggleSpeaker}
              aria-pressed={speakerMuted}
              aria-label={speakerMuted ? "Ativar áudio" : "Silenciar áudio"}
            >
              {speakerMuted ? <VolumeX /> : <Volume2 />}
              <span>Áudio</span>
            </button>

            <button
              type="button"
              className={styles.hangup}
              disabled={busy}
              onClick={() => void hangUp()}
              aria-label="Encerrar chamada"
            >
              <PhoneOff />
              <span>Encerrar</span>
            </button>
          </div>
        ) : (
          <div className={styles.finished}>
            <small>A chamada será fechada automaticamente.</small>
          </div>
        )}
      </section>
    </div>
  );
});

export default VoiceCall;
