# Moderação automática dos comentários do Instagram

## Primeiro passo ao aprovar (organização)
- Salvar este plano como `.lovable/plan-moderacao-comentarios.md`.
- Salvar o plano do Grupo VIP (anexo no fim deste arquivo, sem alteração) como `.lovable/plan-grupo-vip.md`.
- Nada do Grupo VIP será implementado agora.

Isso fica para depois porque, no modo de planejamento, eu só consigo escrever neste arquivo.

## Como vai funcionar
1. **O comentário chega como hoje.** Nada muda no que já é gravado.
2. **Filtro antes de qualquer coisa.** Sai da moderação:
   - comentário de live;
   - comentário da própria Banana;
   - comentário da equipe;
   - respostas da equipe.
   Para o que sobra, o sistema só anota "moderar" numa fila.
3. **Classificação pela IA, separada do recebimento.** Ela roda depois e não atrasa nada.
   - Uma chamada por comentário. Usa o texto + legenda do post + se a pessoa é cliente.
   - Devolve: classe, confiança de 0 a 1 e motivo curto.
   - Nunca reclassifica o mesmo comentário.
4. **Ação imediata conforme a classe.** Cada classe tem interruptor próprio, e existe um interruptor geral.

| Classe | Oculta? | O que mais acontece |
|---|---|---|
| pedido_rastreio | sim | Mensagem privada no direct (1 por comentário, até 7 dias), com o texto configurável. Se o @ for de cliente com pedido, vai junto o link de rastreio BC-XXXXXX do último pedido |
| acusacao | sim, só com confiança ≥ 0,85 | Entra em "Contatar no particular" com nome, WhatsApp e últimos pedidos, quando o @ é de cliente cadastrada. Abaixo de 0,85 vira dúvida |
| ofensa_spam | sim | Nada |
| duvida | não | Sugere uma resposta pública padrão (original, nota fiscal, garantia), enviada com um toque |
| neutro_positivo | não | Nada |

5. **Registro de tudo.** O comentário original fica guardado mesmo depois de oculto. Também ficam guardados:
   - quem ocultou ou reexibiu, e quando;
   - o resultado da IA;
   - a resposta do Instagram.

## Como separa live de post (sem tocar na live)
- **É live quando:** o aviso do Instagram vem marcado como comentário de live, ou o post é do tipo LIVE. Esse comentário nunca entra na moderação.
- **Gravação da live:** continua igual. O "Pedidos por Código na Live" lê a lista de comentários da live, que não muda.
- **Atenção:** hoje, no dia da live, comentários de posts comuns também são copiados para a lista da live. Por segurança, também não modero nenhum comentário que tenha sido copiado para a live naquele dia.
- **Ponto de mudança:** só acrescento uma linha que anota "moderar" depois que tudo o que existe hoje já rodou: gravação no chat, cópia para a live e automações de comentário.

## Anúncios
- Comentário em post patrocinado que reaproveita um post do perfil chega pelo mesmo aviso e entra na moderação.
- Comentário em anúncio criado só para o anúncio (que não aparece no perfil) normalmente **não chega** pelo acesso de Instagram que usamos hoje. Para esse caso seria preciso:
  - conectar pela página do Facebook com as permissões de comentários da página e de anúncios;
  - ou buscar os comentários pela API de Anúncios.
- No passo de verificação eu confiro com um anúncio real e te digo qual dos dois casos acontece.

## Permissão na Meta
- **O que ainda não sei:** se o acesso atual já tem a permissão de gerenciar comentários. Ela cobre ocultar, responder e enviar resposta privada.
- **Por que é provável que tenha:** o sistema já responde comentários e já manda direct a partir de comentário, e essas duas coisas dependem dela.
- **Como confirmo:** ocultando e reexibindo um comentário de teste antes de ligar a moderação.
- **Se faltar:** é preciso reconectar a conta com essa permissão marcada. Não precisa de análise nova da Meta, porque a conta é nossa.
- **Para anúncios exclusivos:** aí sim entram permissões novas da página e dos anúncios.

## Tela "Moderação de comentários"
Fica em Marketing → IG Automação, como uma aba nova ao lado das regras de comentário que existem hoje.
- **No topo:**
  - ocultados nas últimas 24 horas;
  - % de acerto (1 − reexibidos ÷ ocultados que já foram revisados);
  - quantas esperam contato;
  - interruptor geral e um por classe.
