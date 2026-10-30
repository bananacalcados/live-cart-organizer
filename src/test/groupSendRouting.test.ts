import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { groupRoutingSummary, type GroupRoute } from "@/lib/marketing/groupSendRouting";
import { partitionGroupRoutes } from "../../supabase/functions/zapi-group-scheduled-send/planning";

describe("filas independentes por responsável", () => {
  it("separa Pérola, Centro e Carol sem mudar ordem dos grupos", () => {
    const routes = [{instance_id: "perola", base: "1"}, {instance_id: "carol", base: "2"}, {instance_id: "perola", base: "3"}, {instance_id: "centro", base: "4"}];
    expect(partitionGroupRoutes(routes).map(lane => lane.map(r => r.base))).toEqual([["1", "3"], ["2"], ["4"]]);
  });
  it("mantém grupos sem responsável na fila da instância fallback", () => {
    const routes = [{instance_id: "perola", base: "1"}, {instance_id: "perola", base: "2"}];
    expect(partitionGroupRoutes(routes)).toHaveLength(1);
    expect(partitionGroupRoutes(routes)[0]).toHaveLength(2);
  });
  it("soma os 12 grupos Pérola, 3 Centro, 5 Carol e 2 fallback", () => {
    const make = (label: string, count: number, responsible: boolean): GroupRoute[] => Array.from({length: count}, (_, i) => ({base: `${label}-${i}`, label, responsible_id: responsible ? label : null, source: responsible ? "responsible" : "fallback"} as GroupRoute));
    const routes = [...make("Pérola", 12, true), ...make("Centro", 3, true), ...make("Carol", 5, true), ...make("Pérola", 2, false)];
    expect(groupRoutingSummary(routes)).toBe("Vai sair por Pérola (14 grupos), Centro (3 grupos), Carol (5 grupos); 2 grupos sem responsável → fallback instância da campanha");
  });
});