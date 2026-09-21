"use client";

import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from "lucide-react";
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
import { CallNegotiator, CallRecovery } from "@/lib/call-connection";
import type { CallIceConfig } from "@/lib/call-ice";
import { readableErrorMessage, retryNetworkRead } from "@/lib/network";
import { playAlvorecerSound } from "@/lib/site-sounds";
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

type MicrophonePermission = "unknown" | "requesting" | "granted" | "denied";

function microphoneErrorMessage(reason: unknown) {
  const error = reason as DOMException | Error | undefined;
  const name = String((error as DOMException | undefined)?.name || "");
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permita o acesso ao microfone nas configurações do navegador para fazer chamadas.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Nenhum microfone foi encontrado neste aparelho.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "O microfone está indisponível ou sendo usado por outro aplicativo.";
  }
  return readableErrorMessage(reason);
}

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
  const [connection, setConnection] = useState("connecting");
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermission>("unknown");

  const callRef = useRef<DirectCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const peerPromiseRef = useRef<Promise<RTCPeerConnection> | null>(null);
  const signalQueueRef = useRef<Promise<void>>(Promise.resolve());
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const negotiatorRef = useRef<CallNegotiator | null>(null);
  const recoveryRef = useRef<CallRecovery | null>(null);
  const relayConfiguredRef = useRef(false);
  const processedSignalsRef = useRef<Set<number>>(new Set());
  const offerSentRef = useRef(false);
  const endingRef = useRef(false);
  const ringTimerRef = useRef<number | null>(null);
  const speakerMutedRef = useRef(false);
  const relayCandidateSeenRef = useRef(false);
  const tabIdRef = useRef("");

  const updateCall = useCallback((next: DirectCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const currentTabId = useCallback(() => {
    if (tabIdRef.current) return tabIdRef.current;
    const storageKey = "alvorecer-call-tab-id";
    let value = window.sessionStorage.getItem(storageKey);
    if (!value) {
      value = window.crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, value);
    }
    tabIdRef.current = value;
    return value;
  }, []);

  const ownershipKey = useCallback(
    (callId: string) => `alvorecer-call-owner:${callId}`,
    [],
  );

  const claimCallOwnership = useCallback(
    (callId: string) => {
      const tabId = currentTabId();
      window.localStorage.setItem(ownershipKey(callId), tabId);
      return tabId;
    },
    [currentTabId, ownershipKey],
  );

  const ownsCall = useCallback(
    (callId: string) =>
      window.localStorage.getItem(ownershipKey(callId)) === currentTabId(),
    [currentTabId, ownershipKey],
  );

  const releaseCallOwnership = useCallback(
    (callId: string) => {
      if (!ownsCall(callId)) return;
      window.localStorage.removeItem(ownershipKey(callId));
    },
    [ownershipKey, ownsCall],
  );

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const clearPeer = useCallback(
    (stopLocal = true) => {
      recoveryRef.current?.dispose();
      recoveryRef.current = null;
      negotiatorRef.current = null;
      setConnection("connecting");
      if (ringTimerRef.current !== null) {
        window.clearTimeout(ringTimerRef.current);
        ringTimerRef.current = null;
      }
      peerRef.current?.close();
      peerRef.current = null;
      peerPromiseRef.current = null;
      signalQueueRef.current = Promise.resolve();
      remoteStreamRef.current = null;
      processedSignalsRef.current.clear();
      offerSentRef.current = false;
      endingRef.current = false;
      relayCandidateSeenRef.current = false;
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
    if (
      current?.getAudioTracks().some((track) => track.readyState === "live")
    ) {
      setMicrophonePermission("granted");
      return current;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission("denied");
      throw new Error("Este navegador não oferece chamadas de voz.");
    }

    setMicrophonePermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
      setMicrophonePermission("granted");
      return stream;
    } catch (reason) {
      setMicrophonePermission("denied");
      throw new Error(microphoneErrorMessage(reason));
    }
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

  const loadIceConfig = useCallback(
    async (callId: string): Promise<CallIceConfig> => {
      const {
        data: { session },
      } = await browserDb().auth.getSession();
      if (!session) throw new Error("Entre novamente para fazer uma chamada.");
      const response = await fetch("/api/calls/ice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ callId }),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.iceServers)) {
        throw new Error(
          body?.error || "Não foi possível preparar a conexão de voz.",
        );
      }
      return body as CallIceConfig;
    },
    [],
  );

  const ensurePeer = useCallback(async () => {
    if (peerRef.current) return peerRef.current;
    if (peerPromiseRef.current) return peerPromiseRef.current;

    const operation = (async () => {
      const target = callRef.current;
      if (!target || target.status !== "active") {
        throw new Error("A chamada ainda não está ativa.");
      }

      const [localStream, iceConfig] = await Promise.all([
        prepareLocalMedia(),
        loadIceConfig(target.id),
      ]);
      const current = callRef.current;
      if (!current || current.id !== target.id || current.status !== "active") {
        throw new Error("A chamada não está mais ativa.");
      }

      const peer = new RTCPeerConnection({
        iceServers: iceConfig.iceServers,
        iceCandidatePoolSize: 2,
      });

      relayConfiguredRef.current = iceConfig.relayAvailable;
      const negotiator = new CallNegotiator(
        peer,
        actor === target.caller_id,
        (kind, payload) => sendSignal(target, kind, payload),
      );
      negotiatorRef.current = negotiator;

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
        if (event.candidate.type === "relay") {
          relayCandidateSeenRef.current = true;
        }
        void sendSignal(
          current,
          "ice",
          event.candidate.toJSON() as unknown as Record<string, unknown>,
        ).catch((reason) => {
          setError(readableErrorMessage(reason));
        });
      };

      const connectionFailureReason = () =>
        relayCandidateSeenRef.current
          ? "Não foi possível restabelecer a conexão de voz."
          : relayConfiguredRef.current
            ? "O servidor de voz não conseguiu abrir uma rota nesta rede."
            : "A rede bloqueou a conexão direta. Servidor TURN necessário.";

      const recovery = new CallRecovery({
        state: (state) => {
          setConnection(state);
          if (state === "connected") setError("");
        },
        fail: () => {
          void failCall(connectionFailureReason());
        },
        restart: async () => {
          if (actor !== target.caller_id) return;
          const operation = signalQueueRef.current.then(async () => {
            const config = await loadIceConfig(target.id);
            if (
              peerRef.current !== peer ||
              callRef.current?.status !== "active"
            )
              return;
            peer.setConfiguration({ iceServers: config.iceServers });
            relayConfiguredRef.current = config.relayAvailable;
            await negotiator.offer(true);
          });
          signalQueueRef.current = operation.catch(() => undefined);
          await operation;
        },
      });
      recoveryRef.current = recovery;
      peer.onconnectionstatechange = () =>
        recovery.update(peer.connectionState);
      // Also handles stalled initial negotiation, which may never emit "failed".
      recovery.update("connecting");

      peerRef.current = peer;
      return peer;
    })();

    peerPromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (peerPromiseRef.current === operation) {
        peerPromiseRef.current = null;
      }
    }
  }, [actor, failCall, loadIceConfig, prepareLocalMedia, sendSignal]);

  const processSignalNow = useCallback(
    async (signal: CallSignal) => {
      const target = callRef.current;
      if (
        !target ||
        target.id !== signal.call_id ||
        target.status !== "active" ||
        !ownsCall(target.id)
      )
        return;
      if (processedSignalsRef.current.has(signal.id)) return;
      processedSignalsRef.current.add(signal.id);
      if (signal.sender_id === actor) return;

      try {
        await ensurePeer();
        await negotiatorRef.current?.receive(signal.kind, signal.payload);
      } catch (reason) {
        if (
          callRef.current?.id !== target.id ||
          callRef.current.status !== "active"
        )
          return;
        const detail = readableErrorMessage(reason);
        setError(detail);
        void failCall(`Falha na negociação: ${detail}`);
      }
    },
    [actor, ensurePeer, failCall, ownsCall],
  );

  const processSignal = useCallback(
    (signal: CallSignal) => {
      const queued = signalQueueRef.current.then(() =>
        processSignalNow(signal),
      );
      signalQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [processSignalNow],
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
        claimCallOwnership(next.id);
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
      claimCallOwnership,
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

    const applyRow = (row: DirectCall) => {
      if (!valid || (actor !== row.caller_id && actor !== row.callee_id))
        return;
      const current = callRef.current;
      if (current && current.id !== row.id && !TERMINAL.has(current.status))
        return;
      if (current?.id === row.id) {
        if (TERMINAL.has(current.status) && !TERMINAL.has(row.status)) return;
        if (current.status === "active" && row.status === "ringing") return;
      }
      if (
        row.status === "ringing" &&
        row.caller_id === actor &&
        !ownsCall(row.id)
      )
        return;
      if (row.status === "active" && !ownsCall(row.id)) {
        if (current?.id === row.id) updateCall(null);
        return;
      }
      updateCall(row);
    };
    let loading = false;
    const loadCurrent = async () => {
      if (!valid || loading) return;
      loading = true;
      const current = callRef.current;
      try {
        let query = db
          .from("direct_calls")
          .select("*")
          .eq("campaign_id", campaign)
          .or(`caller_id.eq.${actor},callee_id.eq.${actor}`);
        query =
          current && !TERMINAL.has(current.status)
            ? query.eq("id", current.id)
            : query.in("status", ["ringing", "active"]);
        const response = await retryNetworkRead(() =>
          query
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        if (!response.error && response.data)
          applyRow(normalizedCall(response.data as Row));
      } catch {
        // Reconcile again when the connection returns.
      } finally {
        loading = false;
      }
    };
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
        (payload) =>
          applyRow(normalizedCall((payload.new || payload.old) as Row)),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadCurrent();
      });
    void loadCurrent();
    const poll = window.setInterval(() => {
      if (callRef.current && !TERMINAL.has(callRef.current.status))
        void loadCurrent();
    }, 5000);

    return () => {
      valid = false;
      window.clearInterval(poll);
      clearPeer();
      updateCall(null);
      void db.removeChannel(channel);
    };
  }, [actor, campaign, clearPeer, ownsCall, updateCall]);

  useEffect(() => {
    if (!call || call.status !== "active" || !ownsCall(call.id)) return;

    let valid = true;
    const db = browserDb();

    let loading = false;
    const loadExisting = async () => {
      if (!valid || loading) return;
      loading = true;
      try {
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
      } catch {
        // The polling fallback retries while audio is connecting.
      } finally {
        loading = false;
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadExisting();
      });

    void loadExisting();
    const poll = window.setInterval(() => {
      // Established audio does not need continuous database polling.
      if (peerRef.current?.connectionState !== "connected") void loadExisting();
    }, 2500);

    return () => {
      valid = false;
      window.clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [actor, call?.id, call?.status, ownsCall, processSignal]);

  useEffect(() => {
    if (!call || call.status !== "active" || !ownsCall(call.id)) return;

    let active = true;
    const begin = async () => {
      try {
        const peer = await ensurePeer();
        if (active && actor === call.caller_id && !offerSentRef.current) {
          offerSentRef.current = true;
          const operation = signalQueueRef.current.then(async () => {
            if (!active || peerRef.current !== peer) return;
            await negotiatorRef.current?.offer();
          });
          signalQueueRef.current = operation.catch(() => undefined);
          await operation;
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
  }, [
    actor,
    call?.id,
    call?.status,
    ensurePeer,
    failCall,
    ownsCall,
    sendSignal,
  ]);

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
  }, [
    actor,
    call?.created_at,
    call?.id,
    call?.status,
    callAction,
    clearPeer,
    updateCall,
  ]);

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
    releaseCallOwnership(call.id);
    const timer = window.setTimeout(() => {
      if (callRef.current?.id === call.id) updateCall(null);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [call?.id, call?.status, clearPeer, releaseCallOwnership, updateCall]);

  const peerIdentity = useMemo(() => {
    if (!call) return undefined;
    const peerId = call.caller_id === actor ? call.callee_id : call.caller_id;
    return identities.find((identity) => identity.id === peerId);
  }, [actor, call, identities]);

  const incoming = Boolean(
    call && call.status === "ringing" && call.callee_id === actor,
  );

  useEffect(() => {
    if (!call || call.status !== "ringing" || call.callee_id !== actor) return;
    void playAlvorecerSound("notification");
    if ("vibrate" in navigator) {
      navigator.vibrate([180, 80, 180, 80, 260]);
    }
  }, [actor, call?.id, call?.status]);

  const statusText = useMemo(() => {
    if (!call) return "";
    if (call.status === "ringing") {
      return incoming
        ? "Chamada de voz recebida"
        : `Ligando para ${peerIdentity?.name || "contato"}...`;
    }
    if (call.status === "active") {
      if (connection === "reconnecting") return "Reconectando áudio...";
      if (connection !== "connected") return "Conectando áudio...";
      return durationLabel(elapsed);
    }
    if (call.status === "declined") return "Chamada recusada";
    if (call.status === "cancelled") return "Chamada cancelada";
    if (call.status === "missed") return "Chamada não atendida";
    if (call.status === "failed")
      return call.failure_reason || "Não foi possível conectar";
    return "Chamada encerrada";
  }, [call, connection, elapsed, incoming, peerIdentity?.name]);

  const accept = async () => {
    if (!call || call.status !== "ringing" || !incoming || busy) return;
    setBusy(true);
    setError("");
    claimCallOwnership(call.id);
    try {
      await prepareLocalMedia();
      await callAction(call, "accept");
    } catch (reason) {
      releaseCallOwnership(call.id);
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

  if (!call) return <audio ref={remoteAudioRef} autoPlay playsInline />;

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.call}
        role="dialog"
        aria-modal="true"
        aria-label="Chamada de voz"
      >
        <audio ref={remoteAudioRef} autoPlay playsInline />

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
          {call.status === "ringing" &&
            incoming &&
            microphonePermission !== "granted" && (
              <small>
                Ao atender, o navegador solicitará acesso ao microfone.
              </small>
            )}
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
              void remoteAudioRef.current
                .play()
                .then(() => setNeedsAudioTap(false));
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
                <span>
                  {busy
                    ? microphonePermission === "requesting"
                      ? "Permitir microfone..."
                      : "Abrindo..."
                    : "Atender"}
                </span>
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
              className={speakerMuted ? styles.controlActive : styles.control}
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
