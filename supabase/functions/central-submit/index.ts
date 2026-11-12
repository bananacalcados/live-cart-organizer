import { logClient, withAccessLog } from '../_shared/withAccessLog.ts';
import { centralHandler, settingsFlag } from '../_shared/central-handler.ts';
import { runCentralAutoReverse, CENTRAL_PENDING_TEXT } from '../_shared/central-auto-reverse.ts';
import { internalCallHeaders } from '../_shared/requireAuth.ts';
const db=logClient();
if (!db) throw new Error('Central indisponível');
const invoke = async (name: string, body: Record<string, unknown>) => {
  const res = await db.functions.invoke(name, { body, headers: await internalCallHeaders() });
  let detail: string | null = null;
  if (res.error) {
    try { detail = await (res.error as any).context?.text?.() || null; } catch { /* resumo abaixo */ }
    detail = (detail || res.error.message || 'Falha no serviço de reversa').slice(0, 1000);
  }
  return { data: res.data, error: detail };
};
// A Central continua fechada; a automação só roda para links admitidos pela trava existente.
Deno.serve(withAccessLog('central-submit',centralHandler('submit',db as any,settingsFlag(db as any),undefined,async (id, type) => {
  try { return await runCentralAutoReverse(db as any, id, invoke, type); }
  catch { return { status: 'escalado', reason: CENTRAL_PENDING_TEXT }; }
})));
