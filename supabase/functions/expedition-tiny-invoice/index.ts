import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function safeJson(response: Response, label: string) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`${label} returned non-JSON:`, text.substring(0, 500));
    throw new Error(`${label}: resposta inválida da API Tiny - "${text.substring(0, 100)}"`);
  }
}

// Fetch the description of a Tiny forma de envio AND forma de frete by their numeric IDs
async function fetchFormaEnvioAndFreteDescricao(token: string, formaEnvioId: string, formaFreteId?: string | null): Promise<{ envioDesc: string; freteDesc: string }> {
  try {
    const resp = await fetch('https://api.tiny.com.br/api2/formas.envio.obter.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&idFormaEnvio=${formaEnvioId}`,
    });
    const data = await safeJson(resp, `Obter forma envio ${formaEnvioId}`);
    let envioDesc = '';
    let freteDesc = '';
    if (data.retorno?.status === 'OK' || data.retorno?.status === 'Processado') {
      const fe = data.retorno?.forma_envio || data.retorno?.formaEnvio || data.retorno || {};
      envioDesc = fe.descricao || fe.nome || '';
      console.log(`Forma envio ${formaEnvioId} description: "${envioDesc}"`);
      
      // Find the frete description matching formaFreteId
      if (formaFreteId) {
        const fretesData = fe.formas_frete || fe.formasFrete || fe.fretes || fe.servicos || [];
        const fretesList = Array.isArray(fretesData) ? fretesData : [];
        for (const freteEntry of fretesList) {
          const ff = freteEntry?.forma_frete || freteEntry?.formaFrete || freteEntry;
          if (String(ff.id) === String(formaFreteId)) {
            freteDesc = ff.descricao || ff.nome || '';
            console.log(`Forma frete ${formaFreteId} description: "${freteDesc}"`);
            break;
          }
        }
        if (!freteDesc) {
          console.warn(`Forma frete ${formaFreteId} not found in envio ${formaEnvioId} fretes list`);
        }
      }
    }
    return { envioDesc, freteDesc };
  } catch (e) {
    console.warn(`Could not fetch forma envio/frete description for ${formaEnvioId}:`, e.message);
  }
  return { envioDesc: '', freteDesc: '' };
}

async function searchTinyOrderByNumber(token: string, orderNumber: string, customerName?: string): Promise<string | null> {
  // Helper to filter valid (non-canceled) orders and optionally match customer name
  const findValidOrder = (pedidos: any[], requireNameMatch = false): string | null => {
    for (const entry of pedidos) {
      const pedido = entry?.pedido || entry;
      const situacao = (pedido.situacao || '').toLowerCase();
      // Skip canceled orders
      if (situacao === 'cancelado' || situacao === 'cancelada') {
        console.log(`Skipping canceled Tiny order: id=${pedido.id}, numero=${pedido.numero}, situacao=${situacao}`);
        continue;
      }
      // If we have a customer name, try to match
      if (customerName && requireNameMatch) {
        const tinyCliente = (pedido.nome || pedido.nome_cliente || pedido.cliente?.nome || '').toLowerCase();
        const searchName = customerName.toLowerCase().split(' ')[0]; // first name match
        if (tinyCliente && !tinyCliente.includes(searchName)) {
          console.log(`Skipping Tiny order id=${pedido.id}: customer "${tinyCliente}" doesn't match "${customerName}"`);
          continue;
        }
      }
      console.log(`Found valid Tiny order: id=${pedido.id}, numero=${pedido.numero}, situacao=${situacao}, nome=${pedido.nome || pedido.nome_cliente || ''}`);
      return String(pedido.id);
    }
    return null;
  };

  const cleanNumber = orderNumber.replace('#', '');

  // 1) Search by numero_ecommerce first (most reliable for Shopify-synced orders)
  try {
    const ecomResponse = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${token}&formato=json&numeroEcommerce=${encodeURIComponent(cleanNumber)}`,
    });
    const ecomData = await safeJson(ecomResponse, 'Pesquisa pedido Tiny (ecommerce)');
    console.log(`Search Tiny ecommerce "${cleanNumber}":`, JSON.stringify(ecomData).substring(0, 500));

    if (ecomData.retorno?.status === 'OK' || ecomData.retorno?.status === 'Processado') {
      const pedidos = ecomData.retorno?.pedidos || [];
      const found = findValidOrder(pedidos, true);
      if (found) return found;
    }
  } catch (e) {
    console.log('ecommerce search failed:', e);
  }

  // 2) Search by customer name (most reliable for manually-created orders / vendas)
  if (customerName) {
    try {
      const nameSearch = customerName.split(' ')[0]; // first name
      console.log(`Searching Tiny by customer name: "${nameSearch}"`);
      const nameResponse = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${token}&formato=json&pesquisa=${encodeURIComponent(nameSearch)}&situacao=aberto`,
      });
      const nameData = await safeJson(nameResponse, 'Pesquisa pedido Tiny (nome)');
      console.log(`Search Tiny by name "${nameSearch}" (aberto):`, JSON.stringify(nameData).substring(0, 500));

      if (nameData.retorno?.status === 'OK' || nameData.retorno?.status === 'Processado') {
        const pedidos = nameData.retorno?.pedidos || [];
        const found = findValidOrder(pedidos, true);
        if (found) return found;
      }

      // Also try without status filter
      const nameResponse2 = await fetch('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${token}&formato=json&pesquisa=${encodeURIComponent(nameSearch)}`,
      });
      const nameData2 = await safeJson(nameResponse2, 'Pesquisa pedido Tiny (nome, todos)');
      console.log(`Search Tiny by name "${nameSearch}" (todos):`, JSON.stringify(nameData2).substring(0, 500));

      if (nameData2.retorno?.status === 'OK' || nameData2.retorno?.status === 'Processado') {
        const pedidos = nameData2.retorno?.pedidos || [];
        const found = findValidOrder(pedidos, true);
        if (found) return found;
      }
    } catch (e) {
      console.log('name search failed:', e);
    }
  }

  return null;
}

