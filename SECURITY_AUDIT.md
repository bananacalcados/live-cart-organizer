# Auditoria de segurança — Banana Calçados
Data: 05/11/2026 UTC. Escopo: este ERP; o outro projeto invadido não foi alterado.

## Fase 1 — executado
- Dez tabelas passaram a RLS; anon sem privilégios. Backups e _perf_snap exclusivos do serviço. TRUNCATE/REFERENCES/TRIGGER removidos de authenticated em todas as tabelas públicas.
- Leitura das tabelas operacionais para equipe autenticada. Escrita com permissão events para configuração/exibição; inventory para gerar códigos (RPCs invoker precisam dos privilégios subjacentes). Pacing continua só serviço.
- Criados access_log, admin_access_log, security_events; escrita só serviço e leitura admin. Retenção indeterminada, sem limpeza. Índices por data/IP/função/usuário. Alertas admin_new_ip serializados por usuário/IP.
- 318 funções existentes + security-auth-event recebem withAccessLog: 319 funções implantadas. Handler original preservado; OPTIONS não registra, strings até 500; sem payload/Authorization/cookies/query secrets. Identidade somente de JWT verificado, sem confiar em decodificação simples.
- 21 funções ganharam barreira de JWT; contact-erase exige admin, estoque/PDV/expedição exigem módulo. Demais candidatas exigem usuário válido. admin-* preserva barreiras existentes (listagem mantém gerente).
- Continuação de inventory-correct-stock e recuperação do watchdog migradas para serviço + x-internal-call, usando segredo interno existente. Não aceita anon como chamada interna.
- Funções de mensagem com chamadores internos/cron/MCP incertos ficaram SOMENTE com registro, conforme regra de ouro. backfill-payment-method, pos-tiny-create-sale e zapi-group-campaign-execute também permanecem para revisão. zoppy-sync-* não existe no código.
- MCP preservado: chave dedicada x-agent-key, configuração ausente rejeita; ferramenta privilegiada ainda requer revisão por operação.
- Administração > Acessos e Admin adicionados. Login/sessão e logout geram observações server-side com IP; eventos declarados pelo navegador NÃO equivalem a prova auditável de autenticação do provedor. Site não publicado, telas novas só no preview até publicação autorizada.

### Testes e limites
- Anon SELECT live_order_intents: HTTP 401, negado.
- POST inventory-correct-stock sem Authorization: HTTP 401; linha persistida, blocked=true, reason=unauthorized e IP observado.
- Sessão autenticada restaurada: PDV abriu, loja Pérola selecionada, Dashboard e abas operacionais renderizados; Administração/Acessos mostrou registros reais. Nenhum erro de execução observado. Não foi feito login por senha nem operação de venda.
- 4 testes unitários: truncamento 500, exclusão de segredos, dupla credencial interna, seleção de ações sensíveis. Parser de todas as funções sem erro. Build preview OK.
- Todas as 21 funções protegidas recusaram POST sem Authorization (HTTP 401), após implantação; 21 testes de segurança/estorno/splits passaram. Watchdog real continuou retornando 200 nas rodadas observadas.
- Não enviados pagamentos/estornos/mensagens reais. Continuação de estoque não executada com alteração de saldo. Validação interna verificou regra em teste e preservação dos chamadores, não uma correção real.
- Novas telas: 1 consulta paginada (50 registros) por painel aberto; repete ao filtrar/paginar/atualizar, sem polling. Registro acrescenta 1 insert por chamada não-OPTIONS e 1 registro adicional para ação sensível; validação JWT pode acrescentar consulta de identidade. Custo/espaço cresce sem retenção automática.
- Não há cobertura de endpoints implantados sem fonte local: cron atual referencia chat-payment-followup e livete-followup-cron, ausentes do checkout do projeto. Não foram recriados/alterados; registro universal NÃO comprovado nesses dois.

## Fase 2 — somente leitura: principais críticos/altos
1. Pagar.me/AppMax/Yampi: notificações confiam em corpo sem assinatura/reconsulta obrigatória e há caminhos sem comparação de valor. Potencial falso pago; não explorado nem alterado.
2. pagarme-create-charge usa total do cliente como autoridade apesar de carregar pedido: totalAmountCents/baseAmountCents e shippingAmount. Cliente pode solicitar cobrança menor.
3. payment-webhook (MP): amountOk OU refOk, referência correta permite discrepância; POS sem comparação exata. Assinatura inválida só registra.
4. RPCs SECURITY DEFINER executáveis anon incluem operações administrativas sem guarda explícita. RLS das dez tabelas NÃO resolve bypass por RPC/view definer. Prioridade: inventory_claim_correction_batch, resolve_live_order_intent, update_live_order_intent_item, apply_split_payment, merge_master_duplicates e similares listadas abaixo.
5. product_visual_tags tem policy ALL TO public USING/WITH CHECK true; nome 'Service role' não restringe role. Verificar grants antes de conclusão de explorabilidade.
6. Relays WhatsApp/automação log-only continuam risco alto; migrar todas as chamadas internas antes de bloquear.

### Pagamentos: evidência por provedor
| Função | Assinatura/autenticação | Valor antes de marcar pago | Risco/recomendação |
|---|---|---|---|
| pagarme-webhook | Sem assinatura/reconsulta obrigatória no caminho analisado | Ausente | Crítico: comprovar no provedor e comparar transação/valor/moeda/referência |
| appmax-webhook | Sem assinatura/reconsulta | Apenas fallback telefone compara, outras rotas não | Crítico: evidência exata em todas as rotas |
| yampi-webhook | Confia evento do corpo | Ausente; fallback telefone | Crítico: assinatura + confirmação independente |
| payment-webhook (MP) | Falha de assinatura não bloqueia; GET provedor | Pedido aceita valor OU referência; POS não compara | Alto: exigir ambos, preservar splits/Pix/descontos |
| austpay-webhook | HMAC quando segredo existe; sem segredo permite; GET produção obrigatório | Prova compartilhada compara captura/valor/ID/referência | Alto residual: confirmar configuração, falhar fechado na assinatura |
| paypal-webhook | Endpoint capture com chamada autenticada ao provedor | Não exige valor/moeda/capture completed exatos | Alto: verificar captura completa e tentativa vinculada |
| point-webhook | Sem assinatura; reconsulta pedido provedor | Sem comparação exata; erro GET permite fallback de status | Alto: bloquear fallback não comprovado |

Referências (linhas anteriores ao embrulho; novos imports deslocam linhas): pagarme-webhook 46–75/110–139/164/214; appmax-webhook 120–169/254–267/353–365/408–420; yampi-webhook 31–46/69–75/104–125; payment-webhook 85–89/164–217/356–370/399–408/503–535; austpay-webhook 30–45/81–99/132–141/194–202; paypal-webhook 185–243; point-webhook 49–127.

### Preço e frete no servidor
pagarme-create-charge: entradas 243–248, requisição 1226–1229, leitura pedido 1339–1387, total frontend usado 1403–1404, frete do banco apenas se valor recebido falsy 1406–1414, envio gateway 1493. MP usa base recebida 299; AppMax escala produtos 1084–1100. PayPal calcula subtotal/desconto sem frete (paypal-create-order 88–98/124–130). Correção futura deve resolver splits/saldo, itens/preços/descontos/frete/parcelas inteiramente no servidor e comparar evidência independente antes de pago, nunca cobrar total cheio como fallback.

### Segredos
Não identificada chave privada confirmada em src/public na varredura estática. Anon/publishable e Storefront são públicos por projeto, não credenciais Admin. .env conferido sem reproduzir valores: configuração VITE pública. Não prova limpeza de versões históricas/assets já publicados. Não foram consultados/revelados valores privados. Guardas visuais e localStorage não são autorização.

## Inventário completo por função
### Método das referências (complemento de 05/11)
- `src` e `edge`: número de ocorrências literais do nome, com caminho/linha/coluna e classificação. Os rótulos `invoke`/`fetch` indicam evidência estática de chamada; configuração/mapa dinâmico é referência, não execução comprovada. Comentários/testes/texto são discriminados e não provam uso operacional.
- A própria pasta `supabase/functions/<nome>/` e o próprio `withAccessLog('<nome>')` NÃO contam como chamada por outra função. Autorreferências são anotadas separadamente. Nomes parciais não contam: `paypal-webhook` não se confunde com `paypal-webhook-test`.
- `cron`: contagem de ocorrências reais em cron.job e jobid/nome/expressão/ativo; a tentativa psql teve permissão negada, e o resultado vem de SELECT autorizado pela ferramenta de banco. Não foram reproduzidos comandos/cabeçalhos com credenciais.
- `SQL atual`: referências em corpos de rotinas public, inclusive nomes passados a helpers dinâmicos. Acrescentadas para não confundir trigger com função sem chamador. `SQL histórico`: migrations, só evidência histórica, não somada à contagem de referências atuais.
- `externas`: URLs de callback/redirecionamento no código são referências de configuração; **webhook externo?** sinaliza nome de webhook/callback/install/redirect público cuja configuração externa não pode ser vista daqui. Destinos de API dos provedores não são chamadores do ERP; estão separados no anexo.
- **ZERO referências internas → candidata a desativar (triagem, NÃO autorização).** “Internas” nesta marcação = src + outras edge functions + cron + SQL atual. Zero em código apenas é indicado separadamente quando cron/SQL comprovam referência. Uma candidata com webhook externo?, URL pública, chamadas observadas ou necessidade operacional NÃO pode ser desativada sem revisar essas evidências.
- Strings formadas por concatenação, nomes recebidos em dados, outros projetos, MCP externo, botões fora deste checkout e webhooks cadastrados nos gateways podem escapar da busca. A ausência é estática no escopo consultado, não prova absoluta de ausência de uso.

Resumo da contagem corrigida ao escopo solicitado: **319 funções**, **899 ocorrências em src/outras edge**, **600 classificadas sintaticamente invoke/fetch**, **47 com ZERO referências internas**, incluindo cron e SQL atual. Menções do próprio relatório, planos e config.toml foram excluídas da contagem src. Todas as ocorrências estão no anexo com caminho/linha/coluna; não há limite/truncamento por função.

Candidatas (nenhuma desativada): `austpay-ping`, `austpay-refund`, `austpay-webhook`, `automation-ai-crosssell`, `automation-trigger-shopify-purchase`, `backfill-payment-method`, `cashback-external`, `chat-send-nps`, `crm-dedup-customers`, `cron-secretary-reminders`, `expedition-enrich-shipping`, `export-audience-csv`, `fiscal-backfill-xml`, `fiscal-resign-danfe-urls`, `instagram-comment-reply`, `instagram-resend-live-dm`, `live-process-comment`, `mcp-server`, `melhor-envio-test`, `meta-ads-list-accounts`, `meta-capi-sync-vault`, `meta-capi-test`, `meta-capi-trigger-backfill`, `pagarme-webhook`, `payment-incident-audit`, `point-webhook`, `pos-inter-store-stock-transfer`, `pos-sales-enrich-shipping`, `pos-stock-transfer`, `review-token-create`, `send-email`, `shipment-frenet-webhook`, `shopify-backfill-customers`, `shopify-create-test-product`, `shopify-get-variant-sku`, `shopify-oauth-install`, `shopify-webhook`, `uazapi-add-contact`, `uazapi-backfill-status`, `uazapi-check-number`, `uazapi-presence`, `uazapi-resync-chat`, `unify-customers-backfill`, `wasender-check-number`, `wasender-presence`, `yampi-lookup-sku`, `zapi-enable-notify-sent-by-me`.

Uma linha por função local (319). Classificação baseada em fonte/callers literais e cron atual; nomes dinâmicos e validação semântica de todos os ramos podem ficar 'não confirmado'. Autenticação outbound NÃO equivale à de entrada. Cabeçalhos de assinatura identificados não implicam bloqueio obrigatório; detalhes acima prevalecem. Não é um pentest de todos os endpoints.

