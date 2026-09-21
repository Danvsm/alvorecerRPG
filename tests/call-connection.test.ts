import assert from "node:assert/strict";
import test from "node:test";
import { CallNegotiator, CallRecovery } from "../lib/call-connection";
import { issueCallIceConfig, resolveCallIceConfig } from "../lib/call-ice";

test("Metered uses configured credentials with UDP, TCP and TLS routes", async () => {
  const result = await resolveCallIceConfig({
    meteredUsername: "test-user",
    meteredCredential: "test-credential",
    cloudflareKeyId: "unused",
  });
  assert.equal(result.relayAvailable, true);
  assert.equal(result.iceServers[1].username, "test-user");
  assert.equal(result.iceServers[1].credential, "test-credential");
  assert.deepEqual(result.iceServers[1].urls, [
    "turn:global.relay.metered.ca:80",
    "turn:global.relay.metered.ca:80?transport=tcp",
    "turn:global.relay.metered.ca:443",
    "turns:global.relay.metered.ca:443?transport=tcp",
  ]);
});

test("partial Metered configuration does not silently revert to STUN", async () => {
  await assert.rejects(
    resolveCallIceConfig({ meteredUsername: "test-user" }),
    /incompleta/,
  );
  await assert.rejects(
    resolveCallIceConfig({ meteredCredential: "test-credential" }),
    /incompleta/,
  );
  assert.equal((await resolveCallIceConfig({})).relayAvailable, false);
});

type FakePeerState = {
  localDescription: RTCSessionDescriptionInit | null;
  remoteDescription: RTCSessionDescriptionInit | null;
  signalingState: string;
};

function peerFixture() {
  const added: RTCIceCandidateInit[] = [];
  let generation = 0;
  const peer = {
    signalingState: "stable",
    remoteDescription: null,
    localDescription: null,
    async createOffer(options: RTCOfferOptions) {
      if (options.iceRestart) generation++;
      return { type: "offer", sdp: `a=ice-ufrag:g${generation}\r\n` };
    },
    async createAnswer() {
      return { type: "answer", sdp: "answer" };
    },
    async setLocalDescription(
      this: FakePeerState,
      value: RTCSessionDescriptionInit,
    ) {
      this.localDescription = value;
      this.signalingState =
        value.type === "offer" ? "have-local-offer" : "stable";
    },
    async setRemoteDescription(
      this: FakePeerState,
      value: RTCSessionDescriptionInit,
    ) {
      if (value.type === "answer" && this.signalingState !== "have-local-offer")
        throw new Error("Wrong SDP state");
      this.remoteDescription = value;
      this.signalingState =
        value.type === "offer" ? "have-remote-offer" : "stable";
    },
    async addIceCandidate(candidate: RTCIceCandidateInit) {
      if (candidate.candidate === "invalid")
        throw new Error("Obsolete candidate");
      added.push(candidate);
    },
  } as unknown as RTCPeerConnection;
  const sent: { kind: string; payload: Record<string, unknown> }[] = [];
  const send = async (kind: string, payload: Record<string, unknown>) => {
    sent.push({ kind, payload });
  };
  return { peer, sent, added, send };
}

test("callee accepts ICE restart offers, but not duplicate offers", async () => {
  const f = peerFixture();
  const n = new CallNegotiator(f.peer, false, f.send);
  const offer = {
    type: "offer",
    sdp: "a=ice-ufrag:old\r\n",
    negotiationId: "first",
  };
  await n.receive("offer", offer);
  await n.receive("offer", offer);
  assert.equal(f.sent.length, 1);
  await n.receive("ice", { candidate: "future", usernameFragment: "new" });
  assert.equal(f.added.length, 0);
  await n.receive("offer", {
    ...offer,
    sdp: "a=ice-ufrag:new\r\n",
    negotiationId: "second",
  });
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].payload.negotiationId, "second");
  assert.equal(f.added[0].candidate, "future");
});

