# Porta de leitura para a VPS (somente leitura)

Só adições. Nada existente é alterado (tabelas, funções, gatilhos, telas, crons).

## 1. Desenho da função `vps-reader`
Um único endpoint, só GET (qualquer outro método = 405). Header `x-vps-reader-key`.

Rotas (parâmetro `op`):
- `op=tables` — lista da allowlist: nome, chave do cursor, se tem incremental, colunas que saem.
- `op=count&table=X[&since=ISO]` — contagem exata (ou estimada para tabelas gigantes com `mode=estimate`), para conferir backup = origem.
- `op=read&table=X&cursor=...&limit=N` — leitura paginada por chave primária (`id > cursor order by id`).
- `op=changes&table=X&since=ISO&cursor=...` — incremental por `(updated_at, id) > (since, cursor_id)` ordenado por `updated_at, id`. Só para tabelas com `updated_at` indexado; as demais usam `created_at` ou só leitura completa (marcado no catálogo).
- `op=health` — tempos de resposta de consultas leves fixas (contagem estimada, ping) para medir lentidão. Sem consulta pesada.

Resposta: `{ table, rows:[...], next_cursor, has_more, server_ms }`. `limit` padrão 200, teto 500 (tabelas de mensagens teto 200). Teto de tempo por chamada (~8s): se aproximar, devolve o que tem com `next_cursor`.

Implementação: cliente de serviço só com `.from(tabela).select(colunas_fixas)` + filtros `gt/gte/order/limit`. Nenhuma `.insert/.update/.delete/.upsert/.rpc` no arquivo (exceto as duas RPCs internas próprias de auditoria/bloqueio abaixo). Nome da tabela e colunas nunca vêm do cliente: o cliente só escolhe uma chave da allowlist; filtros são montados no servidor. Teste automático varre o código e falha se aparecer método de escrita.

## 2. Allowlist (arquivo único `_shared/vps-reader-allowlist.ts`)
Cada entrada: tabela, colunas permitidas (lista explícita, nunca `*`), chave do cursor, coluna incremental.

Incluídas (todas as de negócio), por grupo:
- Vendas/pedidos: orders (sem checkout_token), order items, pos_sales, pos_sale_items, payment_splits, expedition_*, gateway_refunds, chargebacks, cash_flow_entries, bank_transactions, financeiros/DRE.
- Clientes/contatos: customers, customers_unified, customer_registrations, chat_contacts, leads (lp_leads, event_leads sem referral_token, ad_leads), zoppy_customers, ravena_customers.
- Produtos/estoque: pos_products, variações, pos_stock_adjustments, stock labels, transferências, pos_stores (sem tiny_token).
- Eventos/lives: events (sem overlay_token), event_*, live_comments, raffles/prêmios.
- Mensagens: whatsapp_messages, whatsapp_messages_archive, whatsapp_conversations, chat_* , dispatch_history, dispatch_recipients.
- Marketing/configs: campanhas, automações, templates, grupos VIP, ig_comment_moderation.
- Fiscal: fiscal_documents, fiscal_operations, sequências (só metadados, sem XML/certificado se houver coluna de arquivo).
- Logs: access_log, security_events, ai_error_logs, email_send_log.
A lista final completa (uma linha por tabela, ~350) é gerada na implementação a partir do banco, e te mando para conferir antes de ligar.

## 3. Exclusões propostas (para sua aprovação)
Tabelas inteiras fora:
- appmax_installations, mercadopago_accounts, correios_settings, meta_ads_token_state, webhook_signature_state — credenciais de gateway/integração.
- dispatch_links, dispatch_link_sessions, fiscal_access_settings, financial_agent_invite_tokens, financial_agent_sessions, member_area_magic_links, live_member_sessions, support_links, review_tokens, model_number_tokens, live_catalog_links, customer_access_codes — senhas, hashes ou tokens que dão acesso.
- app_settings inteira (pode guardar chaves); se quiser, só uma lista curta de chaves não sensíveis, aprovada por você.
- Tabelas `_backup_*`, `audit_*_tmp`, `_perf_snap`, `central_rate_limits`, `fiscal_access_attempts` — temporárias/internas.
- A própria auditoria da porta (não se lê pela porta).
Colunas cortadas em tabelas incluídas:
- whatsapp_numbers: access_token, zapi_token, zapi_client_token, uazapi_token, wasender_api_key, wasender_webhook_secret (resto sai).
- companies: certificate_password, brasilnfe_token, certificate_path.
- pos_stores: tiny_token. orders: checkout_token. events: overlay_token. live_overlay_templates: fixed_token. event_leads: referral_token. ig_live_cart_notifications: link_token.
- Claims internos (claim_token) saem por não terem valor de backup.
Observação: dados pessoais de clientes (CPF, telefone, endereço) SAEM, porque é backup. Isso torna o segredo da VPS tão sensível quanto o próprio banco (ver riscos).

