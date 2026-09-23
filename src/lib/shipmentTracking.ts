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

/**
 * Resolve o registro de acompanhamento do pedido, seguindo o agrupamento:
 * quando o pedido foi unificado com outro do mesmo cliente, o link é o do
 * pedido principal (envio único).
 */
async function resolveShipmentRow(saleId: string): Promise<any | null> {
  const { data } = await supabase
    .from('shipment_simulations')
    .select('id, tracking_code, incident_type, fulfillment, merged_into_id')
    .eq('sale_id', saleId)
    .maybeSingle();
  let row = data as any;
  let guard = 0;
  while (row?.merged_into_id && guard < 5) {
    const { data: parent } = await supabase
      .from('shipment_simulations')
      .select('id, tracking_code, incident_type, fulfillment, merged_into_id')
      .eq('id', row.merged_into_id)
      .maybeSingle();
    if (!parent) break;
    row = parent as any;
    guard += 1;
  }
  return row ?? null;
}

/** Busca o código público de acompanhamento de um pedido. */
export async function getPublicTrackingCode(saleId: string): Promise<string | null> {
  const row = await resolveShipmentRow(saleId);
  return row?.tracking_code ?? null;
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
  const row = await resolveShipmentRow(saleId);
  if (!row?.tracking_code) return null;
  return {
    trackingCode: row.tracking_code,
    incidentType: (row.incident_type as IncidentType) || null,
    fulfillment: row.fulfillment ?? null,
  };
}

/** Marca (ou remove, com null) o aviso mostrado ao cliente no acompanhamento. */
export async function setShipmentIncident(saleId: string, type: IncidentType | null): Promise<void> {
  const row = await resolveShipmentRow(saleId);
  if (!row?.id) return;
  const { error } = await supabase
    .from('shipment_simulations')
    .update({
      incident_type: type,
      incident_at: type ? new Date().toISOString() : null,
    } as any)
    .eq('id', row.id);
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
