import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LoginPage } from './components/LoginPage.tsx'
import { supabase } from './supabaseClient.ts'
import type { Session } from '@supabase/supabase-js'

function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // Verificar sessão existente ao arrancar
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    // Escutar mudanças de autenticação (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // A carregar sessão — ecrã em branco mínimo
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Sem sessão → mostrar login
  if (!session) {
    return <LoginPage onLogin={() => {/* onAuthStateChange atualiza automaticamente */}} />;
  }

  // Com sessão → POS completo
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