## 4. Segredo e rotação
- Gerado aleatório (64+ caracteres) como `VPS_READER_SECRET`; você copia de Configurações > Segredos? Não dá para ver valor gerado, então o valor será criado por você (ex. `openssl rand -hex 32`) e salvo nos Segredos, e colocado na VPS.
- Rotação sem queda: aceita `VPS_READER_SECRET` e opcional `VPS_READER_SECRET_NEXT`. Você cria o NEXT, troca na VPS, depois copia para o principal e apaga o NEXT.
- Comparação em tempo constante; sem header ou errado = 401 com corpo vazio genérico.
- Opcional recomendado: allowlist de IP da VPS (`VPS_READER_ALLOWED_IPS`).

## 5. Rate limit e bloqueio
- Tabela nova `vps_reader_guard` (RLS ligada, sem políticas, só serviço): contagem por IP/minuto. 120 chamadas/min válidas; 5 chaves inválidas em 15 min bloqueiam o IP por 1h. Feito por RPC própria atômica (única escrita, só nessa tabela).

## 6. Auditoria
- Tabela nova `vps_reader_audit` (RLS ligada, sem políticas, só serviço): quando, op, tabela, linhas devolvidas, ms, IP, status (ok/401/429/erro), cursor resumido. Nunca os dados. Limpeza de registros >90 dias junto de um cron já existente (sem cron novo).

## 7. Interruptor de emergência
- Flag `vps_reader_enabled` em app_settings (nova linha, padrão DESLIGADO). Lido a cada chamada (consulta por chave primária). Desligado = 503 genérico. Ligar exige sua autorização.

## 8. Peso no sistema
- Sem gatilhos, sem cron, sem polling: a VPS chama quando quiser (sugerir madrugada, fora de 9h–20h).
- Só cursor por chave primária ou `(updated_at,id)`. Antes de liberar incremental numa tabela grande, conferir índice com EXPLAIN; se não houver índice, a tabela fica só no modo completo (sem criar índice novo sem sua aprovação).
- Contagem exata em tabelas gigantes (whatsapp_messages etc.) só sob pedido; padrão estimado.

## 9. Não coberto (só descrito)
- Usuários do login (auth): não estão nas tabelas de negócio; exigiriam rota própria com cuidado (sem hashes de senha) — fica para depois.
- Arquivos (fotos, PDFs, XMLs de notas no Storage): exigiria URLs assinadas por arquivo — fase separada.
- Estrutura do banco (tabelas, funções, políticas): a porta só lê dados; o clone precisa das migrações do próprio repositório.
- Exclusões (linhas apagadas) não aparecem no incremental; conferência pela contagem + leitura completa periódica.
- Consistência: leitura em páginas não é um retrato instantâneo; pode haver pequenas diferenças entre tabelas.
- Risco principal: vazar o segredo = vazar dados de clientes. Mitigações: IP fixo, rotação, interruptor, auditoria.

## 10. Como testar sem risco
1. Implantar com interruptor DESLIGADO; confirmar 503.
2. Testes automáticos: sem chave → 401; chave errada 5x → bloqueio; tabela fora da lista → 400; coluna sensível nunca aparece; varredura do código sem métodos de escrita; `limit` acima do teto é cortado.
3. Ligar por alguns minutos, ler 1 página de 3 tabelas pequenas e fazer `count`, conferir auditoria; desligar.
4. Nenhuma escrita em tabela de negócio em nenhum passo.

## Detalhes técnicos
- Arquivos novos: `supabase/functions/vps-reader/index.ts`, `_shared/vps-reader-allowlist.ts`, testes Deno, migração com as 2 tabelas + 1 RPC de guarda (EXECUTE só service_role) + linha do flag.
- Alterações em existentes: nenhuma.
