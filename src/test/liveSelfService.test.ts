import { describe, it, expect } from "vitest";
import { isWhatsAppLikeMode, registeredInTime, selfServiceStage, formatMmSs } from "@/lib/liveModes";

describe("modo WhatsApp + Cadastro online", () => {
  it("vale tudo do modo whatsapp, sem mudar os outros", () => {
    expect(isWhatsAppLikeMode("whatsapp_autoatendimento")).toBe(true);
    expect(isWhatsAppLikeMode("whatsapp")).toBe(true);
    expect(isWhatsAppLikeMode("member_area")).toBe(false);
    expect(isWhatsAppLikeMode("manual")).toBe(false);
  });

  it("cadastro em até 5 min do pedido conta no prazo", () => {
    const created = "2026-10-23T20:00:00Z";
    expect(registeredInTime(created, "2026-10-23T20:05:00Z", 5)).toBe(true);
    expect(registeredInTime(created, "2026-10-23T20:05:01Z", 5)).toBe(false);
    expect(registeredInTime(created, null, 5)).toBe(false);
  });

  it("cadastro feito antes do pedido conta a favor", () => {
    expect(registeredInTime("2026-10-23T20:00:00Z", "2026-10-23T19:40:00Z", 5)).toBe(true);
  });

  it("estágios na Central", () => {
    const base = { createdAt: "2026-10-23T20:00:00Z", minutes: 5 };
    expect(selfServiceStage({ ...base, isPaid: false })).toBe("awaiting_id");
    expect(selfServiceStage({ ...base, isPaid: false, viewedAt: "2026-10-23T20:01:00Z" })).toBe("viewed");
    expect(selfServiceStage({ ...base, isPaid: false, registeredAt: "2026-10-23T20:09:00Z" })).toBe("registered_late");
    expect(selfServiceStage({ ...base, isPaid: true, registeredAt: "2026-10-23T20:09:00Z" })).toBe("paid");
    expect(selfServiceStage({ ...base, isPaid: false, registeredAt: "2026-10-23T20:09:00Z", confirmedWhatsApp: false })).toBe("registered_unconfirmed");
    expect(selfServiceStage({ ...base, isPaid: false, registeredAt: "2026-10-23T20:09:00Z", confirmedWhatsApp: true })).toBe("registered_late");
    expect(formatMmSs(65_000)).toBe("1:05");
  });
});
