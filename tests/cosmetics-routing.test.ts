import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosmeticsActionRequest,
  FORCE_DELETE_FRAME,
  LEGACY_COSMETIC_EQUIP,
} from "../lib/cosmetics";

test("new avatar frames use frame_action with frame_id", () => {
  assert.deepEqual(
    cosmeticsActionRequest("campaign", "equip", {
      identity_id: "identity",
      frame_id: "frame",
    }),
    {
      rpc: "frame_action",
      params: {
        c: "campaign",
        op: "equip",
        d: { identity_id: "identity", frame_id: "frame" },
      },
    },
  );
});

test("legacy cosmetics use identity_action with cosmetic_id", () => {
  assert.deepEqual(
    cosmeticsActionRequest("campaign", LEGACY_COSMETIC_EQUIP, {
      identity_id: "identity",
      cosmetic_id: "cosmetic",
    }),
    {
      rpc: "identity_action",
      params: {
        c: "campaign",
        op: "equip",
        d: { identity_id: "identity", cosmetic_id: "cosmetic" },
      },
    },
  );
});

test("forced frame deletion uses its master-only RPC", () => {
  assert.deepEqual(
    cosmeticsActionRequest("campaign", FORCE_DELETE_FRAME, {
      frame_id: "frame",
    }),
    {
      rpc: "delete_avatar_frame",
      params: {
        c: "campaign",
        target_id: "frame",
      },
    },
  );
});
