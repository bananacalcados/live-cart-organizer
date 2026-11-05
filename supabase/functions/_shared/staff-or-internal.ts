// Fase 4: trava padrão para funções sensíveis.
// Passa: (1) chamada interna com service role (com ou sem x-internal-call),
// (2) cron com x-cron-secret, ou (3) funcionário logado com o módulo pedido
// (admin sempre passa). A chave pública (anon) nunca passa.
import { isAuthorizedCron } from "./cron-guard.ts";
import { requireAuth } from "./requireAuth.ts";

export async function requireStaffOrInternal(req: Request, modules: string[] = [], adminOnly = false): Promise<Response | null> {
  if (await isAuthorizedCron(req)) return null;
  return await requireAuth(req, modules, adminOnly);
}
