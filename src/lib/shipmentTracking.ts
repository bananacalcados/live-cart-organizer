import { supabase } from '@/integrations/supabase/client';

/** Etapas públicas mostradas ao cliente. */
export type ShipmentStage = 'em_separacao' | 'separado' | 'embalado' | 'enviado' | 'entregue';

export const SHIPMENT_STAGE_LABEL: Record<ShipmentStage, string> = {
  em_separacao: 'Em separação',
  separado: 'Separado',
  embalado: 'Embalado',
  enviado: 'Enviado',
  entregue: 'Entregue',
};

/** Link público do acompanhamento (nunca expõe transportadora nem código real). */
export const publicTrackingUrl = (code: string) =>
  `${window.location.origin}/rastreio/${encodeURIComponent(code)}`;

/** Busca (ou cria) o código público de acompanhamento de um pedido. */
export async function getPublicTrackingCode(saleId: string): Promise<string | null> {
  const { data } = await supabase
    .from('shipment_simulations')
    .select('tracking_code')
    .eq('sale_id', saleId)
    .maybeSingle();
  return (data as any)?.tracking_code ?? null;
}

/** Avisos manuais que a equipe pode exibir no acompanhamento do cliente. */
export type IncidentType =
  | 'extraviado'
  | 'atraso_rota'
  | 'cancelado'
  | 'greve_correios'
  | 'conferencia_endereco';

export const INCIDENT_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: 'extraviado', label: 'Extraviado' },
  { value: 'atraso_rota', label: 'Atraso na rota' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'greve_correios', label: 'Greve dos Correios' },
  { value: 'conferencia_endereco', label: 'Conferência de endereço' },
];

export type ShipmentTrackingInfo = {
  trackingCode: string;
  incidentType: IncidentType | null;
  fulfillment: string | null;
};

/** Dados do acompanhamento de um pedido (código público + aviso ativo). */
export async function getShipmentTracking(saleId: string): Promise<ShipmentTrackingInfo | null> {
  const { data } = await supabase
    .from('shipment_simulations')
    .select('tracking_code, incident_type, fulfillment')
    .eq('sale_id', saleId)
    .maybeSingle();
  const row = data as any;
  if (!row?.tracking_code) return null;
  return {
    trackingCode: row.tracking_code,
    incidentType: (row.incident_type as IncidentType) || null,
    fulfillment: row.fulfillment ?? null,
  };
}

/** Marca (ou remove, com null) o aviso mostrado ao cliente no acompanhamento. */
export async function setShipmentIncident(saleId: string, type: IncidentType | null): Promise<void> {
  const { error } = await supabase
    .from('shipment_simulations')
    .update({
      incident_type: type,
      incident_at: type ? new Date().toISOString() : null,
    } as any)
    .eq('sale_id', saleId);
  if (error) throw new Error(error.message);
}

/**
 * Registra o código real da transportadora no acompanhamento do pedido.
 * Ao fazer isso, todas as etapas anteriores são dadas como concluídas e o
 * cliente passa a ver "Pedido enviado", mesmo que o prazo automático ainda
 * não tivesse sido atingido. A partir daí, o link passa a ser alimentado
 * pelos eventos reais recebidos da transportadora.
 */
export async function attachRealTracking(params: {
  saleIds: string[];
  realCode: string;
  carrier?: string | null;
}): Promise<void> {
  const code = params.realCode.trim();
  if (!code || !params.saleIds.length) return;
  const now = new Date().toISOString();

  const { data: rows } = await supabase
    .from('shipment_simulations')
    .select('id, stage_history')
    .in('sale_id', params.saleIds);

  for (const row of (rows ?? []) as any[]) {
    const history = { ...((row.stage_history as Record<string, string>) || {}) };
    for (const k of ['em_separacao', 'separado', 'embalado'] as const) {
      if (!history[k]) history[k] = now;
    }
    history.enviado = history.enviado || now;
    await supabase
      .from('shipment_simulations')
      .update({
        stage: 'enviado',
        stage_history: history,
        real_tracking_code: code,
        real_carrier: params.carrier || null,
      } as any)
      .eq('id', row.id);
  }
}
