import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ZapiStatus {
  connected: boolean;
  smartphoneConnected?: boolean;
  session?: string;
}

interface SendMessageResult {
  success: boolean;
  error?: string;
}

type MediaType = 'image' | 'audio' | 'video' | 'document';

export function useZapi() {
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ZapiStatus | null>(null);

  const checkConnection = async (): Promise<ZapiStatus | null> => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-connection-status');
      
      if (error) {
        console.error('Error checking Z-API connection:', error);
        toast.error('Erro ao verificar conexão do WhatsApp');
        return null;
      }

      const status: ZapiStatus = {
        connected: data?.connected || false,
        smartphoneConnected: data?.smartphoneConnected,
        session: data?.session,
      };
      
      setConnectionStatus(status);
      return status;
    } catch (error) {
      console.error('Error checking Z-API connection:', error);
      toast.error('Erro ao verificar conexão do WhatsApp');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const getQrCode = async (): Promise<string | null> => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-qrcode');
      
      if (error) {
        console.error('Error getting QR code:', error);
        toast.error('Erro ao obter QR Code');
        return null;
      }

      return data?.value || null;
    } catch (error) {
      console.error('Error getting QR code:', error);
      toast.error('Erro ao obter QR Code');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (phone: string, message: string): Promise<SendMessageResult> => {
    if (!phone) {
      toast.error('Número de WhatsApp não informado');
      return { success: false, error: 'Número não informado' };
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-send-message', {
        body: { phone, message },
      });
      
      if (error) {
        console.error('Error sending message:', error);
        toast.error('Erro ao enviar mensagem');
        return { success: false, error: error.message };
      }

      if (data?.success) {
        toast.success('Mensagem enviada com sucesso!');
        return { success: true };
      } else {
        const errorMsg = data?.error || 'Erro desconhecido';
        toast.error(`Falha ao enviar: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Erro ao enviar mensagem');
      return { success: false, error: 'Erro de conexão' };
    } finally {
      setIsLoading(false);
    }
  };

  const sendMedia = async (
    phone: string,
    mediaUrl: string,
    mediaType: MediaType,
    caption?: string
  ): Promise<SendMessageResult> => {
    if (!phone) {
      toast.error('Número de WhatsApp não informado');
      return { success: false, error: 'Número não informado' };
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-send-media', {
        body: { phone, mediaUrl, mediaType, caption },
      });
      
      if (error) {
        console.error('Error sending media:', error);
        toast.error('Erro ao enviar mídia');
        return { success: false, error: error.message };
      }

      if (data?.success) {
        toast.success('Mídia enviada com sucesso!');
        return { success: true };
      } else {
        const errorMsg = data?.error || 'Erro desconhecido';
        toast.error(`Falha ao enviar: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error('Error sending media:', error);
      toast.error('Erro ao enviar mídia');
      return { success: false, error: 'Erro de conexão' };
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    connectionStatus,
    checkConnection,
    getQrCode,
    sendMessage,
    sendMedia,
  };
}
