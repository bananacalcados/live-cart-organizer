# PDV no celular — Fase 0: levantamento e estrutura (28/11/2026)

## Decisões do Matthews (valem para todo o projeto)
- Usuários: o Matthews (acompanha de fora) e toda a equipe desde o começo. O que é admin continua só admin.
- Venda no salão, de pé ao lado da cliente: uma mão, poucos toques, câmera para bipar.
- Venda: TODAS as formas de pagamento do desktop.
- Troca entra no celular (Fase 5). Condicional/devolução: ver seção 8.
- WhatsApp: notificação de mensagem nova (fase própria).
- Expedição: impressão pelo PC continua padrão + PDF de etiqueta Correios/DANFE pelo celular.
- Mais urgente: WhatsApp e Expedição.
- Ordem: 0 levantamento+estrutura · 1 Expedição (fila, conferência por câmera com foto, despacho) · 2 WhatsApp (lista, conversa, ações da cliente, troca) · 3 Notificação · 4 Expedição PDF etiqueta+DANFE, frete · 5 Caixa+Venda+Troca · 6 Clientes+Dashboard.
- Convite: app_settings.pos_mobile_redirect = off (padrão) | invite | auto. O Matthews liga 'invite' após publicar a Fase 1.

## 1. Permissões (todas as telas)
- /pos e /m/pdv/* usam ProtectedRoute com módulos ["pos","expedition"] (get_user_allowed_modules).
- Só-Expedição (expedition sem pos): desktop força a aba Expedição; o celular mostra só Expedição (mesma função isExpeditionOnly).
- Nas telas de Dashboard/Venda/Caixa/Clientes/Trocas não há checagem de papel por ação no componente; a proteção é a rota + RLS. Config usa PIN no navegador (fora do celular).
- WhatsApp: admin/moderator (user_roles) habilita filtro de atendentes.
- Loja: o desktop NÃO guarda a loja escolhida (escolhe a cada abertura). O celular guarda no aparelho (mesma lista pos_stores ativas e não-simulação). Vendedora: mesma lista pos_sellers ativos da loja; seleção guardada por loja no aparelho; não é senha.

## 2. Dashboard (Fase 6)
- Faz: consolidado de lojas, vendas, metas, clientes; dashboard da loja com vendas, itens, tarefas, alertas, ranking/comissão, reclamações.
- Dados: pos_stores, pos_sales, pos_goals, pos_customers, pos_sale_items, pos_seller_tasks, support_tickets, pos_inter_store_requests, expedition_stock_requests, pos_commission_*; RPC get_conversation_counts; função shopify-sync-to-pos.
- Admin: Dashboard Geral/DRE/Folha com senha no servidor — continuam só desktop/admin.
- Tempo real/repetição: nenhum.
- Preso no componente (vai para lib): consolidação de indicadores e composição da comissão.
- Defeito conhecido: tabela pos_seller_complaints não existe (404) — já relatado.

## 3. Venda (Fase 5)
- Faz: vendedora, buscar/bipar, cliente, itens, desconto, cashback, voucher, pagamento simples/múltiplo/crediário, finalizar, NFC-e, cupom, condicional, troca.
- RPCs: search_products_unaccent, generate_crediario_installments, redeem_voucher_once, get_conversation_counts. Funções: pos-validate-coupon, pos-conditional-create/finalize, pos-site-exchange-finalize, nfce-emitir, referral-validate-coupon, pos-tiny-payment-methods, pos-tiny-create-sale, point-terminals, point-create-order, mercadopago-create-pix/check-payment.
- Periféricos: câmera (POSBarcodeScanner) e leitor-teclado (Enter), mesmo código ignorado por 1,2 s; cupom/presente por window.print (no celular: PDF/compartilhar); Point pela internet (funciona no celular).
- Repetições locais por ação (não são polling de tela): Point consulta a cada 3 s durante a cobrança; Pix a cada 5 s com o diálogo aberto.
- Travas: botão desabilita durante a finalização (só no aparelho); pos-tiny-create-sale não recria se a venda já tem pedido; Point usa chave idempotente. NÃO há chave única de venda nova → no celular será obrigatório criar uma (Fase 5) antes de liberar.
- Preso no componente (muito): toda a sequência pós-venda (crediário, cliente, fiscal, resgates, caixa, pontos, metas) em POSSalesView (3.686 linhas). É a maior extração do projeto; exige teste antes/depois.
- Link avulso (POSCustomLinkDialog) grava venda e item em duas etapas sem transação.

## 4. Caixa (Fase 5)
- Faz: abrir/fechar, saldo inicial, sangria/suprimento, comprovantes, receber crediário, relatórios.
- Dados: pos_cash_registers, pos_cash_movements, pos_payment_receipts, bank_accounts, pos_sales, armazenamento payment-receipts; RPCs pos_crediario_search, pos_crediario_pay_installment, pos_crediario_pay_sale.
- Trava: fechamento relê e recusa se já fechado (leitura seguida de escrita, não atômico). Trigger block_movement_on_closed_register no banco.
- Impressão: window.print → PDF no celular.
- Preso no componente: saldo esperado, fechamento e recebimentos.

## 5. Expedição (Fases 1 e 4)
- Faz: avançar/voltar etapa, SEDEX prioritário, separar/conferir, editar itens/cliente/frete, compras/chegadas, ajuste de estoque/preço, DANFE/NF-e, etiquetas, rastreio, cancelar.
- RPCs: pos_expedition_stage_counts, latest_sale_freight_summaries, exchange_desk_count, revert_sale_price_adjustment, expedition_cancel_sale, expedition_update_sale_items, apply_sale_price_adjustment, compras/grades. Funções: nfe-emitir, fiscal-backfill-danfe, pos-stock-transfer-v2, pos-stock-movement, correios-shipment.
- Tempo real: canais pos-expedition-{loja}/pos_sales, gateway_refunds, exchange_requests (sem polling).
- RISCO CRÍTICO: avançar etapa grava direto em pos_sales pelo id, sem conferir a etapa anterior → duas pessoas podem sobrescrever o movimento uma da outra. Fase 1 propõe função de servidor com "só move se ainda estiver na etapa X".
- Preso no componente: máquina de etapas, agrupamento/priorização, gravações múltiplas (POSExpedition, 2.020 linhas).
- Periféricos: leitor/câmera na conferência; impressora de etiqueta/DANFE (PC).

## 6. Clientes (Fase 6)
- Faz: lista/busca/filtros, perfil 360°, contato/WhatsApp, histórico, cashback, pontos, NPS, insights.
- Dados: customers_unified, crm_customers_v, internal_cashback, pos_sales, zoppy_sales, customer_loyalty_points, chat_nps_surveys, chargebacks; RPC pos_customer_suffixes_by_filter; função pos-customer-360-insights.
- Sem tempo real/repetição. Botões de 32 px e resumos em 3 colunas.

## 7. WhatsApp (Fases 2 e 3)
- Faz: atender, atribuir, mover/finalizar filas, editar/apagar, localizar pedido/cliente, cobrar (Pix/link), avaliação, iniciar troca/devolução/chargeback, catálogo (fonte ERP ligada).
- RPCs: get_conversations_multi_json (fallback get_conversations_multi), get_conversations_since, lookup_cashback_by_phones, resolve_instagram_customer. Funções: envio por provedor (uazapi/wasender/zapi/Meta), zapi-delete/edit-message, review-send-link, zapi-profile-picture.
- Tempo real: canal único wa_msg_inserts (broadcast wa_msg_insert/wa_msg_update), recarga no máx. 1 vez/4 s.
- Repetições automáticas (NÃO alteradas, só propostas):
  1. POSWhatsApp ~l.476 — a cada 60 s (só com aba visível) recarrega cards da live: eventos ativos, números da loja e até 1.000 pedidos. Custo: ~3 consultas/min por tela aberta, a maior delas pesada. Proposta: trocar por evento (canal de orders já usado na live) e recarregar ao voltar para a aba.
  2. POSWhatsApp ~l.1533 — a cada 60 s, rede de segurança da lista (incremental get_conversations_since; completa a cada 10 min); oculta não consulta. Custo: 1 consulta leve/min. Proposta: manter (é seguro), no celular só ao voltar para a tela/reconectar.
  3. POSShipments (aba Envios) ~l.201 — a cada 5 s, SEM pausar com aba oculta, busca até 200 vendas + clientes, vendedoras, itens, tentativas e notas. Custo: ~12 rodadas/min de 5–6 consultas por tela aberta — a mais cara do PDV e fora das regras (mín. 30 s, pausar oculto). Proposta prioritária: tempo real em pos_sales da loja + recarga ao voltar.
  - POSWhatsAppLanes l.198 (30 s) só atualiza o relógio da tela; não consulta o banco.
- Notificação (Fase 3): existe public/push-sw.js (mostra a notificação e abre o link), manifest.json, tabela push_subscriptions e função push-notifications com chaves em app_settings. FALTA: o envio dessa função não é Web Push de verdade (POST vazio sem assinatura VAPID/criptografia); não há cadastro do aparelho no PDV; não há disparo na mensagem recebida. Limitações: Android/Chrome funciona com o site aberto ou fechado após permissão; iPhone só com o app instalado na tela inicial (iOS 16.4+) e permissão dada dentro dele; sem garantia de entrega instantânea; é preciso limitar por vendedora/instância para não notificar todo mundo.

## 8. Trocas, devolução, condicional (Fase 5)
- Novo fluxo: NewExchangePicker + lib/pos/newExchange.ts, finalizeExchange.ts, exchangeNfe.ts; RPCs exchange_add_replacement, exchange_swap_replacement, exchange_cancel, exchange_create_difference_link, exchange_mark_difference_paid; funções correios-reverse, nfe-devolucao-emitir, pos-stock-balance, checkout-quote-freight. A maior parte já está em lib → boa candidata para o celular.
- Legado POSExchanges grava direto (pos-exchange-stock-adjust, pos_exchanges) — não levar ao celular.
- Trava: sobreposição do mesmo item checada antes de inserir (sujeita a corrida).
- Condicional: pos-conditional-create / pos-conditional-finalize (retorna ok se já finalizado); regras de devolvidos por SKU/código, validação de cadastro e pagamento estão em POSSalesView. Para entrar junto com a Venda: extrair essas regras para lib e reaproveitar a impressão do termo de assinatura em PDF.
- Devolução: já está no fluxo novo de trocas (tipo devolucao, estorno padrão) → entra junto com Troca sem trabalho extra além das telas.

## 9. O que só dá para testar em aparelho real
Câmera bipando etiquetas reais, leitor bluetooth, compartilhar/imprimir PDF, Point, notificação (Android e iPhone instalado), áudio no WhatsApp, rede 4G instável, uma mão no salão.

## 10. Outras abas que ficam no desktop
Pedidos, Online, Envios, Retiradas, Solicitações, Transferência, Chat de equipe, Vendedores, Checkout, Queima, Procurados, Config.

## 11. Estrutura construída (Fase 0)
- /m/pdv/* em src/mobile/pdv/ (MobilePdvApp, redirect, sections). Só leitura.
- Barra inferior: Expedição, WhatsApp, Venda, Caixa, Mais (Trocas, Clientes, Dashboard, loja, vendedora, versão completa).
- "Em breve" + "Ver versão completa" → /pos?section=<aba>. O desktop agora aceita ?section= também para sales, cash, whatsapp, customers, returns, dashboard (sem parâmetro continua no Dashboard; config nunca).
- Convite no /pos (toque e <768 px), controlado por pos_mobile_redirect, padrão off.
- Botão flutuante do chat da equipe escondido em /m/pdv (como já era em /pos).
