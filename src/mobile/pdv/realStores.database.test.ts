import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
const real = "00000000-0000-0000-0000-000000000001", simulated = "00000000-0000-0000-0000-000000000002", inactive = "00000000-0000-0000-0000-000000000003";
const sql = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE pos_stores(id uuid,name text,is_active boolean,is_simulation boolean);
CREATE TABLE orders(id uuid,is_pickup boolean,delivery_method text);
CREATE TABLE pos_sales(id uuid,store_id uuid,created_at timestamptz,is_sedex boolean,shipping_type text,shipping_carrier text,tracking_carrier text,payment_details jsonb,sale_type text,status text,paid_at timestamptz,payment_on_delivery boolean,expedition_stage text,source_order_id uuid,customer_name text);
CREATE TABLE pos_sale_items(sale_id uuid,quantity int,expedition_conference_qty int,expedition_waiting_qty int,expedition_completed_qty int);
${readFileSync("drizzle/migrations/0082_expedition_counts_active_items.sql", "utf8")}
${readFileSync("drizzle/migrations/0331_mobile_expedition_real_stores.sql", "utf8")}
INSERT INTO pos_stores VALUES('${real}','Renamed real store',true,false),('${simulated}','Simulator',true,true),('${inactive}','Closed real store',false,false);
INSERT INTO pos_sales(id,store_id,created_at,sale_type,status,paid_at,expedition_stage,customer_name) SELECT id,id,now(),'online','paid',now(),'novo',name FROM pos_stores;
SELECT jsonb_build_object('all',mobile_pdv_expedition_ids_v2(NULL,'novo'),'simulated',mobile_pdv_expedition_ids_v2('${simulated}','novo'),'counts',(SELECT coalesce(jsonb_agg(c),'[]') FROM mobile_pdv_expedition_counts(NULL)c),'simCounts',(SELECT coalesce(jsonb_agg(c),'[]') FROM mobile_pdv_expedition_counts('${simulated}')c));`;
describe("real stores only on mobile — isolated database", () => {
  let result: { all: string[]; simulated: string[]; counts: { stage: string; total: number }[]; simCounts: unknown[] };
  beforeAll(() => { const lines = execFileSync("bash", ["src/test/runEventShippingIsolated.sh"], { input: sql, encoding: "utf8" }).trim().split("\n"); result = JSON.parse(lines.at(-1) || "{}"); }, 60000);
  it("all includes only active non-simulation stores regardless of names", () => expect(result.all).toEqual([real]));
  it("explicit simulated store is excluded server-side", () => expect(result.simulated).toEqual([]));
  it("counts exclude simulated and inactive stores", () => expect(result.counts).toEqual([{ stage: "novo", total: 1 }]));
  it("simulated store has no counts", () => expect(result.simCounts).toEqual([]));
});