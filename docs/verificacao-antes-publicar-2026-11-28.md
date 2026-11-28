# Verificação antes de publicar — Banana Calçados
28/11/2026 — pedido do Matthews

## Veredito: seguro publicar — NÃO, ainda
As correções autorizadas foram feitas e os 1.511 testes automatizados passaram. Não houve publicação, implantação de funções, mudança de interruptores ou gravação de dados reais nesta tarefa.

Ainda falta resolver/autorizar a estrutura ausente de reclamações de vendedora e obter evidência separada da checagem de tipos e do build de produção. O ambiente proíbe executar esses dois manualmente; o sinal automático disponível registra `build OK`, mas não distingue suas etapas. Não vou repetir a afirmação anterior de que ambos passaram separadamente sem essa prova.

## 1. Shopify desligado: correções
- Mensagens agendadas VIP: JPG só quando Marketing está em ERP E o produto traz procedência ERP, incluindo produtos vinculados à Shopify. Shopify mantém a URL original e os mesmos dados do bloco; nenhum envio real foi feito. Intervalos e responsáveis dos grupos intactos.
- Venda online: a validação rígida da Yampi só rejeita itens com procedência ERP. Identificadores Shopify antigos passam intactos. Catálogos já preservavam identificadores sem metadados ERP; isso foi testado, sem alterar sua regra.
- Promoções: fonte exclusivamente pelo interruptor do cross-sell; o interruptor da live não participa da escolha. Nenhuma alteração de cálculo financeiro no servidor.
- Comparação automática: 20 casos executam trechos reais atuais e trechos congelados, extraídos literalmente do commit 89e788d95. Cobrem gravação VIP, foto, identificadores de catálogo/pedido, entrada/saída da Yampi e fonte de busca das promoções. Há comparação da saída da busca; não houve gravação real de promoção.

## 2. Os 12 testes antigos
- 9 de conferência: QueryClientProvider próprio por montagem, com fotos desligadas no cache de teste. As afirmações de bipagem e registro foram preservadas.
- 1 de frete: saiu da chamada sem permissão ao banco compartilhado. Agora executa a mesma função PL/pgSQL versionada num PostgreSQL descartável, acessível apenas por socket local, sob papel autenticado. Verifica também que anon não recebe execução. Não foi alterada nenhuma permissão real. Os 12 cenários e a permissão agora aparecem individualmente (13 testes, antes 1).
- 1 de Correios: expectativa inclui status 01, já preservado pela regra real. Não removi o status.
- 1 de Instagram: simulação inclui leitura de ig_live_cart_notifications sem confirmação anterior. Mantidas as afirmações de isolamento do lote.
Nenhum desses testes revelou defeito real de regra de negócio nesta execução.

### Resultado das suítes
| Executor | Total | Passaram | Falharam |
|---|---:|---:|---:|
| Aplicativo / Vitest | 1.195 | 1.195 | 0 |
| Funções / Deno | 295 | 295 | 0 |
| AustPay / Vitest Node | 21 | 21 | 0 |
| **Total** | **1.511** | **1.511** | **0** |

A contagem aumentou por 20 testes de comparação, 4 de perfil e a divisão dos cenários de frete. Os testes Deno foram executados sem checagem de tipos, com permissões locais de leitura/sys/git necessárias aos testes existentes. Tentativas iniciais falharam por permissões do executor; a execução final passou. Não confundir essas falhas intermediárias com defeitos do aplicativo.

Os 21 arquivos SQL de integração não são descobertos por esses executores; não rodei scripts de banco compartilhado nem cenários com gravações reais. A suíte completa acima é a dos testes descobertos de Vitest/Deno, não uma alegação de teste de todo arquivo SQL ou de toda operação real.

