# Bloqueio de clientes com Chargeback — plano por etapas

Objetivo: marcar uma venda específica como chargeback direto no PDV > Clientes, e a partir disso alertar/barrar esse cliente em novas compras (checkout, PDV, expedição, chat e live).

Base já existente: tabela `chargebacks` (vazia, sem FK), RPC `check_chargeback_risk`, `ChargebackRiskBadge` e o diálogo `MarkChargebackDialog` (hoje só na Expedição).

---

## Etapa 1 — Fundação de dados (banco)
- Adicionar em `chargebacks`: vínculo real com a venda (`pos_sale_id`, `order_id`), `customer_unified_id`, `phone_key` (DDD + 8 dígitos), `cpf_digits`, `blocked` (bloqueia compra sim/não).
- Preencher `phone_key`/`cpf_digits` por trigger, sempre normalizado (nunca confiar no texto digitado).
- Índices por `phone_key`, `cpf_digits` e `customer_unified_id`.
- Reescrever `check_chargeback_risk` para casar por telefone normalizado, CPF, cliente unificado e endereço (CEP + número), devolvendo nível de risco e motivo.

Risco tratado: registros órfãos (sem saber qual venda) e match por telefone falhando por formatação.

## Etapa 2 — Marcar chargeback no PDV > Clientes
- No Perfil 360° do cliente, cada venda do histórico ganha ação "Marcar chargeback", que abre o diálogo já existente pré-preenchido com venda, cliente, endereço e valor.
- O registro nasce vinculado à venda e ao cliente unificado, com opção "bloquear novas compras".
- Selo permanente de chargeback no cabeçalho do cliente e na lista de clientes, derivado da tabela `chargebacks` (não de tag manual).

Risco tratado: dependência de tag em texto livre no chat, que some se alguém editar.

## Etapa 3 — Painel de gestão
- A aba de Chargebacks passa a listar por cliente (não só por registro), mostrando venda vinculada, valor, status e se está bloqueado.
- Ações: bloquear/desbloquear, mudar status, remover marcação errada (com histórico de quem fez).

## Etapa 4 — Bloqueio na venda (o ponto crítico)
- Checagem no servidor antes de criar pedido/cobrança: checkout público, PDV e link de pagamento.
- Cliente bloqueado: pedido não é criado; o operador do PDV vê o alerta e o motivo, com liberação manual só por gestor.
- Cliente marcado mas não bloqueado: só alerta, venda segue.
- Validação sempre no backend (nunca só na tela), para não ser contornável.

## Etapa 5 — Alertas nos outros pontos
- Expedição: alerta antes de despachar (reaproveita o selo atual).
- Chat/WhatsApp: faixa de aviso na conversa quando o telefone bate.
- Live: aviso na anotação/pedido quando o cliente for identificado por telefone ou @ já vinculado.
- Limitação conhecida: cliente que só tem @ do Instagram sem cadastro não é identificado — o alerta aparece assim que telefone ou CPF entrar no pedido.

## Etapa 6 — Retroativo e verificação
- Importar chargebacks antigos manualmente pela tela (ou lista fornecida) para a base já nascer útil.
- Teste ponta a ponta: marcar → tentar comprar no checkout → tentar no PDV → conferir alerta na expedição e no chat.

---

### Detalhes técnicos
- Chave de identidade: DDD + últimos 8 dígitos (padrão do projeto) e CPF só como identidade forte.
- Todas as novas colunas com RLS e GRANT no mesmo passo; escrita restrita a usuários autenticados, leitura de risco via função `security definer`.
- Bloqueio aplicado nas edge functions de criação de pedido/pagamento para valer também fora da interface.
