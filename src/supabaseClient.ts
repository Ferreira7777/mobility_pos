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
                  created_at: localOrder.createdAt,
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
                created_at: localOrder ? localOrder.createdAt : Date.now(),
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