## 3. HTTP 400 e 404
### Perfil: real, corrigido no front
Resposta reproduzida: HTTP 400, código 22P02, `invalid input syntax for type uuid: "email:..."`.
user_profiles.user_id é UUID; TeamChat e POSTeamChat consultavam um texto de e-mail quando não encontravam perfil pelo UUID. Isso afeta qualquer usuário normal sem perfil correspondente, não só sessão de teste.
Removi esse caminho impossível e sua tentativa de regravar vínculo ao abrir. Perfil existente continua pelo UUID; sem perfil, permanece o nome da sessão como já acontecia depois do erro. Quatro testes passaram; o HTTP 400 não reapareceu.

### Reclamações: real, não corrigido por não ser trivial/seguro
HTTP 404, PGRST205: `Could not find the table 'public.pos_seller_complaints' in the schema cache`.
Consulta de esquema confirmou a tabela ausente. O Dashboard consulta essa estrutura e Trocas tenta gravar nela. Portanto, afeta usuários normais também; não é ruído de sessão de teste. Resolver exige definir/aprovar estrutura, permissões e persistência das reclamações. Não inventei tabela nem escondi o erro. A estrutura e as regras dessa funcionalidade ficaram intactas, conforme o limite autorizado.

## 4. Trocas — não alteradas nesta tarefa
Pedido de 27/11/2026, 17:14, mensagem #10707 (fuso não explicitado no histórico):
> Agora, tem que ter uma opção também no modal de marcar a diferença da troca como PAGO para situações em que o cliente pagou por fora do link.

Na mesma mensagem pediu trocar produto de pedido pago, gerar link da diferença e refletir produto novo na Expedição.
Pedido de 27/11/2026, 17:26, #10712:
> Precisa aparecer esse botão de PAGO por fora no modal do whatsapp para podermos marcar a diferença como paga.

O pedido de 16:44, #10705, originou o modal com produtos atuais removíveis e inclusão de novos produtos.

Implementado: commits 4b4a30895, 319f9a6f0 e 2a023e275. Arquivos funcionais:
- src/components/pos/ExchangeInProgressCard.tsx
- src/lib/pos/exchangeInProgress.ts
- drizzle/migrations/0307_exchange_mark_difference_paid.sql
- drizzle/migrations/0308_exchange_mark_difference_paid_followup_cast.sql
Testes: src/components/pos/__tests__/exchangeMarkDifferencePaid.test.tsx e src/test/exchangeInProgress.test.ts.

Para equipe: mostra ATUAL/NOVO, remover/adicionar, Marcar pago por fora e indicação distinta de Link pago. Servidor recalcula diferença, valida pagamento e registra funcionário/forma/horário; encerra espera e follow-ups da cobrança quitada. Se não há cobrança, essa entrada cria link com frete grátis/zero antes de confirmar — decisão já existente, que não alterei. A substituição geral do produto de pedido já pago ANTES do despacho continua apenas desenhada, não implementada. Não confundir as duas entregas.

## 5. O que será publicado junto
Baseline confirmado no HTML do site publicado: 1f084258d6137c8aa97c8bf0e547a3fb248bff0e. Última publicação: 27/11/2026 14:38:59 UTC. Não deduzi o commit apenas pela data.
Há 17 commits anteriores a esta tarefa após esse baseline, com 111 arquivos diferentes, mais as correções desta tarefa.

### Inventário por tema
1. Estoque no celular: correção da busca por códigos/etiquetas e resolução no balanço (0301).
2. Fases 0/A: busca ERP paginada, adaptador, acentos/filtros/desempenho e índice; seletores, itens e botões Shopify preparados para ERP, fonte live ainda Shopify (0302–0306).
3. Trocas: produtos atuais/remover/adicionar e diferença paga por fora, inclusive sem link prévio (0307–0308).
4. Fase B: catálogo/vitrine/cross-sell e promoções ERP; páginas públicas e checkout correspondentes; fonte cross-sell ainda Shopify (0309).
5. Fase C: catálogo WhatsApp PDV/live, seletor de fotos, várias cores, texto sem foto e venda online ERP; fonte WhatsApp ainda Shopify (0310).
6. Fase D: seletores Marketing, catálogo de captação, Dose Tripla e Link Pages; produto ERP-only vai ao atendimento WhatsApp em vez de página inexistente; fonte Marketing ainda Shopify (0311).
7. Rastreio: uma saída real da origem sem expor cidade, rotação do backfill, fallback público apenas Jadlog; testes.
8. Resumo diário de envios com problema, consulta paginada e classificação (0312).
9. Chamados Correios: bloco/lista no PDV junto à etiqueta, persistência e função isolada (0313–0315). API ainda bloqueada pelo contrato e falta e-mail de remetente; timeout da agenda segue sem comprovação.
10. Tipos, testes, documentação e metadados de migração correspondentes.
11. Nesta tarefa: compatibilidade Shopify nos três pontos, perfil sem consulta inválida e correções/testes antigos.

