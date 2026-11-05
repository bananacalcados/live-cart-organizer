import { withAccessLog } from "../_shared/withAccessLog.ts";
// Fase 4 de segurança: função de teste desativada.
Deno.serve(withAccessLog("shopify-create-test-product", () => new Response("Gone", { status: 410 })));
