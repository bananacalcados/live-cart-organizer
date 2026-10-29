import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { normalizeBRPhone, buildPhoneVariations } from "../_shared/phone-utils.ts";
import { phoneKey } from "../_shared/blocked-guard.ts";
import { crossellNextAt, metaCrossellWindow, validateCrossellBlocks, type CrossellBlock } from "../_shared/crossell-blocks.ts";

const mediaSchema = z.object({ url: z.string().url().max(2048), name: z.string().max(150), mime: z.string().max(100), size: z.number().min(0).max(104857600) });
const blockSchema = z.object({ id: z.string().uuid(), kind: z.enum(["text","image","document","audio","video","buttons"]), text: z.string().max(4096), media: z.array(mediaSchema).max(20), buttons: z.array(z.object({ title: z.string().min(1).max(20), interest: z.boolean() })).max(3) });
const schema = z.object({ action: z.enum(["list","save","start","history","resume","cancel","run"]), eventId: z.string().uuid().optional(), orderId: z.string().uuid().optional(), instanceId: z.string().uuid().optional(), requestId: z.string().uuid().optional(), sendId: z.string().uuid().optional(), presetId: z.string().uuid().optional(), name: z.string().min(1).max(100).optional(), blocks: z.array(blockSchema).min(1).max(50).optional() });
const url = Deno.env.get("SUPABASE_URL") || "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(url, key);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const check = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
const fields = "id,send_id,order_id,phone,whatsapp_number_id,crossell_state,crossell_progress,crossell_next_at,crossell_interest_at,reason,created_at";