**Já publicados antes desse baseline, não são novidades desta publicação:** convite do estoque mobile, fotos por cor na ficha, editor de foto do computador, miniaturas, balanço multiaparelho/zeramento/desfazer, criação/edição de produto e variações no celular, seletores em tela cheia. Os commits desses recursos já são ancestrais de 1f084258d. Apenas a correção posterior de busca por códigos ainda entrará agora.

Publicar o front não aplica novamente migrações nem é o que implanta funções. Funções das fases B/D, rastreio, resumo e chamados já foram implantadas nos trabalhos anteriores; nesta tarefa nenhuma função de produção foi modificada ou reimplantada.

### Commits desde a publicação
35559a06f — Corrige busca por códigos no estoque mobile
9137429c8 — Changes
89e788d95 — Update plan
ecb1b08f0 — Produtos da live pelo ERP (Fase 0 e A) com interruptor desligado (shopify)
4b4a30895 — Trocar produto da troca: mostra itens atuais para remover e adicionar novos
319f9a6f0 — Permitir confirmar diferença de troca paga por fora
2a023e275 — Troca: botão Pago por fora aparece mesmo sem link da diferença gerado
d51549bad — Fase B: catálogo, cross-sell e promoções da live aceitam produtos do ERP (interruptor product_source_crossell, padrão Shopify)
b1e63518b — Fase C: WhatsApp (catálogo, seletor de foto e venda online) aceita produtos do ERP com interruptor product_source_whatsapp (padrão Shopify)
00f08ae75 — Fase D: produtos do ERP no Marketing (interruptor desligado), páginas públicas e clique pelo WhatsApp para produto sem página no site
d60e81a94 — Work in progress
310da7eea — Mostra uma única saída real da origem no rastreio público
bb7dccebc — Corrige rotação da fila de atualização de rastreio
87f260645 — Registra diagnóstico do rastreio Jadlog sem alterar regras
7d7d0047d — Adiciona fallback público para rastreio Jadlog
ed6cf0d66 — Adiciona resumo diário de envios com problema para o dono
31ce50a21 — Adiciona chamados Correios isolados com consulta e acompanhamento no PDV

## 6. Navegador: sessão normal, gravações bloqueadas
- Montar pedido da live: abriu o modal Novo Pedido. Não criei pedido.
- Apresentadora: painel e produtos existentes carregaram.
- Venda: abriu a trava Caixa Fechado. Não abri caixa real; a venda com caixa aberto continua não verificada no navegador.
- Expedição: carregou pedidos e contadores reais, sem mover etapa.
- WhatsApp PDV: conversa existente e catálogo Shopify com 1.019 variantes carregaram; nenhum envio.
Execução final: zero exceções JavaScript e zero respostas HTTP de erro nesses cinco caminhos, nenhuma consulta erp_catalog/marketing-catalog-public. O 404 real foi reproduzido separadamente no Dashboard do PDV, que não ficou escondido por essa lista de telas.
Proteção: bloqueou operações de gravação, registro de acesso e verificação Shopify que poderia persistir informações; consultas RPC só liberadas após confirmar leitura. Erros intermediários do navegador foram causados por retorno da proteção em consultas de leitura ainda não liberadas; após ajustar a proteção, não reapareceram. A verificação Shopify automática não foi exercitada.
Não há alegação de venda real, cobrança, estoque ou mensagem testada end-to-end: foram proibidos por este pedido.

