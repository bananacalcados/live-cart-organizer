# Respostas citadas no WhatsApp da Live

## Objetivo
Fazer o modal de WhatsApp do módulo Eventos funcionar como o WhatsApp: mostrar quando a cliente respondeu uma mensagem específica e permitir que a equipe escolha uma mensagem anterior para responder citando-a.

## Implementação
1. **Exibir respostas recebidas**
   - Usar o vínculo de mensagem citada que já existe no histórico.
   - Mostrar dentro do balão uma faixa com remetente, trecho do texto ou tipo da mídia citada.
   - Ao clicar na faixa, rolar até a mensagem original e destacá-la; buscar a original no histórico arquivado quando ela não estiver na lista atual.

2. **Permitir responder uma mensagem anterior**
   - Adicionar a ação de responder em cada mensagem e manter o gesto de pressionar no celular.
   - Mostrar acima da caixa de texto qual mensagem está sendo respondida, com opção de cancelar.
   - Limpar a seleção somente após o envio ser aceito; preservar texto e citação se houver falha.

3. **Enviar a citação ao WhatsApp real**
   - Encaminhar o identificador da mensagem original pelas instâncias Whats Pérola/UAZAPI, WaSender, Z-API e Meta.
   - Gravar o mesmo vínculo no histórico para a resposta aparecer imediatamente na tela da equipe.
   - Não permitir citação quando a mensagem antiga não tiver identificador do WhatsApp; nesse caso, explicar na própria tela.

4. **Completar a captura dos provedores**
   - Preservar o identificador citado nos webhooks de entrada, inclusive no caminho WaSender que hoje perde essa informação ao encaminhar a mensagem.
   - Normalizar os formatos recebidos sem alterar o roteamento por instância.

## Validação
- Abrir o chat de um pedido da Live e responder uma mensagem recebida.
- Confirmar que a prévia aparece antes do envio, no histórico da equipe e no WhatsApp do destinatário.
- Confirmar que uma resposta feita pelo cliente no celular aparece citada no modal.
- Verificar texto, imagem, vídeo, áudio e documento, além de desktop e celular.
- Validar pelo menos uma instância UAZAPI, que é a usada no exemplo, sem enviar mensagem para cliente real durante o teste técnico.