async function guarded(phone: string, instanceId: string) {
  const variants = buildPhoneVariations(phone);
  const [number, optout, blocked, crm] = await Promise.all([
    db.from("whatsapp_numbers").select("id,provider,is_active").eq("id",instanceId).maybeSingle(),
    db.from("automation_opt_outs").select("id").eq("phone_key",phoneKey(phone)).limit(1),
    db.from("blocked_contacts").select("id").in("phone",variants).limit(1),
    db.from("customers_unified").select("id").eq("ddd",phoneKey(phone).slice(0,2)).eq("phone_suffix8",phoneKey(phone).slice(-8)).eq("opt_out_mass_dispatch",true).limit(1),
  ]);
  for (const r of [number,optout,blocked,crm]) check(r.error);
  if (!number.data?.is_active || !["uazapi","meta"].includes(number.data.provider || "meta")) throw new Error("Instância indisponível para Crossell por blocos.");
  if (optout.data?.length || blocked.data?.length || crm.data?.length) throw new Error("Oferta bloqueada: cliente descadastrada ou bloqueada.");
  const provider = number.data.provider || "meta";
  if (provider === "meta") {
    const { data, error } = await db.from("whatsapp_conversations").select("last_incoming_at").in("phone",variants).eq("instance_key",instanceId).limit(10);
    check(error);
    const last = (data || []).map((r) => r.last_incoming_at).filter(Boolean).sort().at(-1) || null;
    if (!metaCrossellWindow(last)) throw new Error("Janela Meta de 24 horas encerrada. Use um template aprovado.");
  }
  return provider;
}
function background(task: Promise<unknown>) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task); else task.catch(console.error);
}
async function run(sendId: string) {
  const started = Date.now();
  while (Date.now() - started < 40000) {
    const { data: send, error: sendError } = await db.from("event_bulk_sends").select("id,manual_blocks,status,base_components,template_label,created_by").eq("id",sendId).maybeSingle();
    check(sendError);
    if (!send?.manual_blocks || send.status === "cancelled" || send.status === "done") return;
    const { data: row, error: rowError } = await db.from("event_bulk_send_items").select(fields).eq("send_id",sendId).limit(1).maybeSingle();
    check(rowError);
    if (!row || row.crossell_state !== "pending") return;
    const wait = Math.max(0, Date.parse(row.crossell_next_at || "") - Date.now()) || 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const { data: claimed, error: claimError } = await db.rpc("claim_manual_crossell", { p_item_id: row.id });
    check(claimError);
    const item = claimed?.[0];
    if (!item) return;
    const progress = item.crossell_progress as { block: number; file: number; sent: Record<string,unknown>[] };
    const blocks = send.base_components as unknown as CrossellBlock[];
    const block = blocks[progress.block];
    if (!block) return;
    let dispatched = false;
    try {
      const provider = await guarded(item.phone,item.whatsapp_number_id);
      const validation = validateCrossellBlocks(blocks,provider);
      if (validation) throw new Error(validation);
      const count = ["text","buttons"].includes(block.kind) ? 1 : block.media.length;
      for (let file = progress.file; file < count; file++) {
        const { data: current } = await db.from("event_bulk_sends").select("status").eq("id",sendId).single();
        if (current?.status === "cancelled") {
          await db.from("event_bulk_send_items").update({ crossell_state: "cancelled", status: "skipped" }).eq("id",item.id);
          return;
        }
        await guarded(item.phone,item.whatsapp_number_id);
        const media = block.media[file];
        const buttons = block.buttons.map((b,i) => ({ ...b, id: `cxb:${item.id}:${block.id}:${i}` }));
        let endpoint = provider === "meta" ? "meta-whatsapp-send" : "uazapi-send-message";
        const body: Record<string,unknown> = { phone:item.phone,whatsapp_number_id:item.whatsapp_number_id,message:block.text };
        if (block.kind === "buttons") {
          if (provider === "meta") Object.assign(body,{ type:"interactive",interactiveData:{ body:block.text,buttons } });
          else { endpoint="uazapi-send-buttons"; body.buttons=buttons; }
        } else if (block.kind !== "text") {
          if (provider === "uazapi") endpoint="uazapi-send-media";
          Object.assign(body,{ type:block.kind,mediaType:block.kind,mediaUrl:media.url,fileName:media.name,caption:block.kind === "audio" ? "" : block.text });
        }
        dispatched = true;
        const response = await fetch(`${url}/functions/v1/${endpoint}`, { method:"POST", headers:{ Authorization:`Bearer ${key}`,"Content-Type":"application/json","x-force-instance":"true" },body:JSON.stringify(body),signal:AbortSignal.timeout(55000) });
        const result = await response.json();
        if (!response.ok || !result.success || !result.messageId) throw new Error(result.error || "Resultado do envio não confirmado; confira a conversa antes de reenviar.");
        const messageId = String(result.messageId);
        progress.file = file+1;
        progress.sent.push({ blockId:block.id,file,messageId,buttons:block.kind === "buttons" ? buttons : [],at:new Date().toISOString() });
        const saved = await db.from("event_bulk_send_items").update({ crossell_progress:progress,message_id:messageId }).eq("id",item.id);
        check(saved.error);
        const persisted = await db.from("whatsapp_messages").insert({ phone:item.phone,whatsapp_number_id:item.whatsapp_number_id,message:block.text || media?.name || "",direction:"outgoing",status:"sent",message_id:messageId,media_type:["text","buttons"].includes(block.kind) ? null : block.kind,media_url:media?.url || null,sender_user_id:send.created_by,source:"live_crossell_blocks" });
        if (persisted.error) console.error("[crossell] histórico não gravado",persisted.error.message);
        dispatched = false;
      }
      progress.block++;
      progress.file=0;
      const done = progress.block>=blocks.length;
      const update = await db.from("event_bulk_send_items").update({ crossell_progress:progress,crossell_state:done ? "done" : "pending",status:done ? "sent" : "pending",crossell_next_at:done ? null : crossellNextAt(Date.now(),null),locked_until:null,sent_at:done ? new Date().toISOString() : null,reason:null }).eq("id",item.id);
      check(update.error);
      if (done) { await db.from("event_bulk_sends").update({ status:"done",sent_count:1 }).eq("id",sendId).neq("status","cancelled"); return; }
    } catch(e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.from("event_bulk_send_items").update({ crossell_state:dispatched ? "review" : "paused",reason:message,locked_until:null }).eq("id",item.id);
      return;
    }
  }
  // Continuation does not reclaim a sending/uncertain block, and adds no cron.
  background(fetch(`${url}/functions/v1/live-crossell-blocks`,{ method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({action:"run",sendId}) }).then((r)=>r.text()));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:corsHeaders});
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return json({error:"Dados inválidos",details:parsed.error.flatten()},400);
    const body = parsed.data;
    const authorization = req.headers.get("Authorization") || "";
    if (body.action === "run") {
      if (authorization !== `Bearer ${key}` || !body.sendId) return json({error:"Acesso negado"},403);
      background(run(body.sendId)); return json({ok:true});
    }
    const userDb = createClient(url,Deno.env.get("SUPABASE_ANON_KEY") || "",{global:{headers:{Authorization:authorization}}});
    const {data:auth,error:authError} = await userDb.auth.getClaims(authorization.replace(/^Bearer /,""));
    const userId = auth?.claims?.sub;
    if (authError || !userId) return json({error:"Sessão inválida"},401);
    const [admin,permission] = await Promise.all([db.rpc("has_role",{_user_id:userId,_role:"admin"}),db.rpc("has_module_access",{_user_id:userId,_module:"events"})]);
    check(admin.error); check(permission.error);
    if (!admin.data && !permission.data) return json({error:"Sem acesso aos Eventos"},403);
    if (body.action === "list") {
      const {data,error} = await db.from("event_message_presets").select("id,name,payload").eq("kind","crossell_blocks").order("updated_at",{ascending:false}).limit(50);
      check(error); return json({offers:data});
    }
    if (body.action === "save") {
      if (!body.blocks || !body.name) return json({error:"Nome e blocos obrigatórios"},400);
      const error = validateCrossellBlocks(body.blocks,"uazapi");
      if (error) return json({error},400);
      const row = {name:body.name,kind:"crossell_blocks",payload:body.blocks,created_by:userId};
      const result = body.presetId ? await db.from("event_message_presets").update(row).eq("id",body.presetId).eq("kind","crossell_blocks").select("id").single() : await db.from("event_message_presets").insert(row).select("id").single();
      check(result.error); return json({id:result.data.id});
    }
    if (body.action === "start") {
      if (!body.orderId || !body.instanceId || !body.requestId || !body.blocks) return json({error:"Pedido, instância e blocos obrigatórios"},400);
      const {data:order,error} = await userDb.from("orders").select("id,event_id,customer:customers(whatsapp)").eq("id",body.orderId).single();
      check(error);
      const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
      const phone = normalizeBRPhone(customer?.whatsapp || "");
      if (!phone) return json({error:"Pedido sem WhatsApp confirmado"},400);
      const provider = await guarded(phone,body.instanceId);
      const validation = validateCrossellBlocks(body.blocks,provider);
      if (validation) return json({error:validation},400);
      const {data:sendId,error:createError} = await db.rpc("start_manual_crossell",{p_id:body.requestId,p_event:order.event_id,p_order:order.id,p_phone:phone,p_instance:body.instanceId,p_user:userId,p_name:body.name || "Crossell",p_blocks:body.blocks});
      check(createError);
      background(run(sendId)); return json({sendId});
    }
    if (body.action === "history") {
      if (!body.orderId) return json({error:"Pedido obrigatório"},400);
      const {data:order,error} = await userDb.from("orders").select("id").eq("id",body.orderId).single();
      check(error);
      const {data,error:historyError} = await db.from("event_bulk_send_items").select(`${fields},event_bulk_sends!inner(template_label,manual_blocks,base_components)`).eq("order_id",order.id).eq("event_bulk_sends.manual_blocks",true).order("created_at",{ascending:false}).limit(10);
      check(historyError); return json({history:data});
    }
    if (!body.sendId) return json({error:"Envio obrigatório"},400);
    const {data:send,error} = await userDb.from("event_bulk_sends").select("id,created_by,manual_blocks,status").eq("id",body.sendId).single();
    check(error);
    if (!send.manual_blocks) return json({error:"Envio incompatível"},403);
    if (body.action === "cancel") {
      await db.from("event_bulk_sends").update({status:"cancelled"}).eq("id",send.id);
      await db.from("event_bulk_send_items").update({crossell_state:"cancelled",status:"skipped"}).eq("send_id",send.id).in("crossell_state",["pending","paused"]);
      return json({ok:true});
    }
    if (body.action === "resume") {
      await db.from("event_bulk_send_items").update({crossell_state:"pending",reason:null}).eq("send_id",send.id).eq("crossell_state","paused");
      background(run(send.id)); return json({ok:true});
    }
    return json({error:"Ação inválida"},400);
  } catch(e) { return json({error:e instanceof Error ? e.message : "Erro no Crossell"},400); }
});