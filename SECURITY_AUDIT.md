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
Uma linha por função local (319). Classificação baseada em fonte/callers literais e cron atual; nomes dinâmicos e validação semântica de todos os ramos podem ficar 'não confirmado'. Autenticação outbound NÃO equivale à de entrada. Cabeçalhos de assinatura identificados não implicam bloqueio obrigatório; detalhes acima prevalecem. Não é um pentest de todos os endpoints.

| Nome | Quem chama | Autenticação atual | Pode fazer | Risco | Recomendação |
|---|---|---|---|---|---|
| `accountant-monthly-package` | cron atual, frontend | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `admin-create-user` | frontend | JWT + admin | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `admin-delete-user` | frontend | JWT + admin | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto |
| `admin-list-users` | frontend | JWT + admin/gerente | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `admin-update-user` | frontend | JWT + admin | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ads-nurture-cron` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `ai-agent-customers` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ai-agent-customers-cron` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `ai-channel-specialist` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ai-classify-transactions` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `ai-group-content` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ai-marketing-master` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ai-marketing-strategy` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ai-secretary` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `ai-stock-analyst` | frontend | JWT verificado + serviço/segredo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto |
| `ai-vip-strategy` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `appmax-install` | desconhecido | JWT ou serviço (guarda legada) | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `appmax-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `austpay-charge-card` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `austpay-create-pix` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `austpay-ping` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `austpay-refund` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `austpay-test-charge` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `austpay-webhook` | webhook gateway/integrador | assinatura/token presente; enforcement a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `auto-create-vip-group` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-ai-ads-respond` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-ai-crosssell` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-ai-respond` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-continue-flow` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-dispatch-audience` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-pos-followups-cron` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-queue-worker` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-test-flow` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `automation-trigger-incoming` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-trigger-new-lead` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-trigger-pos-sale` | RPC/trigger SQL | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `automation-trigger-shopify-purchase` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `backfill-organic-leads` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `backfill-payment-method` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `blocked-buyer-sale-alert` | RPC/trigger SQL, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `brasilnfe-webhook` | frontend, webhook gateway/integrador | assinatura/token presente; enforcement a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `calculate-inventory-health` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `carousel-campaign-run-now` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `carousel-campaign-scheduler` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `carousel-campaign-sender` | cron atual, outra função | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `carousel-ladder-create` | frontend | JWT verificado + serviço/segredo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto |
| `cashback-external` | desconhecido | token integração | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `chat-send-nps` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `checkout-crossell` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `checkout-prize-preview` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `checkout-public` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `checkout-quote-freight` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `concierge-respond` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `consignment-sales-report` | frontend | JWT verificado + serviço/segredo + módulo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto |
| `contact-erase` | frontend | JWT verificado + serviço/segredo + admin | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto |
| `correios-admin` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `correios-reverse` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `correios-shipment` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `create-master-product-pos` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `create-master-product-shopify` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `criar-pedido-externo` | outra função | token compartilhado x-agent-key | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `crm-dedup-customers` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-automation-timeouts` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-check-vip-groups` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-cleanup-status-media` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-inventory-watchdog` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-scheduled-dispatches` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-scheduled-group-messages` | cron atual | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-secretary-reminders` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `cron-send-scheduled-messages` | cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `delete-master-products` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `dispatch-attribution` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `dispatch-orchestrator` | cron atual, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `dispatch-worker` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-bulk-send-enqueue` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-bulk-send-worker` | cron atual, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-followup-dispatcher` | cron atual | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-followup-scheduler` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-lead-capture` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-order-route-to-pos` | RPC/trigger SQL, frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-order-template-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-order-wa-initial-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-prize-wheel` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `event-raffle` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `exchange-reverse-shipping` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-beta-initial-sync` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-check-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-correct-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-enrich-shipping` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-fetch-label` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-quote-freight` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-refresh-orders` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-sync-orders` | frontend | JWT verificado + serviço/segredo + módulo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `expedition-tiny-invoice` | frontend | JWT verificado + serviço/segredo + módulo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto |
| `expedition-transfer-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `expedition-verify-shipped` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `export-audience-csv` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `fiscal-backfill-danfe` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `fiscal-backfill-xml` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `fiscal-recover-by-identifier` | outra função | token interno/cron ou JWT | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `fiscal-render-document` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `fiscal-resign-danfe-urls` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `gateway-payment-lookup` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `group-admin-worker` | SQL histórico, cron atual | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `group-dispatch-worker` | cron atual, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `group-redirect-link` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `ig-live-cart-notify` | RPC/trigger SQL, SQL histórico | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-account-connect` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-comment-reply` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-dm-automation-run` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-dm-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-dm-send-buttons` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-list-media` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-live-sync` | RPC/trigger SQL, SQL histórico, frontend | token interno/cron | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-resend-live-dm` | desconhecido | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-send-bulk-dm` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `instagram-token-refresh` | cron atual, frontend | token interno/cron ou JWT | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `inventory-correct-stock` | frontend, outra função | JWT verificado + serviço/segredo + módulo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto |
| `inventory-verify-and-correct` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `issue-member-magic-link` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `lead-notify-pdv` | outra função | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `legacy-order-webhook` | frontend, webhook gateway/integrador | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `link-page-capture-lead` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `link-page-catalog-sync` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `link-page-public` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `link-page-track-click` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-campaign-dispatch` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-campaign-trigger` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-catalog` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-catalog-invite` | SQL histórico, frontend | token interno/cron ou JWT | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-crossell-blocks` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-member-area` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-process-comment` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-redirect` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-selfservice` | RPC/trigger SQL, SQL histórico, frontend, outra função | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-send-verification` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-verify-code` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `live-whatsapp-redirect` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `livete-order-updated` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `livete-payment-confirmation` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `livete-respond` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `livete-start-order` | RPC/trigger SQL, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `lp-capture-lead` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `marketing-agent-chat` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `marketing-attribution-dashboard` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `marketing-leads-dashboard` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `marketing-ltv-dashboard` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mcp-server` | desconhecido | token compartilhado x-agent-key | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `melhor-envio-test` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mercadopago-check-payment` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mercadopago-create-boleto` | frontend, outra função | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mercadopago-create-pix` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mercadopago-get-public-key` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mercadopago-installments` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `mercadopago-poll-pending` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-ads-list-accounts` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-ads-sync` | cron atual, frontend | token interno/cron ou JWT | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-ads-sync-spend` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `meta-attribution-capture` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-audience-sync` | cron atual, frontend | token interno/cron ou JWT | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-event` | RPC/trigger SQL, SQL histórico, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-lead` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-offline` | RPC/trigger SQL, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-offline-backfill` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-purchase` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-purchase-retry` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-sync-vault` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-test` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-capi-trigger-backfill` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-messenger-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-messenger-webhook` | webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `meta-template-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-whatsapp-create-template` | frontend | JWT verificado + serviço/segredo | consulta/configuração/captura; escopo revisar | médio | Preservar guarda; revisar autorização por objeto |
| `meta-whatsapp-get-templates` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-whatsapp-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-whatsapp-send-template` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-whatsapp-upload-header` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `meta-whatsapp-webhook` | webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `mp-refund` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfce-cancelar` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfce-emitir` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfce-inutilizar` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfce-poll-sefaz` | cron atual | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfce-retry-pending` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfe-devolucao-emitir` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfe-emitir` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfe-link-items-pos` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfe-manifestar` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `nfe-puxar-destinadas` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pagarme-create-charge` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pagarme-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `payment-confirmed-hook` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `payment-incident-audit` | desconhecido | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `payment-webhook` | frontend, outra função, webhook gateway/integrador | assinatura/token presente; enforcement a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `paypal-create-order` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `paypal-get-order` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `paypal-webhook` | frontend, outra função, webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar contrato; validar prova independente |
| `point-create-order` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `point-terminals` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `point-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `pos-add-variants` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-boleto-pdf` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-clone-product-to-store` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-conditional-create` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-conditional-finalize` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-customer-360-insights` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-exchange-stock-adjust` | frontend | JWT verificado + serviço/segredo + módulo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto |
| `pos-expedition-test-orders` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-inter-store-stock-transfer` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-link-payment-confirmation` | RPC/trigger SQL | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-sales-enrich-shipping` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-site-exchange-finalize` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-stock-balance` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-stock-movement` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-stock-transfer` | desconhecido | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-stock-transfer-v2` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-task-dispatch-cron` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-tasks-generate` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-tiny-create-sale` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-tiny-delete-sale` | frontend | JWT verificado + serviço/segredo + módulo | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Preservar guarda; revisar autorização por objeto |
| `pos-tiny-payment-methods` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-tiny-sellers` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `pos-tiny-sync-products` | frontend | JWT verificado + serviço/segredo + módulo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `pos-validate-coupon` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `produto-ativo` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `push-notifications` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `referral-create` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `referral-detect-incoming` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `referral-mark-sent` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `referral-validate-coupon` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `review-load` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `review-send-link` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `review-submit` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `review-token-create` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `rfm-recalculate` | cron atual, frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `sale-freight-quote` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `security-auth-event` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `selfservice-message-worker` | SQL histórico, outra função | token interno/cron | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `send-email` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shipment-frenet-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `shipment-tracking-public` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-backfill-customers` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-cancel-live-order` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-create-draft-order` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-create-live-order` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-create-order` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-create-test-product` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-delete-event-order` | frontend, outra função | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-get-variant-sku` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-link-products` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-live-duplicate-review` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-mirror-stock` | RPC/trigger SQL, outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-oauth-callback` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-oauth-install` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-pull-order-customer` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-reconcile-cron` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-reconcile-stock` | outra função | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-sync-to-pos` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-update-event-order` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-verify-event-orders` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `shopify-webhook` | webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `split-payment` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `sync-master-product-stock` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `sync-pos-shopify-to-rfm` | cron atual, frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `telegram-financial-admin` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `telegram-financial-process-attachment` | outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `telegram-financial-webhook` | outra função, webhook gateway/integrador | assinatura/token presente; enforcement a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `uazapi-add-contact` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-backfill-contacts` | cron atual | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-backfill-status` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-check-number` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-delete-status` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-groups` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-message-actions` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-presence` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-resync-chat` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-send-buttons` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-send-extra` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-send-media` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-send-message` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-send-status` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-session` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `uazapi-webhook` | outra função, webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `unify-customers-backfill` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `update-master-product-shopify` | frontend | JWT presente; ramos/escopo a revisar | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `vip-go` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `vip-orphan-dispatch` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `vps-dispatch-proxy` | frontend | JWT presente; ramos/escopo a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-check-number` | desconhecido | JWT ou serviço (guarda legada) | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-groups` | frontend, outra função | JWT ou serviço (guarda legada) | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-message-actions` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-presence` | desconhecido | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-send-extra` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-send-media` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-send-message` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-session` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `wasender-webhook` | outra função, webhook WhatsApp | assinatura/token presente; enforcement a revisar | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `whatsapp-block-contact` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `yampi-create-payment-link` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `yampi-lookup-sku` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `yampi-webhook` | frontend, webhook gateway/integrador | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |
| `zapi-connection-status` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-delete-message` | frontend | não confirmada; nenhuma guarda explícita detectada | pagamentos/fiscal/estoque/dados (conforme nome e fonte) | crítico | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-edit-message` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-enable-notify-sent-by-me` | desconhecido | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-get-contacts` | frontend | JWT ou serviço (guarda legada) | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-group-campaign-execute` | frontend | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-group-scheduled-send` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-group-settings` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-instance-health-check` | cron atual, outra função | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-list-groups` | frontend | JWT ou serviço (guarda legada) | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-profile-picture` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-qrcode` | frontend | não confirmada; nenhuma guarda explícita detectada | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-send-button-list` | frontend | JWT verificado + serviço/segredo | dados/operações, mensagens, integração ou créditos IA | alto | Preservar guarda; revisar autorização por objeto |
| `zapi-send-group-message` | outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-send-media` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-send-message` | frontend, outra função | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-test-connection` | frontend | JWT presente; ramos/escopo a revisar | consulta/configuração/captura; escopo revisar | médio | Migrar chamadores e exigir JWT/segredo; manter log-only nesta fase |
| `zapi-webhook` | frontend, outra função, webhook WhatsApp | não confirmada; nenhuma guarda explícita detectada | dados/operações, mensagens, integração ou créditos IA | alto | Preservar contrato; validar prova independente |

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
