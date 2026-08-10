# Sorteio de Prêmio (rifa) no Módulo Eventos

Hoje o evento tem só **Roleta** (cada cliente gira e ganha o próprio prêmio). Vamos adicionar um segundo tipo: **Sorteio** — um pool de participantes concorre a 1 (ou poucos) prêmios, com o sorteio feito pela equipe ao vivo.

Nada da roleta atual é alterado: tabelas, edge function e telas existentes continuam intactas. O sorteio nasce em estrutura própria, ao lado.

## Como vai funcionar

Na aba de prêmios do evento passam a existir duas sub-abas: **Roleta** e **Sorteio**.

Ao criar um sorteio, a equipe define:
- Nome (ex.: "Bolsa da Live")
- Prêmio (descrição + tipo: prêmio físico, desconto, frete grátis)
- Quantos ganhadores (padrão 1)
- **Quem participa** (público):
  1. **Pedidos confirmados** — todo mundo que confirmou pedido no evento (etapas: Novo Pedido, Aguardando Pagamento, Pago e posteriores)
  2. **Pagadores** — só quem pagou (com valor mínimo opcional)
  3. **Cadastrados na Live sem pedido** — leads da live que não montaram pedido
- Filtros opcionais: valor mínimo de compra, incluir/excluir quem já ganhou outro sorteio do mesmo evento

A lista de participantes é **calculada ao vivo** (mostra "30 participantes" e a lista com @ e telefone mascarado). Um botão **SORTEAR** congela o pool, sorteia no servidor e registra o resultado. A tela mostra a animação dos nomes girando até parar no ganhador.

Depois do sorteio:
- O ganhador é gravado e aparece como card "Ganhador" com botão de **enviar mensagem no WhatsApp** (template já existente do evento)
- Se o prêmio for físico, ele entra no ciclo de vida de prêmio físico já existente (disponível → reservado → enviado/perdido), igual à roleta
- Se for cupom (desconto/frete), gera código igual ao da roleta e aplica no próximo pedido
- Sorteio realizado fica travado (auditável): pool congelado, semente e horário registrados. Só admin pode **anular e re-sortear**, deixando registro.

## Detalhes técnicos

**Banco (migration nova, sem tocar no que existe)**
- `event_raffles`: event_id, name, prize_label, prize_type, prize_value, winners_count, audience (`confirmed_orders` | `payers` | `live_leads`), min_purchase_value, exclude_previous_winners, status (`draft` | `drawn` | `void`), drawn_at, timestamps.
- `event_raffle_entries`: raffle_id, phone, display_name, order_id (nullable), entry_value — snapshot do pool no momento do sorteio (congelamento).
- `event_raffle_winners`: raffle_id, entry_id, phone, display_name, position, customer_prize_id (nullable), voided_at.
- GRANTs: `authenticated` (leitura/gestão pelo painel) + `service_role`; sem acesso `anon`. RLS com as mesmas políticas de equipe usadas em `event_prize_wheels`.

**Edge function nova `event-raffle`** (service role, admin-only via JWT):
- `preview` → monta o pool conforme o público e devolve contagem + lista
- `draw` → recalcula o pool, grava as entries, sorteia com `crypto.getRandomValues`, grava ganhadores, cria `customer_prizes` quando aplicável (reaproveitando o mesmo caminho da roleta), tudo dentro de uma RPC transacional para evitar sorteio duplicado
- `void` → anula um sorteio (marca `voided_at`, libera prêmio físico)

Regras de pool por público:
- `confirmed_orders`: `orders` do evento com `stage` em `new, awaiting_payment, paid, awaiting_shipping, awaiting_mototaxi, awaiting_pickup, shipped, completed` e não cancelados — 1 entrada por telefone (dedupe pelos 8 últimos dígitos, padrão do projeto)
- `payers`: reutiliza a mesma lógica de `paidTotalInEvent` já usada em `event-prize-wheel`
- `live_leads`: `event_leads`/leads da live do evento cujo telefone **não** aparece em nenhum pedido do evento

**Front**
- `src/components/events/EventRafflesManager.tsx` (novo): CRUD, preview do pool, botão sortear, animação e card de ganhador
- `src/components/events/RaffleDrawAnimation.tsx` (novo): rolagem de nomes até o vencedor
- Onde hoje é renderizado `EventPrizeWheelsManager`, entra um wrapper com `Tabs` (Roleta | Sorteio). O componente da roleta não muda.

**Riscos e mitigação**
- Sorteio duplicado: guardado por `status='drawn'` + claim atômico na RPC.
- Telefones repetidos: dedupe por sufixo de 8 dígitos antes de sortear.
- Nada é exposto publicamente: o sorteio é operado só pelo painel; a cliente só recebe o aviso por WhatsApp.
