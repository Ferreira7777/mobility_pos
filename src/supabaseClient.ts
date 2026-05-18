import { createClient } from '@supabase/supabase-js';
import { db } from './db';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

let isSyncingInProgress = false;

// Serviço para sincronizar a fila de outbox (syncQueue) com o Supabase quando há internet
export async function syncOfflineData() {
  if (!navigator.onLine) return;
  if (isSyncingInProgress) return;

  isSyncingInProgress = true;
  console.log("Iniciando sincronização de dados pendentes com o Supabase...");

  try {
    // Buscar ações pendentes ou falhadas na base de dados local
    const pendingActions = await db.syncQueue
      .where('status')
      .anyOf(['pending', 'failed'])
      .toArray();

    if (pendingActions.length === 0) {
      isSyncingInProgress = false;
      return;
    }

    console.log(`Encontradas ${pendingActions.length} ações pendentes para sincronizar.`);

    // Ordenar por ID (ordem de criação) para manter consistência das transações
    pendingActions.sort((a, b) => (a.id || 0) - (b.id || 0));

    for (const action of pendingActions) {
      try {
        const payload = JSON.parse(action.payload);
        let success = false;

        switch (action.action) {
          case 'update_table': {
            // Sincronizar estado da mesa no Supabase
            // payload: { id, status }
            const { error } = await supabase
              .from('restaurant_tables')
              .upsert({
                id: payload.id,
                number: payload.id, // o número corresponde ao ID local das tabelas
                status: payload.status,
                current_order_total: 0,
                updated_at: new Date().toISOString()
              });
            
            if (!error) success = true;
            else console.error("Erro ao sincronizar mesa no Supabase:", error);
            break;
          }

          case 'create_order': {
            // Sincronizar criação/atualização do carrinho no Supabase
            // payload: { id, items, total }
            const localOrder = await db.orders.get(payload.id);
            if (localOrder) {
              const { error } = await supabase
                .from('orders')
                .upsert({
                  id: localOrder.id,
                  table_id: localOrder.tableId,
                  items: localOrder.items,
                  status: localOrder.status,
                  total: localOrder.total,
                  created_at: new Date(localOrder.createdAt).toISOString(),
                  customer_name: localOrder.customerName || null,
                  customer_nif: localOrder.customerNif || null,
                  payment_method: localOrder.paymentMethod || null,
                  updated_at: new Date().toISOString()
                });
              
              if (!error) success = true;
              else console.error("Erro ao sincronizar pedido no Supabase:", error);
            } else {
              // Se o pedido local já não existir, marcamos como sincronizado para desimpedir a fila
              success = true;
            }
            break;
          }

          case 'complete_order': {
            // Sincronizar fecho de pagamento de mesa no Supabase
            // payload: { id, tableId, paymentMethod }
            const localOrder = await db.orders.get(payload.id);
            
            // 1. Atualizar venda para concluída no Supabase
            const { error: orderError } = await supabase
              .from('orders')
              .upsert({
                id: payload.id,
                table_id: payload.tableId,
                items: localOrder ? localOrder.items : [],
                status: 'completed',
                total: localOrder ? localOrder.total : 0,
                created_at: new Date(localOrder ? localOrder.createdAt : Date.now()).toISOString(),
                customer_name: localOrder?.customerName || null,
                customer_nif: localOrder?.customerNif || null,
                payment_method: payload.paymentMethod,
                updated_at: new Date().toISOString()
              });

            // 2. Libertar mesa no Supabase
            const { error: tableError } = await supabase
              .from('restaurant_tables')
              .upsert({
                id: payload.tableId,
                number: payload.tableId,
                status: 'free',
                current_order_total: 0,
                updated_at: new Date().toISOString()
              });

            if (!orderError && !tableError) {
              success = true;
            } else {
              console.error("Erro ao completar venda no Supabase:", { orderError, tableError });
            }
            break;
          }

          case 'archive_orders': {
            // Sincronizar arquivamento em massa de pedidos (Fecho do Dia) no Supabase
            // payload: { ids: number[] }
            if (payload.ids && payload.ids.length > 0) {
              const { error } = await supabase
                .from('orders')
                .update({ status: 'archived', updated_at: new Date().toISOString() })
                .in('id', payload.ids);

              if (!error) success = true;
              else console.error("Erro ao arquivar faturas no Supabase:", error);
            } else {
              success = true;
            }
            break;
          }

          default:
            console.warn(`Ação de sincronização desconhecida: ${action.action}`);
            success = true; // Desimpedir a fila
            break;
        }

        if (success) {
          // Remover ou marcar como sincronizado
          await db.syncQueue.update(action.id!, { status: 'synced' });
          console.log(`[Sync] Sincronizada ação #${action.id} (${action.action}) com sucesso.`);
        } else {
          await db.syncQueue.update(action.id!, { status: 'failed' });
        }

      } catch (err) {
        console.error(`Erro ao processar ação #${action.id}:`, err);
      }
    }
  } catch (error) {
    console.error("Erro global de sincronização:", error);
  } finally {
    isSyncingInProgress = false;
  }
}

// Ouvir rede online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log("[Sync] Ligação à rede restabelecida. A enviar dados offline...");
    syncOfflineData();
  });

  // Executar sincronização em background a cada 15 segundos
  setInterval(() => {
    if (navigator.onLine) {
      syncOfflineData();
    }
  }, 15000);
}

