import { describe, it, expect } from "vitest";
import { computePayroll, commissionPctForAchievement, type PayrollScaleRow } from "@/lib/pos/payroll";

const scale: PayrollScaleRow[] = [
  { achievement_percent: 80, commission_percent: 0.5 },
  { achievement_percent: 90, commission_percent: 0.7 },
  { achievement_percent: 100, commission_percent: 1.0 },
  { achievement_percent: 110, commission_percent: 1.2 },
  { achievement_percent: 120, commission_percent: 1.5 },
];

describe("commissionPctForAchievement", () => {
  it("picks the highest tier reached", () => {
    expect(commissionPctForAchievement(50, scale)).toBe(0);
    expect(commissionPctForAchievement(80, scale)).toBe(0.5);
    expect(commissionPctForAchievement(96, scale)).toBe(0.7);
    expect(commissionPctForAchievement(100, scale)).toBe(1.0);
    expect(commissionPctForAchievement(119, scale)).toBe(1.2);
    expect(commissionPctForAchievement(130, scale)).toBe(1.5);
  });
});

describe("computePayroll — divisão de live", () => {
  const stores = [
    { id: "st-perola", name: "Loja Perola" },
    { id: "st-centro", name: "Loja Centro" },
  ];
  const sellers = [
    { id: "sl-viviane", name: "Viviane físico", store_id: "st-perola" },
    { id: "sl-emilly", name: "Emilly", store_id: "st-perola" },
    { id: "sl-vitoria", name: "Vitoria A Fisico", store_id: "st-perola" },
    { id: "sl-live", name: "Live Shopping", store_id: "st-perola" },
  ];
  const people = [
    { id: "p-viviane", name: "Viviane", is_active: true, receives_all_lives: false, manual_goal_value: null },
    { id: "p-emilly", name: "Emilly", is_active: true, receives_all_lives: false, manual_goal_value: null },
    { id: "p-vitoria", name: "Vitória", is_active: true, receives_all_lives: false, manual_goal_value: null },
  ];
  const peopleSellers = [
    { person_id: "p-viviane", seller_id: "sl-viviane" },
    { person_id: "p-emilly", seller_id: "sl-emilly" },
    { person_id: "p-vitoria", seller_id: "sl-vitoria" },
  ];

  it("divide o recebido (sem frete) das lives igualmente entre as participantes", () => {
    const sales = [
      // 20k bruto em live, mas 3k é frete → 17k recebido sem frete
      { id: "L1", store_id: "st-perola", seller_id: "sl-live", sale_type: "live", total: 20000, shipping_cost: 3000, payment_details: null },
      // venda física da Viviane
      { id: "F1", store_id: "st-perola", seller_id: "sl-viviane", sale_type: "physical", total: 1000, shipping_cost: 0, payment_details: null },
    ];
    const res = computePayroll({
      sales, sellers, stores, people, peopleSellers,
      liveParticipants: [
        { person_id: "p-viviane", store_id: "st-perola" },
        { person_id: "p-emilly", store_id: "st-perola" },
        { person_id: "p-vitoria", store_id: "st-perola" },
      ],
      scale, goals: [],
    });

    const live = res.liveByStore.find((l) => l.storeKey === "perola")!;
    expect(live.net).toBe(17000);
    expect(live.participants).toBe(3);
    expect(live.quota).toBeCloseTo(5666.67, 1);

    const viviane = res.people.find((p) => p.personId === "p-viviane")!;
    expect(viviane.channels.live_perola).toBeCloseTo(5666.67, 1);
    expect(viviane.channels.fisica_perola).toBe(1000);
    expect(viviane.total).toBeCloseTo(6666.67, 1);
  });

  it("híbrida recebe o total de todas as lives", () => {
    const hybridPeople = [
      ...people,
      { id: "p-jessica", name: "Jéssica", is_active: true, receives_all_lives: true, manual_goal_value: null },
    ];
    const sales = [
      { id: "L1", store_id: "st-perola", seller_id: "sl-live", sale_type: "live", total: 10000, shipping_cost: 0, payment_details: null },
      { id: "L2", store_id: "st-centro", seller_id: "sl-live", sale_type: "live", total: 5000, shipping_cost: 0, payment_details: null },
    ];
    const res = computePayroll({
      sales, sellers, stores, people: hybridPeople, peopleSellers,
      liveParticipants: [], scale, goals: [],
    });
    const jessica = res.people.find((p) => p.personId === "p-jessica")!;
    expect(jessica.channels.live_all).toBe(15000);
    expect(jessica.total).toBe(15000);
  });

  it("live com vendedora REAL mapeada credita direto à vendedora e sai do rateio (sem dupla contagem)", () => {
    const sales = [
      // Live atribuída manualmente à Viviane (vendedora real) — R$ 300, sem frete
      { id: "LM1", store_id: "st-perola", seller_id: "sl-viviane", sale_type: "live", total: 300, shipping_cost: 0, payment_details: null },
      // Live "genérica" (vendedor virtual) — deve ir pro pool/rateio
      { id: "LP1", store_id: "st-perola", seller_id: "sl-live", sale_type: "live", total: 1000, shipping_cost: 0, payment_details: null },
    ];
    const res = computePayroll({
      sales, sellers, stores, people, peopleSellers,
      liveParticipants: [
        { person_id: "p-viviane", store_id: "st-perola" },
        { person_id: "p-emilly", store_id: "st-perola" },
      ],
      scale, goals: [],
    });

    // Pool só contém a live genérica (1000), rateada entre 2 → 500 cada
    const live = res.liveByStore.find((l) => l.storeKey === "perola")!;
    expect(live.net).toBe(1000);
    expect(live.quota).toBe(500);

    // Viviane: 300 direto + 500 de cota = 800 (a venda dela conta UMA vez, direto)
    const viviane = res.people.find((p) => p.personId === "p-viviane")!;
    expect(viviane.channels.live_perola).toBe(800);
    // Emilly só recebe a cota do pool
    const emilly = res.people.find((p) => p.personId === "p-emilly")!;
    expect(emilly.channels.live_perola).toBe(500);
  });
});

import { buildGoalTiers } from "@/lib/pos/payroll";

describe("buildGoalTiers — metas escalonadas", () => {
  it("calcula faturamento, falta e comissão por degrau (exemplo meta 31700)", () => {
    const tiers = buildGoalTiers(31700, 45000, scale);
    const t80 = tiers.find((t) => t.achievementPercent === 80)!;
    const t100 = tiers.find((t) => t.achievementPercent === 100)!;
    const t120 = tiers.find((t) => t.achievementPercent === 120)!;

    expect(t80.targetRevenue).toBeCloseTo(25360, 2);
    expect(t100.targetRevenue).toBeCloseTo(31700, 2);
    expect(t120.targetRevenue).toBeCloseTo(38040, 2);

    // com faturamento de 45k, todos os degraus foram atingidos
    expect(t120.reached).toBe(true);
    expect(t120.missing).toBe(0);
    // comissão projetada no degrau 120% = 38040 * 1.5%
    expect(t120.commissionValue).toBeCloseTo(570.6, 1);
    expect(t100.commissionPercent).toBe(1.0);
  });

  it("mostra quanto falta quando abaixo do degrau", () => {
    const tiers = buildGoalTiers(31700, 20000, scale);
    const t80 = tiers.find((t) => t.achievementPercent === 80)!;
    expect(t80.reached).toBe(false);
    expect(t80.missing).toBeCloseTo(5360, 2); // 25360 - 20000
  });

  it("retorna vazio sem meta", () => {
    expect(buildGoalTiers(0, 5000, scale)).toEqual([]);
  });
});
