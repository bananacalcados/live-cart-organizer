# Marcar "veio do Grupo VIP" nas compras da live

## Resumo
Quem toca no link da live vindo do grupo informa o WhatsApp uma única vez. O aparelho guarda o número. Com isso o clique fica ligado à compra. Quem não informar o número ainda pode ser marcada como "membro de grupo" se o telefone dela estiver em um grupo ativo no dia da live. O relatório do evento mostra os dois números separados. Os links de disparo não mudam.

## 1. Tela do link (/ao-vivo/:slug, só quando utm_source=grupo)
- O fluxo de hoje só muda quando o link chega com utm_source=grupo e sem telefone.
- Antes de buscar um número no aparelho ou pedir o número, a página procura o telefone nesta ordem:
  1. um número no próprio link (?lead/?phone);
  2. o número guardado pelo próprio link do grupo;
  3. o número já salvo pela vitrine ou pelo autoatendimento no mesmo aparelho.
- Se encontrar, redireciona direto, como hoje.
- Se não encontrar, mostra um cartão simples:
  - título "Falta só seu WhatsApp para entrar";
  - um campo com máscara (DD) 9XXXX-XXXX;
  - botão grande "Entrar na live";
  - link pequeno "Entrar sem informar".
- Para não perder ninguém, "Entrar sem informar" grava o clique sem telefone e redireciona.
- O número é validado como celular BR (com o 9º dígito), guardado no aparelho e enviado no clique.

**Fricção:** só na primeira vez, de 2 a 3 toques a mais: tocar no campo, digitar e tocar em "Entrar na live". Nas próximas vezes não muda nada.

## 2. Gravar o clique: estender live_redirect_clicks
**Recomendação:** estender a tabela de cliques em vez de usar event_leads.
- **Motivo:** event_leads representa um cadastro ou lead de captação. Colocar cliques ali poluiria os leads, o lead scoring e os disparos, que leem essa tabela. O clique já mora na tabela de cliques e já tem o evento.
- Colunas novas, todas opcionais (nada quebra):
  - phone_suffix8
  - group_jid_base
  - group_name
  - vip_campaign_id
  - identified_via (link | aparelho | digitado | sem_telefone)
- Um índice em (event_id, phone_suffix8) para casar com as vendas.

**Como identificar o grupo:** o link do grupo passa a aceitar o parâmetro &g=<código curto>, resolvido no servidor para o grupo e a campanha VIP. Também aceita utm_campaign.
- Se o mesmo link for postado em vários grupos e vier sem o código, fica só "Grupo VIP (grupo não identificado)". Depois, o grupo pode ser deduzido pela participação da cliente em um grupo.
- **Suposição:** gerar um link por grupo nas campanhas VIP fica para uma fase 2, porque mexe no envio dos grupos. Na fase 1, o código é colocado manualmente no link ou usa-se só a campanha.

## 3. Marcar a venda sem sobrescrever a atribuição
- Novas colunas opcionais:
  - em orders e em pos_sales: vip_group_origin (jsonb), com { via: 'link', group_jid_base, group_name, campaign_id, click_at };
  - em orders e em pos_sales: vip_group_member (jsonb), com { groups: [...], checked_at }.
- A marcação é calculada por uma função no servidor que roda por evento. Ela é chamada:
  - pelo trigger que já existe na criação ou no pagamento do pedido do evento. A regra de estender trigger existente vale: só atualiza com WHEN e quando houver diferença;
  - pelo relatório do evento, de forma incremental, só para vendas ainda sem marcação.
- Casamento: mesmo evento + últimos 8 dígitos do telefone + clique antes do pedido. Vale o clique identificado mais recente.
- A venda do PDV herda a marcação do pedido de origem.
- Nenhum campo de atribuição que já existe é alterado (utm, link_origin, ad_touch, dispatch_touch).

## 4. Plano B: membro de grupo
- Compradora cujo telefone (últimos 8 dígitos) aparece em whatsapp_group_members, sem ser interno e ativa no dia da live. Ativa quer dizer: entrou antes do fim da live e não saiu, ou saiu depois dela.
- Ela recebe vip_group_member. Fica separado de "veio pelo link".
- Os grupos são agrupados pela chave base do grupo, sem misturar instâncias.

## 5. Relatório do evento
Novo bloco "Grupos VIP" no resultado da live, com duas linhas e o detalhe por grupo/campanha:
- **Veio pelo link do grupo:** cliques, identificadas (com telefone), pedidos, valor pago.
- **Membro de grupo (sem link):** compradoras, pedidos, valor pago.

O valor pago segue o critério de receita do evento: pedidos cancelados não contam como pagos. Os dados vêm de uma única função paginada (máximo de 200 grupos), chamada uma vez ao abrir o bloco, sem atualização automática.

## Detalhes técnicos
- **Migração:**
  - colunas novas em live_redirect_clicks, orders e pos_sales, mais um índice;
  - funções `mark_event_vip_origin(p_event_id)` e `event_vip_group_report(p_event_id, p_limit, p_offset)` como SECURITY DEFINER com checagem de equipe, sem acesso anônimo.
- **Edge `live-redirect`:**
  - aceita phone, g e identified_via só quando utm_source=grupo;
  - normaliza o telefone no padrão E.164 e calcula os últimos 8 dígitos;
  - resolve o g pelo servidor, sem confiar em nome de grupo vindo do navegador;
  - limita a quantidade de cliques por IP.
- **Front:**
  - `LiveRedirectPage.tsx` ganha o cartão do WhatsApp e passa a ler as chaves do aparelho que a vitrine e o autoatendimento já usam;
  - o relatório do evento ganha um componente novo.
- **Consultas:**
  - a página do link faz 1 chamada, como hoje;
  - o relatório faz 1 chamada ao abrir.
- **Testes:**
  - grupo sem telefone mostra o cartão;
  - número guardado no aparelho pula o cartão;
  - link de disparo não muda;
  - casamento pelos últimos 8 dígitos;
  - membro que saiu antes da live não conta.

## Fora do escopo
- Fluxo dos links de disparo.
- Geração automática de link por grupo nas campanhas VIP (fase 2).
- Publicação.
