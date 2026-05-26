
# Plano v2 — Agente Financeiro no Telegram + Conciliação Mercado Pago

Sim, todas as melhorias são viáveis. Telegram inclusive resolve dois problemas de uma vez: zero risco de banimento e **autenticação nativa por `chat_id`** (você libera só a sua conta — quem não estiver na whitelist é ignorado).

Inspecionei os 2 arquivos do Mercado Pago que você enviou:

- **`collection-*.xlsx`** (extrato de vendas / "Releases"): 60+ colunas. Importantes: `date_created`, `date_approved`, `date_released`, `operation_id` (ID único MP), `external_reference` (aqui dá pra cravar nosso `pos_sale_id`!), `transaction_amount`, `mercadopago_fee`, `net_received_amount`, `installments`, `payment_type`, `franchise` (bandeira), `pos_id`, `store_id`.
- **`account_statement-*.xlsx`** (extrato da conta MP): `RELEASE_DATE`, `TRANSACTION_TYPE`, `REFERENCE_ID`, `TRANSACTION_NET_AMOUNT`, `PARTIAL_BALANCE`. Saldos inicial/final no topo.

Cada um cobre um lado diferente da conciliação, e juntos formam a trilha completa: **PDV → Adquirente (collection) → Conta (account_statement)**.

---

## 1. Canal: Telegram (substitui WhatsApp)

- Conector **Telegram** via Bot API (já temos guia nativo no projeto).
- Tabela `financial_agent_authorized_users(chat_id, role, created_at)` — **whitelist**. Qualquer `chat_id` fora dela recebe "Acesso negado." e a mensagem é descartada (e logada).
- Comando `/start <token-de-convite-único>` para auto-cadastro inicial (token gerado por você na UI e expira em 10 min).
- Bot token via `secrets--add_secret` + `setWebhook` com `secret_token` (validação HMAC já no padrão do projeto).
- Mensagens, anexos e respostas trafegam via Edge Function `telegram-financial-webhook`.

## 2. Anexos suportados pelo agente

| Tipo | Uso | Como processamos |
|---|---|---|
| Foto/PDF de comprovante avulso | Lançamento manual de saída/entrada | OCR via `_shared/media-understanding.ts` (Claude vision) → JSON `{amount,date,beneficiary,doc,line_digitavel}` |
| **XLSX collection MP** | Importar vendas de cartão recebidas | Parser específico → loop em linhas `status=approved` |
| **XLSX account_statement MP** | Importar entradas/saídas da conta | Parser específico → loop em linhas |
| CSV genérico | Outros bancos | Parser tolerante (vírgula/ponto-vírgula, header detect) |
| OFX | Padrão bancário | lib `ofx-js` no edge function |

O bot detecta o tipo pelo MIME + heurística de cabeçalho (ex.: header com `INITIAL_BALANCE` = account_statement MP; `operation_id`+`net_received_amount` = collection MP).

## 3. Deduplicação — a parte crítica

A regra-mãe: **toda linha importada precisa de uma chave externa única**. Criamos:

```
cash_flow_entries.external_source   text  -- 'mp_collection' | 'mp_account' | 'ofx_xxx' | 'manual_receipt' | 'pos_sale'
cash_flow_entries.external_id       text  -- chave única do provedor
UNIQUE (external_source, external_id)
```

Por canal:

| Fonte | `external_id` |
|---|---|
| Collection MP | `operation_id` (já é único e imutável no MP) |
| Account statement MP | `REFERENCE_ID` (sempre presente) |
| OFX | `FITID` |
| Comprovante avulso (foto/PDF) | hash SHA-256 do arquivo + valor + data |
| Venda PDV | `pos_sales.id` |

Assim, **reenviar o mesmo arquivo 10 vezes não duplica nada** — o `INSERT ... ON CONFLICT DO NOTHING` no `UNIQUE` resolve.

### Dedup também entre fontes diferentes (o caso que você levantou)

Cenário: você manda foto do PIX hoje, e amanhã manda o extrato da conta — o mesmo PIX aparece nos dois.

Estratégia em 2 camadas:

1. **Match automático** ao importar account_statement: para cada linha do extrato, procurar `cash_flow_entries` com:
   - mesmo `direction`, mesmo `amount`,
   - `entry_date` dentro de ±2 dias úteis,
   - status ≠ `reconciled`.
   - Se achar **1 match** → não cria nova entry; atualiza a existente marcando `status='reconciled'`, `bank_external_id=<REFERENCE_ID>`. (Vira "casamento".)
   - Se achar **>1 match** → cria entry como `status='needs_review'` e o bot pergunta no Telegram qual delas casa.
   - Se achar **0 match** → cria nova entry normal (lançamento que você não tinha registrado).

