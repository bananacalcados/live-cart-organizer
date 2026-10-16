import { describe, expect, it, vi } from "vitest";
import { expeditionGatewayLabel, filterExpeditionGateway } from "@/lib/expeditionGateway";

describe("gateway efetivamente pago na Expedição", () => {
  it("filtra o gateway gravado na venda, não a escolha inicial da cascata", () => {
    const query = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis() };
    filterExpeditionGateway(query, "appmax");
    expect(query.eq).toHaveBeenCalledWith("payment_gateway", "appmax");
    expect(query.is).not.toHaveBeenCalled();
  });
  it("sem informação busca somente gateway nulo, sem atribuir Mercado Pago", () => {
    const query = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis() };
    filterExpeditionGateway(query, "unknown");
    expect(query.is).toHaveBeenCalledWith("payment_gateway", null);
    expect(query.eq).not.toHaveBeenCalled();
    expect(expeditionGatewayLabel(null)).toBe("Gateway não informado");
  });
  it("todos não restringe gateway", () => {
    const query = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis() };
    expect(filterExpeditionGateway(query, "all")).toBe(query);
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.is).not.toHaveBeenCalled();
  });
});