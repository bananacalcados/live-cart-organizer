CREATE OR REPLACE FUNCTION public.central_reverse_finish(p_request_id uuid,p_reverse_id uuid,p_code text,p_valid_until date,p_error text,p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; rv uuid; wid uuid; oid uuid; doc uuid; doc_key text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO e FROM public.exchange_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  rv:=coalesce(p_reverse_id,e.reverse_shipment_id,(SELECT id FROM public.correios_reverse_shipments WHERE idempotency_key='central-'||p_request_id::text));
  IF p_code IS NOT NULL AND p_error IS NULL THEN
    IF p_code!~'^[A-Z]{2}[0-9]{9}[A-Z]{2}$' THEN RAISE EXCEPTION 'Código de postagem inválido'; END IF;
    IF rv IS NOT NULL THEN SELECT r.devolucao_doc_id INTO doc FROM public.correios_reverse_shipments r WHERE r.id=rv; END IF;
    IF doc IS NOT NULL THEN
      SELECT f.chave_acesso INTO doc_key FROM public.fiscal_documents f WHERE f.id=doc AND (f.troca_devolucao_id IS NULL OR f.troca_devolucao_id=e.trocas_devolucoes_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'A nota de devolução já está ligada a outra troca'; END IF;
      UPDATE public.fiscal_documents SET troca_devolucao_id=e.trocas_devolucoes_id WHERE id=doc AND troca_devolucao_id IS NULL;
      UPDATE public.trocas_devolucoes SET devolucao_doc_id=doc,chave_devolucao=doc_key WHERE id=e.trocas_devolucoes_id;
    END IF;
    UPDATE public.exchange_requests SET reverse_shipment_id=rv,reverse_shipping_code=p_code,status='aguardando_postagem',auto_approved=true,requires_human_review=false,escalated_reason=NULL,updated_at=now() WHERE id=e.id;
    UPDATE public.trocas_devolucoes SET codigo_postagem_reversa=p_code,status='aguardando_retorno',fase2_erro=NULL,updated_at=now() WHERE id=e.trocas_devolucoes_id;
    INSERT INTO public.exchange_request_events(request_id,actor_name,action,to_status,note) VALUES(e.id,'Central automática','reverse_created','aguardando_postagem','Reversa e nota de devolução criadas sem duplicidade');
    SELECT m.whatsapp_number_id INTO wid FROM public.whatsapp_messages m
      WHERE m.phone=e.phone AND m.whatsapp_number_id IN ('0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c','ae453235-50e1-4ef6-8a87-8c8a77b2b440','1f715932-e118-4e88-8051-85a5c14f5a4b','c01d2777-df4c-4746-9433-d8c97c57d529')
      ORDER BY m.created_at DESC LIMIT 1;
    wid:=coalesce(wid,'0833dc6c-6bd4-4b2f-8cb2-1889a5993e9c');
    IF p_message IS NOT NULL THEN
      BEGIN
        INSERT INTO public.support_outbox(phone,whatsapp_number_id,text,requested_by,idempotency_key)
        VALUES(e.phone,wid,p_message,'central_auto','central-'||e.id::text) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO oid;
        SELECT id INTO oid FROM public.support_outbox WHERE idempotency_key='central-'||e.id::text;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.exchange_request_events(request_id,actor_name,action,note) VALUES(e.id,'Central automática','outbox_error',left(SQLERRM,800));
      END;
    END IF;
    RETURN jsonb_build_object('ok',true,'status','aguardando_postagem','reverse_code',p_code,'reverse_valid_until',p_valid_until,'outbox_id',oid);
  END IF;
  UPDATE public.exchange_requests SET reverse_shipment_id=rv,status='escalado',auto_approved=false,requires_human_review=true,escalated_reason=left(coalesce(nullif(p_error,''),'Não foi possível gerar a reversa automaticamente'),800),updated_at=now() WHERE id=e.id;
  INSERT INTO public.exchange_request_events(request_id,actor_name,action,to_status,reason) VALUES(e.id,'Central automática','reverse_failed','escalado',left(coalesce(p_error,'erro desconhecido'),800));
  RETURN jsonb_build_object('ok',false,'status','escalado');
END $$;
REVOKE ALL ON FUNCTION public.central_reverse_finish(uuid,uuid,text,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.central_reverse_finish(uuid,uuid,text,date,text,text) TO service_role;