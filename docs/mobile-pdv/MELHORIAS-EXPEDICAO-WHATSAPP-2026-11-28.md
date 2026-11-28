# Melhorias PDV mobile — Expedição (A) e WhatsApp (B) — 28/11

## Parte A — Expedição
- Lista paginada via RPC de leitura `mobile_pdv_expedition_ids_v2` (invoker/RLS, sem anon): loja opcional (null = todas), filtros forma de envio (all/moto/carrier/pickup/none, mesma regra do desktop sobre delivery_method||shipping_carrier) e origem (live/whatsapp/online, mesma regra de getOrigin). Ordem: SEDEX e Mototaxista primeiro, depois mais antigo (desktop não ordena assim; regra só mobile).
- Contadores: `pos_expedition_stage_counts(p_store_id null|loja)` — respeitam o filtro de loja.
- Tempo real: um ouvinte `sales_changed` por loja ativa no modo "todas", igual ao desktop. Sem polling.
- Regra pura `src/lib/pos/expeditionReadiness.ts`: etiqueta de frete, prioridade, "Dados completos/Faltando" (nome, telefone, CPF 11 díg., frete, CEP 8 díg. + logradouro/número/bairro/cidade/UF fora de retirada, pagamento), espelhando a gravação do ExpOrderEditDialog e expeditionShippingError.
- Seleção múltipla: mesmas exclusões do desktop (sem Conferência/Concluído, sem avulso incompleto). Avança pedido a pedido por `pos_expedition_transition` (mesmo modo do avanço individual) e mostra quantos avançaram e quais falharam com o motivo.
- Edição: detalhe em tela cheia + o MESMO ExpOrderEditDialog do desktop (mesma gravação), com a loja do próprio pedido.
