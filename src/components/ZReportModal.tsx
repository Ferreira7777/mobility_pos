import React from 'react';
import { Receipt, X, RefreshCw } from 'lucide-react';
import type { Order } from '../db';

interface ZReportModalProps {
  showZReportModal: boolean;
  setShowZReportModal: (show: boolean) => void;
  completedOrders: Order[];
  handleArchiveZReport: () => void;
  selectedReceiptId: number | null;
  setSelectedReceiptId: (id: number | null) => void;
}

export function ZReportModal({
  showZReportModal,
  setShowZReportModal,
  completedOrders,
  handleArchiveZReport,
  selectedReceiptId,
  setSelectedReceiptId
}: ZReportModalProps) {
  if (!showZReportModal && !selectedReceiptId) return null;

  return (
    <>
      {showZReportModal && (
        <div className="fixed inset-0 bg-slate-100/80 dark:bg-slate-950 bg-white/50 dark:light:bg-slate-900/10 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="glass max-w-4xl w-full max-h-[85vh] rounded-3xl overflow-hidden flex flex-col border border-slate-900/10 dark:border-white/10 shadow-2xl">
            {/* Cabeçalho */}
            <div className="p-6 border-b border-slate-900/5 dark:border-white/5 flex justify-between items-center bg-white/40 dark:bg-slate-900 light:bg-slate-50">
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-brand-600 dark:text-brand-400" />
                  Fecho de Caixa (Z-Report)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 light:text-slate-600">Resumo de vendas do turno atual. Um fecho irá arquivar estas vendas e reiniciar os totais.</p>
              </div>
              <button 
                onClick={() => setShowZReportModal(false)}
                className="w-9 h-9 rounded-xl glass-interactive flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Corpo do Modal */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-100/30 dark:bg-slate-900/10">
              
              {/* Esquerda: Resumo */}
              <div className="md:col-span-1 space-y-4">
                <div className="bg-white dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-900/5 dark:border-white/5 shadow-sm">
                  <h4 className="font-semibold text-slate-900 dark:text-white mb-4 text-sm">Resumo Financeiro</h4>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-end border-b border-slate-900/5 dark:border-white/5 pb-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Total Faturado</span>
                      <span className="text-2xl font-extrabold text-brand-700 dark:text-brand-300">
                        {completedOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}€
                      </span>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Total de Vendas</span>
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{completedOrders.length} transações</span>
                    </div>

                    {/* Breakdown por pagamento */}
                    <div className="pt-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2 block">Por Método de Pagamento</span>
                      <div className="space-y-2">
                        {Object.entries(
                          completedOrders.reduce((acc, order) => {
                            const method = order.paymentMethod || 'Desconhecido';
                            acc[method] = (acc[method] || 0) + order.total;
                            return acc;
                          }, {} as Record<string, number>)
                        ).map(([method, total]) => (
                          <div key={method} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-900/5 dark:border-white/5">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{method}</span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white">{total.toFixed(2)}€</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={handleArchiveZReport}
                  disabled={completedOrders.length === 0}
                  className="w-full bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white font-bold px-4 py-4 rounded-xl text-sm shadow-lg shadow-rose-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Fechar Dia e Arquivar
                </button>
              </div>

              {/* Direita: Lista de Faturas */}
              <div className="md:col-span-2">
                <div className="bg-white dark:bg-slate-900/30 rounded-2xl border border-slate-900/5 dark:border-white/5 shadow-sm h-full flex flex-col">
                  <div className="p-4 border-b border-slate-900/5 dark:border-white/5">
                    <h4 className="font-semibold text-slate-900 dark:text-white text-sm">Transações do Turno ({completedOrders.length})</h4>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {completedOrders.length === 0 ? (
                      <div className="text-center py-10 text-slate-500 dark:text-slate-400 text-xs">
                        Nenhuma venda registada neste turno.
                      </div>
                    ) : (
                      completedOrders.map(order => (
                        <div key={order.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-900/5 dark:border-white/5 gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-slate-900 dark:text-white text-sm">Fatura #{order.id}</span>
                              <span className="text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-700 px-1.5 rounded text-white">{new Date(order.createdAt).toLocaleTimeString('pt-PT')}</span>
                              <span className="text-[10px] font-semibold text-brand-600 dark:text-brand-400 bg-brand-500/10 px-1.5 rounded border border-brand-500/20">
                                {order.tableId === 0 ? "Balcão" : `Mesa ${order.tableId}`}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[250px]">
                              {order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                            </p>
                          </div>
                          <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                            <div className="text-right">
                              <span className="block text-xs font-bold text-slate-900 dark:text-white">{order.total.toFixed(2)}€</span>
                              <span className="text-[9px] text-slate-500 uppercase">{order.paymentMethod || 'N/A'}</span>
                            </div>
                            <button 
                              onClick={() => setSelectedReceiptId(order.id!)}
                              className="glass-interactive px-3 py-1.5 rounded-lg text-[10px] font-bold text-brand-600 dark:text-brand-400 border border-brand-500/20 hover:bg-brand-500 hover:text-white flex items-center gap-1"
                            >
                              <Receipt className="w-3 h-3" />
                              Ver Talão
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE PRÉ-VISUALIZAÇÃO DE TALÃO */}
      {selectedReceiptId && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-[320px] rounded flex flex-col shadow-2xl text-slate-900 relative">
            <button 
              onClick={() => setSelectedReceiptId(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center shadow-lg hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
            
            {/* Design do Talão Térmico */}
            <div className="p-6 flex-1 max-h-[70vh] overflow-y-auto receipt-paper" id="printable-receipt">
              <div className="text-center mb-6 border-b-2 border-dashed border-slate-300 pb-4">
                <h2 className="font-bold text-lg uppercase tracking-widest">Mobility POS</h2>
                <p className="text-[10px] text-slate-600">Restauração Offline-First</p>
                <p className="text-[10px] text-slate-600 mt-2">NIF: 500 000 000</p>
                <p className="text-[10px] text-slate-600">Fatura Simplificada #{selectedReceiptId}</p>
                <p className="text-[10px] text-slate-600">
                  {new Date(completedOrders.find(o => o.id === selectedReceiptId)?.createdAt || Date.now()).toLocaleString('pt-PT')}
                </p>
              </div>

              <div className="mb-4 space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase border-b border-slate-200 pb-1">
                  <span>Qtd. Artigo</span>
                  <span>Valor</span>
                </div>
                {completedOrders.find(o => o.id === selectedReceiptId)?.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs items-start">
                    <span className="flex-1 pr-2">{item.quantity}x {item.name}</span>
                    <span className="font-medium">{(item.price * item.quantity).toFixed(2)}€</span>
                  </div>
                ))}
              </div>

              <div className="border-t-2 border-dashed border-slate-300 pt-4 mb-6">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs uppercase text-slate-600">Total (IVA inc.)</span>
                  <span className="text-lg font-bold">{completedOrders.find(o => o.id === selectedReceiptId)?.total.toFixed(2)}€</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase text-slate-500">Forma de Pagamento</span>
                  <span className="text-xs font-bold">{completedOrders.find(o => o.id === selectedReceiptId)?.paymentMethod || 'N/A'}</span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-500">
                <p>Obrigado pela sua visita!</p>
                <p className="mt-1">Processado por programa certificado N.º 0000</p>
              </div>
            </div>
            
            {/* Ações do Talão */}
            <div className="p-3 bg-slate-100 border-t border-slate-200 rounded-b flex gap-2">
              <button 
                onClick={() => {
                   const printContent = document.getElementById('printable-receipt');
                   const printWindow = window.open('', '', 'width=350,height=600');
                   if (printWindow && printContent) {
                     printWindow.document.write('<html><head><title>Imprimir Talão</title><style>body { font-family: monospace; padding: 20px; } .text-center { text-align: center; } .flex { display: flex; } .justify-between { justify-content: space-between; } .font-bold { font-weight: bold; } .text-lg { font-size: 1.125rem; } .text-xs { font-size: 0.75rem; } .mb-6 { margin-bottom: 1.5rem; } .pb-4 { padding-bottom: 1rem; } .border-b-2 { border-bottom-width: 2px; } .border-dashed { border-style: dashed; } .border-slate-300 { border-color: #cbd5e1; } .mt-2 { margin-top: 0.5rem; } .space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem; } .uppercase { text-transform: uppercase; } .pt-4 { padding-top: 1rem; } .border-t-2 { border-top-width: 2px; }</style></head><body>');
                     printWindow.document.write(printContent.innerHTML);
                     printWindow.document.write('</body></html>');
                     printWindow.document.close();
                     printWindow.focus();
                     printWindow.print();
                     printWindow.close();
                   }
                }}
                className="flex-1 bg-slate-900 text-white font-bold py-2 rounded text-xs hover:bg-slate-800 transition-colors"
              >
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