test("late answer cannot complete a newer ICE negotiation", async () => {
  const f = peerFixture();
  const n = new CallNegotiator(f.peer, true, f.send);
  await n.offer();
  const first = f.sent[0].payload.negotiationId;
  await n.offer(true);
  const second = f.sent[1].payload.negotiationId;
  assert.notEqual(first, second);
  await n.receive("answer", { sdp: "stale", negotiationId: first });
  assert.equal(f.peer.remoteDescription, null);
  await n.receive("answer", { sdp: "current", negotiationId: second });
  assert.equal(f.peer.signalingState, "stable");
  await n.receive("answer", { sdp: "duplicate", negotiationId: second });
  assert.equal(
    (f.peer.remoteDescription as RTCSessionDescription | null)?.sdp,
    "current",
  );
});

test("one invalid ICE route does not abort the next viable route", async () => {
  const f = peerFixture();
  const n = new CallNegotiator(f.peer, false, f.send);
  await n.receive("ice", { candidate: "invalid" });
  await n.receive("ice", { candidate: "valid-before-sdp" });
  await n.receive("offer", { sdp: "offer" });
  await n.receive("ice", { candidate: "invalid" });
  await n.receive("ice", { candidate: "valid-after-sdp" });
  assert.equal(f.added.length, 2);
});

test("a brief disconnection recovers without hanging up or restarting", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let restarts = 0,
    failures = 0;
  const r = new CallRecovery({
    restart: async () => {
      restarts++;
    },
    fail: () => {
      failures++;
    },
    state: () => {},
  });
  r.update("disconnected");
  t.mock.timers.tick(2000);
  r.update("connected");
  t.mock.timers.tick(60000);
  assert.equal(restarts, 0);
  assert.equal(failures, 0);
  r.dispose();
});

test("failed ICE retries once and allows 35 seconds to reconnect", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let restarts = 0,
    failures = 0;
  const r = new CallRecovery({
    restart: async () => {
      restarts++;
    },
    fail: () => {
      failures++;
    },
    state: () => {},
  });
  r.update("failed");
  r.update("failed");
  assert.equal(restarts, 1);
  t.mock.timers.tick(34000);
  assert.equal(failures, 0);
  r.update("connected");
  t.mock.timers.tick(10000);
  assert.equal(failures, 0);
  r.dispose();
});

test("stalled setup eventually fails; disposal cancels recovery", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let restarts = 0,
    failures = 0;
  const r = new CallRecovery({
    restart: async () => {
      restarts++;
    },
    fail: () => {
      failures++;
    },
    state: () => {},
  });
  r.update("connecting");
  t.mock.timers.tick(20000);
  assert.equal(restarts, 1);
  t.mock.timers.tick(35000);
  assert.equal(failures, 1);
  r.dispose();
  r.update("failed");
  t.mock.timers.tick(60000);
  assert.equal(restarts, 1);
});

test("TURN credentials come from provider, never from the permanent API token", async () => {
  let requested = false;
  const config = await issueCallIceConfig(
    "key-id",
    "permanent-secret",
    async (url, init) => {
      requested = true;
      assert.match(String(url), /key-id\/credentials\/generate-ice-servers$/);
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer permanent-secret",
      );
      return Response.json({
        iceServers: [
          {
            urls: [
              "turn:relay:3478?transport=udp",
              "turns:relay:443?transport=tcp",
              "turn:relay:53",
            ],
            username: "expires",
            credential: "temporary",
          },
        ],
      });
    },
  );
  assert.equal(requested, true);
  assert.equal(config.relayAvailable, true);
  assert.equal((config.iceServers[0].urls as string[]).length, 2);
  assert.doesNotMatch(JSON.stringify(config), /permanent-secret/);
});

test("unconfigured TURN is explicit; broken configured TURN never silently falls back", async () => {
  assert.equal(
    (await issueCallIceConfig(undefined, undefined)).relayAvailable,
    false,
  );
  await assert.rejects(issueCallIceConfig("id", undefined), /incompleta/);
  await assert.rejects(
    issueCallIceConfig(
      "id",
      "secret",
      async () => new Response("Internal Server Error", { status: 500 }),
    ),
    /preparar/,
  );
  await assert.rejects(
    issueCallIceConfig("id", "secret", async () =>
      Response.json({ iceServers: [{ urls: "stun:only:3478" }] }),
    ),
    /retransmissão/,
  );
});
