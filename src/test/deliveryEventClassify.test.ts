import { describe, expect, it } from "vitest";
import { classifyDeliveryEvent, findDeliveredEvent } from "../../supabase/functions/_shared/delivery-event";
import { translateRealEvent } from "../../supabase/functions/_shared/shipment-stages";

describe("classificação de entrega no rastreio", () => {
  it("BDE status 01 é entregue", () => {
    expect(classifyDeliveryEvent({ type: "BDE", status: "01", description: "Objeto entregue ao destinatário" })).toBe("delivered");
  });
  it("BDE 'carteiro não atendido' não é entregue, com ou sem status", () => {
    expect(classifyDeliveryEvent({ type: "BDE", status: "20", description: "Objeto não entregue - carteiro não atendido" })).toBe("failed_attempt");
    expect(classifyDeliveryEvent({ type: "BDE", description: "Objeto não entregue - carteiro não atendido" })).toBe("failed_attempt");
    expect(translateRealEvent("Objeto não entregue - carteiro não atendido", "carrier", { type: "BDE" })?.title).toBe("Tentativa de entrega sem sucesso");
  });
  it("insucesso seguido de entrega real usa a data da entrega real", () => {
    const events = [
      { at: "2026-11-12T14:04:00Z", type: "BDE", status: "20", description: "Objeto não entregue - carteiro não atendido" },
      { at: "2026-11-13T15:00:00Z", type: "BDE", status: "01", description: "Objeto entregue ao destinatário" },
    ];
    expect(findDeliveredEvent(events)?.at).toBe("2026-11-13T15:00:00Z");
    expect(findDeliveredEvent(events.slice(0, 1))).toBeNull();
  });
  it("LDI aguardando retirada não é entregue e aparece como retirada na agência", () => {
    const ev = { type: "LDI", description: "Objeto aguardando retirada no endereço indicado" };
    expect(classifyDeliveryEvent(ev)).toBe("awaiting_pickup");
    expect(translateRealEvent(ev.description, "carrier", ev)?.title).toBe("Aguardando retirada na agência");
  });
});