## Diferenças remanescentes com tudo em Shopify
Nos caminhos Shopify comparados, as três diferenças autorizadas foram removidas. Permanecem bloco neutro sem foto, novos campos vazios e novos endereços sem uso.
Além dessas inofensivas, é necessário registrar uma ressalva: páginas/itens ERP já persistidos continuam resolvendo ERP ao desligar; interruptores ficam em cache da aba até recarregar. Isso não foi alterado porque o escopo era fechado. Portanto não afirmo equivalência universal para dados ERP criados anteriormente. Trocas e painel Chamados Correios são mudanças independentes desses interruptores.

## Roteiro após eventual publicação autorizada
1. Recarregar a aba e conferir fontes ainda em Shopify.
2. Abrir live e apresentadora; montar um pedido de TESTE com produto Shopify e conferir preço/variante, sem usar cliente real.
3. Conferir catálogo WhatsApp e agendamento VIP com foto original; envio somente a número de teste.
4. Com caixa aberto legitimamente, conferir Venda e fluxo de teste autorizado; conferir Expedição sem mover pedido real.
5. Abrir páginas antigas de catálogo/Link Page no celular e verificar destinos oficiais.
6. Conferir os botões de trocas existentes, especialmente diferença paga por fora e frete — confirmação real somente com autorização.
7. Verificar Dashboard/reclamações depois da correção específica aprovada e conferir Chamados Correios sem tentar abrir outros protocolos.

