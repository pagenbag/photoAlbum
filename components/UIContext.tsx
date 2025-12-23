import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  isDangerous?: boolean;
}

interface UIContextType {
  showToast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) throw new Error('useUI must be used within a UIProvider');
  return context;
};

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmOptions | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setConfirmDialog(options);
  }, []);

  const closeConfirm = () => setConfirmDialog(null);

  return (
    <UIContext.Provider value={{ showToast, confirm }}>
      {children}
      
      {/* Toast Container */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div 
            key={toast.id}
            className={`
              min-w-[250px] max-w-sm p-4 rounded shadow-lg border-l-4 animate-slide-in pointer-events-auto
              bg-[#fdfbf7] flex flex-col gap-1
              ${toast.type === 'error' ? 'border-red-500' : ''}
              ${toast.type === 'success' ? 'border-green-500' : ''}
              ${toast.type === 'info' ? 'border-blue-500' : ''}
            `}
          >
            <div className="flex items-center gap-2">
                {toast.type === 'success' && <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                {toast.type === 'error' && <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                {toast.type === 'info' && <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                
                <p className={`font-playfair font-bold text-lg capitalize ${
                    toast.type === 'error' ? 'text-red-800' : 
                    toast.type === 'success' ? 'text-green-800' : 'text-stone-800'
                }`}>
                    {toast.type}
                </p>
            </div>
            <p className="font-sans text-stone-600 text-sm ml-7">{toast.message}</p>
          </div>
        ))}
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4 animate-[fadeIn_0.2s_ease-out]">
           <div className="bg-[#fdfbf7] p-8 rounded-lg shadow-2xl max-w-md w-full border border-stone-300 transform scale-100 transition-all">
              <h3 className="font-playfair text-2xl text-stone-800 mb-2">{confirmDialog.title}</h3>
              <p className="font-sans text-stone-600 mb-6 whitespace-pre-line leading-relaxed">{confirmDialog.message}</p>
              
              <div className="flex justify-end gap-3">
                 <button 
                    onClick={closeConfirm}
                    className="px-4 py-2 text-stone-600 hover:text-stone-800 font-sans transition-colors rounded hover:bg-stone-100"
                 >
                    {confirmDialog.cancelText || 'Cancel'}
                 </button>
                 <button 
                    onClick={() => {
                        confirmDialog.onConfirm();
                        closeConfirm();
                    }}
                    className={`px-6 py-2 rounded text-white font-playfair shadow-md transition-colors
                        ${confirmDialog.isDangerous 
                            ? 'bg-red-800 hover:bg-red-900' 
                            : 'bg-stone-800 hover:bg-stone-700'
                        }
                    `}
                 >
                    {confirmDialog.confirmText || 'Confirm'}
                 </button>
              </div>
           </div>
        </div>
      )}
    </UIContext.Provider>
  );
};