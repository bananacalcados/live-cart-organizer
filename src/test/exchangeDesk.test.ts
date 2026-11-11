import { describe, it, expect } from "vitest";
import { canAct, tabOf, ageLevel, daysLeft, fillTemplate, waLink, type DeskReq } from "@/lib/exchangeDesk/rules";

const staff = { isHuman: true, isStaff: true };
const robot = { isHuman: false, isStaff: true };
const esc: DeskReq = { status: "escalado", request_type: "troca" };

describe("painel do atendente — transições", () => {
  it("só humano nega", () => {
    expect(canAct(esc, "deny", robot, "fora do prazo")).not.toBeNull();
    expect(canAct(esc, "deny", staff, "fora do prazo")).toBeNull();
  });
  it("negar e aprovar exigem motivo", () => {
    expect(canAct(esc, "deny", staff, "")).not.toBeNull();
    expect(canAct(esc, "approve", staff, " ")).not.toBeNull();
    expect(canAct(esc, "approve", staff, "cliente antiga")).toBeNull();
  });
  it("quem não é da equipe não faz nada", () => {
    expect(canAct(esc, "assign", { isHuman: true, isStaff: false })).not.toBeNull();
  });
  it("reversa só em aprovada e sem duplicar", () => {
    expect(canAct(esc, "reverse", staff)).not.toBeNull();
    expect(canAct({ ...esc, status: "aprovado" }, "reverse", staff)).toBeNull();
    expect(canAct({ ...esc, status: "aprovado", reverse_shipping_code: "AB123456789BR" }, "reverse", staff)).not.toBeNull();
  });
  it("não nega depois de aprovada", () => {
    expect(canAct({ ...esc, status: "aprovado" }, "deny", staff, "mudei de ideia")).not.toBeNull();
  });
  it("registro de troca só depois de aprovar e uma vez", () => {
    expect(canAct(esc, "create_troca", staff)).not.toBeNull();
    expect(canAct({ ...esc, status: "aprovado" }, "create_troca", staff)).toBeNull();
    expect(canAct({ ...esc, status: "aprovado", trocas_devolucoes_id: "x" }, "create_troca", staff)).not.toBeNull();
  });
  it("oferecer numeração só em troca", () => {
    expect(canAct({ ...esc, request_type: "devolucao" }, "offer_size", staff)).not.toBeNull();
  });
  it("abas: escalado e aprovado sem reversa precisam de você", () => {
    expect(tabOf(esc)).toBe("precisa");
    expect(tabOf({ ...esc, status: "aprovado" })).toBe("precisa");
    expect(tabOf({ ...esc, status: "aguardando_postagem", reverse_shipping_code: "X" })).toBe("andamento");
    expect(tabOf({ ...esc, status: "recusado" })).toBe("concluidas");
  });
  it("destaca >24h e >48h", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(ageLevel("2026-11-11T00:00:00Z", now)).toBe("normal");
    expect(ageLevel("2026-11-10T10:00:00Z", now)).toBe("24h");
    expect(ageLevel("2026-11-09T10:00:00Z", now)).toBe("48h");
  });
  it("dias restantes/excedidos", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(daysLeft("2026-11-13T12:00:00Z", now)).toBe(2);
    expect(daysLeft("2026-11-09T12:00:00Z", now)).toBe(-2);
  });
  it("mensagem pronta e link do WhatsApp", () => {
    expect(fillTemplate("Oi {{nome}}, pedido {{pedido}}", { nome: "Ana", pedido: "123" })).toBe("Oi Ana, pedido 123");
    expect(waLink("(33) 99999-0000", "oi")).toBe("https://wa.me/5533999990000?text=oi");
  });
});
