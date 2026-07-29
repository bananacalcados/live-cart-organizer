## Objetivo

Um **link único e público** fixado na Live do Instagram. Todo mundo clica no mesmo link, digita o WhatsApp e entra na sua própria área: vê o pedido montado por você, confirma o item (que vai direto para *Novo Pedido*) e paga. Dados pessoais ficam mascarados e só são revelados com código OTP enviado no WhatsApp.

Decisões fechadas: colunas do Kanban conforme proposto · estoque só é reservado no pagamento · janela de pagamento de 20 minutos.

---

## Fase 0 — Modo do evento

Campo **Modo de operação** no cadastro/edição do evento:
- **Manual** — comportamento atual, sem nenhuma alteração.
- **Área de Clientes** — gera slug público (`/live/<slug>`) e ativa o Kanban adaptado.

## Fase 1 — Entrada pelo link público

- Tela 1: **WhatsApp** (normalizado em E.164, com 9º dígito).
- Se o telefone não tem cadastro → Tela 2: **Nome completo**, salvo como lead da live.
- Se já tem cadastro → entra direto.
- Se já tem pedido montado no Kanban → entra e abre o modal de confirmação.
- Sem OTP nesta etapa: a área serve também para captação de leads durante a live.

## Fase 2 — Área do cliente

- Cabeçalho com nome + selo "ao vivo".
- **Meu pedido**: itens anotados por você (foto, descrição, cor/tamanho, preço), com ação por item.
- Sem pedido: estado vazio com CTA para comentar na live / falar no WhatsApp.
- **Meus dados**: nome visível; CPF, e-mail e endereço mascarados.

## Fase 3 — OTP como cofre

- "Ver / editar meus dados" dispara código de 4 dígitos no WhatsApp daquele número.
- Validado, libera leitura e edição por 30 minutos de sessão.
- Primeiro preenchimento não exige OTP; a partir do momento em que há dados salvos, toda leitura/edição exige.

## Fase 4 — Confirmação move para Novo Pedido

- Modal **CONFIRMAR / NÃO QUERO** por item.
- Confirmar → pedido vai automaticamente para **Novo Pedido** com carimbo de data/hora da confirmação.
- Recusar → item removido; se era o único, pedido encerrado.
- Itens adicionados por você durante a live aparecem em tempo real para confirmação.

## Fase 5 — Kanban do modo Link

`Montando` → `Aguardando confirmação` → `Novo Pedido` → `Aguardando pagamento` → `Pago` → `Expedição`.
Eventos em modo Manual mantêm as colunas atuais.

## Fase 6 — Pagamento (janela de 20 min)

- Pix (5% off), Crédito e Débito, com o checkout transparente atual, dentro da própria área.
- Contador regressivo de **20 minutos** a partir da confirmação. Expirado, o pedido volta para *Aguardando confirmação* e o cliente pode reabrir.
- **Estoque só é reservado no pagamento confirmado** — antes disso nada é retido.
- Pós-pagamento: status e rastreio na mesma tela.

---

## Detalhes técnicos

- Nova rota pública `/live/:slug` (sem autenticação Supabase), servida por edge function pública, no padrão já usado em `link-page-public`.
- Coluna `operation_mode` e `public_slug` em `events`.
- Sessão do cliente por telefone em armazenamento local + token curto emitido pela edge function; nenhuma leitura direta de tabela pelo navegador.
- OTP reaproveita `live-send-verification` / `live-verify-code`, com escopo "revelar dados" e expiração de 30 min.
- Dados sensíveis nunca trafegam mascarados-no-front: a edge function só devolve CPF/endereço completos após OTP validado.
- Confirmação de item chama RPC que atualiza o estágio do pedido e registra `confirmed_at`.
- Expiração de 20 min tratada por job/varredura no servidor, não apenas por timer no navegador.
- UI mobile-first: botões de 56-64px, uma decisão por tela, alto contraste, voltar sempre visível.