// Serviço de sincronização retroativa total das tabelas e vendas locais históricas
export async function syncAllHistoricalOrders() {
  if (!navigator.onLine) return;
  console.log("Iniciando sincronização retroativa de todas as vendas e mesas...");

  try {
    // 1. Sincronizar todas as mesas locais com o Supabase
    const localTables = await db.restaurantTables.toArray();
    for (const table of localTables) {
      await supabase
        .from('restaurant_tables')
        .upsert({
          id: table.id,
          number: table.number,
          status: table.status,
          current_order_total: table.currentOrderTotal,
          updated_at: new Date().toISOString()
        });
    }
    console.log(`[Sync] Sincronizadas ${localTables.length} mesas com o Supabase.`);

    // 2. Sincronizar todas as vendas concluídas e arquivadas locais com o Supabase
    const localOrders = await db.orders
      .where('status')
      .anyOf(['completed', 'archived'])
      .toArray();

    for (const order of localOrders) {
      await supabase
        .from('orders')
        .upsert({
          id: order.id,
          table_id: order.tableId,
          items: order.items,
          status: order.status,
          total: order.total,
          created_at: new Date(order.createdAt).toISOString(),
          customer_name: order.customerName || null,
          customer_nif: order.customerNif || null,
          payment_method: order.paymentMethod || null,
          updated_at: new Date().toISOString()
        });
    }
    console.log(`[Sync] Sincronizadas ${localOrders.length} vendas históricas com o Supabase.`);
  } catch (error) {
    console.error("Erro na sincronização histórica:", error);
  }
}

// Serviço para restaurar a base de dados IndexedDB local a partir do Supabase (Disaster Recovery)
export async function restoreDataFromSupabase(): Promise<boolean> {
  if (!navigator.onLine) return false;
  console.log("[Restore] A iniciar recuperação de desastres a partir do Supabase...");

  try {
    // 1. Carregar dados das tabelas do Supabase em paralelo
    const [
      { data: remoteMenu, error: menuErr },
      { data: remoteTables, error: tablesErr },
      { data: remoteOrders, error: ordersErr },
      { data: remotePaymentMethods, error: paymentsErr }
    ] = await Promise.all([
      supabase.from('menu_items').select('*'),
      supabase.from('restaurant_tables').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('payment_methods').select('*')
    ]);

    // Se houver erros graves nas consultas ao Supabase, aborta a restauração
    if (menuErr || tablesErr || ordersErr || paymentsErr) {
      console.error("[Restore] Falha ao descarregar tabelas do Supabase:", {
        menuErr,
        tablesErr,
        ordersErr,
        paymentsErr
      });
      return false;
    }

    // Se todas as tabelas na nuvem estiverem vazias, significa que não há nada para restaurar
    const totalRemoteRecords = 
      (remoteMenu?.length || 0) + 
      (remoteTables?.length || 0) + 
      (remoteOrders?.length || 0) + 
      (remotePaymentMethods?.length || 0);

    if (totalRemoteRecords === 0) {
      console.log("[Restore] O Supabase não contém dados sincronizados. Abortando restauração.");
      return false;
    }

    console.log(`[Restore] A repovoar IndexedDB local com ${totalRemoteRecords} registos descarregados do Supabase...`);

    // 2. Limpar e preencher a tabela de artigos (Ementa)
    if (remoteMenu && remoteMenu.length > 0) {
      await db.menuItems.clear();
      await db.menuItems.bulkAdd(
        remoteMenu.map(item => ({
          id: Number(item.id),
          name: item.name,
          price: Number(item.price),
          category: item.category,
          image: item.image || undefined
        }))
      );
      console.log(`[Restore] Restaurados ${remoteMenu.length} artigos da ementa.`);
    }

    // 3. Limpar e preencher a tabela de mesas
    if (remoteTables && remoteTables.length > 0) {
      await db.restaurantTables.clear();
      await db.restaurantTables.bulkAdd(
        remoteTables.map(table => ({
          id: Number(table.id),
          number: Number(table.number),
          status: table.status,
          currentOrderTotal: Number(table.current_order_total || 0)
        }))
      );
      console.log(`[Restore] Restauradas ${remoteTables.length} mesas.`);
    }

    // 4. Limpar e preencher a tabela de faturas/vendas
    if (remoteOrders && remoteOrders.length > 0) {
      await db.orders.clear();
      await db.orders.bulkAdd(
        remoteOrders.map(order => ({
          id: Number(order.id),
          tableId: Number(order.table_id),
          items: order.items,
          status: order.status,
          total: Number(order.total),
          createdAt: new Date(order.created_at).getTime(), // Converte ISO string para timestamp de milissegundos local
          customerName: order.customer_name || undefined,
          customerNif: order.customer_nif || undefined,
          paymentMethod: order.payment_method || undefined
        }))
      );
      console.log(`[Restore] Restauradas ${remoteOrders.length} faturas históricas.`);
    }

    // 5. Limpar e preencher a tabela de formas de pagamento
    if (remotePaymentMethods && remotePaymentMethods.length > 0) {
      await db.paymentMethods.clear();
      await db.paymentMethods.bulkAdd(
        remotePaymentMethods.map(method => ({
          id: Number(method.id),
          name: method.name,
          icon: method.icon,
          active: Boolean(method.active),
          sortOrder: Number(method.sortOrder)
        }))
      );
      console.log(`[Restore] Restauradas ${remotePaymentMethods.length} formas de pagamento.`);
    }

    console.log("[Restore] Restauração concluída com absoluto sucesso!");
    return true;
  } catch (error) {
    console.error("[Restore] Erro catastrófico ao restaurar dados do Supabase:", error);
    return false;
  }
}


