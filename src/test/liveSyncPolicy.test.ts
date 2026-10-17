import { describe, expect, it } from "vitest";
import { LIVE_SYNC_SECOND_PASS_MS, selectLiveAccounts } from "../../supabase/functions/_shared/live-sync-policy";
describe("live recovery load", () => {
 it("uses only the live account when the event identifies it", () => {
  const rows = [{instagram_username:"bananacalcados", label:"Principal"}, {instagram_username:"bananacalcadosgv",label:"GV"}];
  expect(selectLiveAccounts(rows,"https://www.instagram.com/bananacalcados/live/123")).toEqual([rows[0]]);
 });
 it("keeps discovery when no account matches", () => {
  const rows = [{instagram_username:"example",label:null}];
  expect(selectLiveAccounts(rows,null)).toEqual(rows);
 });
 it("performs only a second server check at 30 seconds", () => {
  expect(LIVE_SYNC_SECOND_PASS_MS).toBe(30000);
 });
});