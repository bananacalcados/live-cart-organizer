import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExpOrder } from "@/lib/pos/expedition";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), hydrate: vi.fn(), status: "", refetch: vi.fn(), freight: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0].includes("invoice") && mocks.status ? { id: "doc", status: mocks.status, numero: 40 } : null, isPending: false, isError: false, refetch: mocks.refetch }) }));
vi.mock("@/components/pos/expedition/customerHydrate", () => ({ hydrateSaleCustomer: mocks.hydrate }));
vi.mock("@/lib/saleFreight", () => ({ freightCall: mocks.freight }));
vi.mock("@/lib/edgeFunctionError", () => ({ extractEdgeError: async (e: Error) => e.message }));
import { MobileExpeditionDocuments } from "./MobileExpeditionDocuments";
const order = { id: "sale", customer_name: "Cliente", total: 100 } as ExpOrder;
beforeEach(() => { mocks.status = ""; mocks.invoke.mockReset(); mocks.hydrate.mockReset(); mocks.hydrate.mockResolvedValue({ cpf: "52998224725" }); mocks.refetch.mockResolvedValue({ data: null }); });
afterEach(cleanup);
describe("fiscal confirmation in mobile — no real operations", () => {
  it("opening and cancelling confirmation never requests emission", () => {
    render(<MobileExpeditionDocuments order={order} allowEmission />);
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota fiscal" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar sem emitir" }));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("double touch dispatches exactly once to the existing emission endpoint", async () => {
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    render(<MobileExpeditionDocuments order={order} allowEmission />);
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota fiscal" }));
    const confirm = screen.getByRole("button", { name: "Confirmar emissão" });
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("nfe-emitir", { body: { sale_id: "sale" } });
  });
  it("pending retry keeps the exact document and never hydrates its snapshot", async () => {
    mocks.status = "pending_sefaz"; mocks.invoke.mockResolvedValue({ data: { contingencia: true } });
    render(<MobileExpeditionDocuments order={order} allowEmission />);
    fireEvent.click(screen.getByRole("button", { name: "Consultar e retomar a mesma nota" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar emissão" })); });
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("nfe-emitir", { body: { sale_id: "sale", retry_document_id: "doc" } });
  });
  it("read-only detail cannot emit and never purchases a label", () => {
    render(<MobileExpeditionDocuments order={order} />);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.freight).not.toHaveBeenCalled();
  });
  it("lost response never retries automatically", async () => {
    mocks.invoke.mockRejectedValue(new Error("Resposta perdida"));
    render(<MobileExpeditionDocuments order={order} allowEmission />);
    fireEvent.click(screen.getByRole("button", { name: "Emitir nota fiscal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar emissão" })); });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});