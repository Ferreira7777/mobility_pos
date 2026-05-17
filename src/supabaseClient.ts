import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Serviço simples para sincronizar a fila de outbox (syncQueue) com o Supabase quando há internet
export async function syncOfflineData() {
  if (!navigator.onLine) return;

  try {
    // Exemplo de como a sincronização funcionaria.
    // Lemos as ações pendentes na fila local e enviamos para as tabelas equivalentes no Supabase.
    // Opcional: Implementar dependendo se o Supabase já está totalmente ligado com tabelas idênticas.
    console.log("A verificar sincronização de dados pendentes com o Supabase...");
  } catch (error) {
    console.error("Erro na sincronização:", error);
  }
}

// Escutar eventos de transição online/offline
if (typeof window !== 'undefined') {
  window.addEventListener('online', syncOfflineData);
}
