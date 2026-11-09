import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  createCorreiosFetch,
  getCorreiosToken,
  loadCorreiosSettings,
} from '../_shared/correios.ts';

/** Consulta somente o prazo, sem cotar preço e sem criar etiqueta ou pré-postagem. */
export async function quoteCorreiosDeliveryDays(
  db: SupabaseClient,
  destinationCep: string,
  serviceCode: '03220' | '03298',
): Promise<number> {
  const settings = await loadCorreiosSettings(db);
  const auth = await getCorreiosToken(db, { settings });
  const correiosFetch = createCorreiosFetch(auth.settings, auth.token);
  const result = await correiosFetch('/prazo/v1/nacional', {
    method: 'POST',
    body: JSON.stringify({
      idLote: '1',
      parametrosPrazo: [{
        coProduto: serviceCode,
        nuRequisicao: '1',
        cepOrigem: settings.remetente.cep.replace(/\D/g, ''),
        cepDestino: destinationCep,
      }],
    }),
  });
  const row = Array.isArray(result)
    ? result.find((item: any) => String(item?.coProduto || '') === serviceCode)
    : null;
  if (!row || row.txMsg || (Array.isArray(row.msgs) && row.msgs.length)) {
    throw new Error('Prazo não disponível para este CEP');
  }
  const days = Number(row.prazoEntrega);
  if (!Number.isInteger(days) || days < 0 || days > 60) {
    throw new Error('Transportadora não retornou um prazo válido');
  }
  return days;
}
