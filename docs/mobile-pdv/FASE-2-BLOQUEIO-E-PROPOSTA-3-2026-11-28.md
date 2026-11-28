# Fase 2 — diagnóstico anterior e proposta da Fase 3

## Resultado
Este é o diagnóstico da pausa anterior. Matthews escolheu depois a Opção A: manter o envio intacto e não garantir reenvio sem duplicação. A implementação e suas pendências estão em `ENTREGA-FASE-2-WHATSAPP-2026-11-28.md`. A proposta da Fase 3 abaixo continua somente documentada, sem implementação.

O requisito de reenvio sem duplicação não é garantido pelo caminho atual: `useChatSender` e `posWhatsappSend` enviam diretamente, sem uma identidade persistente da tentativa. Os endpoints de texto uazapi e WaSender repassam cada chamada ao provedor. `withGroupSendRouting` não reserva envios individuais: para telefone de cliente, passa direto ao handler.

Se o provedor aceitar e a resposta se perder, o navegador pode mostrar falha. Repetir a chamada produz uma segunda tentativa de mensagem. Travar o botão no primeiro toque impede toques simultâneos, mas não resolve esse caso após reconexão/reabertura.

O teste `mobileWhatsappResendDiagnostic.test.ts` executa o helper real com respostas em memória: primeira aceitação com resposta perdida, segunda chamada aceita; conta duas chamadas nos dois provedores. É comprovação do risco no helper, não teste de entrega real nem prova de duplicação em produção.

## Decisão necessária
Para cumprir essa garantia pelo mesmo caminho, autorizar uma extensão opcional de identidade de envio no servidor compartilhado, sem mudar o comportamento dos chamadores atuais. O celular usaria essa identidade persistida antes de enviar. Uma tentativa incerta não seria reenviada automaticamente; seria conciliada por evidência do provedor ou exibida como pendente de conferência. Não prometer exatamente uma entrega quando o provedor não permite verificar a aceitação.

Essa extensão não é somente movimentação de código para lib. Por isso a implementação foi pausada, conforme a instrução do Matthews. Alternativa: manter o caminho intacto e retirar a garantia de reenvio, bloqueando tentativas incertas até conferência humana — também depende de aprovação explícita.

## Escopo pendente e validação
Suíte Vitest completa: 1.247 testes em 187 arquivos passaram, incluindo as duas simulações do reenvio. Validação automática da prévia: build OK; tipos/build de produção separados não foram executados. Não houve alteração de código da aplicação.

Lista paginada com filtros equivalentes, conversa, mídia, catálogo, ficha, compras, links, cashback, rastreio, trocas, estornos e atribuição permanecem pendentes. Não foram medidas consultas da futura tela, nem testados 390×844/teclado, histórico longo ou aparelho. Não houve mensagem, troca ou estorno real. Não houve publicação.

## Proposta preliminar da Fase 3 — não implementada

- **Já existe no código:** receptor `public/push-sw.js`, inscrição de push numa página de campanha e painel de Marketing. Não é um fluxo de alertas de conversas da equipe. A função atual faz POST sem assinatura VAPID/payload cifrado no envio usado pelo painel; sua existência não comprova notificações entregues. Não foi feita chamada que gere chaves ou salve inscrições.
- **Falta:** inscrição autenticada por usuário/aparelho, acesso restrito à equipe, preferências por loja/instância, ligação aos eventos de mensagens recebidas, envio Web Push com biblioteca comprovada, abrir a conversa exata e remover inscrições expiradas. Nenhum cron/polling novo.
- **Chaves:** par VAPID e contato do remetente. Pública no navegador; privada somente em Secrets, nunca em configuração legível pelo navegador. Não girar a chave existente sem inventariar inscrições — pode invalidar campanhas. Preservar o fluxo de Marketing; isolamento de chave/registro deve ser escolhido na implementação. Nenhum segredo foi lido ou criado.
- **Android:** navegador compatível, permissão de notificação e HTTPS; testar Chrome com aplicativo aberto, fechado e tela bloqueada. Economia de bateria pode atrasar avisos.
- **iPhone:** iOS/iPadOS 16.4+; instalar na Tela de Início e solicitar permissão por toque dentro do aplicativo instalado. Não prometer recebimento numa aba comum do Safari. Verificar versão/aparelho real antes de liberar.
- **Destinatário proposto:** atendente atribuído, desde que ainda autorizado à loja/instância; sem atendente, somente equipe que optar pela fila daquela loja. Admin/Matthews escolhe acompanhar lojas, não recebe tudo obrigatoriamente. Não usar somente a vendedora selecionada localmente como identidade autenticada.
- **Excesso/privacidade:** agrupar por conversa+instância+destinatário; janela sugerida de 60s com uma notificação substituível; não avisar sobre saída da equipe, disparos, status ou conversa que o destinatário está vendo. Texto padrão sem CPF/endereço/conteúdo sensível na tela bloqueada. Preferências de silêncio propostas, ainda não decididas.
- **Custo:** Web Push não cobra por mensagem como WhatsApp; há uso de processamento/banco/rede do Lovable Cloud. Sem serviço pago adicional previsto; custo exato depende do volume e de medições. Não requer nova conta WhatsApp.
- **Testes antes de habilitar:** somente aparelhos da equipe autorizados, transferência de atendente, revogação de acesso, duplicatas, conversa aberta, aparelho offline e inscrições expiradas. Nunca usar clientes como destinatários de teste.

Essa proposta não ativa nada e fica para aprovação depois de destravar/concluir a Fase 2.