async function updateTinyOrderCustomerData(token: string, tinyOrderId: string, order: any) {
  const shippingAddress = order.shipping_address as any;

  // Parse address1 to extract street, number, and neighborhood
  let street = '';
  let number = '';
  let complement = '';
  let bairro = '';

  if (shippingAddress?.address1) {
    const parts = shippingAddress.address1.split(',').map((p: string) => p.trim());
    street = parts[0] || '';
    number = parts[1] || '';
    if (parts.length > 2) {
      complement = parts.slice(2).join(', ');
    }
  }

  if (shippingAddress?.address2) {
    bairro = shippingAddress.address2;
  }

  // Step 1: Get the order from Tiny to find the contact ID
  console.log(`Step 1: Getting Tiny order ${tinyOrderId} to find contact...`);
  const orderResponse = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${token}&formato=json&id=${tinyOrderId}`,
  });
  const orderData = await safeJson(orderResponse, 'Obter pedido Tiny');
  console.log('Tiny order data cliente:', JSON.stringify(orderData.retorno?.pedido?.cliente));

  const tinyCliente = orderData.retorno?.pedido?.cliente;
  if (!tinyCliente) {
    console.error('Could not find cliente in Tiny order');
    return { retorno: { status: 'Erro', erros: [{ erro: 'Cliente não encontrado no pedido Tiny' }] } };
  }

  // Check what data is missing
  const missingFields: string[] = [];
  if (!tinyCliente.cpf_cnpj && order.customer_cpf) missingFields.push('CPF');
  if (!tinyCliente.endereco && shippingAddress) missingFields.push('Endereço');
  if (!tinyCliente.bairro && bairro) missingFields.push('Bairro');
  if (!tinyCliente.numero && number) missingFields.push('Número');
  if (!tinyCliente.cep && shippingAddress?.zip) missingFields.push('CEP');

  console.log('Missing fields in Tiny:', missingFields.join(', ') || 'none');

  // If the contact already has all data, skip update
  if (missingFields.length === 0 && tinyCliente.cpf_cnpj) {
    console.log('Contact already has all data, skipping update');
    return { retorno: { status: 'OK' }, skipped: true };
  }

  // Step 2: Update the contact (contato) in Tiny with CPF & address
  const contactId = tinyCliente.id || tinyCliente.codigo;
  const cpf = order.customer_cpf?.replace(/\D/g, '') || tinyCliente.cpf_cnpj || '';
  const phone = order.customer_phone?.replace(/\D/g, '') || tinyCliente.fone || '';

  const contatoPayload = {
    contatos: [{
      contato: {
        sequencia: 1,
        ...(contactId ? { id: contactId } : {}),
        nome: order.customer_name || tinyCliente.nome || 'Cliente',
        tipo_pessoa: cpf.length > 11 ? 'J' : 'F',
        cpf_cnpj: cpf,
        situacao: 'A',
        endereco: street || tinyCliente.endereco || '',
        numero: number || tinyCliente.numero || 'S/N',
        complemento: complement || tinyCliente.complemento || '',
        bairro: bairro || tinyCliente.bairro || '',
        cep: shippingAddress?.zip?.replace(/\D/g, '') || tinyCliente.cep?.replace(/\D/g, '') || '',
        cidade: shippingAddress?.city || tinyCliente.cidade || '',
        uf: parseUF(shippingAddress?.province || tinyCliente.uf || ''),
        fone: phone,
        email: order.customer_email || tinyCliente.email || '',
      }
    }]
  };

  console.log(`Step 2: Updating Tiny contact with data:`, JSON.stringify(contatoPayload));

  const response = await fetch('https://api.tiny.com.br/api2/contato.alterar.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${token}&formato=json&contato=${encodeURIComponent(JSON.stringify(contatoPayload))}`,
  });
  const data = await safeJson(response, 'Alterar contato Tiny');
  console.log('Update Tiny contact response:', JSON.stringify(data));

  return data;
}