2. **Match manual via bot**: comando `/conciliar` lista pendências.

Esse mesmo mecanismo cobre conciliar **collection MP ↔ pos_sales** (próxima seção).

## 4. Conciliação PDV ↔ Cartão (collection MP)

Aqui está o ouro: o MP exporta `external_reference` para cada venda. Vamos passar a **gravar `pos_sales.id` nesse campo** quando a venda for cartão MP (alteração pequena na edge function que cria a cobrança / chama a maquininha). A partir daí, conciliação fica trivial:

```
match = collection.external_reference == pos_sales.id
```

Para vendas antigas (sem `external_reference`) ou maquininha que não permita gravar, fallback escalonado:

1. Mesmo dia + mesmo valor bruto + mesma bandeira + mesmas parcelas → match automático (confiança alta).
2. Mesmo dia + mesmo valor → match sugerido (confiança média) → bot pergunta no Telegram.
3. Sem match → fica em `unmatched_card_receivables` e aparece num painel "Recebíveis órfãos".

Cada `collection` linha vira **2 lançamentos** no fluxo:
- Entrada: `net_received_amount` (o que cai de fato).
- Saída: `mercadopago_fee + financing_fee` na categoria "Taxas de cartão > Mercado Pago".

E ligamos via FK ao `pos_sale_id` quando casou — assim você consegue ver no dashboard "venda bruta no PDV vs líquido recebido vs taxa paga" por venda.

## 5. Tabelas finais

```
cash_flow_entries
  id, tenant_id, store_id, entry_date, direction, amount,
  category_id, payment_method, description, attachment_url,
  source, external_source, external_id, source_ref_id,
  pos_sale_id (nullable FK), bank_external_id, status,
  confidence, needs_review_reason, created_by, created_at
  UNIQUE (external_source, external_id)

bank_import_batches
  id, file_name, file_hash, source_type, rows_total,
  rows_inserted, rows_duplicated, rows_matched, rows_needs_review,
  imported_by, created_at

financial_agent_authorized_users (chat_id, role)
financial_agent_sessions (chat_id, last_attachment_id, expected_action, expires_at)
payment_method_fees (method, brand, installments, fee_pct, days_to_receive)
unmatched_card_receivables (view)
```

## 6. Fluxo de uso típico (já com tudo plugado)

```
Você → [PDF de boleto pago] "luz da pérola"
Bot  → "Energia Elétrica · Loja Pérola · R$ 842,30 (08/06)
        Categoria: Despesas Operacionais > Energia. Confirmar? 1✅ 2✏️ 3❌"
Você → 1
Bot  → "Lançado ✅"

(2 dias depois)
Você → [collection-XXXX.xlsx]
Bot  → "📥 142 vendas MP · 138 conciliadas c/ PDV · 3 órfãs · 1 duplicada (ignorada)
        Taxa total: R$ 487,20 lançada em 'Taxas cartão'.
        Ver órfãs? /orfas"

(no mesmo dia)  
Você → [account_statement-XXXX.xlsx]
Bot  → "📊 56 movimentos · 54 já existiam (conciliados) · 2 novos lançados
        ⚠️ 1 saída de R$ 842,30 do dia 08/06 bateu com 'Luz Pérola' — marquei como conciliada."
```

## 7. Segurança (resumo)

1. Whitelist obrigatória de `chat_id`.
2. `secret_token` no webhook (assinado com SHA-256 do bot key).
3. Rate limit por `chat_id` (10 msg/min).
4. Bucket `financial-receipts` privado, signed URL 7 dias.
5. Logs `financial_agent_audit` (entrada, ação, hash do arquivo) — para auditoria.
6. RLS em todas as tabelas por `tenant_id`.

## 8. Ordem de execução revisada

1. **Schema** (tabelas acima + UNIQUE + bucket).
2. **Trigger PDV → cash_flow_entries** (vendas + sangria/suprimento) e **gravar `pos_sales.id` em `external_reference` MP**.
3. **Dashboard de Fluxo de Caixa + DRE** em Administração (já dá valor sem o Telegram).
4. **Parsers**: collection MP, account_statement MP, OFX, CSV genérico, OCR de comprovante.
5. **Motor de dedup/conciliação** (regra `(external_source, external_id)` + matcher fuzzy ±2d).
6. **Bot Telegram** + whitelist + webhook + estados de conversa.
7. **Categorização IA** reaproveitando `ai-classify-transactions`.
8. **Painel "Recebíveis órfãos"** + tela de conciliação manual.

Se aprovar, começo pela **Etapa 1+2** (gera valor imediato e prepara o terreno) e na sequência ataco os parsers MP + bot Telegram. Confirma?
