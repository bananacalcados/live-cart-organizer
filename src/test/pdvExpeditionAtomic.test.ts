import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
const sql = readFileSync('drizzle/migrations/0319_pdv_expedition_atomic_transitions_and_scans.sql','utf8') + readFileSync('drizzle/migrations/0321_pdv_transition_unambiguous_item_alias.sql','utf8');
const release = readFileSync('drizzle/migrations/0219_shipped_at_tracking_cancel_before_ship.sql','utf8');
const releaseStart = release.indexOf('CREATE OR REPLACE FUNCTION public.pos_sales_release_on_expedition()');
const releaseEnd = release.indexOf('$function$',releaseStart); // migrations use $$, take exact function through its terminator below
const releaseFunction = release.slice(releaseStart).split('$$;')[0]+'$$;';
const id='00000000-0000-0000-0000-000000000001';
const iid='00000000-0000-0000-0000-000000000002';
const sid='00000000-0000-0000-0000-000000000003';
const stamp='2026-11-28T12:00:00Z';
const literal=(v:unknown)=>`'${JSON.stringify(v).replace(/'/g,"''")}'::jsonb`;
function call(mode:string,stage:string,target:string|null,qty=2,conference=0,waiting=0,completed=0,picked=0) {
 return `SELECT public.pos_expedition_transition(${literal([{id,stage}])},'${mode}',${target===null?'NULL':`'${target}'`},${literal([{id:iid,total_qty:2,qty,conference,waiting,completed,picked,scanned:true,feet_ok:true,has_defect:false}])},${literal({carrier:'Correios PAC',tracking_carrier:'Correios',tracking:'AP123456789BR',tracking_url:'',delivery_days:'',courier:''})},'${stamp}');`;
}
const setup=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${sid}'::uuid $$;
CREATE FUNCTION is_team_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE pos_sales(id uuid PRIMARY KEY,store_id uuid,expedition_stage text,updated_at timestamptz,payment_details jsonb,sale_type text,is_store_pickup boolean,sale_released_at timestamptz,shipped_at timestamptz,shipped_source text,expedition_finished_at timestamptz,expedition_waiting_products boolean,shipping_carrier text,tracking_carrier text,tracking_code text,tracking_url text,delivery_days text,courier_name text,status text,total numeric);
CREATE TABLE pos_sale_items(id uuid PRIMARY KEY,sale_id uuid,quantity numeric,expedition_conference_qty numeric,expedition_waiting_qty numeric,expedition_completed_qty numeric,expedition_picked_qty numeric,barcode text,product_name text,variant_name text,sku text);
CREATE TABLE pos_expedition_checks(sale_id uuid,sale_item_id uuid,barcode text,scanned boolean,feet_ok boolean,has_defect boolean);
CREATE TABLE expedition_scan_log(id uuid PRIMARY KEY,operator_id uuid DEFAULT auth.uid(),flow text,stage text,method text,code_read text,variant_code text,variant_id uuid,sale_id uuid,sale_item_id uuid,product_name text,variant_name text,sku text,barcode text,quantity integer,store_id uuid);
CREATE TABLE audit(n integer GENERATED ALWAYS AS IDENTITY,t text,columns text[]);
CREATE FUNCTION audit_col() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.audit(t,columns) VALUES(TG_TABLE_NAME, ARRAY[TG_ARGV[0]]); RETURN NEW;END;$$;
CREATE TRIGGER sale_stage AFTER UPDATE OF expedition_stage ON pos_sales FOR EACH ROW EXECUTE FUNCTION audit_col('expedition_stage');
CREATE TRIGGER sale_finished AFTER UPDATE OF expedition_finished_at ON pos_sales FOR EACH ROW EXECUTE FUNCTION audit_col('expedition_finished_at');
CREATE TRIGGER sale_status AFTER UPDATE OF status ON pos_sales FOR EACH ROW EXECUTE FUNCTION audit_col('status');
CREATE TRIGGER item_conf AFTER UPDATE OF expedition_conference_qty ON pos_sale_items FOR EACH ROW EXECUTE FUNCTION audit_col('expedition_conference_qty');
CREATE TRIGGER item_done AFTER UPDATE OF expedition_completed_qty ON pos_sale_items FOR EACH ROW EXECUTE FUNCTION audit_col('expedition_completed_qty');
${releaseFunction}
CREATE TRIGGER release_sale BEFORE UPDATE OF expedition_stage ON pos_sales FOR EACH ROW EXECUTE FUNCTION pos_sales_release_on_expedition();
${sql}
INSERT INTO pos_sales(id,store_id,expedition_stage,updated_at,payment_details,sale_type,is_store_pickup,status,total,expedition_waiting_products) VALUES('${id}','${sid}','novo','${stamp}','{}','online',false,'paid',500,false);
INSERT INTO pos_sale_items VALUES('${iid}','${id}',2,0,0,0,0,'123','Tenis','Branco','SKU');
CREATE FUNCTION state() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('sales',(SELECT jsonb_agg(to_jsonb(s)) FROM pos_sales s),'items',(SELECT jsonb_agg(to_jsonb(i)) FROM pos_sale_items i),'checks',(SELECT jsonb_agg(to_jsonb(c)) FROM pos_expedition_checks c),'audit',(SELECT jsonb_agg(to_jsonb(a)-'n' ORDER BY n) FROM audit a)) $$;
CREATE TABLE results(name text,before jsonb,after jsonb);
`;
const scenarios=[
 ['advance','novo','preparacao',`UPDATE pos_sales SET expedition_stage='preparacao' WHERE id='${id}';`,call('advance','novo','preparacao')],
 ['items','separacao','conferencia',`UPDATE pos_sale_items SET expedition_picked_qty=2,expedition_conference_qty=2,expedition_waiting_qty=0 WHERE id='${iid}';UPDATE pos_sales SET expedition_stage='conferencia' WHERE id='${id}';`,call('items','separacao','conferencia')],
 ['waiting','aguardando','conferencia',`UPDATE pos_sale_items SET expedition_waiting_qty=0,expedition_conference_qty=2,expedition_picked_qty=2 WHERE id='${iid}';UPDATE pos_sales SET expedition_stage='conferencia' WHERE id='${id}';`,call('waiting','aguardando','conferencia',2,0,2,0,2)],
 ['finish','conferencia','concluido',`DELETE FROM pos_expedition_checks WHERE sale_id='${id}';INSERT INTO pos_expedition_checks VALUES('${id}','${iid}','123',true,true,false);UPDATE pos_sale_items SET expedition_completed_qty=2,expedition_conference_qty=0 WHERE id='${iid}';UPDATE pos_sales SET expedition_stage='concluido',expedition_finished_at='${stamp}',expedition_waiting_products=false,shipping_carrier='Correios PAC',tracking_carrier='Correios',tracking_code='AP123456789BR',tracking_url=NULL,delivery_days=NULL,courier_name=NULL WHERE id='${id}';`,call('finish','conferencia',null,2,2,0,0,2)],
 ['partial','conferencia','aguardando',`DELETE FROM pos_expedition_checks WHERE sale_id='${id}';INSERT INTO pos_expedition_checks VALUES('${id}','${iid}','123',true,true,false);UPDATE pos_sale_items SET expedition_completed_qty=1,expedition_conference_qty=0 WHERE id='${iid}';UPDATE pos_sales SET expedition_stage='aguardando',expedition_finished_at=NULL,expedition_waiting_products=true,shipping_carrier='Correios PAC',tracking_carrier='Correios',tracking_code='AP123456789BR',tracking_url=NULL,delivery_days=NULL,courier_name=NULL WHERE id='${id}';`,call('finish','conferencia',null,1,1,1,0,2)],
] as const;

describe('Expedition atomic RPC vs exact pre-mobile SQL, disposable DB only',()=>{
 let results:Record<string,any>;
 beforeAll(()=>{
  let program=setup;
  for(const [name,stage,,legacy,current] of scenarios){
   program+=`\nBEGIN;UPDATE pos_sales SET expedition_stage='${stage}';UPDATE pos_sale_items SET expedition_conference_qty=${name==='finish'?2:name==='partial'?1:0},expedition_waiting_qty=${name==='waiting'?2:name==='partial'?1:0},expedition_picked_qty=${['finish','partial','waiting'].includes(name)?2:0};DELETE FROM audit;SAVEPOINT initial;${legacy}INSERT INTO results VALUES('${name}',state(),NULL);`;
   // Save legacy snapshot outside rollback using psql variable, all in one transaction => same now() for trigger timestamps.
   program+=`SELECT state() AS legacy_state \\gset\nROLLBACK TO initial;${current}INSERT INTO results VALUES('${name}',:'legacy_state'::jsonb,state());COMMIT;\n`;
   program+=`UPDATE pos_sales SET expedition_stage='novo',sale_released_at=NULL,shipped_at=NULL,shipped_source=NULL,expedition_finished_at=NULL,expedition_waiting_products=false,shipping_carrier=NULL,tracking_carrier=NULL,tracking_code=NULL,tracking_url=NULL,delivery_days=NULL,courier_name=NULL;UPDATE pos_sale_items SET expedition_conference_qty=0,expedition_waiting_qty=0,expedition_completed_qty=0,expedition_picked_qty=0;DELETE FROM pos_expedition_checks;`;
  }
  // A stale second operator must fail before checks/items/stock effects.
  program+=`DELETE FROM audit;${call('advance','novo','preparacao')} CREATE TABLE concurrency(ok boolean);
