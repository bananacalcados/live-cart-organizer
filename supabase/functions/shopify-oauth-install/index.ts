import { withAccessLog } from "../_shared/withAccessLog.ts";
// Fase 4 de segurança: desativada. Era a instalação única do app Shopify (o token já está salvo).
// A versão antiga aceitava qualquer "shop" e enviava o segredo do app para ele, além de exibir o token na tela.
Deno.serve(withAccessLog("shopify-oauth-install", () => new Response("Gone", { status: 410 })));
