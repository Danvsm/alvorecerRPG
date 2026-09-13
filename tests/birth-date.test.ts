import { test } from "node:test";
import assert from "node:assert/strict";
import { validBirthDate } from "../supabase/functions/alvorecer-api/birth-date";

test("birth date is required, a real calendar date and not in the future", () => {
  for (const value of [
    undefined,
    null,
    "",
    "2001-02-29",
    "2000-02-30",
    "13/09/2000",
    "9999-01-01",
    "0000-01-01",
  ])
    assert.equal(validBirthDate(value), false, String(value));
  for (const value of ["2000-02-29", "2001-08-14", "1990-12-31"])
    assert.equal(validBirthDate(value), true, value);
});