DO $$BEGIN BEGIN PERFORM pos_expedition_transition(${literal([{id,stage:'novo'}])},'advance','separacao');INSERT INTO concurrency VALUES(false);EXCEPTION WHEN serialization_failure THEN INSERT INTO concurrency VALUES(SQLERRM='Já foi movido por outra pessoa');END;END;$$;
${call('items','preparacao','conferencia')}
${call('finish','conferencia',null,2,2,0,0,2)}
DO $$BEGIN BEGIN PERFORM pos_expedition_transition(${literal([{id,stage:'conferencia'}])},'finish',NULL,${literal([{id:iid,total_qty:2,qty:2,conference:2,waiting:0,completed:0,picked:2,scanned:true,feet_ok:true}])},'{"carrier":"Correios"}');INSERT INTO concurrency VALUES(false);EXCEPTION WHEN serialization_failure THEN INSERT INTO concurrency VALUES(SQLERRM='Já foi movido por outra pessoa');END;END;$$;
`;
  const entry={id:'00000000-0000-0000-0000-000000000099',sale_id:id,sale_item_id:iid,method:'codigo_antigo',code_read:'123'};
  program+=`SELECT pos_expedition_scan_batch(${literal([entry])});SELECT pos_expedition_scan_batch(${literal([entry])});