| Nome | Quem chama | Autenticação atual | Pode fazer | Risco | Recomendação  Referências |
|---|---|---|---|---|------|
| `accountant-monthly-package` | cron atual, frontend | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 0, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `admin-create-user` | frontend | JWT + admin | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `admin-delete-user` | frontend | JWT + admin | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `admin-list-users` | frontend | JWT + admin/gerente | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `admin-update-user` | frontend | JWT + admin | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ads-nurture-cron` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `ai-agent-customers` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ai-agent-customers-cron` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 0, cron 2, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `ai-channel-specialist` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ai-classify-transactions` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `ai-group-content` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ai-marketing-master` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ai-marketing-strategy` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `ai-secretary` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ai-stock-analyst` | frontend | JWT verificado + serviço/segredo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `ai-vip-strategy` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `appmax-install` | desconhecido | JWT ou serviço (guarda legada) | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `appmax-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo? |
| `austpay-charge-card` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `austpay-create-pix` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `austpay-ping` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `austpay-refund` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `austpay-test-charge` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `austpay-webhook` | webhook gateway/integrador | assinatura/token presente; enforcement a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo?; **ZERO — candidata a desativar** |
| `auto-create-vip-group` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `automation-ai-ads-respond` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `automation-ai-crosssell` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `automation-ai-respond` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **11 internas**: src 1, edge 10, cron 0, SQL 0; invoke/fetch 9; detalhes abaixo; não confirmada |
| `automation-continue-flow` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **6 internas**: src 0, edge 6, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `automation-dispatch-audience` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 3, edge 1, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `automation-pos-followups-cron` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 1, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `automation-queue-worker` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 2, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `automation-test-flow` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `automation-trigger-incoming` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **12 internas**: src 0, edge 12, cron 0, SQL 0; invoke/fetch 7; detalhes abaixo; não confirmada |
| `automation-trigger-new-lead` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 2, edge 2, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `automation-trigger-pos-sale` | RPC/trigger SQL | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 0, edge 3, cron 0, SQL 1; invoke/fetch 0; detalhes abaixo; não confirmada |
| `automation-trigger-shopify-purchase` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `backfill-organic-leads` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `backfill-payment-method` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `blocked-buyer-sale-alert` | RPC/trigger SQL, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 1, cron 0, SQL 1; invoke/fetch 1; detalhes abaixo; não confirmada |
| `brasilnfe-webhook` | frontend, webhook gateway/integrador | assinatura/token presente; enforcement a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo? |
| `calculate-inventory-health` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `carousel-campaign-run-now` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `carousel-campaign-scheduler` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `carousel-campaign-sender` | cron atual, outra função | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 1, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `carousel-ladder-create` | frontend | JWT verificado + serviço/segredo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `cashback-external` | desconhecido | token integração | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; URL pública/externa? revisar; **ZERO — candidata a desativar** |
| `chat-send-nps` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `checkout-crossell` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `checkout-prize-preview` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `checkout-public` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **5 internas**: src 5, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `checkout-quote-freight` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **5 internas**: src 2, edge 3, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `concierge-respond` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **8 internas**: src 0, edge 8, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `consignment-sales-report` | frontend | JWT verificado + serviço/segredo + módulo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `contact-erase` | frontend | JWT verificado + serviço/segredo + admin | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `correios-admin` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 3, edge 1, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `correios-reverse` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `correios-shipment` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **6 internas**: src 5, edge 1, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `create-master-product-pos` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `create-master-product-shopify` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `criar-pedido-externo` | outra função | token compartilhado x-agent-key | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `crm-dedup-customers` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `cron-automation-timeouts` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 1, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `cron-check-vip-groups` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 1, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `cron-cleanup-status-media` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `cron-inventory-watchdog` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `cron-scheduled-dispatches` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `cron-scheduled-group-messages` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `cron-secretary-reminders` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `cron-send-scheduled-messages` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `delete-master-products` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `dispatch-attribution` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `dispatch-orchestrator` | cron atual, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 2, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `dispatch-worker` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 2, edge 3, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `event-bulk-send-enqueue` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `event-bulk-send-worker` | cron atual, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 1, edge 1, cron 1, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `event-followup-dispatcher` | cron atual | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `event-followup-scheduler` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `event-lead-capture` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 2, edge 2, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `event-order-route-to-pos` | RPC/trigger SQL, frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 0, cron 0, SQL 1; invoke/fetch 1; detalhes abaixo; não confirmada |
| `event-order-template-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 3, edge 1, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `event-order-wa-initial-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **6 internas**: src 5, edge 1, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `event-prize-wheel` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `event-raffle` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `exchange-reverse-shipping` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `expedition-beta-initial-sync` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `expedition-check-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `expedition-correct-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `expedition-enrich-shipping` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `expedition-fetch-label` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `expedition-quote-freight` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `expedition-refresh-orders` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `expedition-sync-orders` | frontend | JWT verificado + serviço/segredo + módulo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `expedition-tiny-invoice` | frontend | JWT verificado + serviço/segredo + módulo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto  **5 internas**: src 5, edge 0, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `expedition-transfer-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `expedition-verify-shipped` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `export-audience-csv` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `fiscal-backfill-danfe` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `fiscal-backfill-xml` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `fiscal-recover-by-identifier` | outra função | token interno/cron ou JWT | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 2, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `fiscal-render-document` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **10 internas**: src 2, edge 8, cron 0, SQL 0; invoke/fetch 8; detalhes abaixo; não confirmada |
| `fiscal-resign-danfe-urls` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `gateway-payment-lookup` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `group-admin-worker` | SQL histórico, cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 1, edge 1, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `group-dispatch-worker` | cron atual, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 2, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `group-redirect-link` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 1, edge 2, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; URL pública/externa? revisar |
| `ig-live-cart-notify` | RPC/trigger SQL, SQL histórico | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 0, cron 0, SQL 2; invoke/fetch 0; detalhes abaixo; não confirmada |
| `instagram-account-connect` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `instagram-comment-reply` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `instagram-dm-automation-run` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `instagram-dm-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **7 internas**: src 2, edge 5, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `instagram-dm-send-buttons` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 2, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `instagram-list-media` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `instagram-live-sync` | RPC/trigger SQL, SQL histórico, frontend | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 0, cron 0, SQL 1; invoke/fetch 1; detalhes abaixo; não confirmada |
| `instagram-resend-live-dm` | desconhecido | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `instagram-send-bulk-dm` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `instagram-token-refresh` | cron atual, frontend | token interno/cron ou JWT | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 1, edge 1, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `inventory-correct-stock` | frontend, outra função | JWT verificado + serviço/segredo + módulo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto  **6 internas**: src 4, edge 2, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `inventory-verify-and-correct` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 1, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `issue-member-magic-link` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `lead-notify-pdv` | outra função | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 2, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `legacy-order-webhook` | frontend, webhook gateway/integrador | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; webhook externo? |
| `link-page-capture-lead` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `link-page-catalog-sync` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `link-page-public` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `link-page-track-click` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `live-campaign-dispatch` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 2, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `live-campaign-trigger` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `live-catalog` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `live-catalog-invite` | SQL histórico, frontend | token interno/cron ou JWT | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 2, edge 1, cron 0, SQL 1; invoke/fetch 1; detalhes abaixo; não confirmada |
| `live-crossell-blocks` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `live-member-area` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `live-process-comment` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `live-redirect` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; URL pública/externa? revisar |
| `live-selfservice` | RPC/trigger SQL, SQL histórico, frontend, outra função | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **7 internas**: src 4, edge 1, cron 0, SQL 2; invoke/fetch 5; detalhes abaixo; não confirmada |
| `live-send-verification` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `live-verify-code` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `live-whatsapp-redirect` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; URL pública/externa? revisar |
| `livete-order-updated` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **7 internas**: src 7, edge 0, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `livete-payment-confirmation` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 1, edge 3, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `livete-respond` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **6 internas**: src 0, edge 6, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `livete-start-order` | RPC/trigger SQL, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **7 internas**: src 4, edge 2, cron 0, SQL 1; invoke/fetch 2; detalhes abaixo; não confirmada |
| `lp-capture-lead` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `marketing-agent-chat` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `marketing-attribution-dashboard` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `marketing-leads-dashboard` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `marketing-ltv-dashboard` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `mcp-server` | desconhecido | token compartilhado x-agent-key | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; URL pública/externa? revisar; **ZERO — candidata a desativar** |
| `melhor-envio-test` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `mercadopago-check-payment` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 4, edge 0, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `mercadopago-create-boleto` | frontend, outra função | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `mercadopago-create-pix` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **11 internas**: src 8, edge 3, cron 0, SQL 0; invoke/fetch 10; detalhes abaixo; não confirmada |
| `mercadopago-get-public-key` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `mercadopago-installments` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `mercadopago-poll-pending` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 2, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `meta-ads-list-accounts` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `meta-ads-sync` | cron atual, frontend | token interno/cron ou JWT | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 1, edge 1, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `meta-ads-sync-spend` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `meta-attribution-capture` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `meta-audience-sync` | cron atual, frontend | token interno/cron ou JWT | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 2, edge 1, cron 2, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `meta-capi-event` | RPC/trigger SQL, SQL histórico, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **12 internas**: src 4, edge 7, cron 0, SQL 1; invoke/fetch 4; detalhes abaixo; não confirmada |
| `meta-capi-lead` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 2, edge 2, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `meta-capi-offline` | RPC/trigger SQL, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 1, edge 1, cron 0, SQL 2; invoke/fetch 0; detalhes abaixo; não confirmada |
| `meta-capi-offline-backfill` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `meta-capi-purchase` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `meta-capi-purchase-retry` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `meta-capi-sync-vault` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `meta-capi-test` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `meta-capi-trigger-backfill` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `meta-messenger-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **10 internas**: src 5, edge 5, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `meta-messenger-webhook` | webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo? |
| `meta-template-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 1, edge 4, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `meta-whatsapp-create-template` | frontend | JWT verificado + serviço/segredo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto  **4 internas**: src 4, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `meta-whatsapp-get-templates` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **21 internas**: src 21, edge 0, cron 0, SQL 0; invoke/fetch 18; detalhes abaixo; não confirmada |
| `meta-whatsapp-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **55 internas**: src 16, edge 39, cron 0, SQL 0; invoke/fetch 38; detalhes abaixo; não confirmada |
| `meta-whatsapp-send-template` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **25 internas**: src 10, edge 15, cron 0, SQL 0; invoke/fetch 22; detalhes abaixo; não confirmada |
| `meta-whatsapp-upload-header` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `meta-whatsapp-webhook` | webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo? |
| `mp-refund` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **8 internas**: src 4, edge 4, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `nfce-cancelar` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `nfce-emitir` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **13 internas**: src 7, edge 6, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `nfce-inutilizar` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `nfce-poll-sefaz` | cron atual | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `nfce-retry-pending` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 0, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `nfe-devolucao-emitir` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `nfe-emitir` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **8 internas**: src 8, edge 0, cron 0, SQL 0; invoke/fetch 6; detalhes abaixo; não confirmada |
| `nfe-link-items-pos` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `nfe-manifestar` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `nfe-puxar-destinadas` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 0, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pagarme-create-charge` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **9 internas**: src 9, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `pagarme-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo?; **ZERO — candidata a desativar** |
| `payment-confirmed-hook` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `payment-incident-audit` | desconhecido | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `payment-webhook` | frontend, outra função, webhook gateway/integrador | assinatura/token presente; enforcement a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **12 internas**: src 3, edge 9, cron 0, SQL 0; invoke/fetch 9; detalhes abaixo; webhook externo? |
| `paypal-create-order` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `paypal-get-order` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `paypal-webhook` | frontend, outra função, webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; webhook externo? |
| `point-create-order` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `point-terminals` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `point-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo?; **ZERO — candidata a desativar** |
| `pos-add-variants` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-boleto-pdf` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `pos-clone-product-to-store` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `pos-conditional-create` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-conditional-finalize` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-customer-360-insights` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-exchange-stock-adjust` | frontend | JWT verificado + serviço/segredo + módulo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-expedition-test-orders` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-inter-store-stock-transfer` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `pos-link-payment-confirmation` | RPC/trigger SQL | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 0, SQL 1; invoke/fetch 0; detalhes abaixo; não confirmada |
| `pos-sales-enrich-shipping` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `pos-site-exchange-finalize` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-stock-balance` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 4, edge 0, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `pos-stock-movement` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 4, edge 0, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `pos-stock-transfer` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `pos-stock-transfer-v2` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **8 internas**: src 4, edge 4, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `pos-task-dispatch-cron` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 0, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-tasks-generate` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 3, edge 1, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `pos-tiny-create-sale` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-tiny-delete-sale` | frontend | JWT verificado + serviço/segredo + módulo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto  **4 internas**: src 3, edge 1, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `pos-tiny-payment-methods` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `pos-tiny-sellers` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `pos-tiny-sync-products` | frontend | JWT verificado + serviço/segredo + módulo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `pos-validate-coupon` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `produto-ativo` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `push-notifications` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 4, edge 0, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `referral-create` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `referral-detect-incoming` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `referral-mark-sent` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `referral-validate-coupon` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `review-load` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `review-send-link` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `review-submit` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `review-token-create` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `rfm-recalculate` | cron atual, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 3, edge 1, cron 1, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `sale-freight-quote` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 1, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `security-auth-event` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `selfservice-message-worker` | SQL histórico, outra função | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **7 internas**: src 0, edge 5, cron 0, SQL 2; invoke/fetch 5; detalhes abaixo; não confirmada |
| `send-email` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `shipment-frenet-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo?; **ZERO — candidata a desativar** |
| `shipment-tracking-public` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `shopify-backfill-customers` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `shopify-cancel-live-order` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-create-draft-order` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `shopify-create-live-order` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-create-order` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 3, edge 2, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `shopify-create-test-product` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `shopify-delete-event-order` | frontend, outra função | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 2, edge 2, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `shopify-get-variant-sku` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `shopify-link-products` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `shopify-live-duplicate-review` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-mirror-stock` | RPC/trigger SQL, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 0, edge 2, cron 0, SQL 3; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-oauth-callback` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; webhook externo? |
| `shopify-oauth-install` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; URL pública/externa? revisar; **ZERO — candidata a desativar** |
| `shopify-pull-order-customer` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-reconcile-cron` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `shopify-reconcile-stock` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 2, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-sync-to-pos` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 0, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-update-event-order` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `shopify-verify-event-orders` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `shopify-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo?; **ZERO — candidata a desativar** |
| `split-payment` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **8 internas**: src 7, edge 1, cron 0, SQL 0; invoke/fetch 7; detalhes abaixo; não confirmada |
| `sync-master-product-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `sync-pos-shopify-to-rfm` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 1, edge 0, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `telegram-financial-admin` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `telegram-financial-process-attachment` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `telegram-financial-webhook` | outra função, webhook gateway/integrador | assinatura/token presente; enforcement a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **1 internas**: src 0, edge 1, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; webhook externo? |
| `uazapi-add-contact` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `uazapi-backfill-contacts` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 0, edge 0, cron 1, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `uazapi-backfill-status` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `uazapi-check-number` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `uazapi-delete-status` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `uazapi-groups` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **23 internas**: src 7, edge 16, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `uazapi-message-actions` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 1, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `uazapi-presence` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `uazapi-resync-chat` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `uazapi-send-buttons` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 2, edge 3, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `uazapi-send-extra` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 1, edge 2, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `uazapi-send-media` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **8 internas**: src 4, edge 4, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `uazapi-send-message` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **13 internas**: src 5, edge 8, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `uazapi-send-status` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `uazapi-session` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **13 internas**: src 13, edge 0, cron 0, SQL 0; invoke/fetch 13; detalhes abaixo; não confirmada |
| `uazapi-webhook` | outra função, webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; webhook externo? |
| `unify-customers-backfill` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `update-master-product-shopify` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `vip-go` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; URL pública/externa? revisar |
| `vip-orphan-dispatch` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `vps-dispatch-proxy` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `wasender-check-number` | desconhecido | JWT ou serviço (guarda legada) | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `wasender-groups` | frontend, outra função | JWT ou serviço (guarda legada) | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **9 internas**: src 2, edge 7, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `wasender-message-actions` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `wasender-presence` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `wasender-send-extra` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **4 internas**: src 2, edge 2, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `wasender-send-media` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **6 internas**: src 4, edge 2, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `wasender-send-message` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **11 internas**: src 5, edge 6, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `wasender-session` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **9 internas**: src 9, edge 0, cron 0, SQL 0; invoke/fetch 9; detalhes abaixo; não confirmada |
| `wasender-webhook` | outra função, webhook WhatsApp | assinatura/token presente; enforcement a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **3 internas**: src 0, edge 3, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; webhook externo? |
| `whatsapp-block-contact` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 1, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `yampi-create-payment-link` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `yampi-lookup-sku` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `yampi-webhook` | frontend, webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; webhook externo? |
| `zapi-connection-status` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-delete-message` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `zapi-edit-message` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-enable-notify-sent-by-me` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **0 internas**: src 0, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada; **ZERO — candidata a desativar** |
| `zapi-get-contacts` | frontend | JWT ou serviço (guarda legada) | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 2, edge 0, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `zapi-group-campaign-execute` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 0; detalhes abaixo; não confirmada |
| `zapi-group-scheduled-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 2, edge 1, cron 0, SQL 0; invoke/fetch 2; detalhes abaixo; não confirmada |
| `zapi-group-settings` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **19 internas**: src 6, edge 13, cron 0, SQL 0; invoke/fetch 5; detalhes abaixo; não confirmada |
| `zapi-instance-health-check` | cron atual, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **2 internas**: src 0, edge 1, cron 1, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-list-groups` | frontend | JWT ou serviço (guarda legada) | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 4, edge 1, cron 0, SQL 0; invoke/fetch 4; detalhes abaixo; não confirmada |
| `zapi-profile-picture` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **3 internas**: src 3, edge 0, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; não confirmada |
| `zapi-qrcode` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-send-button-list` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-send-group-message` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **5 internas**: src 0, edge 5, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-send-media` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **15 internas**: src 7, edge 8, cron 0, SQL 0; invoke/fetch 11; detalhes abaixo; não confirmada |
| `zapi-send-message` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **37 internas**: src 13, edge 24, cron 0, SQL 0; invoke/fetch 24; detalhes abaixo; não confirmada |
| `zapi-test-connection` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase  **1 internas**: src 1, edge 0, cron 0, SQL 0; invoke/fetch 1; detalhes abaixo; não confirmada |
| `zapi-webhook` | frontend, outra função, webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente  **9 internas**: src 2, edge 7, cron 0, SQL 0; invoke/fetch 3; detalhes abaixo; webhook externo? |
## RPCs public executáveis anon
441 assinaturas, incluindo funções trigger/extensões que não são RPCs diretamente utilizáveis. A coluna é triagem estática, não autorização concedida por esta auditoria. Grant herdado de PUBLIC também conta. Não foram alteradas na Fase 2.

| RPC/assinatura | Definer | Justificativa/ação |
|---|---|---|
| `_dispatch_can_read()` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `_pm_pmd_sync_in_progress()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `_set_updated_at()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `add_business_days(date,integer)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `analyze_catalog_sync_from_pos()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `analyze_master_duplicates(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `analyze_variant_normalization()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `apply_event_prize_to_order(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `apply_online_order_stock_movement()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `apply_pos_sale_item_stock_movement()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `apply_pos_sale_stock_movement()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `apply_shopify_links(jsonb)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `apply_variant_normalization(boolean,integer)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `approve_group_drafts(uuid[],text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `archive_inactive_ads_conversations(integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `archive_inactive_broadcast_messages(integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `archive_inactive_conversations(integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `archive_old_messages_individual(integer,integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `archive_old_whatsapp_messages(integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `assign_price_tier()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `assign_price_tier_master()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `attach_physical_prize_to_order(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `audience_filter_options()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `auto_assign_chat_from_support_ticket()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `auto_convert_leads_on_customer_sync()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `auto_link_color_size_variants()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `auto_link_product_brand_category()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `auto_reopen_finished_conversation_on_message()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `automation_pacing_gate(text,integer,integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `automation_pacing_release(text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `automation_pacing_reset_stale()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `automation_queue_pending_count()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `backfill_estoque_from_pos(boolean)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `backfill_master_costs_from_pos()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `backfill_phones_from_pos_customers(boolean)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `bc_match_audience(crm_customers_v,jsonb,jsonb)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `bc_norm_txt(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `bc_order_total(jsonb,text,numeric)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `bc_phone_key(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `block_items_added_to_paid_orders()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `block_movement_on_closed_register()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `broadcast_live_chat()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `broadcast_live_viewers()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `calculate_inventory_health(integer,uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `calculate_rfm_scores()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `calculate_rfm_scores_unified()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `campaign_buyer_detail(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `campaign_daily_deficit(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `campaign_dashboard_stats(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `campaign_envios_detail(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `campaign_run_periods()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `campaigns_overview_conversions(date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `campaigns_overview_stats(date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `cancel_expedition_on_order_unpaid_stage()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `chargebacks_normalize()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `chat_lane_clear_on_finish()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `chat_lane_clear_on_incoming()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `check_chargeback_risk(text,text,text,text,text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `check_order_ai_paused(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `check_order_paid(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `check_referral_double_cashback()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `check_touch_quota(jsonb,text,text,uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `claim_automation_queue_jobs(text,integer,integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `claim_dispatch_jobs(uuid,text,integer,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `claim_event_raffle_draw(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `classify_group_member(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `cleanup_livete_locks()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `cleanup_webhook_routing_log()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `clear_event_live_active(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `compute_pos_sale_channel(text,uuid,jsonb,jsonb,text,boolean)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `consolidate_estoque_parents_by_pos(boolean)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `copy_trigger_messages(uuid,uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `count_campaign_audience(jsonb)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `count_products_by_brand()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `count_products_by_category()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `create_product_with_variants(jsonb,jsonb)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `crm_facet_counts(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `customers_unified_before_write()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `dedup_outgoing_message(text,text,uuid,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `delete_master_to_pmd()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `delete_pmd_to_master()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `delete_pos_divergent_parent(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `delete_pos_divergent_variant(text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `delete_unsent_dispatch(uuid)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `dispatch_link_click(text,text,text,text)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `dispatch_quota_summary(jsonb,text,text,uuid,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `enforce_quick_reply_folder_depth()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `enforce_single_live_broadcasting()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `enqueue_campanha_envios_guarded(uuid,jsonb,text,text,boolean,jsonb)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `enqueue_live_campaign_dispatches_guarded(uuid,uuid,jsonb,text,text,text,boolean)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `enqueue_mass_dispatch_targets_guarded(uuid,jsonb,text,text,text,boolean)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `ensure_product_color_code(uuid,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `ensure_shipment_tracking_for_sale()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `event_buyer_origin_matrix(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `event_catalog_products_before_write()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `event_inner_dashboard(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `event_lead_cohorts(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `event_live_repurchase(uuid,boolean)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `event_phone_key(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `event_raffle_winner_unique_guard()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `event_raffles_default_registration_minutes()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `event_unarchive_on_incoming_message()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `events_buyer_origin_matrix_range(timestamp with time zone,timestamp with time zone,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `execute_merge_unified_duplicates(boolean,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `expedition_apply_sedex_on_insert()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `expedition_cancel_sale(uuid,text,boolean)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `expedition_update_sale_items(uuid,jsonb)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `expire_live_payment_windows()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `extract_base_product_name(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `extract_phone_ddd_suffix(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `extract_phone_suffix8(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `fill_pos_sale_item_size()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `finalize_completed_dispatches()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `find_customer_prefill_by_phone(text)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `find_or_create_unified_customer(text,text,text,text,text,text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `forfeit_physical_prize(uuid,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `format_customer_code(bigint)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gateway_split_stats(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `gateway_split_validate_and_log()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `gen_shipment_public_code()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gen_unique_ean13()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `gen_unique_variant_sku(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `generate_ean13_barcode()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `generate_ean13_internal()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_abc_curve_products(integer,uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_abc_curve_sizes(integer,uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_active_mp_account()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_agent_memory(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_attendant_metrics(uuid,timestamp with time zone,timestamp with time zone)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_automation_exec_stats()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_campaign_results(date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_checkout_order(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_checkout_registration(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_classificacao_summary()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_conversation_counts()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `get_conversation_instance(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_conversations(uuid,boolean)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_conversations_since(uuid,boolean,timestamp with time zone)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_customer_active_prizes(text,boolean)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_customer_chat_history(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_customer_checkout_prefill(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_customer_last_address(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_customer_lookup(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_customer_store_seller_map()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_customers_for_opportunities(integer,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_dispatch_pressure(date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_dispatchable_scheduled_messages(integer)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_dispatches_with_pending(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_event_checkout_shipping(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_event_installment_config(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_events_performance(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_group_member_activity(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_inventory_summary()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_latest_registration_by_customer(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_leads_by_channel(date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_leads_for_recovery()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_leads_lookup(text,date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_live_anterior_grade(uuid)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_live_events_summary(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_member_area_leads(uuid,integer,text,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_member_area_origin_breakdown(timestamp with time zone,timestamp with time zone,integer,uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_mp_token_by_payment_id(text)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `get_mp_token_for_order(uuid)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `get_mp_token_for_sale(uuid)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `get_next_fiscal_number(uuid,smallint,smallint,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `get_or_create_customer_access_code(text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `get_order_status(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_orders_by_customer(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_pos_whatsapp_dashboard(text,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_provider_cost(text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_reactivation_candidates(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_registration_by_cpf(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_relatorio_grade_expedicao(uuid[])` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_relatorio_grade_live(uuid,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_relatorio_grade_live(uuid,text,boolean)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `get_rfm_summary()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_sale_installment_override(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_sales_vs_goals(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_shadow_report(date,date)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_stock_by_size(jsonb)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_top_customers(text,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `get_user_allowed_modules(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `gin_extract_query_trgm(text,internal,smallint,internal,internal,internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gin_extract_value_trgm(text,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gin_trgm_consistent(internal,smallint,text,integer,internal,internal,internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gin_trgm_triconsistent(internal,smallint,text,integer,internal,internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_compress(internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_consistent(internal,text,smallint,oid,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_decompress(internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_distance(internal,text,smallint,oid,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_in(cstring)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_options(internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_out(gtrgm)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_penalty(internal,internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_picksplit(internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_same(gtrgm,gtrgm,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `gtrgm_union(internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `guard_automation_dispatch(uuid,text,text,text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `handle_new_user()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `has_module_access(uuid,text)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `has_role(uuid,app_role)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `ig_handle_loose(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `ig_handle_norm(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `increment_campaign_leads_captured(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `increment_execution_count(uuid)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `increment_referral_count()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `inherit_gift_from_source_order()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `inherit_group_manual_vip()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `inventory_claim_correction_batch(uuid,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `is_cpf_mergeable(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `is_email_placeholder(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `is_generic_email(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `is_phone_generic(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `is_sync_in_progress()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `is_unified_inventory_enabled()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `latest_sale_freight_summaries(uuid[])` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `lead_campaign_counts()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `legacy_master_variants(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `legacy_masters_summary(uuid[])` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `list_campaign_audience(jsonb,integer,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `list_nfe_emitters()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `list_pos_estoque_divergences(text,integer,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `list_pos_estoque_divergences_grouped(text,integer,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `list_unack_template_alerts()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `live_backfill_order_phone(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `live_catalog_schedule_invite()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `live_link_order_verified(uuid,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `live_mark_last4_conflicts()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `live_repurchase_cohorts(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `live_zap_phone_key(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `log_pos_products_stock_change()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `lookup_cashback_by_phones(text[])` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `lookup_crm_by_phones(text[])` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `lookup_customer_by_whatsapp(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `lp_leads_mark_existing_customer()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mark_dispatch_sent(uuid[],text[])` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `mark_lead_as_paid(text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `mark_physical_prize_shipped(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `match_event_leads(uuid,text[])` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `merge_duplicate_zoppy_customers()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `merge_master_duplicates(integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `merge_product_color(uuid,uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `merge_product_size(uuid,uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `merge_selected_masters(uuid,uuid[])` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `merge_tiny_online_duplicates()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `merge_unified_zoppy_duplicates()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `meta_ads_campaign_group(text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `meta_aud_email(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `meta_aud_phone(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `mirror_chat_contacts_to_unified()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_customer_registrations_to_unified()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_customers_to_unified()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_group_manual_vip()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_instagram_links_to_unified()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_pos_customers_to_unified()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_pos_product_cost_price()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `mirror_zoppy_customers_to_unified()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `next_product_sku_root()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `next_template_variant(smallint,text,integer)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `norm_cpf(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `norm_email(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `norm_identity_text(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `norm_instagram(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `norm_phone_br(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `norm_txt(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `normalize_address_key(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `normalize_phone_br(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `normalize_variant_color_size(text,text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `normalize_vip_photo_internal_name()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `normalize_wa_status(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `notify_product_wait_on_restock()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `notify_selfservice_initial_contact()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `notify_wa_message_insert()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `notify_wa_message_update()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `orders_mark_cart_assembled()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `orders_paid_stage_autoconfirm()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `orders_payment_source_guard()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `orders_propagate_sedex()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `orders_propagate_sedex_to_pos_sales()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `orders_sync_shipping_type()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `overlay_order_events()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `overlay_pull(uuid,bigint)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `overlay_shown_products(uuid)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `parse_brand_from_name(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `parse_category_from_name(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `parse_live_comment_codes(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `parse_payment_methods(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `parse_size_from_name(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pc_gender_canon(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pc_gender_from_text(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pc_norm(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pc_ref_prefix(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pc_slug(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `phone_ddd(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `phone_suffix8(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pmd_gender_to_master()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `pos_crediario_norm(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `pos_crediario_pay_installment(uuid,numeric,text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `pos_crediario_pay_sale(uuid,numeric,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `pos_crediario_search(uuid,text,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `pos_customers_require_contact()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `pos_estoque_divergence_summary()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `pos_sale_to_faturamento(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `pos_sales_apply_sedex_on_insert()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `pos_sales_release_on_expedition()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `pos_sales_sync_shipping_type()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `process_live_comment_codes(text,uuid,text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `process_pos_sale_sale_event(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `product_name_key(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `propagate_order_gift_to_pos_sale()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `purchase_item_block_delete_confirmed()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `quota_check_with_snapshot(jsonb,text,text,text,uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `raffle_norm_phone(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `reactivate_pos_product_on_stock()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `recalc_customer_metrics(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `recalc_customer_payment_store_attrs(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `recalc_customer_product_attributes(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `recompute_needs_review()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `record_whatsapp_group_snapshot()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `redeem_internal_cashback(text,text,text,numeric)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `refresh_dispatch_counts(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `refresh_event_bulk_send_counts(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `refresh_vip_orphans()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `refund_config()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `register_template_category_change(text,text,uuid,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `reopen_physical_prize(uuid,text)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `resolve_campaign_template(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_customer_unified(text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_finished_conversations(text[])` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_fiscal_rule(text,text,text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_ig_handles(text[])` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_instagram_customer(text,text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_live_order_intent(uuid,text,text,uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `resolve_or_create_unified_customer(text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `resolve_payment_fee(text,text,text,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `resolve_selfservice_event_shipping(jsonb,jsonb)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `resolve_typebot_event_id(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `restore_pos_sale_item_stock(uuid,text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `revert_merge_batch(uuid)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `sample_variant_normalization(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `save_customer_registration(uuid,text,text,text,text,text,text,text,text,text,text,text,uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `search_all_conversations(text)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `search_products_unaccent(text,uuid)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `select_campaign_batch(uuid,integer,integer,boolean)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `selfservice_br_phone(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `set_active_mp_account(uuid)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `set_codigo_devolucao()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `set_customer_access_code(text,text)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `set_event_live_active(uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `set_fiscal_sequence_start(uuid,smallint,smallint,text,bigint,text)` | sim | Guarda auth detectada: anon deve rejeitar; revisar corpo |
| `set_limit(real)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `set_live_shown_product(uuid,text,text,text)` | não | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `set_pos_sale_channel()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `set_pos_sale_expedition_stage()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `set_updated_at_column()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `set_voucher_codigo()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `shadow_cycle_check_big_live()` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `shadow_cycle_ready_for_report()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `shadow_report_period(timestamp with time zone,timestamp with time zone)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `show_limit()` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `show_trgm(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `similarity(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `similarity_dist(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `similarity_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `simulate_merge_unified_duplicates()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `slugify_dict(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `snapshot_group_message_exposure(uuid,uuid,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `strict_word_similarity(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `strict_word_similarity_commutator_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `strict_word_similarity_dist_commutator_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `strict_word_similarity_dist_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `strict_word_similarity_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `sync_contact_tags_to_leads()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_event_lead_to_lp_leads()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_lead_pix_data(text,text,text,timestamp with time zone)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `sync_master_to_pmd()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_master_to_pos()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_order_payment_to_pos_sale()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_order_stage_from_expedition()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_pmd_to_master()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_pos_product_to_estoque()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_pos_to_catalog()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_product_category_brand()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_registration_to_pos_customer()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_task_instance_progress()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `sync_variant_to_pos()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `tg_product_brands_updated_at()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `title_case_color(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `touch_pos_tracking_templates()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `tracked_link_stats(text)` | sim | Parâmetro token/código: revisar validade/escopo antes de manter público |
| `transfer_products_brand(uuid,uuid)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `transfer_products_category(uuid,uuid)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `trg_blocked_buyer_sale_alert()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_events_live_url_touch()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_live_comment_codes()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_orders_attach_physical_prize()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_orders_prize_forfeit()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_cash_movement_to_transfer()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_register_close_quebra()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_sale_completed_automation()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_sales_prize_lifecycle()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_sales_recalc_after()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_sales_sync_customer()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_pos_sales_to_cash_flow()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_recalc_customer_attrs_on_item()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_recalc_customer_pay_store_on_sale()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_route_paid_event_order_to_pos()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_sync_products_master_cat_brand()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trg_variant_color_code()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trigger_meta_capi_offline_enrich_resend()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trigger_meta_capi_offline_purchase()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `trigger_meta_capi_purchase_on_paid()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `try_claim_scheduled_message(uuid,integer)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `unaccent(regdictionary,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `unaccent(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `unaccent_init(internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `unaccent_lexize(internal,internal,internal,internal)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `unified_inventory_apply_nfe_entry(text,jsonb,uuid,text,text,text,text,numeric,numeric,uuid,uuid)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `update_lead_recovery(text,text,integer,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `update_live_order_intent_item(uuid,integer,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `update_order_stage(text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `update_updated_at_column()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `upsert_landing_customer(text,text,text)` | sim | CRÍTICO: definer sem guarda detectada; revogar após mapear chamadas |
| `validate_ig_capture_mode()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `validate_max_installments_override()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `vip_groups_interaction_ranking(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `vip_groups_overview()` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `vip_groups_sales_ranking(integer,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `vip_leads_ranking(integer,integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `vip_link_funnel(integer)` | sim | ALTO: definer sem guarda detectada; revisar exposição |
| `vip_link_match_incoming()` | sim | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `vip_link_phone_key(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `vip_photo_internal_name(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `wa_message_status_guard()` | não | Trigger: não invocável como RPC normal; remover grant dispensável futuramente |
| `wa_status_rank(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `word_similarity(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `word_similarity_commutator_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `word_similarity_dist_commutator_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `word_similarity_dist_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `word_similarity_op(text,text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |
| `zoppy_origin_class(text)` | não | Função invoker/utilitário: depende dos grants/RLS; revisar necessidade pública |

## Policies públicas de leitura
| Tabela | Policy | Role | Operação | qual | with_check |
|---|---|---|---|---|---|
| `product_visual_tags` | Service role can manage visual tags | public | ALL | true | true |
| `product_visual_tags` | Visual tags are publicly readable | public | SELECT | true | None |

## Policies públicas de escrita
| Tabela | Policy | Role | Operação | qual | with_check |
|---|---|---|---|---|---|
| `lp_leads` | lp_leads_anon_insert | anon | INSERT | None | true |
| `link_page_leads` | Public can register lead | anon | INSERT | None | true |
| `catalog_lead_registrations` | Anyone can insert registrations | public | INSERT | None | true |
| `product_visual_tags` | Service role can manage visual tags | public | ALL | true | true |
| `link_page_visits` | Anyone can insert visits | anon,authenticated | INSERT | None | true |

## RLS ligada e zero policies: comparação com frontend
| Tabela | Frontend usa diretamente | Resultado |
|---|---|---|
| `correios_settings` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `appmax_installations` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `fiscal_access_settings` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `fiscal_access_attempts` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `selfservice_instance_pacing` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `pos_products_phantom_backup_20260513` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `pos_products_dedup_backup` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `meta_audience_candidates` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `meta_audience_members` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `automation_dispatch_job_audience` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `livete_processing_locks` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `live_member_rate_limits` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `internal_function_secrets` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `_perf_snap` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `webhook_events_raw` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `shopify_yampi_mapping` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `meta_media_cache` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `participant_score_cache` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `products_master_category_backup_20261103` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `selfservice_advertising_consents` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `live_phone_verifications` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |
| `conversation_counts_cache` | não detectado | Service-only/cache/backup: zero policies pode ser intencional |

## Cron e fonte divergente
Cron atual chama chat-payment-followup e livete-followup-cron, sem fonte local. Implantação/logs desses endpoints não verificados. Não recriados por segurança.

## Arquivos alterados
- drizzle/migrations/0117_security_phase1a_table_lockdown.sql e 0118_security_phase1b_access_logs.sql.
- Todos os 318 supabase/functions/*/index.ts existentes: apenas embrulho, com guardas adicionais nas 21 listadas.
- supabase/functions/_shared/{access-log-data,withAccessLog,requireAuth,withRequiredAuth}.ts; security-auth-event/index.ts.
- src/components/admin/SecurityAccessPanel.tsx, src/components/SecuritySessionLogger.tsx; src/pages/Admin.tsx, Home.tsx, App.tsx; src/test/securityAccessLog.test.ts.
- roadmap.md e este relatório.

## Complemento da Fase 2 — sinais de uso dos provedores

Leitura em 05/11/2026, aproximadamente 04:00–04:05 UTC. Nenhuma função, credencial, agendamento ou integração foi desativada/alterada. Datas abaixo em UTC. Secrets: inventário de 60 **nomes configurados**, valores nunca consultados. Presença não comprova validade, assinatura de webhook ou uso atual; configuração também pode residir em tabelas protegidas.

“Última linha” significa última pelo timestamp indicado, com ID/status/tipo apenas: sem payload, telefone, e-mail, IP, transação do gateway ou credencial. Tentativa com erro prova tentativa, não pagamento aprovado. Ausência de linha NÃO prova desuso: logs universais acabaram de ser implantados; o bruto de WhatsApp tem expurgo legado de sete dias (cron 47), e o roteamento também tem limpeza legada (cron 41); nada foi limpo nesta auditoria. `n_live_tup` é estimativa e NÃO foi usada como prova de tabela vazia (PayPal/Zoppy tinham registros apesar da estimativa zero).

| Provedor | Nomes configurados no ambiente | Última evidência específica encontrada | Interpretação / limite |
|---|---|---|---|
| zapi | `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN` | `webhook_events_raw(provider=zapi)`: nenhuma; `webhook_routing_log(provider=zapi)`: nenhuma; `access_log(function_name=zapi-webhook)`: nenhuma | Credenciais presentes, recebimento recente não comprovado. Z-API não escreve bruto no caminho inspecionado; ausência nesse bruto isoladamente não indica desuso. Cron de saúde 37 ativo, que também atende outras instâncias. |
| wasender | `WASENDER_API_TOKEN` | Bruto, roteamento (`provider=wasender`) e acesso `wasender-webhook`: nenhuma linha | Credencial presente, uso recente não comprovado; bruto não é a trilha própria confirmada. |
| uazapi | `UAZAPI_ADMIN_TOKEN`, `UAZAPI_SUBDOMAIN` | Bruto: **05/11 03:39:49.267207**, `messages_update`, ID `569c4401-6872-4127-b040-13e75519382a`; roteamento: **05/11 03:17:03.903307**, matched=true, ID `3ed85678-c4ca-4d39-8677-d7f010036bae` | Recebimento recente comprovado. Acesso universal ainda sem linha para `uazapi-webhook`, o que não invalida o registro específico. |
| meta-whatsapp | `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_VERIFY_TOKEN`, `META_APP_ID`, `META_APP_SECRET` | Bruto usa **provider=meta**: **05/11 03:54:56.724983**, `messages`, ID `deec98c2-1cf0-4480-a54c-60be02e371c3`; acesso: **05/11 03:54:58.547614**, HTTP 200, ID `010c282e-0ceb-4dc1-ad50-e92e7149ba80` | Recebimento recente comprovado. Roteamento meta também encontrado em 05/11 03:17:45.956716, matched=true. |
| yampi | `YAMPI_STORE_ALIAS`, `YAMPI_USER_SECRET_KEY`, `YAMPI_USER_TOKEN` | Acesso `yampi-webhook`: nenhuma; `automation_executions` ligada a fluxo `yampi_abandoned_cart`: nenhuma; não identificada tabela própria de webhook/pagamento Yampi | Credenciais presentes; atividade atual não comprovada. Atualização direta de pedidos não permite inferir provedor de uma linha sem vínculo específico. |
| paypal | `PAYPAL_BASE_URL`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | `paypal_payments.created_at`: **04/05/2026 21:19:42.023789**, status=created, ID `b5200784-2c3e-4f61-884c-d7d13e7829c7`; updated_at igual | Apenas criação histórica; captura/pagamento atual não comprovado. Acesso `paypal-webhook`: nenhuma linha. |
| point | `MP_POINT_ACCESS_TOKEN` | `point_payment_intents`: nenhuma linha; acesso `point-webhook`: nenhuma | Configurado, uso não comprovado. Point tem trilha própria, não equivale ao checkout Mercado Pago. |
| zoppy | **Nenhum nome Zoppy** no inventário | `zoppy_sync_log.started_at`: **10/02/2026 21:15:03.417**, completed_at=21:15:04.091, success/orders, ID `699d214c-d366-459d-99c4-6e7a3dd90f69`; última `zoppy_sales.completed_at`: **10/03/2026 03:00:00**, completed, ID `8618e3b7-03c8-439c-b1c1-357c9274c32a` | Evidência histórica/importada, não prova integração atual. Endpoint próprio não localizado. |
| telegram | `TELEGRAM_BOT_TOKEN` | `financial_agent_audit.created_at`: **28/08/2026 15:34:14.997255**, direction=in, action=text, ID `6823f4cb-cf63-48ce-a93e-a44e0624eb5f` | Mensagem histórica recebida; uso recente não comprovado; acesso `telegram-financial-webhook` vazio. |
| austpay | `AUSTPAY_API_KEY`, `AUSTPAY_ENV` | `pos_checkout_attempts(gateway=austpay).created_at`: **01/11 21:06:19.554888**, success, ID `1270b2bc-8f5f-4cd7-8d9a-c77e668e2a3b`; estorno mais recentemente criado: **31/10 16:34:02.063097**, concluido, completed_at=16:57:17.418, ID `08387347-3653-46f3-9882-e1909d3c032a` | Uso recente registrado, sem revalidar transação no provedor. **`AUSTPAY_WEBHOOK_SECRET`, `AUSTPAY_PROVIDER`, `AUSTPAY_MERCHANT_ID` não constam no inventário**, embora referenciados no código; configurações em app_settings não foram lidas. |
| appmax | `APPMAX_ACCESS_TOKEN`, `APPMAX_APP_CLIENT_ID`, `APPMAX_APP_CLIENT_SECRET`, `APPMAX_APP_UUID` | Tentativa: **05/11 03:35:46.648739**, error, ID `890cb05d-eb8d-4db8-a96a-edf1730dd48f`; último estorno por criação: **30/10 17:50:23.761775**, falhou, updated_at=04/11 16:17:49.992, ID `daf40d0c-a955-4188-a45e-a7d4194b4136` | Tentativa recente comprovada, não aprovação. Credenciais OAuth também podem estar em appmax_installations. |
| vindi | **`VINDI_API_KEY` não configurado no inventário** | Tentativa `gateway=vindi`: **05/05/2026 15:04:17.758023**, error, ID `9193ab49-a162-4c6a-bdcd-4c79b66a3784` | Só tentativa histórica. Não existe endpoint local `vindi-webhook`: ramo em `payment-webhook?gateway=vindi`; acesso desse handler não distingue MP/Vindi sozinho. |
| pagarme | `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY` | Tentativa: **01/11 20:24:01.180856**, failed, ID `b246d4fa-b79b-4c6a-bede-d6fc328cd20e`; evento específico: **03/10 20:01:40.012761**, card_approved, ID `e0488183-5c57-4a97-9cd9-a8c23de507d5` | Tentativa recente; última aprovação nesta trilha é anterior. Não equivale a última venda global. |
| mercadopago | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` | Tentativa: **05/11 03:13:35.472286**, failed, ID `ccbf80a8-f01c-49a2-945d-c104b4fa3276`; último estorno por criação: **04/11 15:02:22.767515**, concluido, completed_at=15:02:23.579, ID `bc56176c-9c44-4f7f-8397-6f13a5373c02`; evento Pix: **21/10 22:56:25.346855**, pix_generated | Uso recente registrado, sem comprovar última aprovação global. `payment-webhook` atende também Vindi. |
| tiny | `TINY_ERP_TOKEN`, `TINY_APP_CLIENT_ID`, `TINY_APP_CLIENT_SECRET` | `tiny_management_sync_log.started_at`: **03/07/2026 11:23:39.073136**, completed/orders, completed_at=11:24:07.201, ID `adc0056e-a780-46ec-8362-c02d2fa0fc9e`; `tiny_accounts_payable_sync_log`: **12/02/2026 16:27:49.927338**, completed, ID `5f4c480c-3948-4f51-97d9-d08ec2da7a93` | Logs históricos não provam desuso da Expedição, integração preservada por regra. Acesso recente `expedition-tiny-invoice` às 03:53:56 foi **401/bloqueado do teste da Fase 1**, NÃO uso operacional. |
| brasilnfe | `BRASILNFE_WEBHOOK_SECRET` | `fiscal_webhook_events.received_at`: **04/11 15:03:26.742346**, provider=brasilnfe, status_update, processed=true, ID `c3bb964f-5b29-4369-ad95-fe009a7d8852` | Webhook recente persistido. Token de emissão é por empresa; não foi consultado/revelado. |
| frenet | `FRENET_TOKEN`, `FRENET_WEBHOOK_TOKEN` | `shipment_simulations.last_real_sync`: **05/11 03:39:18.844**, stage=enviado, status=active, ID `e98e081e-d8ad-42eb-87e1-42ea7af9094c` | Rastreio real recente registrado; pode ser consulta sob demanda, NÃO prova chegada de webhook. Acesso `shipment-frenet-webhook` sem linha. |

### Consultas executadas e cuidados
- `cron.job`: 51 jobs, 38 ocorrências diretas de URL de função; somente jobid/jobname/schedule/active e nomes extraídos, sem cabeçalhos ou valores secretos. Tentativa psql somente leitura negada por falta de permissão no schema cron; inventário obtido pela ferramenta SQL autorizada, sem contornar permissões.
- `pg_proc` em public: nomes e referências extraídas, nunca corpos contendo credenciais. Incluídas referências SQL atuais para evitar tratar chamadas por trigger/helper como órfãs; presença do corpo não prova que todo trigger esteja ativo ou tenha executado.
- Bruto/roteamento: últimos IDs/datas por provider via LIMIT 1; EXPLAIN confirmou índice `idx_webhook_events_raw_type` para zapi; roteamento tem índice `(provider,created_at DESC)`.
- Pagamentos/tentativas: uma leitura agrupada por gateway, não N consultas nem descarga de registros. `order_payment_events` (estimativa 6.475 linhas) não tem índice global gateway/data; EXPLAIN constatou scan para gateway e a auditoria fez uma rodada única. Não criado índice nem rotina recorrente. Tabelas específicas pequenas sem índice por timestamp tiveram somente consulta pontual, sem payload.
- Valores das credenciais, corpos de cron, mensagens de clientes e payloads dos webhooks nunca entraram no relatório. Configurações externas dos gateways e validade real das credenciais continuam **não verificadas**.

### URLs externas conhecidas (destinos, não prova de chamador)
Z-API `https://api.z-api.io`; WaSender `https://www.wasenderapi.com`; uazapi `https://banana.uazapi.com` (base configurável); Meta `https://graph.facebook.com`; Yampi `https://api.dooki.com.br`; PayPal `https://api-m.paypal.com`; Point/MP `https://api.mercadopago.com`; Telegram `https://api.telegram.org` (token no caminho omitido); AustPay `https://api.rinne.com.br`, `https://pci.api.rinne.com.br` (também sandbox); Appmax `https://auth.appmax.com.br`, `https://api.appmax.com.br`, `https://admin.appmax.com.br` (também sandbox); Vindi `https://api.intermediador.yapay.com.br/api/v3/transactions/get_by_token` (query omitida); Pagar.me `https://api.pagar.me/core/v5/orders`; Tiny `https://api.tiny.com.br/api2/pedido.incluir.php`; BrasilNFe `https://api.brasilnfe.com.br/services`; Frenet `https://api.frenet.com.br/tracking/trackinginfo`, `https://api.frenet.com.br/shipping/quote`. URL própria de Zoppy não localizada.

Fontes de mapeamento: `supabase/functions/_shared/routing-log.ts:41-54`, `uazapi-webhook/index.ts:324-330`, `meta-whatsapp-webhook/index.ts:202-203`, `_shared/checkout-failure-log.ts:31`, `paypal-create-order/index.ts:179`, `point-webhook/index.ts:87-130`, `telegram-financial-webhook/index.ts:1115-1121`, `brasilnfe-webhook/index.ts:98-108`, `shipment-frenet-webhook/index.ts:65-99` (todos sob supabase/functions, salvo indicação). O inventário de secrets vem do ambiente implantado; as linhas de banco vêm de SELECTs reais desta rodada.

### Endpoints chamados sem fonte local
- `chat-payment-followup`: referência atual encontrada; implantação, corpo e registro universal não comprovados; não recriado/desativado.
- `livete-followup-cron`: referência atual encontrada; implantação, corpo e registro universal não comprovados; não recriado/desativado.
- `tiny-mirror-stock`: referência atual encontrada; implantação, corpo e registro universal não comprovados; não recriado/desativado.

### Agendamentos atuais — referências completas

| jobid | Nome | Expressão cron | Ativo | Referências diretas a funções | Chamadas SQL extraídas |
|---|---|---|---|---|---|
| 3 | `chat-payment-followup-every-minute` | `* * * * *` | sim | `chat-payment-followup` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 4 | `dispatch-scheduled-group-messages` | `* * * * *` | sim | `cron-scheduled-group-messages` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 5 | `check-vip-groups-capacity` | `*/5 * * * *` | sim | `cron-check-vip-groups` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 6 | `trigger-scheduled-dispatches` | `* * * * *` | sim | `cron-scheduled-dispatches` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 7 | `inventory-watchdog-every-2min` | `*/2 * * * *` | sim | `cron-inventory-watchdog` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 8 | `livete-followup-cron` | `* * * * *` | sim | `livete-followup-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 10 | `ads-nurture-cron` | `*/30 * * * *` | sim | `ads-nurture-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 12 | `send-scheduled-messages` | `* * * * *` | sim | `cron-send-scheduled-messages` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 13 | `ai-agent-customers-weekly` | `0 10 * * 1` | sim | `ai-agent-customers-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 14 | `ai-agent-sunday-reminder` | `0 23 * * 0` | sim | `ai-agent-customers-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 16 | `mercadopago-poll-pending-2min` | `*/2 * * * *` | sim | `mercadopago-poll-pending` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 22 | `automation-dispatch-recovery` | `* * * * *` | sim | `cron-automation-timeouts` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 23 | `nfce-retry-pending` | `*/5 * * * *` | sim | `nfce-retry-pending` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 24 | `nfce-poll-sefaz-10min` | `*/10 * * * *` | sim | `nfce-poll-sefaz` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 25 | `nfe-puxar-destinadas-diario` | `0 6 * * *` | sim | `nfe-puxar-destinadas` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 28 | `deactivate-stale-zero-stock-products` | `0 3 * * *` | sim | 0 | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 29 | `shopify-sync-to-pos-15min` | `*/15 * * * *` | sim | `shopify-sync-to-pos` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 30 | `archive-whatsapp-messages-nightly` | `30 3 * * *` | sim | 0 | `archive_old_whatsapp_messages` |
| 31 | `archive-broadcast-inactive-nightly` | `45 3 * * *` | sim | 0 | `archive_inactive_broadcast_messages` |
| 32 | `archive-ads-inactive-nightly` | `0 4 * * *` | sim | 0 | `archive_inactive_ads_conversations` |
| 33 | `archive-inactive-conversations-nightly` | `15 4 * * *` | sim | 0 | `archive_inactive_conversations` |
| 35 | `archive-individual-messages-30d` | `30 4 * * *` | sim | 0 | `archive_old_messages_individual` |
| 36 | `calculate-rfm-weekly` | `0 9 * * 1` | sim | `rfm-recalculate` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 37 | `zapi-instance-health-check-every-2min` | `*/2 * * * *` | sim | `zapi-instance-health-check` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 38 | `sync-pos-shopify-to-rfm-hourly` | `15 * * * *` | sim | `sync-pos-shopify-to-rfm` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 40 | `vip-group-dispatch-worker` | `* * * * *` | sim | `group-dispatch-worker` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 41 | `cleanup-webhook-routing-log` | `0 4 * * *` | sim | 0 | `cleanup_webhook_routing_log` |
| 42 | `dispatch-orchestrator-every-minute` | `* * * * *` | sim | `dispatch-orchestrator` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 43 | `cleanup-status-media-daily` | `0 5 * * *` | sim | `cron-cleanup-status-media` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 44 | `uazapi-backfill-contacts-centro` | `* * * * *` | sim | `uazapi-backfill-contacts` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 46 | `pos-task-dispatch-every-5min` | `*/5 * * * *` | sim | `pos-task-dispatch-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 47 | `purge_webhook_events_raw` | `15 3 * * *` | sim | 0 | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 60 | `shopify-reconcile-stock-15min` | `*/15 * * * *` | sim | `shopify-reconcile-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 61 | `carousel-campaign-scheduler-daily` | `0 12 * * *` | sim | `carousel-campaign-scheduler` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 62 | `carousel-campaign-sender-every-5min` | `*/5 * * * *` | sim | `carousel-campaign-sender` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 63 | `recalculate-lead-temperature-daily` | `37 6 * * *` | sim | 0 | `recalculate_lead_temperature` |
| 64 | `event-followup-scheduler` | `* * * * *` | sim | `event-followup-scheduler` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 65 | `event-followup-dispatcher` | `* * * * *` | sim | `event-followup-dispatcher` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 66 | `expire-live-payment-windows` | `* * * * *` | sim | 0 | `expire_live_payment_windows` |
| 67 | `automation-queue-worker-every-minute` | `* * * * *` | sim | `automation-queue-worker` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 68 | `event-bulk-send-worker-hourly-backstop` | `7 * * * *` | sim | `event-bulk-send-worker` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 69 | `instagram-token-refresh-daily` | `20 7 * * *` | sim | `instagram-token-refresh` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 70 | `wa-conv-reconcile-nightly` | `15 4 * * *` | sim | 0 | `wa_conv_reconcile` |
| 71 | `automation-pos-followups-cron` | `*/15 * * * *` | sim | `automation-pos-followups-cron` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 72 | `purge-cron-history` | `17 4 * * *` | sim | 0 | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 73 | `meta-ads-sync-daily` | `0 9 * * *` | sim | `meta-ads-sync` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 74 | `group-admin-worker` | `* * * * *` | sim | `group-admin-worker` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 995 | `accountant-monthly-package-daily` | `0 11 * * *` | sim | `accountant-monthly-package` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 996 | `meta-audience-sync-03h` | `0 6 * * *` | sim | `meta-audience-sync` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 997 | `meta-audience-sync-live` | `0 13,15 * * *` | sim | `meta-audience-sync` | 0 extraídas; pode conter UPDATE/DELETE SQL direto |
| 1035 | `live-catalog-invites` | `* * * * *` | sim | 0 | `live_catalog_invites_tick` |

### Chamadas em corpos SQL atuais (não apenas migrations)

| Rotina SQL | Referências a funções |
|---|---|
| `apply_online_order_stock_movement` | `shopify-mirror-stock` |
| `apply_pos_sale_stock_movement` | `tiny-mirror-stock`, `shopify-mirror-stock` |
| `expire_live_payment_windows` | `instagram-live-sync` |
| `live_selfservice_match_incoming` | `live-selfservice` |
| `process_pos_sale_sale_event` | `shopify-mirror-stock` |
| `selfservice_resend_register_dm` | `ig-live-cart-notify` |
| `trg_blocked_buyer_sale_alert` | `blocked-buyer-sale-alert` |
| `trg_pos_sale_completed_automation` | `automation-trigger-pos-sale`, `pos-link-payment-confirmation` |
| `trg_route_paid_event_order_to_pos` | `event-order-route-to-pos` |
| `trigger_livete_ig_initial_dm` | `livete-start-order` |
| `trigger_meta_capi_offline_enrich_resend` | `meta-capi-offline` |
| `trigger_meta_capi_offline_purchase` | `meta-capi-offline` |
| `trigger_meta_capi_purchase_on_paid` | `meta-capi-event` |
| `wake_ig_live_cart_notify` | `ig-live-cart-notify` |
| `live_catalog_invites_tick` | `selfservice-message-worker`, `live-catalog-invite` |
| `selfservice_notify_late_order` | `selfservice-message-worker`, `live-selfservice` |

Validação: cobertura dos 17 provedores conferida; nomes de 60 configurações recebidos sem valores; os metadados específicos foram consultados no banco real. Auditoria não gerou vendas, cobranças, estornos, mensagens nem chamadas a APIs dos provedores. Nenhuma mudança de aplicativo ou regra de negócio.


## Referências completas por função — complemento

### `accountant-monthly-package`

- src: 2 — `src/components/pos/AccountantSendSection.tsx:140:64` (invoke); `src/test/accountantBusinessDays.test.ts:2:75` (test).
- outras funções: 0 — nenhuma.
- cron.job: 1 — 995 `accountant-monthly-package-daily` (`0 11 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `admin-create-user`

- src: 1 — `src/pages/Admin.tsx:114:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `admin-delete-user`

- src: 1 — `src/pages/Admin.tsx:174:50` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `admin-list-users`

- src: 1 — `src/pages/Admin.tsx:88:50` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:51:31.392159+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `admin-update-user`

- src: 1 — `src/pages/Admin.tsx:145:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `ads-nurture-cron`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 10 `ads-nurture-cron` (`*/30 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:00:04.607672+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `ai-agent-customers`

- src: 1 — `src/pages/AIAgents.tsx:240:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:57.77412+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-agent-customers-cron`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 2 — 13 `ai-agent-customers-weekly` (`0 10 * * 1`, ativo=true); 14 `ai-agent-sunday-reminder` (`0 23 * * 0`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `ai-channel-specialist`

- src: 1 — `src/pages/NewCampaign.tsx:120:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:57.946884+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-classify-transactions`

- src: 1 — `src/components/management/BankReconciliation.tsx:348:64` (invoke).
- outras funções: 1 — `supabase/functions/telegram-financial-process-attachment/index.ts:345:41` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `ai-group-content`

- src: 1 — `src/components/marketing/CreateGroupDialog.tsx:105:60` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:58.143189+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-marketing-master`

- src: 1 — `src/pages/NewCampaign.tsx:98:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:58.91747+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-marketing-strategy`

- src: 2 — `src/components/marketing/CampaignCreator.tsx:112:52` (invoke); `src/components/marketing/ScheduledMessageForm.tsx:933:82` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:59.422628+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-secretary`

- src: 1 — `src/components/admin/SecretaryChat.tsx:141:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:59.142085+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-stock-analyst`

- src: 1 — `src/components/inventory/InventoryAIAnalysis.tsx:75:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:59.03278+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `ai-vip-strategy`

- src: 1 — `src/components/marketing/VipStrategyPanel.tsx:72:82` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:59.229122+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `appmax-install`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/AGENTS.md:17:31` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `appmax-webhook`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/_shared/refund-gateways/appmax-close.ts:1:63` (comment); `supabase/functions/_shared/refund-gateways/appmax.test.ts:2:56` (comment); `supabase/functions/_shared/refund-gateways/appmax.ts:14:20` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `austpay-charge-card`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/pagarme-create-charge/index.ts:1807:82` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `austpay-create-pix`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/mercadopago-create-pix/index.ts:27:62` (invoke).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `austpay-ping`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `austpay-refund`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `austpay-test-charge`

- src: 1 — `src/pages/AustpayTestPage.tsx:43:64` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `austpay-webhook`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 11.
- **ZERO referências internas: candidata a desativar**, somente triagem; webhook externo?; não desativada.

### `auto-create-vip-group`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/cron-check-vip-groups/index.ts:177:25` (comment); `supabase/functions/cron-check-vip-groups/index.ts:192:74` (fetch); `supabase/functions/group-redirect-link/index.ts:415:58` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:02:16.423824+00:00 UTC, HTTP 400, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `automation-ai-ads-respond`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/meta-whatsapp-webhook/index.ts:767:81` (fetch); `supabase/functions/uazapi-webhook/index.ts:1059:66` (fetch); `supabase/functions/zapi-webhook/index.ts:813:77` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `automation-ai-crosssell`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `automation-ai-respond`

- src: 1 — `src/components/marketing/AutomationFlowBuilder.tsx:428:52` (invoke).
- outras funções: 10 — `supabase/functions/_shared/message-router.ts:198:34` (comment); `supabase/functions/automation-continue-flow/index.ts:358:64` (fetch); `supabase/functions/automation-test-flow/index.ts:138:66` (test); `supabase/functions/automation-trigger-incoming/index.ts:321:68` (fetch); `supabase/functions/automation-trigger-new-lead/index.ts:348:68` (fetch); `supabase/functions/live-campaign-trigger/index.ts:488:67` (fetch); `supabase/functions/meta-messenger-webhook/index.ts:529:76` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:724:78` (fetch); `supabase/functions/uazapi-webhook/index.ts:1031:63` (fetch); `supabase/functions/zapi-webhook/index.ts:774:74` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `automation-continue-flow`

- src: 0 — nenhuma.
- outras funções: 6 — `supabase/functions/_shared/automation-context.ts:5:41` (comment); `supabase/functions/_shared/automation-send.ts:3:10` (comment); `supabase/functions/_shared/automation-wait-response.ts:33:73` (invoke); `supabase/functions/cron-automation-timeouts/index.ts:184:52` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:682:56` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:692:52` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `automation-dispatch-audience`

- src: 3 — `src/components/marketing/AutomationFlowBuilder.tsx:3271:52` (invoke); `src/components/marketing/AutomationFlowBuilder.tsx:3305:34` (invoke); `src/components/marketing/AutomationFlowBuilder.tsx:3328:32` (invoke).
- outras funções: 1 — `supabase/functions/cron-automation-timeouts/index.ts:48:44` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `automation-pos-followups-cron`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/_shared/automation-context.ts:6:32` (comment).
- cron.job: 1 — 71 `automation-pos-followups-cron` (`*/15 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 3 — `supabase/migrations/20260918160242_ef5a4708-a8b1-4c08-b460-a67ecd8b8bac.sql:5:67`; `supabase/migrations/20260918160242_ef5a4708-a8b1-4c08-b460-a67ecd8b8bac.sql:8:8`; `supabase/migrations/20260918160242_ef5a4708-a8b1-4c08-b460-a67ecd8b8bac.sql:12:71`.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T04:00:04.537949+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `automation-queue-worker`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/_shared/automation-context.ts:6:4` (comment); `supabase/functions/_shared/automation-send.ts:4:9` (comment).
- cron.job: 1 — 67 `automation-queue-worker-every-minute` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 6.
- Última chamada observada em access_log: 2026-11-05T04:04:01.489848+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `automation-test-flow`

- src: 1 — `src/components/marketing/AutomationFlowBuilder.tsx:3248:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:54:01.012604+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `automation-trigger-incoming`

- src: 0 — nenhuma.
- outras funções: 12 — `supabase/functions/_shared/instagram-comment-automation.ts:613:50` (fetch); `supabase/functions/_shared/instagram-comment-automation.ts:786:50` (fetch); `supabase/functions/_shared/instagram-comment-automation.ts:913:48` (fetch); `supabase/functions/_shared/message-router.ts:57:45` (comment); `supabase/functions/meta-whatsapp-webhook/index.ts:851:56` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:855:52` (other); `supabase/functions/uazapi-webhook/index.ts:1100:41` (fetch); `supabase/functions/uazapi-webhook/index.ts:1104:42` (other); `supabase/functions/zapi-webhook/index.ts:899:52` (fetch); `supabase/functions/zapi-webhook/index.ts:903:48` (other); `supabase/functions/zapi-webhook/index.ts:910:48` (fetch); `supabase/functions/zapi-webhook/index.ts:914:44` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `automation-trigger-new-lead`

- src: 2 — `src/pages/BananaLanding.tsx:162:34` (invoke); `src/pages/BananaLandingGV.tsx:158:34` (invoke).
- outras funções: 2 — `supabase/functions/event-lead-capture/index.ts:282:28` (comment); `supabase/functions/event-lead-capture/index.ts:283:67` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `automation-trigger-pos-sale`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/_shared/automation-context.ts:5:12` (comment); `supabase/functions/pos-link-payment-confirmation/index.ts:11:47` (comment); `supabase/functions/pos-link-payment-confirmation/index.ts:65:34` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.trg_pos_sale_completed_automation`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 4 — `supabase/migrations/20260504140800_680a55f8-3443-421c-9275-48db1f0ad50a.sql:38:72`; `supabase/migrations/20260713224646_1911f0ec-16e6-4be2-8c49-73506b5962db.sql:9:72`; `supabase/migrations/20260918175249_c30adb1e-a654-4205-ab39-5a0bfe183bb2.sql:8:72`; `supabase/migrations/20260929083652_b2d528bb-fba3-41c0-b4fd-1d250d772b8a.sql:15:72`.
- Autorreferências excluídas: 2.

### `automation-trigger-shopify-purchase`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `backfill-organic-leads`

- src: 2 — `src/pages/Marketing.tsx:481:64` (invoke); `src/pages/Marketing.tsx:557:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `backfill-payment-method`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `blocked-buyer-sale-alert`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/payment-webhook/index.ts:289:42` (invoke).
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.trg_blocked_buyer_sale_alert`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260718180103_86f89ed9-5c31-48fd-8560-2f1c32d9e39a.sql:11:72`.
- Autorreferências excluídas: 4.

### `brasilnfe-webhook`

- src: 1 — `src/pages/admin/FiscalDocuments.tsx:22:77` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 6.

### `calculate-inventory-health`

- src: 1 — `src/components/inventory/InventoryHealthScoreCard.tsx:71:72` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `carousel-campaign-run-now`

- src: 1 — `src/components/pos/automation/CampaignList.tsx:102:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `carousel-campaign-scheduler`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 61 `carousel-campaign-scheduler-daily` (`0 12 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `carousel-campaign-sender`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/carousel-campaign-run-now/index.ts:144:43` (fetch).
- cron.job: 1 — 62 `carousel-campaign-sender-every-5min` (`*/5 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:00:05.751374+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `carousel-ladder-create`

- src: 2 — `src/components/admin/CarouselTemplatesLadder.tsx:255:64` (invoke); `src/components/events/EventCarouselTemplatesTab.tsx:11:39` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T03:53:59.925102+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `cashback-external`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- **ZERO referências internas: candidata a desativar**, somente triagem; URL pública/externa? revisar; não desativada.

### `chat-send-nps`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `checkout-crossell`

- src: 3 — `src/components/checkout/CrossellModal.tsx:90:64` (invoke); `src/components/checkout/CrossellModal.tsx:118:64` (invoke); `src/pages/TransparentCheckout.tsx:993:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `checkout-prize-preview`

- src: 1 — `src/pages/TransparentCheckout.tsx:867:16` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `checkout-public`

- src: 5 — `src/lib/checkoutPublic.ts:1:65` (comment); `src/lib/checkoutPublic.ts:8:62` (invoke); `src/lib/checkoutPublic.ts:12:22` (other); `src/lib/checkoutPublic.ts:17:20` (other); `src/lib/livePublic.ts:5:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260603232420_b6e43ea0-f533-42f6-a433-b0d45ba4ff46.sql:2:58`.
- Autorreferências excluídas: 3.
- Última chamada observada em access_log: 2026-11-05T03:50:51.391136+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `checkout-quote-freight`

- src: 2 — `src/pages/StoreCheckout.tsx:396:64` (invoke); `src/pages/TransparentCheckout.tsx:507:64` (invoke).
- outras funções: 3 — `supabase/functions/_shared/livete-tools.ts:566:68` (fetch); `supabase/functions/live-member-area/index.ts:1895:29` (comment); `supabase/functions/live-member-area/index.ts:1929:79` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `concierge-respond`

- src: 0 — nenhuma.
- outras funções: 8 — `supabase/functions/meta-messenger-webhook/index.ts:512:52` (fetch); `supabase/functions/meta-messenger-webhook/index.ts:522:60` (other); `supabase/functions/meta-whatsapp-webhook/index.ts:842:56` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:846:52` (other); `supabase/functions/uazapi-webhook/index.ts:1088:41` (fetch); `supabase/functions/uazapi-webhook/index.ts:1092:42` (other); `supabase/functions/zapi-webhook/index.ts:890:52` (fetch); `supabase/functions/zapi-webhook/index.ts:894:48` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `consignment-sales-report`

- src: 1 — `src/components/inventory/ProductCaptureTab.tsx:425:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:57.807197+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `contact-erase`

- src: 1 — `src/components/chat/EraseContactButton.tsx:53:64` (invoke).
- outras funções: 1 — `supabase/functions/_shared/access-log-data.ts:25:67` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.
- Última chamada observada em access_log: 2026-11-05T03:53:56.795746+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `correios-admin`

- src: 3 — `src/components/admin/CorreiosSettingsPanel.tsx:19:35` (other); `src/components/admin/CorreiosSettingsPanel.tsx:29:51` (config); `src/components/admin/CorreiosSettingsPanel.tsx:35:56` (other).
- outras funções: 1 — `supabase/functions/AGENTS.md:6:39` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `correios-reverse`

- src: 1 — `src/components/pos/POSWhatsAppReverseDialog.tsx:46:60` (invoke).
- outras funções: 1 — `supabase/functions/AGENTS.md:20:3` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `correios-shipment`

- src: 5 — `src/components/pos/expedition/ExpCorreiosShipmentPanel.tsx:40:84` (config); `src/components/pos/expedition/ExpCorreiosShipmentPanel.tsx:41:103` (config); `src/components/pos/expedition/ExpCorreiosShipmentPanel.tsx:47:68` (config); `src/components/pos/expedition/ExpCorreiosShipmentPanel.tsx:54:126` (config); `src/components/pos/expedition/POSExpedition.tsx:255:68` (config).
- outras funções: 1 — `supabase/functions/AGENTS.md:10:3` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `create-master-product-pos`

- src: 2 — `src/components/inventory/LegacyProductsList.tsx:326:64` (invoke); `src/components/inventory/ProductMasterForm.tsx:286:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `create-master-product-shopify`

- src: 2 — `src/components/inventory/LegacyProductsList.tsx:338:64` (invoke); `src/components/inventory/LegacyProductsList.tsx:473:77` (config).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `criar-pedido-externo`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/mcp-server/index.ts:407:63` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `crm-dedup-customers`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `cron-automation-timeouts`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/automation-dispatch-audience/index.ts:937:66` (comment).
- cron.job: 1 — 22 `automation-dispatch-recovery` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- Última chamada observada em access_log: 2026-11-05T04:04:01.099501+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `cron-check-vip-groups`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/auto-create-vip-group/index.ts:9:16` (comment).
- cron.job: 1 — 5 `check-vip-groups-capacity` (`*/5 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:55:09.416626+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `cron-cleanup-status-media`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 43 `cleanup-status-media-daily` (`0 5 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `cron-inventory-watchdog`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 7 `inventory-watchdog-every-2min` (`*/2 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:01.02691+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `cron-scheduled-dispatches`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 6 `trigger-scheduled-dispatches` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T04:04:01.036944+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `cron-scheduled-group-messages`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 4 `dispatch-scheduled-group-messages` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:00.98436+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `cron-secretary-reminders`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `cron-send-scheduled-messages`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 12 `send-scheduled-messages` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:00.668215+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `delete-master-products`

- src: 2 — `src/components/inventory/LegacyProductsList.tsx:425:64` (invoke); `src/components/inventory/UnifiedProductsList.tsx:161:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `dispatch-attribution`

- src: 1 — `src/components/marketing/DispatchAttributionPanel.tsx:86:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `dispatch-orchestrator`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/cron-scheduled-dispatches/index.ts:22:58` (fetch); `supabase/functions/cron-scheduled-dispatches/index.ts:32:56` (other).
- cron.job: 1 — 42 `dispatch-orchestrator-every-minute` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T04:04:00.998493+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `dispatch-worker`

- src: 2 — `src/components/marketing/DispatchHistoryList.tsx:544:41` (comment); `src/components/marketing/DispatchHistoryList.tsx:553:64` (invoke).
- outras funções: 3 — `supabase/functions/dispatch-orchestrator/index.ts:86:44` (fetch); `supabase/functions/vps-dispatch-proxy/index.ts:5:21` (comment); `supabase/functions/vps-dispatch-proxy/index.ts:117:42` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `event-bulk-send-enqueue`

- src: 2 — `src/components/events/EventBulkSendDialog.tsx:318:64` (invoke); `src/components/events/EventBulkSendDialog.tsx:333:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `event-bulk-send-worker`

- src: 1 — `src/components/events/EventBulkSendsHistory.tsx:109:40` (invoke).
- outras funções: 1 — `supabase/functions/event-bulk-send-enqueue/index.ts:284:41` (fetch).
- cron.job: 1 — 68 `event-bulk-send-worker-hourly-backstop` (`7 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `event-followup-dispatcher`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 65 `event-followup-dispatcher` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:01.052723+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `event-followup-scheduler`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 64 `event-followup-scheduler` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:03.656341+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `event-lead-capture`

- src: 2 — `src/pages/public/EventLandingView.tsx:110:64` (invoke); `src/pages/public/EventTypebotView.tsx:150:64` (invoke).
- outras funções: 2 — `supabase/functions/_shared/instagram-comment-automation.ts:403:64` (fetch); `supabase/functions/lead-notify-pdv/index.ts:66:23` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `event-order-route-to-pos`

- src: 1 — `src/components/events/StorePickupWizard.tsx:119:42` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.trg_route_paid_event_order_to_pos`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 9 — `supabase/migrations/20260506185310_d5baf7b1-8aeb-4e64-91ba-bfc030c96583.sql:31:67`; `supabase/migrations/20260520194043_0984527d-77b1-4148-a207-74500f8fd4df.sql:50:67`; `supabase/migrations/20260706164400_f2d6abe9-2670-4db3-8b02-bc22eae43520.sql:62:67`; `supabase/migrations/20260715224726_58b89d13-2de9-4210-bd37-3812cb114027.sql:63:67`; `supabase/migrations/20260727183131_3d421c6b-20db-4849-bdb6-2b24a54c4038.sql:67:67`; `supabase/migrations/20260729125650_3b0d8839-9104-471b-a202-4a38bcddbcbd.sql:55:67`; `supabase/migrations/20260804174507_dffe480a-7709-48f3-9298-086ee2430a2b.sql:59:67`; `supabase/migrations/20260805020707_5b539f5b-bc45-4400-93c1-9e10bb1eca6f.sql:61:67`; `supabase/migrations/20260907220538_a9e82fca-2040-4f60-bf47-439fae4d9f6a.sql:71:67`.
- Autorreferências excluídas: 1.

### `event-order-template-send`

- src: 3 — `src/components/OrderCardDb.tsx:850:74` (invoke); `src/components/OrderCardDb.tsx:933:80` (invoke); `src/components/events/LiveCardMessageActions.tsx:50:41` (config).
- outras funções: 1 — `supabase/functions/live-member-area/index.ts:1659:42` (invoke).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `event-order-wa-initial-send`

- src: 5 — `src/components/CustomerFichaDialog.tsx:613:10` (other); `src/components/OrderCardDb.tsx:881:74` (invoke); `src/components/events/LiveCardMessageActions.tsx:50:71` (config); `src/components/events/LiveQuickActionsDialog.tsx:79:64` (invoke); `src/components/events/WaInitialMessageEditor.tsx:43:23` (comment).
- outras funções: 1 — `supabase/functions/livete-start-order/index.ts:560:60` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `event-prize-wheel`

- src: 3 — `src/components/events/WheelLiveSpinList.tsx:34:62` (invoke); `src/components/events/WheelLiveSpinList.tsx:42:62` (invoke); `src/components/prize/EventPrizeWheelDialog.tsx:24:60` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 5.

### `event-raffle`

- src: 1 — `src/components/events/EventRafflesManager.tsx:110:60` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 8.

### `exchange-reverse-shipping`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/concierge-respond/index.ts:838:70` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-beta-initial-sync`

- src: 1 — `src/pages/ExpeditionBeta.tsx:80:68` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-check-stock`

- src: 2 — `src/components/expedition-beta/BetaPickingList.tsx:185:66` (invoke); `src/components/expedition/ExpeditionPickingList.tsx:257:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `expedition-correct-stock`

- src: 1 — `src/components/expedition-beta/StockCorrectionDialog.tsx:78:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-enrich-shipping`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `expedition-fetch-label`

- src: 2 — `src/components/expedition/ExpeditionFreightQuote.tsx:263:64` (invoke); `src/components/expedition/ExpeditionFreightQuote.tsx:295:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-quote-freight`

- src: 1 — `src/components/expedition/ExpeditionFreightQuote.tsx:56:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-refresh-orders`

- src: 1 — `src/pages/Expedition.tsx:171:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-sync-orders`

- src: 1 — `src/pages/Expedition.tsx:152:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:56.715381+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `expedition-tiny-invoice`

- src: 5 — `src/components/expedition/ExpeditionFreightQuote.tsx:172:87` (invoke); `src/components/expedition/ExpeditionFreightQuote.tsx:180:64` (invoke); `src/components/expedition/ExpeditionFreightQuote.tsx:201:85` (invoke); `src/components/expedition/ExpeditionFreightQuote.tsx:226:64` (invoke); `src/components/expedition/ExpeditionFreightQuote.tsx:541:90` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:56.678667+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `expedition-transfer-stock`

- src: 2 — `src/components/expedition/ExpeditionPackingStation.tsx:197:64` (invoke); `src/components/pos/POSOnlineSales.tsx:544:44` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `expedition-verify-shipped`

- src: 1 — `src/pages/Expedition.tsx:104:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `export-audience-csv`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `fiscal-backfill-danfe`

- src: 3 — `src/components/pos/POSSaleDetailDialog.tsx:334:38` (invoke); `src/components/pos/expedition/ExpConferenceDialog.tsx:126:42` (invoke); `src/components/pos/expedition/ExpConferenceDialog.tsx:148:42` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `fiscal-backfill-xml`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `fiscal-recover-by-identifier`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/nfce-emitir/index.ts:369:79` (fetch); `supabase/functions/nfe-emitir/index.ts:802:79` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `fiscal-render-document`

- src: 2 — `src/lib/openFiscalDocument.ts:3:43` (fetch); `src/lib/openFiscalDocument.ts:19:43` (fetch).
- outras funções: 8 — `supabase/functions/_shared/fiscal-persist-files.ts:7:43` (fetch); `supabase/functions/brasilnfe-webhook/index.ts:22:43` (fetch); `supabase/functions/fiscal-backfill-danfe/index.ts:14:43` (fetch); `supabase/functions/fiscal-resign-danfe-urls/index.ts:12:4` (comment); `supabase/functions/nfce-emitir/index.ts:68:43` (fetch); `supabase/functions/nfe-devolucao-emitir/index.ts:96:43` (fetch); `supabase/functions/nfe-emitir/index.ts:31:43` (fetch); `supabase/functions/nfe-emitir/index.ts:751:41` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 4 — `supabase/migrations/20260520211205_0942256f-aef8-467e-80eb-b87fdf1e197a.sql:2:72`; `supabase/migrations/20260520211205_0942256f-aef8-467e-80eb-b87fdf1e197a.sql:6:81`; `supabase/migrations/20260520211205_0942256f-aef8-467e-80eb-b87fdf1e197a.sql:9:72`; `supabase/migrations/20260520211205_0942256f-aef8-467e-80eb-b87fdf1e197a.sql:13:81`.
- Autorreferências excluídas: 2.

### `fiscal-resign-danfe-urls`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `gateway-payment-lookup`

- src: 3 — `src/components/GatewayPaymentLookupButton.tsx:24:64` (invoke); `src/components/OrderDetailsDialog.tsx:148:64` (invoke); `src/components/OrderDialogDb.tsx:129:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `group-admin-worker`

- src: 1 — `src/test/groupAdminQueue.test.ts:2:94` (test).
- outras funções: 1 — `supabase/functions/auto-create-vip-group/index.ts:144:39` (comment).
- cron.job: 1 — 74 `group-admin-worker` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 9.
- Última chamada observada em access_log: 2026-11-05T04:04:01.046106+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `group-dispatch-worker`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/zapi-group-scheduled-send/index.ts:14:50` (comment); `supabase/functions/zapi-group-scheduled-send/index.ts:293:42` (fetch).
- cron.job: 1 — 40 `vip-group-dispatch-worker` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260715174456_b4121eac-fc76-4141-9127-088026cfb010.sql:32:44`.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:01.162583+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `group-redirect-link`

- src: 1 — `src/pages/VipGroupRedirectPage.tsx:47:40` (fetch).
- outras funções: 2 — `supabase/functions/auto-create-vip-group/index.ts:9:40` (comment); `supabase/functions/event-lead-capture/index.ts:246:59` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260604103935_14034902-36ba-4a5e-bc17-d1b383c95275.sql:20:70`.
- Autorreferências excluídas: 1.

### `ig-live-cart-notify`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 2 — `public.selfservice_resend_register_dm`, `public.wake_ig_live_cart_notify`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260928185208_ef3139d3-71e4-40a5-a8c5-576091b3e43d.sql:5:67`.
- Autorreferências excluídas: 3.

### `instagram-account-connect`

- src: 2 — `src/components/admin/InstagramAccountManager.tsx:112:64` (invoke); `src/components/admin/InstagramAccountManager.tsx:157:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `instagram-comment-reply`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `instagram-dm-automation-run`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/meta-messenger-webhook/index.ts:354:52` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `instagram-dm-send`

- src: 2 — `src/components/events/InstagramDMChat.tsx:253:64` (invoke); `src/components/events/InstagramDMChat.tsx:370:64` (invoke).
- outras funções: 5 — `supabase/functions/event-followup-dispatcher/index.ts:172:64` (fetch); `supabase/functions/live-campaign-dispatch/index.ts:93:63` (fetch); `supabase/functions/live-campaign-dispatch/index.ts:97:18` (comment); `supabase/functions/livete-start-order/index.ts:345:42` (comment); `supabase/functions/livete-start-order/index.ts:412:57` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `instagram-dm-send-buttons`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/event-followup-dispatcher/index.ts:195:55` (fetch); `supabase/functions/livete-start-order/index.ts:437:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `instagram-list-media`

- src: 1 — `src/components/marketing/InstagramCommentAutomation.tsx:314:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `instagram-live-sync`

- src: 2 — `src/components/events/EventLiveCommentsPanel.tsx:473:64` (invoke); `src/components/events/EventLiveCommentsPanel.tsx:501:21` (other).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.expire_live_payment_windows`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `instagram-resend-live-dm`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `instagram-send-bulk-dm`

- src: 1 — `src/components/events/LiveCommentsHistory.tsx:384:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `instagram-token-refresh`

- src: 1 — `src/components/admin/InstagramAccountManager.tsx:63:64` (invoke).
- outras funções: 1 — `supabase/functions/_shared/instagram-account.ts:33:48` (comment).
- cron.job: 1 — 69 `instagram-token-refresh-daily` (`20 7 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260908134216_ef214329-058f-4fe4-a4d5-e54ce94e874a.sql:7:67`.
- Autorreferências excluídas: 1.

### `inventory-correct-stock`

- src: 4 — `src/pages/Inventory.tsx:412:36` (invoke); `src/pages/Inventory.tsx:1049:64` (invoke); `src/pages/Inventory.tsx:1134:34` (invoke); `src/pages/Inventory.tsx:1182:32` (invoke).
- outras funções: 2 — `supabase/functions/_shared/access-log-data.ts:25:20` (other); `supabase/functions/cron-inventory-watchdog/index.ts:74:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- Última chamada observada em access_log: 2026-11-05T03:54:01.265439+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `inventory-verify-and-correct`

- src: 2 — `src/pages/Inventory.tsx:1014:32` (invoke); `src/pages/Inventory.tsx:1896:60` (invoke).
- outras funções: 1 — `supabase/functions/cron-inventory-watchdog/index.ts:56:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `issue-member-magic-link`

- src: 3 — `src/components/CustomerFichaDialog.tsx:521:62` (invoke); `src/components/events/LiveCardMessageActions.tsx:78:64` (invoke); `src/components/events/LiveQuickActionsDialog.tsx:108:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `lead-notify-pdv`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/event-lead-capture/index.ts:318:77` (fetch); `supabase/functions/event-lead-capture/index.ts:328:45` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 5.

### `legacy-order-webhook`

- src: 1 — `src/components/OrderCardDb.tsx:422:44` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `link-page-capture-lead`

- src: 1 — `src/pages/LinkPageView.tsx:136:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `link-page-catalog-sync`

- src: 1 — `src/components/marketing/LinkPageManager.tsx:403:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `link-page-public`

- src: 2 — `src/pages/LinkPageView.tsx:88:71` (invoke); `src/pages/LinkPageView.tsx:115:59` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `link-page-track-click`

- src: 1 — `src/pages/LinkPageView.tsx:180:32` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `live-campaign-dispatch`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/live-campaign-trigger/index.ts:547:78` (comment); `supabase/functions/live-campaign-trigger/index.ts:563:122` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `live-campaign-trigger`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/meta-whatsapp-webhook/index.ts:572:54` (fetch); `supabase/functions/uazapi-webhook/index.ts:884:39` (fetch); `supabase/functions/zapi-webhook/index.ts:566:50` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `live-catalog`

- src: 2 — `src/pages/LiveCatalogPage.tsx:34:60` (invoke); `src/test/liveCatalogCashback.test.ts:2:77` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 7.

### `live-catalog-invite`

- src: 2 — `src/components/events/LiveCatalogInviteBlock.tsx:38:60` (invoke); `src/test/liveCatalogInvite.test.ts:2:103` (test).
- outras funções: 1 — `supabase/functions/AGENTS.md:16:112` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.live_catalog_invites_tick`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `live-crossell-blocks`

- src: 1 — `src/components/events/CrossellBlocksEditor.tsx:23:57` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `live-member-area`

- src: 2 — `src/components/events/CustomerAccessCodeRow.tsx:43:62` (invoke); `src/pages/LiveMemberArea.tsx:169:60` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 12.

### `live-process-comment`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `live-redirect`

- src: 2 — `src/pages/LiveRedirectPage.tsx:10:32` (comment); `src/pages/LiveRedirectPage.tsx:50:40` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `live-selfservice`

- src: 4 — `src/components/events/SelfServiceQueueAlerts.tsx:72:38` (invoke); `src/lib/selfServiceAdvertising.ts:23:60` (invoke); `src/pages/SelfServiceCartPage.tsx:36:60` (invoke); `src/pages/SelfServiceOrderPage.tsx:54:60` (invoke).
- outras funções: 1 — `supabase/functions/livete-start-order/index.ts:552:63` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 2 — `public.live_selfservice_match_incoming`, `public.selfservice_notify_late_order`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 14.

### `live-send-verification`

- src: 1 — `src/components/live/LiveLeadGate.tsx:49:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260603205222_19ca4feb-102a-4fd9-83d1-a1c88354e87d.sql:2:5`.
- Autorreferências excluídas: 2.

### `live-verify-code`

- src: 1 — `src/components/live/LiveLeadGate.tsx:89:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260603205222_19ca4feb-102a-4fd9-83d1-a1c88354e87d.sql:2:29`.
- Autorreferências excluídas: 1.

### `live-whatsapp-redirect`

- src: 1 — `src/pages/LiveWhatsAppRedirectPage.tsx:65:46` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 7.

### `livete-order-updated`

- src: 7 — `src/stores/dbOrderStore.ts:330:38` (invoke); `src/stores/dbOrderStore.ts:334:38` (invoke); `src/stores/dbOrderStore.ts:338:38` (invoke); `src/stores/dbOrderStore.ts:508:36` (invoke); `src/stores/dbOrderStore.ts:511:39` (other); `src/stores/dbOrderStore.ts:513:51` (other); `src/stores/dbOrderStore.ts:542:36` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 7.

### `livete-payment-confirmation`

- src: 1 — `src/stores/dbOrderStore.ts:37:30` (invoke).
- outras funções: 3 — `supabase/functions/_shared/payment-confirmed.ts:19:40` (fetch); `supabase/functions/mercadopago-poll-pending/index.ts:279:69` (fetch); `supabase/functions/pagarme-create-charge/index.ts:197:42` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 21.

### `livete-respond`

- src: 0 — nenhuma.
- outras funções: 6 — `supabase/functions/meta-whatsapp-webhook/index.ts:713:56` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:717:52` (other); `supabase/functions/uazapi-webhook/index.ts:1021:41` (fetch); `supabase/functions/uazapi-webhook/index.ts:1025:42` (other); `supabase/functions/zapi-webhook/index.ts:764:52` (fetch); `supabase/functions/zapi-webhook/index.ts:768:48` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260408153349_3537a1af-c153-4cc8-a92c-2b0e4e9c22a4.sql:2:32`.
- Autorreferências excluídas: 19.

### `livete-start-order`

- src: 4 — `src/components/OrderCardDb.tsx:813:74` (invoke); `src/components/WhatsAppChat.tsx:1399:54` (comment); `src/components/events/InitialMessageEditor.tsx:58:23` (comment); `src/stores/dbOrderStore.ts:458:42` (invoke).
- outras funções: 2 — `supabase/functions/live-selfservice/index.ts:227:49` (comment); `supabase/functions/meta-template-send/index.ts:3:51` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.trigger_livete_ig_initial_dm`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 2 — `supabase/migrations/20260526182113_403b1418-8b7e-42bf-beeb-54c4e98e7f17.sql:5:74`; `supabase/migrations/20260827183213_f3642342-b6ae-4e5f-b264-0a2b82067958.sql:83:45`.
- Autorreferências excluídas: 3.

### `lp-capture-lead`

- src: 1 — `src/pages/ConfortoLP.tsx:160:40` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 7.

### `marketing-agent-chat`

- src: 1 — `src/components/marketing/StrategistPanel.tsx:101:52` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `marketing-attribution-dashboard`

- src: 1 — `src/components/marketing/MarketingAttributionDashboard.tsx:149:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `marketing-leads-dashboard`

- src: 3 — `src/components/marketing/ConvertedLeadsDialog.tsx:51:66` (invoke); `src/components/marketing/LeadsAnalyticsDashboard.tsx:113:69` (invoke); `src/components/marketing/LeadsSourceBreakdownDialog.tsx:84:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `marketing-ltv-dashboard`

- src: 1 — `src/components/marketing/MarketingAttributionDashboard.tsx:176:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `mcp-server`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; URL pública/externa? revisar; não desativada.

### `melhor-envio-test`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `mercadopago-check-payment`

- src: 4 — `src/components/checkout/PaymentSection.tsx:332:59` (invoke); `src/components/pos/POSWhatsAppPixDialog.tsx:56:59` (invoke); `src/pages/Checkout.tsx:153:66` (invoke); `src/pages/StoreCheckout.tsx:640:59` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `mercadopago-create-boleto`

- src: 1 — `src/components/pos/POSGenerateBoletoDialog.tsx:327:64` (invoke).
- outras funções: 1 — `supabase/functions/_shared/livete-tools.ts:470:69` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `mercadopago-create-pix`

- src: 8 — `src/components/ChatPixButton.tsx:43:46` (comment); `src/components/ChatPixButton.tsx:92:54` (invoke); `src/components/OrderDialogDb.tsx:531:64` (invoke); `src/components/checkout/PaymentSection.tsx:374:57` (invoke); `src/components/pos/POSOnlineSales.tsx:528:83` (invoke); `src/components/pos/POSWhatsAppPixDialog.tsx:126:64` (invoke); `src/pages/Checkout.tsx:209:57` (invoke); `src/pages/StoreCheckout.tsx:701:64` (invoke).
- outras funções: 3 — `supabase/functions/live-selfservice/index.ts:486:54` (fetch); `supabase/functions/livete-order-updated/index.ts:183:66` (fetch); `supabase/functions/livete-respond/index.ts:615:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `mercadopago-get-public-key`

- src: 1 — `src/lib/mercadopago.ts:55:57` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `mercadopago-installments`

- src: 3 — `src/components/checkout/PaymentSection.tsx:657:66` (invoke); `src/test/paymentConfirmStep.test.tsx:57:23` (test); `src/test/paymentConfirmStep.test.tsx:67:62` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `mercadopago-poll-pending`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/_shared/refund-gateways/appmax-close.ts:2:16` (comment); `supabase/functions/_shared/refund-post-actions.ts:2:56` (comment).
- cron.job: 1 — 16 `mercadopago-poll-pending-2min` (`*/2 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:01.548363+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `meta-ads-list-accounts`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `meta-ads-sync`

- src: 1 — `src/components/marketing/RoasRealDashboard.tsx:226:64` (invoke).
- outras funções: 1 — `supabase/functions/AGENTS.md:18:29` (other).
- cron.job: 1 — 73 `meta-ads-sync-daily` (`0 9 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `meta-ads-sync-spend`

- src: 1 — `src/components/management/InvestmentsDashboard.tsx:145:60` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:54:01.221682+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `meta-attribution-capture`

- src: 2 — `src/pages/CatalogLeadPage.tsx:323:38` (invoke); `src/pages/LiveMemberArea.tsx:376:18` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `meta-audience-sync`

- src: 2 — `src/pages/MetaAudiences.tsx:38:32` (invoke); `src/pages/MetaAudiences.tsx:46:62` (invoke).
- outras funções: 1 — `supabase/functions/AGENTS.md:19:26` (other).
- cron.job: 2 — 996 `meta-audience-sync-03h` (`0 6 * * *`, ativo=true); 997 `meta-audience-sync-live` (`0 13,15 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `meta-capi-event`

- src: 4 — `src/components/pos/POSMetaPixelDashboard.tsx:106:38` (other); `src/lib/checkoutMetaEvents.ts:33:56` (invoke); `src/lib/checkoutMetaEvents.ts:34:31` (other); `src/lib/checkoutMetaEvents.ts:36:20` (other).
- outras funções: 7 — `supabase/functions/AGENTS.md:11:45` (other); `supabase/functions/live-member-area/index.ts:1576:68` (comment); `supabase/functions/live-selfservice/index.ts:843:57` (fetch); `supabase/functions/meta-capi-offline/index.ts:97:48` (comment); `supabase/functions/meta-capi-offline/index.ts:180:59` (fetch); `supabase/functions/meta-capi-offline/index.ts:212:19` (other); `supabase/functions/meta-capi-purchase-retry/index.ts:62:59` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.trigger_meta_capi_purchase_on_paid`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 6 — `supabase/migrations/20260426214432_5f5977b0-663c-460f-ab76-623abf8b2936.sql:5:66`; `supabase/migrations/20260426214432_5f5977b0-663c-460f-ab76-623abf8b2936.sql:58:45`; `supabase/migrations/20260502201542_facebc0b-74e7-4130-9c1d-c72d53b72f02.sql:61:45`; `supabase/migrations/20260520160031_99839c50-b3e2-4d0a-9530-97f8f707f320.sql:57:45`; `supabase/migrations/20260520160031_99839c50-b3e2-4d0a-9530-97f8f707f320.sql:159:69`; `supabase/migrations/20260727004313_3f25b625-399c-41ec-9858-1bb2b05c0f77.sql:61:45`.
- Autorreferências excluídas: 12.

### `meta-capi-lead`

- src: 2 — `src/pages/public/EventTypebotView.tsx:203:38` (invoke); `src/pages/public/EventTypebotView.tsx:216:42` (other).
- outras funções: 2 — `supabase/functions/live-campaign-dispatch/index.ts:219:46` (invoke); `supabase/functions/live-campaign-trigger/index.ts:187:36` (invoke).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `meta-capi-offline`

- src: 1 — `src/components/pos/POSMetaPixelDashboard.tsx:146:43` (config).
- outras funções: 1 — `supabase/functions/meta-capi-test/index.ts:37:60` (test).
- cron.job: 0 — nenhuma.
- SQL atual: 2 — `public.trigger_meta_capi_offline_enrich_resend`, `public.trigger_meta_capi_offline_purchase`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 9 — `supabase/migrations/20260424182216_8e23f8c7-9c70-482b-ab46-1b3e28daa711.sql:90:45`; `supabase/migrations/20260424184141_677a5e3b-3cb1-4962-bd98-caa45b628f91.sql:49:45`; `supabase/migrations/20260424184302_a6d82343-2268-430c-bfc3-09a1dad623d8.sql:8:167`; `supabase/migrations/20260424184302_a6d82343-2268-430c-bfc3-09a1dad623d8.sql:60:45`; `supabase/migrations/20260424194831_e09a59e5-57d3-44a1-9d8e-cefe36d552ab.sql:2:65`; `supabase/migrations/20260520155618_48624dae-54e9-44bf-9f5d-c4704c28a310.sql:48:45`; `supabase/migrations/20260520160031_99839c50-b3e2-4d0a-9530-97f8f707f320.sql:105:69`; `supabase/migrations/20260727005211_f7f43235-378f-4983-92ee-3c205d49ec2d.sql:6:67`; `supabase/migrations/20260727021534_08196b4d-d99f-49ec-bf09-471ef3725e68.sql:47:45`.
- Autorreferências excluídas: 3.

### `meta-capi-offline-backfill`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/meta-capi-trigger-backfill/index.ts:21:58` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 3 — `supabase/migrations/20260424194104_98555b5b-973b-4829-9e57-d4372b85b242.sql:13:65`; `supabase/migrations/20260424194559_81175c0f-b111-4650-9ef2-2f8577aefeab.sql:11:65`; `supabase/migrations/20260424194720_85505e52-8740-4d3f-8cc4-46a2def2a7b6.sql:2:65`.
- Autorreferências excluídas: 1.

### `meta-capi-purchase`

- src: 1 — `src/hooks/useConversationEnrichment.ts:213:36` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `meta-capi-purchase-retry`

- src: 2 — `src/components/pos/POSMetaPixelDashboard.tsx:146:65` (config); `src/components/pos/POSMetaPixelDashboard.tsx:161:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `meta-capi-sync-vault`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `meta-capi-test`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `meta-capi-trigger-backfill`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `meta-messenger-send`

- src: 5 — `src/components/WhatsAppChat.tsx:548:64` (invoke); `src/components/live/LiveWhatsAppChatDialog.tsx:115:35` (comment); `src/hooks/chat/useChatSender.ts:106:40` (comment); `src/hooks/chat/useChatSender.ts:112:68` (invoke); `src/pages/Chat.tsx:592:68` (fetch).
- outras funções: 5 — `supabase/functions/concierge-respond/index.ts:1272:23` (other); `supabase/functions/concierge-respond/index.ts:1842:17` (other); `supabase/functions/instagram-dm-automation-run/index.ts:11:31` (comment); `supabase/functions/instagram-dm-automation-run/index.ts:63:58` (fetch); `supabase/functions/meta-messenger-webhook/index.ts:539:64` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `meta-messenger-webhook`

- src: 1 — `src/components/events/EventLiveCommentsPanel.tsx:875:11` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `meta-template-send`

- src: 1 — `src/components/WhatsAppChat.tsx:1442:64` (invoke).
- outras funções: 4 — `supabase/functions/event-order-template-send/index.ts:257:59` (fetch); `supabase/functions/livete-start-order/index.ts:509:64` (fetch); `supabase/functions/livete-start-order/index.ts:523:39` (other); `supabase/functions/pos-task-dispatch-cron/index.ts:150:47` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 5.

### `meta-whatsapp-create-template`

- src: 4 — `src/components/MetaTemplateCreator.tsx:549:60` (fetch); `src/components/MetaTemplateCreator.tsx:693:60` (fetch); `src/components/admin/SimpleTemplatesPanel.tsx:65:5` (comment); `src/components/admin/SimpleTemplatesPanel.tsx:282:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:54:00.036876+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `meta-whatsapp-get-templates`

- src: 21 — `src/components/MetaTemplateCreator.tsx:161:60` (fetch); `src/components/WhatsAppChat.tsx:1299:70` (fetch); `src/components/admin/CarouselTemplatesLadder.tsx:293:64` (invoke); `src/components/admin/SimpleTemplatesPanel.tsx:65:49` (comment); `src/components/admin/SimpleTemplatesPanel.tsx:124:60` (fetch); `src/components/chat/BulkMessageDialog.tsx:88:64` (invoke); `src/components/events/EventBulkSendDialog.tsx:204:36` (invoke); `src/components/events/EventCrossellDialog.tsx:199:64` (invoke); `src/components/events/MetaTemplateConfigurator.tsx:85:12` (other); `src/components/events/OtpAccessCodeSettingsDialog.tsx:67:57` (invoke); `src/components/live/LiveWhatsAppChatDialog.tsx:273:64` (invoke); `src/components/marketing/AutomationFlowBuilder.tsx:690:78` (fetch); `src/components/marketing/LiveCampaignsManager.tsx:95:57` (invoke); `src/components/marketing/MassTemplateDispatcher.tsx:602:60` (fetch); `src/components/pos/NewConversationDialog.tsx:159:57` (invoke); `src/components/pos/POSSendTemplateDialog.tsx:54:57` (invoke); `src/components/pos/POSTaskManagerDialog.tsx:463:32` (invoke); `src/components/pos/automation/CampaignBuilder.tsx:188:70` (invoke); `src/components/pos/automation/CampaignBuilder.tsx:369:66` (invoke); `src/lib/pos/carouselTemplate.ts:82:4` (comment); `src/pages/Chat.tsx:757:70` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `meta-whatsapp-send`

- src: 16 — `src/components/DashboardChatPanel.tsx:330:42` (invoke); `src/components/GlobalWhatsAppChat.tsx:195:60` (invoke); `src/components/GlobalWhatsAppChat.tsx:225:66` (invoke); `src/components/LiveSessionManager.tsx:381:60` (invoke); `src/components/WhatsAppChat.tsx:512:70` (fetch); `src/components/live/LiveWhatsAppChatDialog.tsx:116:55` (comment); `src/components/pos/NewConversationDialog.tsx:333:40` (invoke); `src/components/pos/NewConversationDialog.tsx:420:46` (invoke); `src/components/pos/POSSaleDetailDialog.tsx:301:55` (config); `src/components/pos/POSSaleDetailDialog.tsx:575:55` (config); `src/components/pos/POSShipments.tsx:309:55` (config); `src/hooks/chat/useChatSender.ts:128:68` (invoke); `src/lib/pos/posWhatsappSend.ts:74:62` (invoke); `src/lib/pos/posWhatsappSend.ts:108:62` (invoke); `src/lib/pos/posWhatsappSend.ts:153:62` (invoke); `src/pages/Chat.tsx:572:68` (fetch).
- outras funções: 39 — `supabase/functions/_shared/access-code.ts:125:48` (fetch); `supabase/functions/_shared/ads-tools.ts:1098:71` (fetch); `supabase/functions/_shared/automation-send.ts:72:58` (fetch); `supabase/functions/_shared/automation-send.ts:142:56` (fetch); `supabase/functions/_shared/refund-receipt-send.ts:113:42` (config); `supabase/functions/automation-dispatch-audience/index.ts:821:72` (fetch); `supabase/functions/automation-test-flow/index.ts:153:70` (test); `supabase/functions/automation-test-flow/index.ts:381:70` (test); `supabase/functions/automation-trigger-incoming/index.ts:285:56` (fetch); `supabase/functions/automation-trigger-incoming/index.ts:337:58` (fetch); `supabase/functions/automation-trigger-new-lead/index.ts:320:70` (fetch); `supabase/functions/automation-trigger-new-lead/index.ts:361:56` (fetch); `supabase/functions/automation-trigger-pos-sale/index.ts:345:38` (invoke); `supabase/functions/automation-trigger-shopify-purchase/index.ts:120:46` (invoke); `supabase/functions/chat-send-nps/index.ts:76:48` (fetch); `supabase/functions/concierge-respond/index.ts:1284:25` (other); `supabase/functions/concierge-respond/index.ts:1854:19` (other); `supabase/functions/cron-automation-timeouts/index.ts:127:52` (fetch); `supabase/functions/cron-send-scheduled-messages/index.ts:77:34` (other); `supabase/functions/live-campaign-trigger/index.ts:354:55` (config); `supabase/functions/live-campaign-trigger/index.ts:378:55` (config); `supabase/functions/live-campaign-trigger/index.ts:508:57` (config); `supabase/functions/live-catalog/index.ts:301:41` (config); `supabase/functions/live-crossell-blocks/index.ts:95:47` (config); `supabase/functions/live-selfservice/index.ts:104:13` (other); `supabase/functions/livete-order-updated/index.ts:147:50` (fetch); `supabase/functions/livete-order-updated/index.ts:204:56` (fetch); `supabase/functions/livete-payment-confirmation/index.ts:414:57` (fetch); `supabase/functions/livete-respond/index.ts:581:50` (fetch); `supabase/functions/livete-start-order/index.ts:487:50` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:735:82` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:781:72` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:802:70` (fetch); `supabase/functions/meta-whatsapp-webhook/index.ts:815:70` (fetch); `supabase/functions/payment-webhook/index.ts:455:56` (fetch); `supabase/functions/pos-link-payment-confirmation/index.ts:131:50` (fetch); `supabase/functions/referral-mark-sent/index.ts:51:46` (invoke); `supabase/functions/review-send-link/index.ts:80:50` (fetch); `supabase/functions/selfservice-message-worker/index.ts:65:13` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 11.

### `meta-whatsapp-send-template`

- src: 10 — `src/components/LiveSessionManager.tsx:403:58` (invoke); `src/components/WhatsAppChat.tsx:1356:70` (fetch); `src/components/chat/BulkMessageDialog.tsx:162:60` (invoke); `src/components/events/EventCrossellDialog.tsx:302:64` (invoke); `src/components/live/LiveWhatsAppChatDialog.tsx:365:58` (invoke); `src/components/marketing/MassTemplateDispatcher.tsx:1306:82` (fetch); `src/components/pos/NewConversationDialog.tsx:367:42` (invoke); `src/components/pos/POSSendTemplateDialog.tsx:111:40` (invoke); `src/components/pos/automation/CampaignBuilder.tsx:486:64` (invoke); `src/pages/Chat.tsx:826:70` (fetch).
- outras funções: 15 — `supabase/functions/_shared/access-code.ts:102:50` (fetch); `supabase/functions/_shared/automation-send.ts:50:58` (fetch); `supabase/functions/ads-nurture-cron/index.ts:126:48` (invoke); `supabase/functions/automation-test-flow/index.ts:287:68` (test); `supabase/functions/automation-trigger-incoming/index.ts:255:66` (fetch); `supabase/functions/automation-trigger-new-lead/index.ts:249:70` (fetch); `supabase/functions/automation-trigger-pos-sale/index.ts:337:56` (invoke); `supabase/functions/automation-trigger-shopify-purchase/index.ts:96:71` (invoke); `supabase/functions/carousel-campaign-sender/index.ts:10:36` (comment); `supabase/functions/carousel-campaign-sender/index.ts:309:18` (comment); `supabase/functions/carousel-campaign-sender/index.ts:315:52` (fetch); `supabase/functions/cron-automation-timeouts/index.ts:135:52` (fetch); `supabase/functions/event-bulk-send-worker/index.ts:59:65` (fetch); `supabase/functions/event-followup-dispatcher/index.ts:125:64` (fetch); `supabase/functions/live-campaign-dispatch/index.ts:135:63` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `meta-whatsapp-upload-header`

- src: 2 — `src/components/MetaTemplateCreator.tsx:272:58` (fetch); `src/components/admin/SimpleTemplatesPanel.tsx:167:60` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `meta-whatsapp-webhook`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/carousel-campaign-sender/index.ts:16:5` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:54:58.547614+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `mp-refund`

- src: 4 — `src/hooks/useCanRefund.ts:6:57` (comment); `src/lib/refundRules.ts:2:44` (comment); `src/lib/refunds.ts:1:29` (comment); `src/lib/refunds.ts:88:60` (invoke).
- outras funções: 4 — `supabase/functions/_shared/refund-gateways/mercadopago.ts:1:52` (comment); `supabase/functions/_shared/refund-list.ts:1:33` (comment); `supabase/functions/_shared/refund-post-actions.ts:2:24` (comment); `supabase/functions/austpay-refund/index.ts:4:27` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `nfce-cancelar`

- src: 1 — `src/components/fiscal/CancelFiscalDocDialog.tsx:32:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `nfce-emitir`

- src: 7 — `src/components/pos/POSPickupOrders.tsx:273:64` (invoke); `src/components/pos/POSSaleDetailDialog.tsx:490:46` (config); `src/components/pos/POSSaleDetailDialog.tsx:513:53` (config); `src/components/pos/POSSalesView.tsx:1300:42` (invoke); `src/components/pos/POSSalesView.tsx:1301:52` (other); `src/components/pos/POSSalesView.tsx:1518:64` (invoke); `src/pages/admin/FiscalDocuments.tsx:44:64` (invoke).
- outras funções: 6 — `supabase/functions/fiscal-backfill-xml/index.ts:5:34` (comment); `supabase/functions/nfce-retry-pending/index.ts:4:13` (comment); `supabase/functions/nfce-retry-pending/index.ts:4:66` (comment); `supabase/functions/nfce-retry-pending/index.ts:59:50` (comment); `supabase/functions/nfce-retry-pending/index.ts:62:75` (fetch); `supabase/functions/nfe-emitir/index.ts:4:40` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `nfce-inutilizar`

- src: 1 — `src/components/fiscal/InutilizarFiscalDialog.tsx:53:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `nfce-poll-sefaz`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 24 `nfce-poll-sefaz-10min` (`*/10 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- Última chamada observada em access_log: 2026-11-05T04:00:04.963041+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `nfce-retry-pending`

- src: 1 — `src/pages/admin/FiscalDocuments.tsx:73:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 1 — 23 `nfce-retry-pending` (`*/5 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T04:00:04.659312+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `nfe-devolucao-emitir`

- src: 1 — `src/lib/pos/finalizeExchange.ts:111:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `nfe-emitir`

- src: 8 — `src/components/expedition/ExpeditionOrdersList.tsx:408:64` (invoke); `src/components/fiscal/EmitNfeButton.tsx:62:64` (invoke); `src/components/pos/FinalizeExchangePicker.tsx:734:82` (invoke); `src/components/pos/POSSaleDetailDialog.tsx:490:31` (config); `src/components/pos/POSSaleDetailDialog.tsx:513:38` (config); `src/components/pos/POSShipments.tsx:280:64` (invoke); `src/components/pos/expedition/ExpConferenceDialog.tsx:312:54` (invoke); `src/lib/pos/exchangeNfe.ts:99:60` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 5.

### `nfe-link-items-pos`

- src: 2 — `src/components/inventory/NfeDetailEditor.tsx:240:64` (invoke); `src/components/inventory/NfeDetailEditor.tsx:266:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `nfe-manifestar`

- src: 1 — `src/pages/admin/NfeReceived.tsx:72:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `nfe-puxar-destinadas`

- src: 1 — `src/pages/admin/NfeReceived.tsx:52:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 1 — 25 `nfe-puxar-destinadas-diario` (`0 6 * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pagarme-create-charge`

- src: 9 — `src/components/checkout/PaymentSection.tsx:787:64` (invoke); `src/pages/StoreCheckout.tsx:912:64` (invoke); `src/test/paymentConfirmStep.test.tsx:6:161` (test); `src/test/paymentConfirmStep.test.tsx:51:72` (test); `src/test/paymentConfirmStep.test.tsx:59:21` (test); `src/test/paymentConfirmStep.test.tsx:71:62` (test); `src/test/paymentConfirmStep.test.tsx:85:62` (test); `src/test/paymentStorage.test.tsx:6:97` (test); `src/test/paymentStorage.test.tsx:30:79` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pagarme-webhook`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- **ZERO referências internas: candidata a desativar**, somente triagem; webhook externo?; não desativada.

### `payment-confirmed-hook`

- src: 2 — `src/components/pos/POSPickupOrders.tsx:247:42` (invoke); `src/stores/dbOrderStore.ts:19:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `payment-incident-audit`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `payment-webhook`

- src: 3 — `src/components/admin/MercadoPagoAccountsManager.tsx:159:69` (comment); `src/stores/dbOrderStore.ts:31:19` (other); `src/stores/dbOrderStore.ts:33:21` (other).
- outras funções: 9 — `supabase/functions/mercadopago-create-boleto/index.ts:250:54` (fetch); `supabase/functions/mercadopago-create-boleto/index.ts:317:58` (fetch); `supabase/functions/mercadopago-create-pix/index.ts:408:54` (fetch); `supabase/functions/mercadopago-poll-pending/index.ts:90:50` (fetch); `supabase/functions/mercadopago-poll-pending/index.ts:109:50` (fetch); `supabase/functions/pagarme-create-charge/index.ts:394:75` (fetch); `supabase/functions/pagarme-create-charge/index.ts:807:71` (fetch); `supabase/functions/split-payment/index.ts:181:73` (fetch); `supabase/functions/split-payment/index.ts:243:73` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `supabase/functions/mercadopago-create-boleto/index.ts:250` → `/functions/v1/payment-webhook`; `supabase/functions/mercadopago-create-boleto/index.ts:317` → `/functions/v1/payment-webhook`; `supabase/functions/mercadopago-create-pix/index.ts:408` → `/functions/v1/payment-webhook`; `supabase/functions/mercadopago-poll-pending/index.ts:90` → `/functions/v1/payment-webhook`; `supabase/functions/mercadopago-poll-pending/index.ts:109` → `/functions/v1/payment-webhook`; `supabase/functions/pagarme-create-charge/index.ts:394` → `/functions/v1/payment-webhook`; `supabase/functions/pagarme-create-charge/index.ts:807` → `/functions/v1/payment-webhook`; `supabase/functions/split-payment/index.ts:181` → `/functions/v1/payment-webhook`; `supabase/functions/split-payment/index.ts:243` → `/functions/v1/payment-webhook`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `paypal-create-order`

- src: 3 — `src/components/LiveSessionManager.tsx:1688:105` (invoke); `src/components/OrderDialogDb.tsx:494:64` (invoke); `src/components/pos/POSOnlineSales.tsx:417:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `paypal-get-order`

- src: 1 — `src/pages/Checkout.tsx:516:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `paypal-webhook`

- src: 1 — `src/pages/Checkout.tsx:558:64` (invoke).
- outras funções: 1 — `supabase/functions/paypal-create-order/index.ts:116:52` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `supabase/functions/paypal-create-order/index.ts:116` → `/functions/v1/paypal-webhook`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `point-create-order`

- src: 3 — `src/components/pos/PointChargeDialog.tsx:147:64` (invoke); `src/components/pos/PointChargeDialog.tsx:181:64` (invoke); `src/components/pos/PointChargeDialog.tsx:217:57` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 6.

### `point-terminals`

- src: 3 — `src/components/admin/PointTerminalsPanel.tsx:48:64` (invoke); `src/components/admin/PointTerminalsPanel.tsx:72:64` (invoke); `src/components/pos/PointChargeDialog.tsx:123:16` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `point-webhook`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 7.
- **ZERO referências internas: candidata a desativar**, somente triagem; webhook externo?; não desativada.

### `pos-add-variants`

- src: 1 — `src/components/inventory/ProductEditDialog.tsx:530:83` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-boleto-pdf`

- src: 2 — `src/components/pos/POSGenerateBoletoDialog.tsx:134:64` (invoke); `src/components/pos/POSGenerateBoletoDialog.tsx:368:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-clone-product-to-store`

- src: 2 — `src/pages/Inventory.tsx:563:66` (invoke); `src/pages/Inventory.tsx:624:72` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-conditional-create`

- src: 1 — `src/components/pos/POSSalesView.tsx:913:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `pos-conditional-finalize`

- src: 1 — `src/components/pos/POSSalesView.tsx:988:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `pos-customer-360-insights`

- src: 1 — `src/components/pos/POSCustomer360.tsx:336:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `pos-exchange-stock-adjust`

- src: 1 — `src/components/pos/POSExchanges.tsx:316:64` (invoke).
- outras funções: 1 — `supabase/functions/_shared/access-log-data.ts:25:82` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:56.73041+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `pos-expedition-test-orders`

- src: 1 — `src/components/pos/expedition/POSExpedition.tsx:173:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-inter-store-stock-transfer`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `pos-link-payment-confirmation`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 1 — `public.trg_pos_sale_completed_automation`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260929083652_b2d528bb-fba3-41c0-b4fd-1d250d772b8a.sql:16:77`.
- Autorreferências excluídas: 1.

### `pos-sales-enrich-shipping`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `pos-site-exchange-finalize`

- src: 1 — `src/components/pos/POSSalesView.tsx:1256:84` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `pos-stock-balance`

- src: 4 — `src/components/inventory/ProductStockManagerDialog.tsx:171:64` (invoke); `src/components/pos/POSStockBalance.tsx:124:64` (invoke); `src/lib/pos/finalizeExchange.ts:213:44` (invoke); `src/pages/ProductStockManager.tsx:233:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-stock-movement`

- src: 4 — `src/components/inventory/GradeStockEntryDialog.tsx:271:64` (invoke); `src/components/inventory/MultiStoreBalanceDialog.tsx:62:68` (invoke); `src/components/inventory/UnifiedProductsList.tsx:1211:64` (invoke); `src/components/pos/expedition/ExpStockAdjustDialog.tsx:89:66` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-stock-transfer`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `pos-stock-transfer-v2`

- src: 4 — `src/components/inventory/UnifiedProductsList.tsx:1244:64` (invoke); `src/components/pos/POSInterStoreRequests.tsx:197:97` (invoke); `src/components/pos/expedition/ExpStockAdjustDialog.tsx:74:66` (invoke); `src/components/pos/transfer/POSStockTransfer.tsx:25:60` (invoke).
- outras funções: 4 — `supabase/functions/pos-inter-store-stock-transfer/index.ts:2:63` (comment); `supabase/functions/pos-inter-store-stock-transfer/index.ts:7:87` (other); `supabase/functions/pos-stock-transfer/index.ts:2:63` (comment); `supabase/functions/pos-stock-transfer/index.ts:7:87` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `pos-task-dispatch-cron`

- src: 1 — `src/components/pos/POSTaskManagerDialog.tsx:528:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 1 — 46 `pos-task-dispatch-every-5min` (`*/5 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260611165347_d795df03-ef42-4b56-90f5-14f796348da5.sql:13:71`.
- Autorreferências excluídas: 2.
- Última chamada observada em access_log: 2026-11-05T04:00:04.746574+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `pos-tasks-generate`

- src: 3 — `src/hooks/usePosTasksByDate.ts:90:42` (invoke); `src/hooks/useSellerTasks.ts:95:40` (invoke); `src/lib/sellerTasks/recurrence.ts:2:43` (comment).
- outras funções: 1 — `supabase/functions/pos-task-dispatch-cron/index.ts:116:32` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `pos-tiny-create-sale`

- src: 1 — `src/components/pos/POSSalesView.tsx:1114:62` (fetch).
- outras funções: 1 — `supabase/functions/pos-site-exchange-finalize/index.ts:4:9` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `pos-tiny-delete-sale`

- src: 3 — `src/components/pos/POSSaleDetailDialog.tsx:649:65` (fetch); `src/components/pos/POSSaleDetailDialog.tsx:706:62` (fetch); `src/components/pos/POSSaleDetailDialog.tsx:1013:62` (fetch).
- outras funções: 1 — `supabase/functions/_shared/access-log-data.ts:25:45` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:56.843408+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `pos-tiny-payment-methods`

- src: 2 — `src/components/pos/POSPickupOrders.tsx:142:62` (fetch); `src/components/pos/POSSalesView.tsx:369:62` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `pos-tiny-sellers`

- src: 1 — `src/components/pos/POSConfig.tsx:1127:76` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `pos-tiny-sync-products`

- src: 2 — `src/components/pos/POSConfig.tsx:874:49` (fetch); `src/components/pos/POSConfig.tsx:961:43` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:53:57.72847+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `pos-validate-coupon`

- src: 2 — `src/components/pos/POSSalesView.tsx:216:64` (invoke); `src/components/pos/POSWhatsAppCheckoutDialog.tsx:203:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `produto-ativo`

- src: 1 — `src/test/securityAccessLog.test.ts:15:190` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `push-notifications`

- src: 4 — `src/components/marketing/PushNotificationPanel.tsx:38:60` (fetch); `src/components/marketing/PushNotificationPanel.tsx:57:60` (fetch); `src/pages/LiveConsumidorLP.tsx:59:60` (fetch); `src/pages/LiveConsumidorLP.tsx:98:42` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260604103935_14034902-36ba-4a5e-bc17-d1b383c95275.sql:16:74`.
- Autorreferências excluídas: 1.

### `referral-create`

- src: 1 — `src/pages/ReviewReferralPage.tsx:88:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `referral-detect-incoming`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/meta-whatsapp-webhook/index.ts:532:69` (fetch); `supabase/functions/uazapi-webhook/index.ts:803:37` (fetch); `supabase/functions/zapi-webhook/index.ts:445:67` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `referral-mark-sent`

- src: 1 — `src/pages/ReviewReferralPage.tsx:117:55` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `referral-validate-coupon`

- src: 1 — `src/components/pos/POSSalesView.tsx:1312:48` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `review-load`

- src: 2 — `src/pages/ReviewReferralPage.tsx:53:57` (invoke); `src/pages/ReviewReferralPage.tsx:126:61` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `review-send-link`

- src: 1 — `src/components/pos/POSWhatsApp.tsx:3060:42` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `review-submit`

- src: 1 — `src/pages/ReviewReferralPage.tsx:69:56` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `review-token-create`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `rfm-recalculate`

- src: 3 — `src/pages/AIAgents.tsx:178:64` (invoke); `src/pages/Marketing.tsx:876:82` (fetch); `src/pages/Marketing.tsx:1082:84` (fetch).
- outras funções: 1 — `supabase/functions/sync-pos-shopify-to-rfm/index.ts:316:65` (fetch).
- cron.job: 1 — 36 `calculate-rfm-weekly` (`0 9 * * 1`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `sale-freight-quote`

- src: 2 — `src/components/pos/expedition/ExpFreightQuotePanel.tsx:33:52` (config); `src/components/pos/expedition/ExpFreightQuotePanel.tsx:39:69` (config).
- outras funções: 1 — `supabase/functions/AGENTS.md:6:176` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `security-auth-event`

- src: 2 — `src/components/SecuritySessionLogger.tsx:14:56` (invoke); `src/pages/Home.tsx:165:37` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:51:29.831372+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `selfservice-message-worker`

- src: 0 — nenhuma.
- outras funções: 5 — `supabase/functions/live-catalog-invite/index.ts:108:35` (fetch); `supabase/functions/live-catalog/index.ts:290:39` (fetch); `supabase/functions/live-selfservice/index.ts:200:37` (fetch); `supabase/functions/live-selfservice/index.ts:219:37` (fetch); `supabase/functions/livete-payment-confirmation/index.ts:381:46` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 2 — `public.live_catalog_invites_tick`, `public.selfservice_notify_late_order`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `send-email`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `shipment-frenet-webhook`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; webhook externo?; não desativada.

### `shipment-tracking-public`

- src: 1 — `src/pages/PublicTracking.tsx:44:100` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-backfill-customers`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `shopify-cancel-live-order`

- src: 1 — `src/components/LiveSessionManager.tsx:326:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-create-draft-order`

- src: 1 — `src/pages/CustomerRegister.tsx:332:23` (other).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-create-live-order`

- src: 2 — `src/components/LiveSessionManager.tsx:1211:86` (invoke); `src/pages/TransparentCheckout.tsx:1409:49` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-create-order`

- src: 3 — `src/components/OrderCardDb.tsx:442:64` (invoke); `src/components/OrderDialogDb.tsx:582:64` (invoke); `src/pages/TransparentCheckout.tsx:1443:45` (comment).
- outras funções: 2 — `supabase/functions/shopify-update-event-order/index.ts:24:13` (comment); `supabase/functions/shopify-update-event-order/index.ts:85:64` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-create-test-product`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `shopify-delete-event-order`

- src: 2 — `src/components/OrderCardDb.tsx:473:64` (invoke); `src/components/OrderCardDb.tsx:489:64` (invoke).
- outras funções: 2 — `supabase/functions/shopify-update-event-order/index.ts:23:13` (comment); `supabase/functions/shopify-update-event-order/index.ts:70:61` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `shopify-get-variant-sku`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `shopify-link-products`

- src: 2 — `src/components/inventory/ShopifyLinkManager.tsx:63:64` (invoke); `src/components/inventory/ShopifyLinkManager.tsx:90:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-live-duplicate-review`

- src: 1 — `src/components/LiveSessionManager.tsx:307:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-mirror-stock`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/pos-site-exchange-finalize/index.ts:9:36` (comment); `supabase/functions/pos-site-exchange-finalize/index.ts:257:38` (invoke).
- cron.job: 0 — nenhuma.
- SQL atual: 3 — `public.apply_online_order_stock_movement`, `public.apply_pos_sale_stock_movement`, `public.process_pos_sale_sale_event`.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 13 — `supabase/migrations/20260611022035_260be982-3577-4e6f-b9f0-c61ad548b933.sql:255:73`; `supabase/migrations/20260619032353_93831cb4-af99-42d5-9a68-2e8c84c36f33.sql:167:73`; `supabase/migrations/20260619032933_d642c5eb-a2c0-413f-86d1-bc8931a38db7.sql:162:73`; `supabase/migrations/20260619032933_d642c5eb-a2c0-413f-86d1-bc8931a38db7.sql:287:77`; `supabase/migrations/20260619034240_0946f6e6-bc61-4e50-8d73-781899d1bf09.sql:232:73`; `supabase/migrations/20260621025320_b35b8615-1c3c-4fa6-8581-3c5cd3c28c80.sql:112:73`; `supabase/migrations/20260703210533_ae765558-1596-4200-b6ba-c5f2776fc75b.sql:199:73`; `supabase/migrations/20260703210533_ae765558-1596-4200-b6ba-c5f2776fc75b.sql:323:77`; `supabase/migrations/20260703210533_ae765558-1596-4200-b6ba-c5f2776fc75b.sql:408:73`; `supabase/migrations/20260716153659_3b9ae323-fd2f-41f6-864d-2d061ab4b6be.sql:206:73`; `supabase/migrations/20260721201147_8a0d440d-18be-4847-a2e8-4fc6b08480ed.sql:108:73`; `supabase/migrations/20260723205927_8f9e7910-a8b3-4299-9751-3280cdc83d99.sql:112:73`; `supabase/migrations/20260724130915_2ae9539f-3a47-431e-b543-cbdf18581867.sql:111:73`.
- Autorreferências excluídas: 5.

### `shopify-oauth-callback`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/shopify-oauth-install/index.ts:9:52` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `supabase/functions/shopify-oauth-install/index.ts:9` → `/functions/v1/shopify-oauth-callback`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-oauth-install`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; URL pública/externa? revisar; não desativada.

### `shopify-pull-order-customer`

- src: 1 — `src/components/pos/POSSaleDetailDialog.tsx:973:62` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `shopify-reconcile-cron`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 60 `shopify-reconcile-stock-15min` (`*/15 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.
- Última chamada observada em access_log: 2026-11-05T04:02:00.459366+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `shopify-reconcile-stock`

- src: 0 — nenhuma.
- outras funções: 2 — `supabase/functions/shopify-reconcile-cron/index.ts:4:44` (comment); `supabase/functions/shopify-reconcile-cron/index.ts:39:59` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.
- Última chamada observada em access_log: 2026-11-05T04:02:00.358619+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `shopify-sync-to-pos`

- src: 1 — `src/components/pos/POSGeneralDashboard.tsx:388:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 1 — 29 `shopify-sync-to-pos-15min` (`*/15 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:00:05.209588+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `shopify-update-event-order`

- src: 1 — `src/components/OrderCardDb.tsx:506:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `shopify-verify-event-orders`

- src: 2 — `src/pages/Events.tsx:202:70` (invoke); `src/pages/Events.tsx:227:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `shopify-webhook`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- **ZERO referências internas: candidata a desativar**, somente triagem; webhook externo?; não desativada.

### `split-payment`

- src: 7 — `src/components/ChatPixButton.tsx:83:54` (invoke); `src/components/checkout/SplitPartsSummary.tsx:90:64` (invoke); `src/components/checkout/SplitPaymentPanel.tsx:40:60` (invoke); `src/components/checkout/SplitPaymentSetupButton.tsx:26:60` (invoke); `src/components/pos/MarkCheckoutPaidDialog.tsx:48:60` (invoke); `src/components/pos/POSOnlineSales.tsx:516:91` (invoke); `src/components/pos/POSWhatsAppCheckoutDialog.tsx:291:89` (invoke).
- outras funções: 1 — `supabase/functions/payment-webhook/index.ts:2:64` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 5.

### `sync-master-product-stock`

- src: 2 — `src/components/inventory/LegacyProductsList.tsx:383:64` (invoke); `src/components/inventory/LegacyProductsList.tsx:409:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `sync-pos-shopify-to-rfm`

- src: 1 — `src/pages/Marketing.tsx:891:82` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 1 — 38 `sync-pos-shopify-to-rfm-hourly` (`15 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260706184347_040af2ab-7ba9-4947-a96a-6fb1c1c34397.sql:8:40`.
- Autorreferências excluídas: 1.

### `telegram-financial-admin`

- src: 3 — `src/components/management/FinancialAgentSettings.tsx:34:64` (invoke); `src/components/management/FinancialAgentSettings.tsx:56:64` (invoke); `src/components/management/FinancialAgentSettings.tsx:67:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `telegram-financial-process-attachment`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/telegram-financial-webhook/index.ts:1214:41` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `telegram-financial-webhook`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/telegram-financial-admin/index.ts:44:56` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `supabase/functions/telegram-financial-admin/index.ts:44` → `/functions/v1/telegram-financial-webhook`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `uazapi-add-contact`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `uazapi-backfill-contacts`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 1 — 44 `uazapi-backfill-contacts-centro` (`* * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:01.041878+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `uazapi-backfill-status`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `uazapi-check-number`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `uazapi-delete-status`

- src: 1 — `src/components/pos/POSStatusDialog.tsx:108:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `uazapi-groups`

- src: 7 — `src/components/marketing/CampaignDetailPanel.tsx:1385:66` (invoke); `src/components/marketing/GroupMembersDialog.tsx:169:64` (invoke); `src/components/marketing/GroupsVipManager.tsx:177:64` (invoke); `src/components/marketing/GroupsVipManager.tsx:203:45` (config); `src/lib/marketing/instanceGroups.ts:30:41` (config); `src/lib/marketing/instanceGroups.ts:66:14` (comment); `src/lib/marketing/instanceGroups.ts:87:62` (invoke).
- outras funções: 16 — `supabase/functions/auto-create-vip-group/index.ts:8:37` (comment); `supabase/functions/auto-create-vip-group/index.ts:109:31` (config); `supabase/functions/auto-create-vip-group/index.ts:182:33` (config); `supabase/functions/group-admin-worker/index.ts:14:18` (comment); `supabase/functions/group-admin-worker/index.ts:79:42` (other); `supabase/functions/group-admin-worker/index.ts:80:51` (other); `supabase/functions/group-admin-worker/index.ts:81:45` (other); `supabase/functions/group-admin-worker/index.ts:82:56` (other); `supabase/functions/group-admin-worker/index.ts:83:55` (other); `supabase/functions/group-admin-worker/index.ts:84:47` (other); `supabase/functions/group-admin-worker/index.ts:85:49` (other); `supabase/functions/group-admin-worker/index.ts:86:48` (other); `supabase/functions/group-admin-worker/index.ts:87:51` (other); `supabase/functions/group-admin-worker/index.ts:88:54` (other); `supabase/functions/group-dispatch-worker/index.ts:48:58` (fetch); `supabase/functions/group-dispatch-worker/index.ts:225:24` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 8.

### `uazapi-message-actions`

- src: 2 — `src/components/pos/POSWhatsApp.tsx:1943:46` (invoke); `src/components/pos/POSWhatsApp.tsx:1994:46` (invoke).
- outras funções: 1 — `supabase/functions/zapi-delete-message/index.ts:34:43` (config).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `uazapi-presence`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `uazapi-resync-chat`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 5.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `uazapi-send-buttons`

- src: 2 — `src/components/WhatsAppChat.tsx:1631:68` (invoke); `src/lib/pos/posWhatsappSend.ts:166:62` (invoke).
- outras funções: 3 — `supabase/functions/live-crossell-blocks/index.ts:99:28` (other); `supabase/functions/live-selfservice/index.ts:100:13` (other); `supabase/functions/selfservice-message-worker/index.ts:61:13` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `uazapi-send-extra`

- src: 1 — `src/components/chat/ChatExtraSender.tsx:128:43` (config).
- outras funções: 2 — `supabase/functions/group-dispatch-worker/index.ts:183:48` (other); `supabase/functions/group-dispatch-worker/index.ts:212:24` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `uazapi-send-media`

- src: 4 — `src/components/WhatsAppChat.tsx:432:66` (invoke); `src/components/pos/NewConversationDialog.tsx:337:40` (invoke); `src/hooks/chat/useChatSender.ts:163:37` (config); `src/lib/pos/posWhatsappSend.ts:123:10` (other).
- outras funções: 4 — `supabase/functions/_shared/refund-receipt-send.ts:114:37` (other); `supabase/functions/group-dispatch-worker/index.ts:219:24` (other); `supabase/functions/live-crossell-blocks/index.ts:101:48` (other); `supabase/functions/uazapi-webhook/index.ts:291:40` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `uazapi-send-message`

- src: 5 — `src/components/WhatsAppChat.tsx:440:64` (invoke); `src/components/pos/NewConversationDialog.tsx:428:46` (invoke); `src/hooks/chat/useChatSender.ts:163:59` (config); `src/lib/pos/posWhatsappSend.ts:82:10` (other); `src/lib/pos/trackingSend.ts:56:60` (invoke).
- outras funções: 8 — `supabase/functions/_shared/meta-fallback.ts:101:44` (config); `supabase/functions/cron-send-scheduled-messages/index.ts:78:38` (other); `supabase/functions/group-dispatch-worker/index.ts:230:22` (other); `supabase/functions/live-catalog/index.ts:301:140` (config); `supabase/functions/live-crossell-blocks/index.ts:95:70` (config); `supabase/functions/live-selfservice/index.ts:106:89` (other); `supabase/functions/selfservice-message-worker/index.ts:67:89` (other); `supabase/functions/uazapi-webhook/index.ts:273:40` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `uazapi-send-status`

- src: 1 — `src/components/pos/POSStatusDialog.tsx:171:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `uazapi-session`

- src: 13 — `src/components/admin/UazapiInstanceManager.tsx:144:64` (invoke); `src/components/admin/UazapiInstanceManager.tsx:192:63` (invoke); `src/components/admin/UazapiInstanceManager.tsx:198:63` (invoke); `src/components/admin/UazapiInstanceManager.tsx:220:57` (invoke); `src/components/admin/UazapiInstanceManager.tsx:235:63` (invoke); `src/components/admin/UazapiInstanceManager.tsx:253:64` (invoke); `src/components/admin/UazapiInstanceManager.tsx:268:57` (invoke); `src/components/admin/UazapiInstanceManager.tsx:287:40` (invoke); `src/components/admin/UazapiInstanceManager.tsx:325:40` (invoke); `src/components/admin/UazapiInstanceManager.tsx:339:57` (invoke); `src/components/admin/UazapiInstanceManager.tsx:367:57` (invoke); `src/components/admin/UazapiInstanceManager.tsx:406:57` (invoke); `src/components/admin/UazapiInstanceManager.tsx:437:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `uazapi-webhook`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/uazapi-resync-chat/index.ts:46:35` (comment); `supabase/functions/uazapi-resync-chat/index.ts:61:21` (comment); `supabase/functions/uazapi-session/index.ts:72:55` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `supabase/functions/uazapi-session/index.ts:72` → `/functions/v1/uazapi-webhook`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 19.

### `unify-customers-backfill`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `update-master-product-shopify`

- src: 3 — `src/components/inventory/LegacyProductsList.tsx:363:64` (invoke); `src/components/inventory/LegacyProductsList.tsx:473:43` (config); `src/test/shopifySafeUpdate.test.ts:2:102` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `vip-go`

- src: 1 — `src/pages/VipGoRedirect.tsx:10:85` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: URL pública/externa? revisar; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `vip-orphan-dispatch`

- src: 2 — `src/components/marketing/OrphanDispatchPanel.tsx:109:53` (invoke); `src/components/marketing/OrphanDispatchPanel.tsx:118:54` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 1 — `supabase/migrations/20260715174126_2ac9ea67-f210-4dc3-aea6-fc4fa638e12b.sql:109:27`.
- Autorreferências excluídas: 4.

### `vps-dispatch-proxy`

- src: 2 — `src/components/marketing/DispatchHistoryList.tsx:472:64` (invoke); `src/components/marketing/MassTemplateDispatcher.tsx:1585:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `wasender-check-number`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `wasender-groups`

- src: 2 — `src/components/marketing/GroupsVipManager.tsx:203:63` (config); `src/lib/marketing/instanceGroups.ts:30:59` (config).
- outras funções: 7 — `supabase/functions/group-admin-worker/index.ts:17:18` (comment); `supabase/functions/group-admin-worker/index.ts:98:29` (other); `supabase/functions/group-admin-worker/index.ts:100:49` (other); `supabase/functions/group-admin-worker/index.ts:101:48` (other); `supabase/functions/group-admin-worker/index.ts:102:51` (other); `supabase/functions/group-admin-worker/index.ts:103:54` (other); `supabase/functions/group-dispatch-worker/index.ts:205:24` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 7.

### `wasender-message-actions`

- src: 2 — `src/components/pos/POSWhatsApp.tsx:1947:46` (invoke); `src/components/pos/POSWhatsApp.tsx:1998:46` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `wasender-presence`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `wasender-send-extra`

- src: 2 — `src/components/chat/ChatExtraSender.tsx:36:65` (comment); `src/components/chat/ChatExtraSender.tsx:128:65` (config).
- outras funções: 2 — `supabase/functions/group-dispatch-worker/index.ts:183:70` (other); `supabase/functions/group-dispatch-worker/index.ts:194:24` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `wasender-send-media`

- src: 4 — `src/components/WhatsAppChat.tsx:482:66` (invoke); `src/components/pos/NewConversationDialog.tsx:335:40` (invoke); `src/hooks/chat/useChatSender.ts:142:37` (config); `src/lib/pos/posWhatsappSend.ts:125:12` (other).
- outras funções: 2 — `supabase/functions/_shared/refund-receipt-send.ts:115:39` (other); `supabase/functions/group-dispatch-worker/index.ts:200:24` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `wasender-send-message`

- src: 5 — `src/components/WhatsAppChat.tsx:490:64` (invoke); `src/components/pos/NewConversationDialog.tsx:424:46` (invoke); `src/hooks/chat/useChatSender.ts:142:61` (config); `src/lib/pos/posWhatsappSend.ts:84:12` (other); `src/lib/pos/posWhatsappSend.ts:176:62` (invoke).
- outras funções: 6 — `supabase/functions/_shared/meta-fallback.ts:101:68` (config); `supabase/functions/cron-send-scheduled-messages/index.ts:79:40` (other); `supabase/functions/group-dispatch-worker/index.ts:207:22` (other); `supabase/functions/live-catalog/index.ts:301:90` (config); `supabase/functions/live-selfservice/index.ts:106:39` (other); `supabase/functions/selfservice-message-worker/index.ts:67:39` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `wasender-session`

- src: 9 — `src/components/admin/WaSenderInstanceManager.tsx:89:64` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:109:63` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:115:63` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:138:57` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:150:63` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:168:64` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:185:57` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:204:40` (invoke); `src/components/admin/WaSenderInstanceManager.tsx:219:40` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 3.

### `wasender-webhook`

- src: 0 — nenhuma.
- outras funções: 3 — `supabase/functions/wasender-session/index.ts:107:57` (fetch); `supabase/functions/wasender-session/index.ts:214:57` (fetch); `supabase/functions/zapi-webhook/index.ts:261:35` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `supabase/functions/wasender-session/index.ts:107` → `/functions/v1/wasender-webhook`; `supabase/functions/wasender-session/index.ts:214` → `/functions/v1/wasender-webhook`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 11.

### `whatsapp-block-contact`

- src: 2 — `src/components/chat/BlockContactButton.tsx:74:64` (invoke); `src/components/chat/ChatView.tsx:312:64` (invoke).
- outras funções: 1 — `supabase/functions/_shared/blocked-guard.ts:15:42` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 4.

### `yampi-create-payment-link`

- src: 2 — `src/components/pos/POSOnlineSales.tsx:400:66` (invoke); `src/lib/yampi.ts:65:62` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `yampi-lookup-sku`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `yampi-webhook`

- src: 1 — `src/lib/yampi.ts:161:57` (comment).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `zapi-connection-status`

- src: 1 — `src/hooks/useZapi.ts:35:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-delete-message`

- src: 3 — `src/components/GlobalWhatsAppChat.tsx:395:60` (invoke); `src/components/WhatsAppChat.tsx:1234:52` (invoke); `src/components/pos/POSWhatsApp.tsx:1959:46` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-edit-message`

- src: 1 — `src/components/pos/POSWhatsApp.tsx:2002:46` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-enable-notify-sent-by-me`

- src: 0 — nenhuma.
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.
- **ZERO referências internas: candidata a desativar**, somente triagem; não confirmada; não desativada.

### `zapi-get-contacts`

- src: 2 — `src/components/marketing/CampaignDetailPanel.tsx:1337:82` (fetch); `src/components/marketing/CreateGroupDialog.tsx:56:60` (fetch).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-group-campaign-execute`

- src: 1 — `src/test/securityAccessLog.test.ts:15:123` (test).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-group-scheduled-send`

- src: 2 — `src/components/marketing/CampaignDetailPanel.tsx:992:66` (fetch); `src/test/groupSendRouting.test.ts:4:64` (test).
- outras funções: 1 — `supabase/functions/cron-scheduled-group-messages/index.ts:66:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-group-settings`

- src: 6 — `src/components/marketing/CampaignDetailPanel.tsx:1392:84` (fetch); `src/components/marketing/CreateGroupDialog.tsx:141:60` (fetch); `src/components/marketing/CreateGroupDialog.tsx:168:62` (fetch); `src/components/marketing/CreateGroupDialog.tsx:183:60` (fetch); `src/lib/marketing/instanceGroups.ts:66:37` (comment); `src/lib/marketing/instanceGroups.ts:106:78` (fetch).
- outras funções: 13 — `supabase/functions/auto-create-vip-group/index.ts:8:60` (comment); `supabase/functions/auto-create-vip-group/index.ts:117:31` (config); `supabase/functions/group-admin-worker/index.ts:16:18` (comment); `supabase/functions/group-admin-worker/index.ts:111:40` (other); `supabase/functions/group-admin-worker/index.ts:112:49` (other); `supabase/functions/group-admin-worker/index.ts:113:43` (other); `supabase/functions/group-admin-worker/index.ts:114:54` (other); `supabase/functions/group-admin-worker/index.ts:115:53` (other); `supabase/functions/group-admin-worker/index.ts:116:47` (other); `supabase/functions/group-admin-worker/index.ts:117:46` (other); `supabase/functions/group-admin-worker/index.ts:118:49` (other); `supabase/functions/group-admin-worker/index.ts:119:52` (other); `supabase/functions/group-admin-worker/index.ts:124:27` (other).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-instance-health-check`

- src: 0 — nenhuma.
- outras funções: 1 — `supabase/functions/zapi-group-scheduled-send/index.ts:143:52` (fetch).
- cron.job: 1 — 37 `zapi-instance-health-check-every-2min` (`*/2 * * * *`, ativo=true).
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T04:04:00.94832+00:00 UTC, HTTP 200, blocked=false. Chamada observada; motivo/identidade não reproduzidos.

### `zapi-list-groups`

- src: 4 — `src/components/marketing/CampaignDashboard.tsx:238:74` (fetch); `src/components/marketing/CampaignDashboard.tsx:348:82` (fetch); `src/components/marketing/GroupsVipManager.tsx:211:84` (fetch); `src/lib/marketing/instanceGroups.ts:38:78` (fetch).
- outras funções: 1 — `supabase/functions/wasender-groups/index.ts:72:71` (comment).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `zapi-profile-picture`

- src: 3 — `src/components/DashboardChatPanel.tsx:223:34` (invoke); `src/components/pos/POSWhatsApp.tsx:810:59` (invoke); `src/components/pos/POSWhatsApp.tsx:845:32` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 2.

### `zapi-qrcode`

- src: 1 — `src/hooks/useZapi.ts:63:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-send-button-list`

- src: 1 — `src/lib/pos/posWhatsappSend.ts:184:60` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
- Última chamada observada em access_log: 2026-11-05T03:54:00.757025+00:00 UTC, HTTP 401, blocked=true. Pode ser teste da Fase 1; não prova uso operacional.

### `zapi-send-group-message`

- src: 0 — nenhuma.
- outras funções: 5 — `supabase/functions/_shared/group-send-routing.ts:67:21` (other); `supabase/functions/group-admin-worker/index.ts:16:41` (comment); `supabase/functions/group-admin-worker/index.ts:121:36` (config); `supabase/functions/group-dispatch-worker/index.ts:255:20` (other); `supabase/functions/zapi-group-campaign-execute/index.ts:93:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-send-media`

- src: 7 — `src/components/DashboardChatPanel.tsx:334:42` (invoke); `src/components/GlobalWhatsAppChat.tsx:231:66` (invoke); `src/components/WhatsAppChat.tsx:590:68` (invoke); `src/components/pos/NewConversationDialog.tsx:339:40` (invoke); `src/hooks/chat/useChatSender.ts:184:37` (config); `src/hooks/useZapi.ts:131:64` (invoke); `src/lib/pos/posWhatsappSend.ts:126:12` (other).
- outras funções: 8 — `supabase/functions/_shared/ads-tools.ts:1110:71` (fetch); `supabase/functions/_shared/ads-tools.ts:1138:78` (fetch); `supabase/functions/_shared/refund-receipt-send.ts:115:63` (other); `supabase/functions/live-campaign-dispatch/index.ts:169:63` (fetch); `supabase/functions/live-campaign-trigger/index.ts:378:78` (config); `supabase/functions/mcp-server/index.ts:567:63` (fetch); `supabase/functions/zapi-webhook/index.ts:827:68` (fetch); `supabase/functions/zapi-webhook/index.ts:863:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 13.

### `zapi-send-message`

- src: 13 — `src/components/GlobalWhatsAppChat.tsx:200:60` (invoke); `src/components/OrderCardDb.tsx:553:44` (invoke); `src/components/WhatsAppChat.tsx:459:64` (invoke); `src/components/chat/BulkMessageDialog.tsx:120:60` (invoke); `src/components/events/EventStockAlerts.tsx:232:40` (invoke); `src/components/marketing/CreateGroupDialog.tsx:208:60` (fetch); `src/components/pos/NewConversationDialog.tsx:432:46` (invoke); `src/components/pos/POSSaleDetailDialog.tsx:301:78` (config); `src/components/pos/POSSaleDetailDialog.tsx:575:78` (config); `src/components/pos/POSShipments.tsx:309:78` (config); `src/hooks/chat/useChatSender.ts:184:57` (config); `src/hooks/useZapi.ts:89:64` (invoke); `src/lib/pos/posWhatsappSend.ts:85:12` (other).
- outras funções: 24 — `supabase/functions/ads-nurture-cron/index.ts:141:48` (invoke); `supabase/functions/ai-agent-customers-cron/index.ts:70:58` (fetch); `supabase/functions/automation-trigger-incoming/index.ts:279:56` (fetch); `supabase/functions/automation-trigger-incoming/index.ts:331:58` (fetch); `supabase/functions/chat-send-nps/index.ts:82:48` (fetch); `supabase/functions/concierge-respond/index.ts:1268:25` (config); `supabase/functions/concierge-respond/index.ts:1838:19` (config); `supabase/functions/cron-send-scheduled-messages/index.ts:80:14` (other); `supabase/functions/live-campaign-dispatch/index.ts:152:63` (fetch); `supabase/functions/live-campaign-trigger/index.ts:354:78` (config); `supabase/functions/live-campaign-trigger/index.ts:508:80` (config); `supabase/functions/live-catalog/index.ts:301:164` (config); `supabase/functions/live-selfservice/index.ts:106:113` (other); `supabase/functions/livete-order-updated/index.ts:153:50` (fetch); `supabase/functions/livete-order-updated/index.ts:210:56` (fetch); `supabase/functions/livete-respond/index.ts:587:50` (fetch); `supabase/functions/livete-start-order/index.ts:493:50` (fetch); `supabase/functions/mcp-server/index.ts:538:63` (fetch); `supabase/functions/payment-webhook/index.ts:461:56` (fetch); `supabase/functions/review-send-link/index.ts:86:50` (fetch); `supabase/functions/selfservice-message-worker/index.ts:67:113` (other); `supabase/functions/zapi-webhook/index.ts:719:54` (fetch); `supabase/functions/zapi-webhook/index.ts:785:62` (fetch); `supabase/functions/zapi-webhook/index.ts:849:66` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-test-connection`

- src: 1 — `src/components/admin/ZApiInstanceManager.tsx:156:64` (invoke).
- outras funções: 0 — nenhuma.
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: não confirmada; caminhos de callback conhecidos: nenhum callback literal classificado; não consultados painéis externos.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.

### `zapi-webhook`

- src: 2 — `src/components/admin/ZApiInstanceManager.tsx:241:92` (fetch); `src/components/admin/ZApiInstanceManager.tsx:245:33` (other).
- outras funções: 7 — `supabase/functions/automation-trigger-incoming/index.ts:25:55` (comment); `supabase/functions/wasender-webhook/index.ts:288:47` (comment); `supabase/functions/wasender-webhook/index.ts:371:38` (comment); `supabase/functions/wasender-webhook/index.ts:374:40` (fetch); `supabase/functions/wasender-webhook/index.ts:381:54` (other); `supabase/functions/zapi-enable-notify-sent-by-me/index.ts:12:52` (comment); `supabase/functions/zapi-enable-notify-sent-by-me/index.ts:32:54` (fetch).
- cron.job: 0 — nenhuma.
- SQL atual: 0 — nenhuma.
- URLs externas/configuração: webhook externo?; caminhos de callback conhecidos: `src/components/admin/ZApiInstanceManager.tsx:241` → `/functions/v1/zapi-webhook`; `supabase/functions/wasender-webhook/index.ts:374` → `/functions/v1/zapi-webhook`; `supabase/functions/zapi-enable-notify-sent-by-me/index.ts:32` → `/functions/v1/zapi-webhook`.
- Migrations (histórico, não somado): 0 — nenhuma.
- Autorreferências excluídas: 1.
