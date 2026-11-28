import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
const A='00000000-0000-0000-0000-000000000001',S='00000000-0000-0000-0000-000000000002',N='00000000-0000-0000-0000-000000000003',SELLER='00000000-0000-0000-0000-000000000004',OWNER='00000000-0000-0000-0000-000000000005',OTHER='00000000-0000-0000-0000-000000000006';
const schema=`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${A}'::uuid $$;
CREATE FUNCTION public.is_team_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.has_module_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES('${A}','admin');
CREATE TABLE pos_store_whatsapp_numbers(store_id uuid,whatsapp_number_id uuid); INSERT INTO pos_store_whatsapp_numbers VALUES('${S}','${N}');
CREATE TABLE whatsapp_numbers_safe(id uuid,provider text); INSERT INTO whatsapp_numbers_safe VALUES('${N}','uazapi');
CREATE TABLE pos_sellers(id uuid,store_id uuid,linked_user_id uuid,is_active boolean); INSERT INTO pos_sellers VALUES('${SELLER}','${S}','${OWNER}',true);
CREATE TABLE whatsapp_conversations(phone text,instance_key uuid,whatsapp_number_id uuid,is_group boolean,channel text,sender_name text,last_message text,last_message_at timestamptz,last_direction text,last_is_mass_dispatch boolean,last_incoming_at timestamptz,nm_last_message text,nm_last_message_at timestamptz,nm_last_direction text,nm_last_outgoing_at timestamptz,unread_count bigint);
CREATE TABLE chat_contacts(phone text,custom_name text,display_name text);
CREATE TABLE customers_unified(phone_suffix8 text,merged_into_id uuid,name text,updated_at timestamptz);
CREATE TABLE chat_conversation_assignments(phone text,whatsapp_number_id uuid,assigned_to uuid,assigned_name text);
CREATE TABLE chat_finished_conversations(phone text,whatsapp_number_id uuid,finished_at timestamptz);
CREATE TABLE chat_conversation_lanes(phone_key text,whatsapp_number_id text,lane text);
CREATE TABLE chat_archived_conversations(phone text); CREATE TABLE chat_awaiting_payment(phone text);
CREATE TABLE support_tickets(customer_phone text,status text);
CREATE TABLE events(id uuid,whatsapp_number_id uuid,default_store_id uuid,is_active boolean);
CREATE TABLE customers(id uuid,whatsapp text,instagram_handle text);
CREATE TABLE orders(id uuid,event_id uuid,customer_id uuid,is_paid boolean,created_at timestamptz,updated_at timestamptz);
CREATE FUNCTION wa_group_chat_state(text,uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'normal'::text $$;
${readFileSync('drizzle/migrations/0325_mobile_whatsapp_live_and_lane_parity.sql','utf8')}
${readFileSync('drizzle/migrations/0326_mobile_whatsapp_lazy_live_candidates.sql','utf8')}
${readFileSync('docs/mobile-pdv/WHATSAPP-MINHAS.sql','utf8')}
INSERT INTO whatsapp_conversations SELECT '55339'||lpad(i::text,8,'0'),'${N}','${N}',false,'whatsapp','Cliente '||i,'Mensagem',now()-i*interval '1 minute','incoming',false,now(),'Mensagem',now()-i*interval '1 minute','incoming',NULL,1 FROM generate_series(1,180)i;
INSERT INTO chat_conversation_assignments SELECT phone,'${N}',CASE WHEN right(phone,8)::integer<=120 THEN '${OTHER}'::uuid ELSE '${OWNER}'::uuid END,'Vendedor' FROM whatsapp_conversations;
CREATE TABLE results(key text,value jsonb);
INSERT INTO results VALUES('mine1',mobile_whatsapp_page('${S}','${SELLER}',p_lane=>'mine',p_limit=>50)),('mine2',mobile_whatsapp_page('${S}','${SELLER}',p_lane=>'mine',p_limit=>50,p_offset=>50)),('none',mobile_whatsapp_page('${S}',p_lane=>'mine')),('all',mobile_whatsapp_page('${S}',p_limit=>100));
UPDATE pos_sellers SET linked_user_id=NULL; UPDATE chat_conversation_assignments SET assigned_to='${SELLER}' WHERE assigned_to='${OWNER}';
INSERT INTO results VALUES('unlinked',mobile_whatsapp_page('${S}','${SELLER}',p_lane=>'mine'));
SELECT jsonb_object_agg(key,value)||jsonb_build_object('anon',has_function_privilege('anon','mobile_whatsapp_page(uuid,uuid,text,uuid,text,integer,integer)','EXECUTE')) FROM results;`;
describe('Minhas filtra no servidor antes de paginar',()=>{
 let result:Record<string,any>;
 beforeAll(()=>{const lines=execFileSync('bash',['src/test/runEventShippingIsolated.sh'],{input:schema,encoding:'utf8'}).trim().split('\n');result=JSON.parse(lines.at(-1)||'{}');},60000);
 it('encontra as 60 atribuídas mesmo depois de 120 de outros vendedores',()=>{expect(result.mine1).toHaveLength(50);expect(result.mine2).toHaveLength(10);expect(result.mine1.every((r:any)=>r.assigned_to===OWNER)).toBe(true);});
 it('não repete conversas entre páginas',()=>expect(result.mine1.some((r:any)=>result.mine2.some((s:any)=>s.phone===r.phone))).toBe(false));
 it('sem vendedor Minhas não mostra conversas de outra pessoa',()=>expect(result.none).toEqual([]));
 it('vendedor sem usuário vinculado usa sua própria identidade',()=>{expect(result.unlinked).toHaveLength(50);expect(result.unlinked.every((r:any)=>r.assigned_to===SELLER)).toBe(true);});
 it('Todas e o bloqueio anônimo ficam inalterados',()=>{expect(result.all).toHaveLength(100);expect(result.anon).toBe(false);});
});