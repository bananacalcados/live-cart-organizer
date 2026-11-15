# Auditoria de estornos e custos — 15/11/2026

## Escopo e segurança
- Corte fixo: pagamentos criados entre 01/07/2026 00:00 BRT e 14/11/2026 22:40 BRT (15/11 01:40 UTC).
- Somente consultas aos provedores, autenticação e cotação; nenhuma mensagem, estorno, etiqueta ou alteração operacional.
- Três tabelas `audit_*_tmp` têm RLS, nenhum acesso anon/authenticated e acesso service_role.
- Chave de deduplicação financeira: gateway + conta + payment_id.
- A função de coleta é temporária e será removida do servidor e do projeto ao término.

## Interpretação financeira
- `refunded_amount` é devolução registrada pelo provedor; chargeback sem refund não entra artificialmente nesse campo.
- Chargebacks devem ser analisados separadamente pelo valor da transação. Status de chargeback não comprova perda definitiva nem motivo de troca/devolução.
- Esta auditoria não calcula prejuízo líquido: é necessário cruzar retornos físicos, motivo, recuperação de chargeback, taxas e custo do produto.
- Datas mensais de estorno usam refund_date. Datas ausentes ficam em grupo separado; nunca usar a data da compra como falsa data do estorno.
- Appmax: valores da API v3 estão em reais; usar total, não full_payment_amount, para o valor bruto da compra. Parcial em pedido integrado é incluído quando paid_at existe e total_refunded > 0.
- Pagar.me: cobrança canceled com paid_at, canceled_amount > 0 e última transação refunded é estorno real, diferente de Pix Mercado Pago cancelled não pago.

## Limitações verificadas
- Mercado Pago: consultadas as duas contas, inclusive MATTHEWS PF desativada sem reativação; refunded, charged_back, approved e cancelled separados. Segunda conferência por mês para reduzir discrepância de totais da busca.
- Appmax nova: autenticação aceita, listagem /v1/orders recusada HTTP 403; catálogo público só documenta consulta individual por ID, não um extrato geral de pedidos/estornos. Conta antiga permite /api/v3/order paginado.
- AustPay: lista e consulta individual de produção; somente refunds COMPLETED. Total/páginas estimados da lista não são condição de encerramento: usar hasNext.
- Vindi: VINDI_API_KEY ausente na função implantada e no ambiente; sem consulta autenticada disponível.
- Frenet: /shipments, /orders e /wallet/demonstrative WhiteLabel recusaram HTTP 401 com o token disponível; documentação exige também x-partner-token, ausente. Token atual atende à cotação e rastreio, não deu acesso ao extrato. Não há dados gravados na tabela Frenet.
- Frenet painel: Meus Fretes > Histórico de Transações > Extrato, com data inicial/final, operação, status e pedido; aba Notas Fiscais > Baixar Relatório detalha Pagamento Carteira Cliente (valor pago pela etiqueta), Pagamento Frenet e diferença de intermediação. Conferido no artigo oficial via navegador. Referência: https://ajuda.frenet.com.br/knowledge-base/extrato-nota-fiscal-etiqueta/ .
- Correios: response das reversas não contém preço; valor da auditoria é cotação atual /preco/v1/nacional, serviço 03301, CEP cliente → remetente contratado, pacote salvo. Não é extrato histórico de cobrança.
- Duas reversas com CEP 00000000 receberam HTTP 400, sem inventar endereço ou cotação.
- Etiqueta emitida não prova uso: eventos físicos comprovam postagem/coleta/transporte; expirada/cancelada sem eventos físicos = não usada; só etiqueta ativa = uso desconhecido.
- Reposição: nenhum vínculo a correios_shipments pelas trocas; uma troca tem código Correios, mas faltam serviço/peso/preço do novo envio. Registro com valor nulo; nunca reaproveitar shipping_cost da venda original.

## Consultas de conferência

## Fechamento confirmado
- Mercado Pago Varejo Calçados: 134 pagamentos (118 estornos integrais, 10 parciais e 6 chargebacks), R$ 40.551,18 devolvidos; chargebacks R$ 2.359,94 em valor de transação, sem refund registrado.
- Mercado Pago MATTHEWS PF: nenhum estorno/chargeback; 1 Pix cancelado expired.
- Appmax legacy: 794 pedidos percorridos em 80 páginas; 13 devoluções, R$ 5.649,86. Uma parcial de R$ 179,99 sem refunded_at, inclusive na consulta individual.
- AustPay: 1 estorno COMPLETED, R$ 359,99; consulta individual confirma histórico. Nenhum chargeback encontrado.
- Pagar.me: 593 cobranças percorridas; 3 estornos R$ 719,97 e 2 chargebacks R$ 539,98 em valor da transação.
- Total devolvido confirmado: R$ 47.281,00. Chargebacks separados: 8 / R$ 2.899,92 (não representam automaticamente perda definitiva).
- Cancelled Mercado Pago fora das tabelas: Varejo expired 527, by_collector 9, by_payer 3; MATTHEWS PF expired 1. Total 540.
- Correios: 81 reversas; 79 cotadas por R$ 2.020,78, 2 sem cotação por CEP 00000000; 25 postadas (cotações R$ 650,57), 27 expiradas/canceladas sem postagem, 29 sem prova de uso. Todas em novembro.
- Reposição Correios: 1 registro com custo nulo por ausência de serviço/peso/preço; não foi inventada cotação.
- Seis testes de inclusão/exclusão passaram. RLS/grants conferidos nas três tabelas; nenhum acesso anon/authenticated.

| Mês do estorno | Mercado Pago | Appmax | AustPay | Pagar.me |
|---|---:|---:|---:|---:|
| Julho | 12 / 2.334,18 | 1 / 459,99 | 0 | 0 |
| Agosto | 21 / 4.926,06 | 8 / 3.509,92 | 0 | 1 / 179,99 |
| Setembro | 18 / 4.991,52 | 1 / 319,99 | 0 | 0 |
| Outubro | 54 / 19.048,62 | 2 / 1.179,97 | 1 / 359,99 | 1 / 179,99 |
| Novembro até o corte | 23 / 9.250,80 | 0 | 0 | 1 / 359,99 |
| Sem data fornecida | 0 | 1 / 179,99 | 0 | 0 |

```sql
-- Totais por gateway, chargeback separado
select gateway, account, count(*) pagamentos,
       sum(refunded_amount) estornos,
       sum(transaction_amount) filter (where status in ('charged_back','chargedback','CHARGEDBACK')) valor_transacoes_chargeback
from audit_gateway_refunds_tmp group by 1,2 order by 1,2;

-- Estornos por mês; datas ausentes não viram mês da compra
select gateway, to_char(refund_date at time zone 'America/Sao_Paulo','YYYY-MM') mes,
       count(*) pagamentos, sum(refunded_amount) estornos
from audit_gateway_refunds_tmp where refunded_amount > 0
group by 1,2 order by 1,2;

-- Coorte de criação de pagamento, incluindo chargebacks
select gateway, to_char(date_created at time zone 'America/Sao_Paulo','YYYY-MM') mes_compra,
       count(*) pagamentos, sum(refunded_amount) estornos,
       sum(transaction_amount) filter (where status in ('charged_back','chargedback','CHARGEDBACK')) valor_chargeback
from audit_gateway_refunds_tmp group by 1,2 order by 1,2;

select direction, value_source, used, count(*), count(amount), sum(amount)
from audit_reverse_costs_tmp group by 1,2,3;
```