// Map full province names to UF codes (Tiny requires 2-letter UF)
function parseUF(province: string): string {
  const map: Record<string, string> = {
    'acre': 'AC', 'alagoas': 'AL', 'amapá': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceará': 'CE', 'distrito federal': 'DF', 'espírito santo': 'ES',
    'goiás': 'GO', 'maranhão': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'pará': 'PA', 'paraíba': 'PB', 'paraná': 'PR',
    'pernambuco': 'PE', 'piauí': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondônia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'são paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
  };
  if (province.length === 2) return province.toUpperCase();
  return map[province.toLowerCase()] || province;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { order_id, action } = await req.json();
    if (!order_id) throw new Error('order_id is required');

    const TINY_ERP_TOKEN = Deno.env.get('TINY_ERP_TOKEN');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TINY_ERP_TOKEN) throw new Error('TINY_ERP_TOKEN not configured');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: order, error: orderError } = await supabase
      .from('expedition_orders')
      .select('*, expedition_order_items(*)')
      .eq('id', order_id)
      .single();

    if (orderError || !order) throw new Error('Order not found');

    // ACTION: sync_order - Find existing Tiny order and update customer data (CPF, etc.)
    // This replaces the old create_order action. Shopify orders are already auto-synced to Tiny.
    if (action === 'sync_order' || action === 'create_order') {
      const searchNumber = order.shopify_order_name || order.shopify_order_number;
      if (!searchNumber) throw new Error('Pedido sem número Shopify para buscar no Tiny');

      console.log(`Searching Tiny for order: ${searchNumber}, customer: ${order.customer_name}`);
      let tinyOrderId = order.tiny_order_id;

      if (!tinyOrderId) {
        tinyOrderId = await searchTinyOrderByNumber(TINY_ERP_TOKEN, searchNumber, order.customer_name);
      }

      if (!tinyOrderId) {
        throw new Error(
          `Pedido "${searchNumber}" não encontrado no Tiny ERP (ou está cancelado). ` +
          `Verifique se o pedido já foi sincronizado da Shopify para o Tiny. ` +
          `Aguarde alguns minutos e tente novamente.`
        );
      }

      // Save tiny_order_id
      await supabase
        .from('expedition_orders')
        .update({ tiny_order_id: tinyOrderId })
        .eq('id', order_id);

      // Update customer data (CPF, address, etc.) on the Tiny order
      const updateResult = await updateTinyOrderCustomerData(TINY_ERP_TOKEN, tinyOrderId, order);
      const updateOk = updateResult.retorno?.status === 'OK' || updateResult.retorno?.status === 'Processado';

      return new Response(JSON.stringify({
        success: true,
        tiny_order_id: tinyOrderId,
        customer_updated: updateOk,
        message: updateOk
          ? `Pedido localizado no Tiny (ID: ${tinyOrderId}) e dados do cliente atualizados com sucesso.`
          : `Pedido localizado (ID: ${tinyOrderId}), mas não foi possível atualizar dados do cliente.`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'emit_invoice') {
      // If we don't have tiny_order_id yet, search for it first
      if (!order.tiny_order_id) {
        const searchNumber = order.shopify_order_name || order.shopify_order_number;
        if (searchNumber) {
          const foundId = await searchTinyOrderByNumber(TINY_ERP_TOKEN, searchNumber, order.customer_name);
          if (foundId) {
            await supabase
              .from('expedition_orders')
              .update({ tiny_order_id: foundId })
              .eq('id', order_id);
            order.tiny_order_id = foundId;

            // Also update CPF on Tiny order before emitting NF-e
            if (order.customer_cpf) {
              await updateTinyOrderCustomerData(TINY_ERP_TOKEN, foundId, order);
            }
          }
        }
      } else if (order.customer_cpf) {
        // Even if we already have tiny_order_id, ensure CPF is synced before NF-e
        await updateTinyOrderCustomerData(TINY_ERP_TOKEN, order.tiny_order_id, order);
      }

      if (!order.tiny_order_id) throw new Error('Pedido não encontrado no Tiny ERP. Clique em "Sincronizar com Tiny" primeiro.');

      // Check if freight was quoted first
      if (!order.freight_carrier || !order.freight_price) {
        throw new Error('O frete precisa ser cotado e selecionado antes de emitir a NF-e.');
      }

      // Use stored Tiny IDs to fetch DESCRIPTIONS (Tiny API needs text, not numeric IDs)
      let formaEnvio = '';
      let formaFrete = '';
      
      if (order.tiny_forma_envio_id) {
        // Fetch the actual description from Tiny (e.g., "Jadlog via Frenet", "Correios via Frenet")
        const envioResult = await fetchFormaEnvioAndFreteDescricao(TINY_ERP_TOKEN, order.tiny_forma_envio_id, order.tiny_forma_frete_id);
        formaEnvio = envioResult.envioDesc;
        formaFrete = envioResult.freteDesc;
      }
      
      if (!formaEnvio) {
        // Fallback: construct description from carrier name
        const carrierLower = (order.freight_carrier || '').toLowerCase();
        if (carrierLower.includes('correio') || carrierLower.includes('pac') || carrierLower.includes('sedex')) {
          formaEnvio = 'Correios via Frenet';
        } else if (carrierLower.includes('jadlog')) {
          formaEnvio = 'Jadlog via Frenet';
        } else if (carrierLower.includes('j&t') || carrierLower.includes('jet')) {
          formaEnvio = 'J&T Express via Frenet';
        } else {
          formaEnvio = order.freight_carrier || 'Transportadora';
        }
      }
      
      if (!formaFrete) {
        // Use freight_service directly (e.g., "Sedex", "PAC", "Jadlog Package")
        formaFrete = order.freight_service || order.freight_carrier || '';
      }

      console.log(`Carrier mapping: tiny_forma_envio_id="${order.tiny_forma_envio_id}" → formaEnvio="${formaEnvio}", formaFrete="${formaFrete}"`);
      // STRATEGY: First try gerar.nota.fiscal.pedido.php (auto-taxes).
      // Then check if transport data is missing. If so, create NF-e manually with nota.fiscal.incluir.php.
      
      // Step 1: Get full order from Tiny to have item data available
      console.log('Step 1: Getting Tiny order details...');
      const tinyOrderResp = await fetch('https://api.tiny.com.br/api2/pedido.obter.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&id=${order.tiny_order_id}`,
      });
      const tinyOrderData = await safeJson(tinyOrderResp, 'Obter pedido Tiny');
      const tinyPedido = tinyOrderData.retorno?.pedido;
      
      if (!tinyPedido) {
        throw new Error('Não foi possível obter dados do pedido no Tiny para gerar a NF-e.');
      }

      console.log('Tiny order obtained. Items:', JSON.stringify(tinyPedido.itens?.length || 0));

      // Step 2: Create NF-e using nota.fiscal.incluir.php WITH transport data
      // This gives us control over the carrier/transport section
      console.log('Step 2: Creating NF-e with transport data via nota.fiscal.incluir.php...');
      
      const tinyCliente = tinyPedido.cliente || {};
      const tinyItems = tinyPedido.itens || [];
      
      // Build items array for NF-e
      const nfItems = tinyItems.map((entry: any) => {
        const item = entry?.item || entry;
        return {
          item: {
            ...(item.id_produto ? { id_produto: item.id_produto } : {}),
            ...(item.codigo ? { codigo: item.codigo } : {}),
            descricao: item.descricao || 'Produto',
            unidade: item.unidade || 'UN',
            quantidade: item.quantidade || 1,
            valor_unitario: item.valor_unitario || 0,
            tipo: 'P', // Product
          }
        };
      });

      if (nfItems.length === 0) {
        throw new Error('Pedido no Tiny não possui itens. Verifique o pedido.');
      }

      // Calculate total weight in kg (min 0.3)
      const totalWeightKg = Math.max(0.3, (order.total_weight_grams || 300) / 1000);

      const nfPayload = {
        nota_fiscal: {
          tipo: 'S', // Saída
          numero_pedido_ecommerce: order.shopify_order_name?.replace('#', '') || '',
          cliente: {
            nome: tinyCliente.nome || order.customer_name || 'Cliente',
            tipo_pessoa: tinyCliente.tipo_pessoa || 'F',
            cpf_cnpj: tinyCliente.cpf_cnpj || order.customer_cpf?.replace(/\D/g, '') || '',
            endereco: tinyCliente.endereco || '',
            numero: tinyCliente.numero || 'S/N',
            complemento: tinyCliente.complemento || '',
            bairro: tinyCliente.bairro || '',
            cep: tinyCliente.cep || '',
            cidade: tinyCliente.cidade || '',
            uf: tinyCliente.uf || '',
            fone: tinyCliente.fone || order.customer_phone || '',
            email: tinyCliente.email || order.customer_email || '',
            atualizar_cliente: 'N', // Don't update client registry
          },
          itens: nfItems,
          // TRANSPORT DATA - forma_envio must be the DESCRIPTION text, not numeric ID
          transportador: {
            nome: order.freight_carrier || '',
          },
          forma_envio: formaEnvio,
          forma_frete: formaFrete,
          frete_por_conta: 'R', // CIF - Remetente
          valor_frete: order.freight_price || 0,
          volumes: [
            {
              quantidade: 1,
              especie: 'CAIXA',
              peso_bruto: Number(totalWeightKg.toFixed(3)),
              peso_liquido: Number(totalWeightKg.toFixed(3)),
            }
          ],
          forma_pagamento: tinyPedido.forma_pagamento || '',
          obs: tinyPedido.obs || `Pedido ${order.shopify_order_name || ''}`,
        }
      };

      console.log('NF-e payload (transport section):', JSON.stringify({
        transportador: nfPayload.nota_fiscal.transportador,
        forma_envio: nfPayload.nota_fiscal.forma_envio,
        forma_frete: nfPayload.nota_fiscal.forma_frete,
        frete_por_conta: nfPayload.nota_fiscal.frete_por_conta,
        valor_frete: nfPayload.nota_fiscal.valor_frete,
      }));

      const nfResponse = await fetch('https://api.tiny.com.br/api2/nota.fiscal.incluir.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${TINY_ERP_TOKEN}&formato=json&nota=${encodeURIComponent(JSON.stringify(nfPayload))}`,
      });
      const nfData = await safeJson(nfResponse, 'Incluir NF-e');
      console.log('NF-e incluir response:', JSON.stringify(nfData));

      let invoiceId: string | null = null;
      let usedFallback = false;

      if (nfData.retorno?.status === 'OK' || nfData.retorno?.status === 'Processado') {
        const reg = nfData.retorno?.registros?.registro || nfData.retorno?.registros?.[0]?.registro || nfData.retorno?.registros;
        invoiceId = reg?.id || reg?.idNotaFiscal || reg?.[0]?.id || null;
        console.log('NF-e created via incluir with transport data. Invoice ID:', invoiceId);
      } else {
        // Fallback: try gerar.nota.fiscal.pedido.php (auto-taxes but no transport)
        const nfErr = nfData.retorno?.erros?.[0]?.erro || JSON.stringify(nfData.retorno);
        console.warn('nota.fiscal.incluir failed:', nfErr, '- falling back to gerar.nota.fiscal.pedido.php');
        usedFallback = true;

        const fallbackResp = await fetch('https://api.tiny.com.br/api2/gerar.nota.fiscal.pedido.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&id=${order.tiny_order_id}&modelo=NFe`,
        });
        const fallbackData = await safeJson(fallbackResp, 'Gerar NF-e (fallback)');
        console.log('NF-e fallback response:', JSON.stringify(fallbackData));

        if (fallbackData.retorno?.status === 'OK' || fallbackData.retorno?.status === 'Processado') {
          const fbReg = fallbackData.retorno?.registros?.registro || fallbackData.retorno?.registros;
          invoiceId = fbReg?.idNotaFiscal || fbReg?.[0]?.idNotaFiscal || null;
        } else {
          const fbErr = fallbackData.retorno?.erros?.[0]?.erro || JSON.stringify(fallbackData.retorno);
          
          // Check if NF-e already exists
          if (fbErr.includes('Já foi gerada nota fiscal') || fbErr.includes('já foi gerada')) {
            // Will be handled by the existing NF-e search logic below
          }
          
          if (!invoiceId) {
            throw new Error(`Erro ao gerar NF-e: ${fbErr}`);
          }
        }
      }

      if (invoiceId) {
        // Step 3: Authorize (emit) the NF-e at SEFAZ
        console.log(`Step 3: Authorizing NF-e ${invoiceId} at SEFAZ...`);
        const emitResponse = await fetch('https://api.tiny.com.br/api2/nota.fiscal.emitir.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&id=${invoiceId}&enviarEmail=S`,
        });
        const emitData = await safeJson(emitResponse, 'Emitir/Autorizar NF-e');
        console.log('NF-e authorization response:', JSON.stringify(emitData));
        
        const emitOk = emitData.retorno?.status === 'OK' || emitData.retorno?.status === 'Processado';
        if (!emitOk) {
          const emitErr = emitData.retorno?.erros?.[0]?.erro || '';
          if (!emitErr.includes('já autorizada') && !emitErr.includes('já foi autorizada') && !emitErr.includes('Autorizada')) {
            console.warn('NF-e authorization warning:', emitErr);
          }
        }

        // Wait for Tiny to process authorization
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 4: Get invoice details
        const detailResponse = await fetch('https://api.tiny.com.br/api2/nota.fiscal.obter.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${TINY_ERP_TOKEN}&formato=json&id=${invoiceId}`,
        });

        const detailData = await safeJson(detailResponse, 'Obter NF-e');
        const nf = detailData.retorno?.nota_fiscal || {};

        await supabase
          .from('expedition_orders')
          .update({
            tiny_invoice_id: String(invoiceId),
            invoice_number: nf.numero || null,
            invoice_series: nf.serie || null,
            invoice_key: nf.chave_acesso || null,
            invoice_pdf_url: nf.link_danfe || null,
            invoice_xml_url: nf.link_xml || null,
            expedition_status: 'invoice_issued',
          })
          .eq('id', order_id);

        const transportMsg = usedFallback
          ? 'NF-e gerada (sem dados de transporte - configure manualmente no Tiny).'
          : 'NF-e gerada COM dados da transportadora!';

        return new Response(JSON.stringify({ 
          success: true, 
          invoice: nf, 
          tiny_invoice_id: invoiceId,
          authorized: emitOk,
          transport_included: !usedFallback,
          message: emitOk 
            ? `${transportMsg} Autorizada na SEFAZ com sucesso!`
            : `${transportMsg} Autorização pode levar alguns instantes.`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // If we got here without returning, no invoice was created
      throw new Error('Não foi possível gerar a NF-e. Verifique os dados do pedido no Tiny.');
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error('Error with Tiny ERP:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
