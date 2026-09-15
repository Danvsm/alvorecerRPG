import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avatarSelectionRequest,
  characterAvatarIdentityId,
} from "../lib/avatar";

test("detached character never matches an orphaned player identity", () => {
  assert.equal(
    characterAvatarIdentityId("campaign", { owner_id: null }, [
      {
        id: "orphaned-identity",
        user_id: null,
        campaign_id: "campaign",
        kind: "player",
      },
    ]),
    undefined,
  );
});

test("owned character resolves its player's social identity", () => {
  assert.equal(
    characterAvatarIdentityId("campaign", { owner_id: "player" }, [
      {
        id: "other-campaign-identity",
        user_id: "player",
        campaign_id: "other-campaign",
        kind: "player",
      },
      {
        id: "player-identity",
        user_id: "player",
        campaign_id: "campaign",
        kind: "player",
      },
    ]),
    "player-identity",
  );
});

test("master character avatar selection targets the player's social identity", () => {
  assert.deepEqual(
    avatarSelectionRequest(
      "campaign",
      {
        kind: "character",
        characterId: "player-character",
        identityId: "player-identity",
      },
      "new-avatar",
    ),
    {
      rpc: "identity_action",
      params: {
        c: "campaign",
        op: "avatar",
        d: { identity_id: "player-identity", avatar_id: "new-avatar" },
      },
    },
  );
});

test("detached character avatar selection remains scoped to that character", () => {
  assert.deepEqual(
    avatarSelectionRequest(
      "campaign",
      { kind: "character", characterId: "detached-character" },
      "new-avatar",
    ),
    {
      rpc: "game_action",
      params: {
        c: "campaign",
        op: "avatar_select",
        d: {
          character_id: "detached-character",
          avatar_id: "new-avatar",
        },
      },
    },
  );
});

test("profile avatar selection remains scoped to the signed-in identity", () => {
  assert.deepEqual(
    avatarSelectionRequest(
      "campaign",
      { kind: "profile", identityId: "master-identity" },
      "new-avatar",
    ),
    {
      rpc: "identity_action",
      params: {
        c: "campaign",
        op: "avatar",
        d: { identity_id: "master-identity", avatar_id: "new-avatar" },
      },
    },
  );
});
