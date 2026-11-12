ALTER TABLE public.gateway_refunds ADD COLUMN IF NOT EXISTS fiscal_override_by uuid, ADD COLUMN IF NOT EXISTS fiscal_override_reason text, ADD COLUMN IF NOT EXISTS fiscal_override_at timestamptz;
CREATE OR REPLACE FUNCTION public.refund_return_facts(p_source text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s uuid; o uuid; registered boolean; received boolean; note_ok boolean; active_exit boolean; old_exit boolean;
BEGIN
 IF p_source='pos_sale' THEN SELECT id,source_order_id INTO s,o FROM public.pos_sales WHERE id=p_id;
 ELSIF p_source='order' THEN SELECT pos_sale_id,id INTO s,o FROM public.orders WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Origem inválida'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.trocas_devolucoes t WHERE t.pedido_original_id=s AND t.tipo='devolucao' AND t.status<>'cancelada'),
 EXISTS(SELECT 1 FROM public.trocas_devolucoes t WHERE t.pedido_original_id=s AND t.tipo='devolucao' AND t.status<>'cancelada' AND (t.status IN ('recebido_conferencia','concluida') OR EXISTS(SELECT 1 FROM public.trocas_devolucoes_itens i WHERE i.troca_devolucao_id=t.id AND i.direcao='devolvido' AND i.quantidade>0 AND i.estado_estoque IN ('retornado_vendavel','retornado_avaria')))),
 EXISTS(SELECT 1 FROM public.trocas_devolucoes t JOIN public.fiscal_documents f ON (f.troca_devolucao_id=t.id OR f.id=t.devolucao_doc_id) WHERE t.pedido_original_id=s AND t.tipo='devolucao' AND t.status<>'cancelada' AND (t.status IN ('recebido_conferencia','concluida') OR EXISTS(SELECT 1 FROM public.trocas_devolucoes_itens i WHERE i.troca_devolucao_id=t.id AND i.direcao='devolvido' AND i.quantidade>0 AND i.estado_estoque IN ('retornado_vendavel','retornado_avaria'))) AND f.finalidade=4 AND f.modelo=55 AND f.ambiente='producao' AND f.status IN ('authorized','pending','pending_sefaz')) INTO registered,received,note_ok;
 SELECT EXISTS(SELECT 1 FROM public.fiscal_documents f WHERE (f.pos_sale_id=s OR f.order_id=o) AND coalesce(f.finalidade,1)=1 AND f.ambiente='producao' AND f.status IN ('authorized','pending','pending_sefaz')),
 EXISTS(SELECT 1 FROM public.fiscal_documents f WHERE (f.pos_sale_id=s OR f.order_id=o) AND coalesce(f.finalidade,1)=1 AND f.status='authorized' AND f.data_autorizacao<now()-interval '24 hours') INTO active_exit,old_exit;
 RETURN jsonb_build_object('sale_id',s,'registered',registered,'received',received,'return_note_ready',note_ok,'active_sale_note',active_exit,'sale_note_over_24h',old_exit);
END $$;
REVOKE ALL ON FUNCTION public.refund_return_facts(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refund_return_facts(text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_refund_return_fiscal() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE f jsonb; blocked boolean; actor uuid;
BEGIN
 f:=public.refund_return_facts(NEW.source,NEW.source_id);
 blocked:=CASE WHEN NEW.reason='devolucao' THEN NOT ((f->>'registered')::boolean AND (f->>'received')::boolean AND (f->>'return_note_ready')::boolean) WHEN NEW.reason='cancelamento_antes_envio' THEN (f->>'active_sale_note')::boolean AND NOT ((f->>'registered')::boolean AND (f->>'return_note_ready')::boolean) ELSE false END;
 IF NEW.fiscal_override_by IS NOT NULL THEN
 actor:=coalesce(NEW.approved_by,NEW.manual_registered_by,NEW.requested_by);
 IF NEW.fiscal_override_by IS DISTINCT FROM actor OR NOT public.has_role(actor,'admin') OR length(trim(coalesce(NEW.fiscal_override_reason,'')))<3 OR length(NEW.fiscal_override_reason)>500 THEN RAISE EXCEPTION 'Exceção fiscal exige administrador e justificativa de 3 a 500 caracteres'; END IF;
 NEW.fiscal_override_at:=coalesce(NEW.fiscal_override_at,now());
 ELSIF blocked THEN
 RAISE EXCEPTION 'Estorno bloqueado: registre a devolução, confirme o recebimento/conferência e emita a NF-e de devolução; no cancelamento, cancele a nota de venda ou registre a devolução';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_refund_return_fiscal() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_refund_return_fiscal() TO service_role;
CREATE TRIGGER guard_refund_return_insert BEFORE INSERT ON public.gateway_refunds FOR EACH ROW WHEN (NEW.status IN ('aguardando_aprovacao','processando','concluido_manual')) EXECUTE FUNCTION public.guard_refund_return_fiscal();
CREATE TRIGGER guard_refund_return_start BEFORE UPDATE ON public.gateway_refunds FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='processando' AND OLD.status IN ('aguardando_aprovacao','falhou')) EXECUTE FUNCTION public.guard_refund_return_fiscal();
CREATE OR REPLACE VIEW public.estornos_sem_nf_devolucao WITH (security_invoker=true) AS
 SELECT r.id estorno_id,coalesce(s.id,o.pos_sale_id) venda_id,coalesce(s.customer_name,ps.customer_name,c.full_name) cliente,coalesce(r.completed_at,r.manual_done_at,r.created_at) data_estorno,r.amount valor_estorno,r.source,r.source_id,r.fiscal_override_by,r.fiscal_override_reason,n.numero nota_venda_numero,n.chave_acesso nota_venda_chave,
 EXISTS(SELECT 1 FROM public.trocas_devolucoes t WHERE t.pedido_original_id=coalesce(s.id,o.pos_sale_id) AND t.tipo='devolucao' AND t.status<>'cancelada') tem_registro_devolucao
 FROM public.gateway_refunds r LEFT JOIN public.pos_sales s ON r.source='pos_sale' AND s.id=r.source_id LEFT JOIN public.orders o ON r.source='order' AND o.id=r.source_id LEFT JOIN public.pos_sales ps ON ps.id=o.pos_sale_id LEFT JOIN public.customers c ON c.id=o.customer_id
 LEFT JOIN LATERAL (SELECT f.numero,f.chave_acesso FROM public.fiscal_documents f WHERE (f.pos_sale_id=coalesce(s.id,o.pos_sale_id) OR f.order_id=o.id) AND coalesce(f.finalidade,1)=1 AND f.status='authorized' ORDER BY f.created_at DESC LIMIT 1) n ON true
 WHERE r.status IN ('concluido','concluido_manual') AND (r.reason='devolucao' OR r.fiscal_override_by IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.fiscal_documents f WHERE (f.pos_sale_id=coalesce(s.id,o.pos_sale_id) OR f.order_id=o.id) AND f.finalidade=4 AND f.modelo=55 AND f.status='authorized' AND f.ambiente='producao');
REVOKE ALL ON public.estornos_sem_nf_devolucao FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.estornos_sem_nf_devolucao TO service_role;