SELECT jsonb_object_agg(name,jsonb_build_object('equal',before=after,'after',after)) FROM results WHERE after IS NOT NULL;
SELECT jsonb_build_object('concurrency', (SELECT bool_and(ok) FROM concurrency),'scans',(SELECT count(*) FROM expedition_scan_log),'completed',(SELECT expedition_completed_qty FROM pos_sale_items LIMIT 1),'anon_blocked',NOT has_function_privilege('anon','pos_expedition_transition(jsonb,text,text,jsonb,jsonb,timestamptz)','EXECUTE'));`;
  const out=execFileSync('bash',['src/test/runEventShippingIsolated.sh'],{input:program,encoding:'utf8'}).trim().split('\n').filter(line=>line.startsWith('{'));
  results={...JSON.parse(out.at(-2)||'{}'),final:JSON.parse(out.at(-1)||'{}')};
 },60000);
 scenarios.forEach(([name])=>it(`${name}: same columns, trigger audit, checks and item quantities`,()=>expect(results[name].equal).toBe(true)));
 it('the real release/shipped trigger still releases a complete shipment',()=>{expect(results.finish.after.sales[0].shipped_source).toBe('expedicao');expect(results.finish.after.sales[0].sale_released_at).not.toBeNull();});
 it('partial dispatch does not release the whole shipment',()=>expect(results.partial.after.sales[0].sale_released_at).toBeNull());
 it('two stale operators cannot duplicate completion',()=>{expect(results.final.concurrency).toBe(true);expect(results.final.completed).toBe(2);});
 it('same scan UUID uploaded twice inserts once',()=>expect(results.final.scans).toBe(1));
 it('anonymous execution remains blocked',()=>expect(results.final.anon_blocked).toBe(true));
});
