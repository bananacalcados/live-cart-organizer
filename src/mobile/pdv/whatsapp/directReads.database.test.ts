import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
const A="00000000-0000-0000-0000-000000000001",N="00000000-0000-0000-0000-000000000002",S="00000000-0000-0000-0000-000000000003";
const schema=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${A}'::uuid $$;
CREATE FUNCTION public.is_team_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.has_module_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE user_roles(user_id uuid,role text);INSERT INTO user_roles VALUES('${A}','admin');
CREATE TABLE pos_store_whatsapp_numbers(store_id uuid,whatsapp_number_id uuid);INSERT INTO pos_store_whatsapp_numbers VALUES('${S}','${N}');
CREATE TABLE whatsapp_numbers_safe(id uuid,provider text);INSERT INTO whatsapp_numbers_safe VALUES('${N}','instagram');
CREATE TABLE pos_sellers(id uuid,store_id uuid,linked_user_id uuid,is_active boolean);
CREATE TABLE whatsapp_conversations(phone text,instance_key uuid,whatsapp_number_id uuid,is_group boolean,channel text,sender_name text,last_message text,last_message_at timestamptz,last_direction text,last_is_mass_dispatch boolean,last_incoming_at timestamptz,nm_last_message text,nm_last_message_at timestamptz,nm_last_direction text,nm_last_outgoing_at timestamptz,unread_count bigint);
CREATE TABLE chat_contacts(phone text,custom_name text,display_name text);
CREATE TABLE customers_unified(phone_suffix8 text,merged_into_id uuid,name text,updated_at timestamptz);
CREATE TABLE chat_conversation_assignments(phone text,whatsapp_number_id uuid,assigned_to uuid,assigned_name text);
CREATE TABLE chat_finished_conversations(phone text,whatsapp_number_id uuid,finished_at timestamptz);
CREATE TABLE chat_conversation_lanes(phone_key text,whatsapp_number_id text,lane text);
CREATE TABLE chat_archived_conversations(phone text);
CREATE TABLE chat_awaiting_payment(phone text);
CREATE TABLE support_tickets(customer_phone text,status text);
CREATE TABLE events(id uuid,whatsapp_number_id uuid,default_store_id uuid,is_active boolean);
CREATE TABLE customers(id uuid,whatsapp text,instagram_handle text);
CREATE TABLE orders(id uuid,event_id uuid,customer_id uuid,is_paid boolean,created_at timestamptz,updated_at timestamptz);
CREATE FUNCTION wa_group_chat_state(text,uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'normal'::text $$;
CREATE TABLE whatsapp_messages(id uuid,phone text,whatsapp_number_id uuid,message text,created_at timestamptz,direction text,status text,channel text,source text,sender_name text,media_type text,media_url text,is_group boolean,message_id text,sender_user_id uuid,quoted_message_id text);
CREATE TABLE whatsapp_messages_archive(LIKE whatsapp_messages);
${readFileSync("drizzle/migrations/0325_mobile_whatsapp_live_and_lane_parity.sql","utf8")}
${readFileSync("drizzle/migrations/0326_mobile_whatsapp_lazy_live_candidates.sql","utf8")}
${readFileSync("drizzle/migrations/0332_mobile_instagram_direct_read_only.sql","utf8")}
${readFileSync("drizzle/migrations/0333_mobile_instagram_direct_summary_fast_path.sql","utf8")}
INSERT INTO whatsapp_conversations SELECT phone,'${N}','${N}',false,'instagram',name,'💬 Comentário no Live: teste',now(),'incoming',false,now(),'💬 Comentário no Live: teste',now(),'incoming',NULL,99 FROM (VALUES ('comment-only','@comments'),('mixed','@mixed'),('old','@old'))x(phone,name);
INSERT INTO whatsapp_messages(id,phone,whatsapp_number_id,message,created_at,direction,status,channel,source,quoted_message_id) VALUES
('${A}','mixed','${N}','Direct recebido',now()-interval '10 minutes','incoming','received','instagram','manual','provider-quote'),
('${N}','mixed','${N}','💬 Comentário no Live: teste',now()-interval '1 minute','incoming','received','instagram','manual',NULL),
('${S}','comment-only','${N}','💬 Comentário no Reel: teste',now(),'incoming','received','instagram','manual',NULL);
INSERT INTO whatsapp_messages_archive(id,phone,whatsapp_number_id,message,created_at,direction,status,channel,source) VALUES('00000000-0000-0000-0000-000000000004','old','${N}','Direct antigo',now()-interval '60 days','incoming','read','instagram','instagram_backfill');
INSERT INTO chat_archived_conversations VALUES('old');
CREATE TABLE results(key text,value jsonb);
INSERT INTO results VALUES('list',mobile_whatsapp_page('${S}')),('messages',mobile_instagram_message_page('mixed','${N}')),('updates',mobile_instagram_message_page('mixed','${N}',p_ids=>ARRAY['${A}'::uuid,'${N}'::uuid])),('archive',mobile_instagram_message_page('old','${N}',true)),('search',mobile_whatsapp_page('${S}',p_query=>'@old'));
UPDATE whatsapp_messages SET status='read' WHERE id='${A}';
INSERT INTO results VALUES('read',mobile_whatsapp_page('${S}'));
INSERT INTO whatsapp_messages(id,phone,whatsapp_number_id,message,created_at,direction,status,channel,source) VALUES('00000000-0000-0000-0000-000000000005','mixed','${N}','Resposta de botão',now(),'incoming','received','instagram','ig_interaction');
INSERT INTO results VALUES('button',mobile_instagram_message_page('mixed','${N}')),('after',mobile_instagram_message_page('mixed','${N}',p_after_at=>now()-interval '5 minutes',p_after_id=>'${A}'));
SELECT jsonb_object_agg(key,value)||jsonb_build_object('anon',has_function_privilege('anon','mobile_instagram_message_page(text,uuid,boolean,timestamptz,uuid,timestamptz,uuid,uuid[],integer)','EXECUTE')) FROM results;`;
describe("Instagram Direct only — isolated server reads",()=>{
 let r:Record<string,any>;
 beforeAll(()=>{const lines=execFileSync("bash",["src/test/runEventShippingIsolated.sh"],{input:schema,encoding:"utf8"}).trim().split("\n");r=JSON.parse(lines.at(-1)||"{}");},60000);
 it("comment-only conversations are absent",()=>expect(r.list.map((x:any)=>x.phone)).toEqual(['mixed']));
 it("preview and unread exclude a later comment",()=>expect(r.list[0]).toMatchObject({last_message:'Direct recebido',unread_count:1}));
 it("unread becomes zero although comments stay unread",()=>expect(r.read[0].unread_count).toBe(0));
 it("message pages and status updates exclude comments",()=>{expect(r.messages).toHaveLength(1);expect(r.updates).toHaveLength(1);expect(r.messages[0].quoted_message_id).toBe('provider-quote');});
 it("archive Direct remains readable and searchable",()=>{expect(r.archive[0].message).toBe('Direct antigo');expect(r.search[0].phone).toBe('old');});
 it("Direct interaction replies remain included",()=>expect(r.button.map((x:any)=>x.message)).toContain('Resposta de botão'));
 it("incremental cursor cannot pull a comment",()=>expect(r.after.map((x:any)=>x.message)).toEqual(['Resposta de botão']));
 it("anonymous access remains denied",()=>expect(r.anon).toBe(false));
});