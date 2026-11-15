# Teste do extrato Mercado Pago — julho a outubro de 2026

**Resultado: dá para automatizar valores e recuperar parte das descrições, mas ainda não dá para identificar e classificar todas as saídas automaticamente.**

Período completo: 01/07/2026 00:00 a 31/10/2026 23:59:59, Brasília. Baixados 8 relatórios de Liberações (4 de cada conta) e 4 Dinheiro em conta da Varejo. Gravados 14.177 registros em audit_mp_movements_tmp: 9.469 linhas dos extratos de Liberações e 4.708 evidências Dinheiro em conta. RLS ligada, nenhuma policy; somente service_role. Os saldos iniciais/finais NÃO são movimentação. As evidências Dinheiro em conta NÃO devem ser somadas novamente às Liberações.

Relatório detalhado entregue ao solicitante, com agrupamentos, exemplos e limitações.

## 5. Qual consulta trouxe mais detalhe

- Liberações é o extrato completo de saldo: data, ID, tipo, bruto, crédito/débito, MP_FEE e saldo. Não trouxe favorecido nem descrição digitada; DESCRIPTION é o tipo do movimento.
- Dinheiro em conta Varejo acrescentou segmentos como Bill Payments - Agenda, Bill payments, Virtual e Merchant Services; DESCRIPTION vazio em todas as 4.708 linhas. include_withdraw=false: não cobre payouts, por isso não substitui Liberações.
- GET /v1/payments/search filtrado por payer.id, paginado até página vazia, foi o melhor complemento para pagamentos feitos com saldo: 1.342 pagamentos consultados, 1.210 de 1.212 débitos payment cruzados. Identificou cofrinhos/partition_transfer, compras, bancos de boletos, descrições de serviços e alguns Pix; não acessa os payouts.
- GET /v1/payments/{id} confirmou exemplos de cofrinho, boleto e compra. IDs payout deram 404 Payment not found. GET /v1/payouts e /v1/payouts/{id} foram recusados com 403 PolicyAgent nas duas contas. Não foi insistido nem tentado contornar a restrição.
- GET /v1/account/movements e /v1/transfers (inclusive por ID) deram 404. Não há conclusão de inexistência de toda API privada do MP; somente estes caminhos e os tokens atuais foram testados.

## 6. Limitações e preservação

- PF: Dinheiro em conta recusou a criação com 404 porque não havia configuração; não foi criada configuração manual. Liberações foi gerado e cobriu os quatro meses.
- Ao gerar o primeiro relatório PF, o próprio Mercado Pago materializou uma configuração padrão de Liberações (GET config mudou de 404 para 200). Nenhum POST/PUT/PATCH de configuração foi enviado; não removi nem alterei esse padrão. As duas configurações existentes da Varejo permaneceram idênticas.
- No teste inicial, as configurações não tinham detalhe completo de favorecido/chave/documento, referência externa no CSV nem componentes separados de taxas. Em 15/11, uma ampliação autorizada e documentada em `mp-expanded-report-audit-2026-11-15.md` acrescentou conta de destino a todos os payouts de outubro, mas ainda não trouxe nome do favorecido ou banco. POI_BANK_NAME documentado é banco de origem, não garantia de favorecido.
- Não é possível entregar 30 favorecidos verdadeiros a partir de nomes ocultos. O ranking de descrições acima é o máximo comprovável, sem adivinhar identidades ou classificação financeira.
- Sem rate limit: nenhum 429. Consultas sequenciais, pausa de 800ms por chamada ao MP; geração acompanhada com consultas espaçadas.
- Nenhum pagamento, saque, transferência ou estorno criado/alterado. Nenhum lançamento em cash_flow_entries ou bank_transactions. Nenhuma tela mudou e não há publicação. Função temporária removida ao final; tabela permanece.

## Conferência por SQL

```sql
-- Extrato de saldo: NUNCA somar settlement_evidence junto
select account, to_char(date at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
 description, record_type, count(*), sum(net_credit), sum(net_debit)
from public.audit_mp_movements_tmp
where record_type in ('movement','reserve')
group by account, mes, description, record_type order by account, mes, description;

-- Taxas agregadas, por data de aprovação do Dinheiro em conta
select to_char(date at time zone 'America/Sao_Paulo','YYYY-MM') as mes,
 -sum(fee_amount) as taxas_liquidas
from public.audit_mp_movements_tmp
where record_type = 'settlement_evidence'
group by mes order by mes;
```

Fontes oficiais:
- https://www.mercadopago.com.br/developers/en/docs/reports/released-money/introduction
- https://www.mercadopago.com.br/developers/en/docs/reports/account-money/report-fields
- https://www.mercadopago.com.br/developers/en/docs/reports/released-money/api
