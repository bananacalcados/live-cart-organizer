# Pedido sem telefone na live: identificar por nome completo ou @ do Instagram

## Problema
Hoje o pedido só sai de "Incompleto" quando alguém digita o WhatsApp. Como a cliente fala o número em voz alta na live, golpistas capturam e se passam pela loja. Precisamos criar o pedido com um identificador não sensível e deixar a cliente entregar o telefone só em ambiente privado (a própria área de membros).

## Como eu resolveria

### 1. O pedido passa a ter 3 chaves de identidade
No modal de novo pedido (Eventos > dentro do evento), além de `@ do Instagram` e `WhatsApp`, entra o campo **Nome completo**.

Regra nova de estágio: o pedido sai de "Incompleto" para "Aguardando confirmação do cliente" quando tiver **pelo menos uma** chave de identidade:
- WhatsApp, ou
- @ do Instagram, ou
- Nome completo válido (2+ palavras, só letras — mesma validação de `isRealFullName`)

Assim a vendedora nunca precisa pedir o número em público: pede o nome completo (idosa sabe) ou o @ (quem souber).

### 2. Entrada na área de membros com 3 opções
A tela de entrada passa a ter um seletor: **WhatsApp | @ do Instagram | Nome completo**.

- **WhatsApp** — fluxo atual, inalterado.
- **@ do Instagram** — busca o pedido pelo handle.
- **Nome completo** — busca o pedido pelo nome normalizado (sem acento, minúsculo) dentro do evento corrente.

### 3. O telefone continua sendo o fator de segurança — só que digitado em privado
Entrar por nome/@ **não abre o pedido direto**. O fluxo é:

```text
digita nome completo / @  ->  achou pedido do evento
   -> pede o WhatsApp dela (digitado no celular, não falado na live)
   -> envia OTP e valida
   -> vincula o telefone ao pedido/cliente e abre a área de membros
```

Isso mantém o mesmo nível de proteção de hoje (posse do número), tira o telefone do ar da live e ainda preenche o cadastro automaticamente. Se o telefone já estiver no cadastro dela (cliente conhecida), o OTP é dispensado como hoje.

### 4. Nomes repetidos / tentativa de sequestro de pedido
- Busca por nome é restrita ao **evento corrente** e a pedidos não cancelados — reduz muito a colisão.
- Se houver mais de um pedido com o mesmo nome, a tela pede um segundo sinal (o @ do Instagram ou os **4 últimos dígitos** do WhatsApp) em vez de listar os pedidos.
- Nenhum dado do pedido (itens, valores, endereço) aparece antes do OTP validado. Quem chutar um nome não vê nada.
- Rate limit por IP e por nome pesquisado, no mesmo padrão já usado para telefone.

### 5. Fallback para quem não sabe o @
Ordem de preferência mostrada na tela: **Nome completo** primeiro (todo mundo sabe), @ como atalho para quem usa Instagram, WhatsApp para quem já é cliente. Sem exigir @ de ninguém.

## Detalhes técnicos
- Banco: coluna `customer_full_name` (ou reuso de `customers.name`) + índice por nome normalizado; RPC de busca `member_area_find_by_identity(event_id, kind, value)` em SECURITY DEFINER, retornando só `order_id` + se precisa de desambiguação — nunca o conteúdo do pedido.
- `orders.stage`: regra de transição `incomplete_order -> awaiting_confirmation` passa a aceitar qualquer uma das 3 chaves (hoje só telefone).
- Edge function `live-member-area`: nova ação `identify` (nome/@) que devolve um token temporário de "pré-sessão"; `enter` passa a aceitar esse token + telefone + OTP e faz o merge do telefone no `customers`/`orders` (a lógica de casar por @ e liberar o pedido incompleto já existe nas linhas do `enter` e será generalizada para nome).
- Front: `OrderDialogDb.tsx` ganha o campo de nome completo com validação; `LiveMemberArea.tsx` ganha o seletor de forma de entrada e o passo de confirmação por telefone.

## Etapas de entrega
1. Base de dados + regra de estágio por qualquer identidade.
2. Campo "Nome completo" no modal de pedido e nos cards/kanban.
3. Entrada por nome/@ na área de membros, com OTP de telefone no final.
4. Desambiguação, rate limit e auditoria do fluxo completo.
