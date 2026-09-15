import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarSelectionRequest } from "../lib/avatar";

test("master character avatar selection targets the selected character", () => {
  assert.deepEqual(
    avatarSelectionRequest(
      "campaign",
      { kind: "character", characterId: "player-character" },
      "new-avatar",
    ),
    {
      rpc: "game_command",
      params: {
        c: "campaign",
        op: "avatar_select",
        d: {
          character_id: "player-character",
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
