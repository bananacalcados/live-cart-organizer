import { processStoryReplyAutomation } from "./instagram-comment-automation.ts";
import { buildRhVagaMetaMessage } from "./rh-vaga-automation.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function fixture() {
  const rules = [
    { id: "rh-rule", name: "VAGA-RH", trigger_type: "rh_vaga", media_types: ["post", "REELS", "IGTV", "story", "live"], cooldown_minutes: 60, action_send_dm: true, dm_message_text: "Oii {username}!", min_delay_seconds: 20, max_delay_seconds: 60 },
    { id: "legacy", name: "Antiga", trigger_type: "all", media_types: ["story"], cooldown_minutes: 60, action_send_dm: false },
  ].map((rule) => ({ ...rule, is_active: true }));
  const actions: any[] = [], jobs: any[] = [], reads: string[] = [];
  let submitted = false, linkCalls = 0;
  const sb: any = {
    from(table: string) {
      reads.push(table);
      const filters: Array<[string, unknown]> = [];
      let write: any, single = false, update = false;
      const q: any = {
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(k: string, v: unknown) { filters.push([k, v]); return q; },
        like(k: string, v: string) { filters.push([k, v]); return q; },
        gte() { return q; },
        insert(v: any) { write = v; return q; },
        update(v: any) { write = v; update = true; return q; },
        single() { single = true; return q; }, maybeSingle() { single = true; return q; },
        then(resolve: (v: any) => unknown, reject: (e: unknown) => unknown) {
          try {
            if (update) return Promise.resolve({ error: null }).then(resolve);
            const pool = table === "instagram_comment_rules" ? rules : table === "instagram_comment_actions" ? actions : table === "ig_live_cart_notifications" ? jobs : [{ id: "vacancy", ativo: true }];
            if (write) {
              const duplicate = pool.some((a) => table === "instagram_comment_actions"
                ? a.comment_id === write.comment_id && a.rule_id === write.rule_id && a.action_type === write.action_type
                : a.source_key === write.source_key && a.instagram_handle === write.instagram_handle);
              if (duplicate) return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve);
              const row = { ...write, id: `row-${pool.length}` }; pool.push(row);
              return Promise.resolve({ data: row, error: null }).then(resolve);
            }
            const found = pool.filter((a) => filters.every(([k, v]) => typeof v === "string" && v.endsWith("%") ? String(a[k]).startsWith(v.slice(0, -1)) : a[k] === v));
            return Promise.resolve({ data: single ? found[0] || null : found, error: null }).then(resolve);
          } catch (e) { return Promise.reject(e).then(resolve, reject); }
        },
      };
      return q;
    },
    rpc(name: string) {
      assert(name === "rh_create_link", "Unexpected RPC");
      linkCalls++;
      return Promise.resolve({ data: { code: "abc123def4", estado: submitted ? "enviado" : "gerado" }, error: null });
    },
  };
  return { sb, actions, jobs, reads, submitted: () => { submitted = true; }, linkCalls: () => linkCalls };
}

for (const [sourceKind, text] of [["story", "😊 V A G A!!"], ["dm", "quero a vagá"], ["story", "vaja"]] as const) {
  Deno.test(`RH inbox ${sourceKind}: ${text}`, async () => {
    const f = fixture();
    const result = await processStoryReplyAutomation(f.sb, { sourceKind, fromId: "sender", username: "@pessoa_teste", text, messageId: "mid-1", storyId: sourceKind === "story" ? "story-123" : null, accountId: "account" }, "mock-token");
    assert(result.actions.includes("dm_queued:VAGA-RH"), "RH did not queue");
    assert(f.jobs.length === 1 && f.jobs[0].comment_id === null && f.jobs[0].recipient_id === "sender", "Wrong recipient/public comment");
    const message: any = buildRhVagaMetaMessage(f.jobs[0]);
    assert(message.attachment.payload.buttons[0].url === "https://checkout.bananacalcados.com.br/vaga/abc123def4", "Wrong URL");
    assert(f.actions.every((a) => a.action_type !== "reply"), "Public reply was reserved");
    if (sourceKind === "dm") assert(f.actions.every((a) => a.rule_id === "rh-rule"), "Legacy rule ran on DM");
  });
}

Deno.test("Direct: duplicate/concurrent delivery + cross-story cooldown produce one job", async () => {
  const f = fixture();
  const input = { sourceKind: "dm" as const, fromId: "same-sender", username: "pessoa_teste", text: "VAGA", messageId: "mid-1" };
  await Promise.all([processStoryReplyAutomation(f.sb, input, "mock-token"), processStoryReplyAutomation(f.sb, input, "mock-token")]);
  await processStoryReplyAutomation(f.sb, { ...input, sourceKind: "story", messageId: "mid-2", storyId: "story-1" }, "mock-token");
  assert(f.jobs.length === 1 && f.linkCalls() === 1, "Duplicate link or notice");
});

Deno.test("Submitted candidate receives confirmation without button/new link", async () => {
  const f = fixture(); f.submitted();
  await processStoryReplyAutomation(f.sb, { sourceKind: "dm", fromId: "sender", username: "pessoa_teste", text: "vga", messageId: "mid-3" }, "mock-token");
  assert(f.jobs.length === 1 && f.jobs[0].link_token === null, "Submitted link got button");
  assert(f.jobs[0].message.includes("Já recebemos"), "Missing confirmation");
});

Deno.test("Ordinary unrelated DM makes zero automation queries", async () => {
  const f = fixture();
  await processStoryReplyAutomation(f.sb, { sourceKind: "dm", fromId: "sender", username: "pessoa_teste", text: "uma vaca", messageId: "mid-4" }, "mock-token");
  assert(f.reads.length === 0 && f.jobs.length === 0, "Unrelated DM touched automation");
});