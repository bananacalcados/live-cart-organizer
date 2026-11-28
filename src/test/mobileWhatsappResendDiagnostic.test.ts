import { describe, expect, it, vi } from "vitest";
import { posSendText } from "@/lib/pos/posWhatsappSend";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

// Diagnostic of the existing path, NOT an assertion that resends are safe.
// The provider accepts the first request but its response never reaches the browser.
// All requests are in-memory: no real customer or provider is contacted.
describe("existing PDV resend after an uncertain response", () => {
  for (const provider of ["uazapi", "wasender"] as const) {
    it(`${provider}: a retry reaches the send endpoint a second time`, async () => {
      invoke.mockReset();
      let providerAcceptances = 0;
      invoke.mockImplementation(async () => {
        providerAcceptances++;
        return providerAcceptances === 1
          ? { data: null, error: { message: "Simulated lost response after acceptance" } }
          : { data: { messageId: "simulated-second-message" }, error: null };
      });
      const request = { provider, phone: "5533999990000", message: "SIMULATED", numberId: "simulated-instance" };
      await expect(posSendText(request)).rejects.toThrow("lost response");
      await expect(posSendText(request)).resolves.toBe("simulated-second-message");
      expect(providerAcceptances).toBe(2);
      expect(invoke).toHaveBeenCalledTimes(2);
    });
  }
});