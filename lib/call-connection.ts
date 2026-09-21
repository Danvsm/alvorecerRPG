export type CallSignalKind = "offer" | "answer" | "ice";
type SendSignal = (
  kind: CallSignalKind,
  payload: Record<string, unknown>,
) => Promise<void>;

/** One negotiator per call. Its methods must run on the same serialized queue. */
export class CallNegotiator {
  private offerId: string | null = null;
  private candidates: RTCIceCandidateInit[] = [];

  constructor(
    private peer: RTCPeerConnection,
    private caller: boolean,
    private send: SendSignal,
  ) {}

  async offer(restart = false) {
    if (!this.caller || this.peer.signalingState === "closed") return;
    this.offerId = crypto.randomUUID();
    const offer = await this.peer.createOffer({ iceRestart: restart });
    await this.peer.setLocalDescription(offer);
    await this.send("offer", {
      type: "offer",
      sdp: this.peer.localDescription?.sdp,
      negotiationId: this.offerId,
    });
  }

  private matches(candidate: RTCIceCandidateInit) {
    return (
      !candidate.usernameFragment ||
      Boolean(
        this.peer.remoteDescription?.sdp.includes(
          `a=ice-ufrag:${candidate.usernameFragment}\r\n`,
        ),
      )
    );
  }

  private async add(candidate: RTCIceCandidateInit) {
    try {
      await this.peer.addIceCandidate(candidate);
    } catch {
      // One obsolete or incompatible route must not terminate all other routes.
    }
  }

  private async drain() {
    const pending = this.candidates.splice(0);
    for (const candidate of pending) {
      if (this.matches(candidate)) await this.add(candidate);
    }
  }

  async receive(kind: CallSignalKind, payload: Record<string, unknown>) {
    const peer = this.peer;
    if (peer.signalingState === "closed") return;
    if (kind === "ice") {
      const candidate = payload as RTCIceCandidateInit;
      if (peer.remoteDescription && this.matches(candidate))
        await this.add(candidate);
      else {
        this.candidates.push(candidate);
        if (this.candidates.length > 128) this.candidates.shift();
      }
      return;
    }
    if (kind === "offer" && !this.caller) {
      if (
        peer.signalingState !== "stable" ||
        peer.remoteDescription?.sdp === payload.sdp
      )
        return;
      await peer.setRemoteDescription({
        type: "offer",
        sdp: String(payload.sdp),
      });
      await this.drain();
      await peer.setLocalDescription(await peer.createAnswer());
      await this.send("answer", {
        type: "answer",
        sdp: peer.localDescription?.sdp,
        negotiationId: payload.negotiationId,
      });
    }
    if (kind === "answer" && this.caller) {
      if (peer.signalingState !== "have-local-offer") return;
      // Delayed answers to an earlier ICE attempt cannot answer a newer offer.
      if (payload.negotiationId && payload.negotiationId !== this.offerId)
        return;
      await peer.setRemoteDescription({
        type: "answer",
        sdp: String(payload.sdp),
      });
      await this.drain();
    }
  }
}

type RecoveryOptions = {
  restart: () => Promise<void>;
  fail: () => void;
  state: (value: "connecting" | "connected" | "reconnecting") => void;
};

/** Bounded recovery: tolerate short interruptions, then renegotiate once. */
export class CallRecovery {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recovering = false;
  private disposed = false;
  constructor(private options: RecoveryOptions) {}

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  update(state: RTCPeerConnectionState) {
    if (this.disposed) return;
    if (state === "connected") {
      this.cancelTimer();
      this.recovering = false;
      this.options.state("connected");
    } else if (state === "closed") {
      this.dispose();
    } else if (!this.recovering) {
      if (state === "failed") {
        this.cancelTimer();
        this.recover();
      } else if (!this.timer) {
        this.options.state(
          state === "disconnected" ? "reconnecting" : "connecting",
        );
        this.timer = setTimeout(
          () => this.recover(),
          state === "disconnected" ? 3000 : 20000,
        );
      }
    }
  }

  private recover() {
    if (this.disposed || this.recovering) return;
    this.recovering = true;
    this.options.state("reconnecting");
    this.timer = setTimeout(() => {
      if (!this.disposed) this.options.fail();
    }, 35000);
    // Only the caller creates restart offers; the callee waits for them.
    void this.options.restart().catch(() => {
      // Signaling may be briefly offline. Leave the recovery window open.
    });
  }

  dispose() {
    this.disposed = true;
    this.cancelTimer();
  }
}