## Arquivos anteriores ainda fora da versão publicada (inventário integral)
- .lovable/plan.md
- AGENTS.md
- drizzle/migrations/0301_mobile_product_code_lookup.sql
- drizzle/migrations/0302_erp_catalog_search_live.sql
- drizzle/migrations/0303_erp_catalog_search_accent_fix.sql
- drizzle/migrations/0304_erp_catalog_search_null_filter_fix.sql
- drizzle/migrations/0305_erp_catalog_search_stock_speed.sql
- drizzle/migrations/0306_erp_catalog_search_barcode_index.sql
- drizzle/migrations/0307_exchange_mark_difference_paid.sql
- drizzle/migrations/0308_exchange_mark_difference_paid_followup_cast.sql
- drizzle/migrations/0309_erp_crossell_phase_b.sql
- drizzle/migrations/0310_product_source_whatsapp_switch.sql
- drizzle/migrations/0311_erp_marketing_phase_d.sql
- drizzle/migrations/0312_shipment_delay_digest_read_page.sql
- drizzle/migrations/0313_correios_pi_requests.sql
- drizzle/migrations/0314_correios_pi_apply_checks.sql
- drizzle/migrations/0315_correios_pi_service_only_writes.sql
- drizzle/migrations/meta/0301_snapshot.json
- drizzle/migrations/meta/0302_snapshot.json
- drizzle/migrations/meta/0303_snapshot.json
- drizzle/migrations/meta/0304_snapshot.json
- drizzle/migrations/meta/0305_snapshot.json
- drizzle/migrations/meta/0306_snapshot.json
- drizzle/migrations/meta/0307_snapshot.json
- drizzle/migrations/meta/0308_snapshot.json
- drizzle/migrations/meta/0309_snapshot.json
- drizzle/migrations/meta/0310_snapshot.json
- drizzle/migrations/meta/0311_snapshot.json
- drizzle/migrations/meta/0312_snapshot.json
- drizzle/migrations/meta/0313_snapshot.json
- drizzle/migrations/meta/0314_snapshot.json
- drizzle/migrations/meta/0315_snapshot.json
- drizzle/migrations/meta/_journal.json
- roadmap.md
- src/components/LiveSessionManager.tsx
- src/components/OrderCardDb.tsx
- src/components/OrderDialogDb.tsx
- src/components/ProductSelector.tsx
- src/components/checkout/CrossellModal.tsx
- src/components/events/ActiveProductBar.tsx
- src/components/events/CrossellBlocksEditor.tsx
- src/components/events/CrossellConfigStep.tsx
- src/components/events/EventCatalogManager.tsx
- src/components/events/EventSetupWizard.tsx
- src/components/events/LiveCodeIntentLane.tsx
- src/components/events/LivePromotionsManager.tsx
- src/components/events/LiveShownProductsPanel.tsx
- src/components/events/ShopifyImagePicker.tsx
- src/components/marketing/AutomationFlowBuilder.tsx
- src/components/marketing/CatalogLandingPageCreator.tsx
- src/components/marketing/CatalogLeadPageCreator.tsx
- src/components/marketing/LinkPageManager.tsx
- src/components/marketing/PublicProductImage.tsx
- src/components/marketing/ScheduledMessageForm.tsx
- src/components/pos/ExchangeInProgressCard.tsx
- src/components/pos/POSOnlineSales.tsx
- src/components/pos/POSProductCatalogSender.tsx
- src/components/pos/__tests__/exchangeMarkDifferencePaid.test.tsx
- src/components/pos/expedition/CorreiosPiPanel.tsx
- src/components/pos/expedition/ExpCorreiosShipmentPanel.tsx
- src/integrations/supabase/types.ts
- src/lib/AGENTS.md
- src/lib/inventory/mobileCycleApi.test.ts
- src/lib/inventory/mobileCycleApi.ts
- src/lib/inventoryStockCode.ts
- src/lib/liveCatalog.ts
- src/lib/liveCodeOrder.ts
- src/lib/liveProductSource.ts
- src/lib/marketing/erpMarketing.ts
- src/lib/pos/exchangeInProgress.ts
- src/lib/shopify.ts
- src/lib/whatsapp/erpProductPhotos.ts
- src/mobile/inventory/MobileInventoryApp.tsx
- src/mobile/inventory/data.test.ts
- src/mobile/inventory/data.ts
- src/pages/CatalogLeadPage.tsx
- src/pages/DoseTriplaCatalog.tsx
- src/pages/LinkPageView.tsx
- src/pages/LiveCatalogPage.tsx
- src/pages/LiveCatalogPublicPage.tsx
- src/stores/dbOrderStore.ts
- src/test/crossellProductSource.test.ts
- src/test/exchangeInProgress.test.ts
- src/test/liveProductSource.test.ts
- src/test/marketingProductSource.test.ts
- src/test/posCatalogSenderErp.test.tsx
- src/test/whatsappErpPhotos.test.ts
- src/types/database.ts
- supabase/config.toml
- supabase/functions/_shared/frenet-tracking.test.ts
- supabase/functions/_shared/frenet-tracking.ts
- supabase/functions/_shared/shipment-origin-event.ts
- supabase/functions/_shared/shipment-stages.ts
- supabase/functions/checkout-crossell/index.ts
- supabase/functions/correios-pedido-informacao/AGENTS.md
- supabase/functions/correios-pedido-informacao/domain.ts
- supabase/functions/correios-pedido-informacao/domain_test.ts
- supabase/functions/correios-pedido-informacao/index.ts
- supabase/functions/link-page-catalog-sync/index.ts
- supabase/functions/live-catalog-public/index.ts
- supabase/functions/live-catalog/index.ts
- supabase/functions/marketing-catalog-public/index.ts
- supabase/functions/shipment-delay-digest/AGENTS.md
- supabase/functions/shipment-delay-digest/digest.test.ts
- supabase/functions/shipment-delay-digest/digest.ts
- supabase/functions/shipment-delay-digest/index.ts
- supabase/functions/shipment-tracking-backfill/index.ts
- supabase/functions/shipment-tracking-backfill/selection.test.ts
- supabase/functions/shipment-tracking-public/index.ts
- supabase/functions/shipment-tracking-public/origin-event.test.ts
- supabase/functions/vip-go/index.ts
