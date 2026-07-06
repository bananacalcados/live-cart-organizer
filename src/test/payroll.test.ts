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
});