- **Aba Ocultados:** foto do post, comentário, @, classe, motivo, confiança, data. Botões "Reexibir" e "Estava certo".
- **Aba Contatar no particular:** situação (a contatar, contatado, resolvido), anotação, dados da cliente e atalho para abrir a conversa.
- **Aba Dúvidas para responder:** resposta sugerida que dá para editar e botão "Responder".
- **Aba Configurações:**
  - texto da mensagem privada (com {primeiro_nome} e {link_rastreio});
  - texto da resposta padrão para dúvidas;
  - nível mínimo de confiança.
- **Resumo do dia** (só na tela): ocultados por classe e quantos esperam contato, por dia.
- Listas de 50 em 50, com filtros e busca feitos no servidor e sem atualização automática. Ao abrir a tela são 2 consultas: os números do topo e a primeira página.

## Leveza e limites
- **Fila e envio aos poucos:** a fila é processada pelo worker que já roda a cada 5 minutos, ou por outro equivalente que já exista, sem criar rotina nova de 1 minuto. São até 30 comentários por rodada, e há pausa automática se o Instagram avisar limite ou erro (código 4, 17, 32 ou 613).
- **Sem repetição:** ocultar e mandar a mensagem privada acontecem só uma vez, com trava no banco. Repetir a tentativa nunca duplica a mensagem.
- **IA:** usa o modelo Lovable AI (Gemini Flash), com instrução fixa e resposta em formato estruturado. Se a IA falhar, o comentário fica "não classificado" e **não** é ocultado.
- **Volume estimado:** algumas centenas por dia, com uma chamada de IA cada.

## Detalhes técnicos

**Tabelas novas** (com RLS, sem acesso anônimo, leitura pela equipe e alteração pelo admin ou pelo servidor):
- `ig_comment_moderation`
  - comment_id (único), media_id, media_permalink, media_thumb, media_product_type
  - from_id, username, text_original
  - received_at
  - status (pending | classified | hidden | kept | failed | skipped), skip_reason
  - class, confidence, reason, ai_model, classified_at
  - hidden_at, hide_response
  - private_reply_sent_at, private_reply_error
  - suggested_reply, public_reply_sent_at, public_reply_by
  - unhidden_at, unhidden_by
  - review_verdict (correct | wrong), reviewed_by, reviewed_at
  - customer_id
  - contact_status (a_contatar | contatado | resolvido), contact_note
  - Índices: (status, received_at), (class, hidden_at) e (contact_status).
- `ig_moderation_settings`, com 1 linha: enabled (padrão desligado), class_enabled jsonb, acusacao_min_confidence (0,85), private_reply_template, public_reply_template, own_usernames, team_usernames.
- `ig_moderation_daily`: dia, classe, ocultados, reexibidos e a contatar, mantidos por trigger, para não somar a cada leitura.

**Funções de rotina do servidor:**
- `ig-comment-moderate`: worker em lote. Classifica, oculta e manda a mensagem privada. Exige chamada interna.
- `ig-comment-moderation-action`: reexibir, marcar "estava certo", responder publicamente e mudar a situação do contato. Exige login da equipe e registra quem fez.
- `meta-messenger-webhook`: só ganha um insert "pending" no fim, quando não é live, não é da própria conta e não foi copiado para a live.

**Funções no banco:**
- `ig_moderation_summary()`: os números do topo.
- `ig_moderation_list(p_tab, p_limit ≤ 200, p_offset, p_search)`.
- Liberadas só para usuários logados.

**Ligar o @ à cliente:** pelas tabelas de vínculo do Instagram que já existem, numa consulta por lote. O link de rastreio sai do último pedido pago, usando o código BC.

**Testes:**
- comentário de live nunca entra na fila;
- comentário da própria conta é ignorado;
- acusação abaixo de 0,85 vira dúvida;
- a mensagem privada sai só uma vez;
- falha da IA não oculta.

**Liberação:** começa com o interruptor geral desligado. Primeiro roda 1 dia em teste sem ocultar nada, só para medir. Esse passo só existe se você quiser, porque a sua regra é ocultar direto.

## Fora do escopo
- Fluxo de comentários e pedidos da live.
- Regras de automação de comentário que já existem.
- Publicação.

---

## Anexo — plano Grupo VIP (cópia sem alteração, não implementar)

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
