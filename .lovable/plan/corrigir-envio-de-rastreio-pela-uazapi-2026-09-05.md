# Corrigir envio de rastreio pela UAZAPI

## Objetivo
Garantir que os botões de envio de rastreio da Expedição usem somente instâncias UAZAPI ativas e nunca desviem silenciosamente para outro provedor.

## Implementação
- Filtrar os seletores da Conferência e do reenvio para exibir apenas instâncias UAZAPI ativas.
- Pré-selecionar a instância UAZAPI já vinculada à conversa do cliente; quando não houver vínculo, usar uma instância UAZAPI ativa e permitir troca manual.
- Corrigir o nome do campo usado no reenvio (`wa_number_id`) e validar que a instância escolhida ainda existe e pertence à UAZAPI antes do envio.
- Remover o fallback silencioso para Z-API no rastreio: a chamada irá diretamente à função UAZAPI e mostrará o erro real caso a instância esteja indisponível.
- Manter a escolha explícita da expedidora autorizada a enviar mesmo quando o histórico anterior ocorreu em outra instância.

## Validação
- Conferir as instâncias UAZAPI ativas e suas credenciais no backend.
- Validar o retorno da função UAZAPI e a confirmação por `messageId`.
- Verificar compilação e os dois fluxos: envio durante a Conferência e reenvio em Concluídos.
