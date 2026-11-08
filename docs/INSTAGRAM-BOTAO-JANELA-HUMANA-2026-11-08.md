# Instagram: botão F e resposta humana

## Entregue
- F agenda somente a primeira mensagem. Inclui quick reply “Quero meu link 🛍️”, editável no cartão F. O mecanismo antigo `ig_initial_message_buttons` envia templates em conversa já aberta; seus postbacks `evtauto:` continuam intactos. Novo payload `livef:` reaproveita o webhook, com assinatura obrigatória e vínculo exato de pedido, cliente e conta.
- Toque confirmado reserva uma única mensagem imediata com o carrinho. Somente a confirmação desse envio cria os passos 10/25/45 min, contados do toque, com jitter ±1 min. Duplicatas não reenviam. Resposta livre interrompe; interação de botão não interrompe. Sem toque: aguardando por 24h, depois expirado, sem novos envios. Cron existente atualiza a expiração; nenhum cron novo.
- HUMAN_AGENT é autorizado somente com identidade de funcionário verificada, envio manual pelo chat, aprovação da conta comprovada e última mensagem entre 24h e 7 dias. Chamadas internas não podem obter essa autorização. Removidos fallbacks HUMAN_AGENT de botões automáticos e reenvios em lote.
- Histórico diferencia automações de atendimento manual; chat mostra janela automática, prazo humano quando aprovado e aviso de aprovação pendente. Sem aprovação, mantém 24h.

## Verificação segura e limitações
- Consulta `debug_token` do token da conta @bananacalcados retornou HTTP 400. Portanto **não foi possível comprovar a aprovação Human Agent**; isso não prova que a conta não tenha a aprovação nem que o token de envio esteja inválido. A janela estendida permanece bloqueada.
- No Meta for Developers, selecionar o app conectado ao Instagram → App Review / Revisão do app → Permissions and Features / Permissões e recursos → solicitar acesso avançado ao recurso **Human Agent**. Mostrar vídeo de atendente humano respondendo uma solicitação não resolvida em 24h, sem automações. Concluir verificação da empresa quando exigida. Para Instagram Login conferir também `instagram_business_manage_messages`; para Facebook Login, `instagram_manage_messages`. A disponibilidade do recurso depende da configuração do app.
- A documentação oficial de Private Replies não confirma explicitamente quick replies no envio com `recipient.comment_id`; o template antigo não serve como comprovação. A primeira mensagem foi preparada com quick reply, sem fallback para um segundo envio nem retry automático. **Aceitação pela Meta precisa de teste controlado autorizado durante live antes de ligar F.** Não houve envio real nesta entrega e não é correto prometer que o botão já chega no Instagram.
- Referências: https://developers.facebook.com/documentation/instagram-platform/private-replies ; https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies ; https://developers.facebook.com/docs/features-reference/human-agent/

## Testado
- 50 testes unitários/regressão passaram.
- Simulação SQL autenticada e revertida: toque abre 24h sem contar como resposta; identidade errada bloqueada; claim único; nenhum passo posterior antes do carrinho; três passos após confirmação; base no toque; 10/25/45 ±1 min; texto digitado para. Todos verdadeiros, zero chamadas a provedores.
- Simulação anterior de remetentes, LID, comentário ≠ DM e resposta privada continuou passando.
- Navegador autenticado: botão editável no cartão F; global desligado; aviso “Resposta humana até 7 dias: aguardando aprovação da Meta” no topo do chat. Sem polling: três leituras ao abrir aba; duas leituras delimitadas de contexto no chat por abertura/atualização já existente.
- Funções implantadas; frontend não publicado. Planos não alterados; candidato protegido preservado.

## Antes de usar
Não ligar global/F até confirmar aceitação do quick reply pela Meta em live controlada. Para novas telas chegarem ao site publicado, publicar o frontend somente após conferência e autorização do dono. A resposta humana de 7 dias exige comprovar aprovação e revalidar a capacidade da conta no servidor; nenhuma configuração do navegador libera a tag.