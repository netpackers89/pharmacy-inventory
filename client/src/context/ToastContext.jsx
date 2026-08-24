import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X, Loader } from 'lucide-react';
import './Toast.css';

const ToastContext = createContext();

let toastId = 0;

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const [loadingState, setLoadingState] = useState({ active: false, message: '' });
  const activeRequests = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 400);
  }, []);

  const addToast = useCallback((type, message, duration = 4000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, message, exiting: false }]);
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
    return id;
  }, [removeToast]);

  const toast = {
    success: (msg, duration) => addToast('success', msg, duration),
    error: (msg, duration) => addToast('error', msg, duration || 6000),
    warning: (msg, duration) => addToast('warning', msg, duration || 5000),
    info: (msg, duration) => addToast('info', msg, duration),
  };

  const showLoading = useCallback((message = 'Processing...') => {
    activeRequests.current += 1;
    setLoadingState({ active: true, message });
  }, []);

  const hideLoading = useCallback(() => {
    activeRequests.current = Math.max(0, activeRequests.current - 1);
    if (activeRequests.current === 0) {
      setLoadingState({ active: false, message: '' });
    }
  }, []);

  // Wrapper for async operations with loading + toast
  const withLoading = useCallback(async (asyncFn, { loadingMsg = 'Processing...', successMsg, errorMsg } = {}) => {
    showLoading(loadingMsg);
    try {
      const result = await asyncFn();
      if (successMsg) toast.success(successMsg);
      return result;
    } catch (err) {
      const msg = errorMsg || err?.response?.data?.error || err?.response?.data?.details || err?.message || 'Operation failed';
      toast.error(msg);
      throw err;
    } finally {
      hideLoading();
    }
  }, [showLoading, hideLoading]);

  const icons = {
    success: <CheckCircle size={20} />,
    error: <XCircle size={20} />,
    warning: <AlertTriangle size={20} />,
    info: <Info size={20} />,
  };

  return (
    <ToastContext.Provider value={{ toast, showLoading, hideLoading, withLoading }}>
      {children}

      {/* Loading Overlay */}
      {loadingState.active && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner">
              <div className="spinner-ring"></div>
              <div className="spinner-ring spinner-ring-2"></div>
              <div className="spinner-ring spinner-ring-3"></div>
              <div className="spinner-dot"></div>
            </div>
            <p className="loading-message">{loadingState.message}</p>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-item toast-${t.type} ${t.exiting ? 'toast-exit' : 'toast-enter'}`}
            role="alert"
          >
            <div className="toast-icon">{icons[t.type]}</div>
            <div className="toast-body">
              <p className="toast-message">{t.message}</p>
            </div>
            <button className="toast-close" onClick={() => removeToast(t.id)} aria-label="Close">
              <X size={16} />
            </button>
            <div className="toast-progress">
              <div
                className="toast-progress-bar"
                style={{ animationDuration: `${t.type === 'error' ? 6 : t.type === 'warning' ? 5 : 4}s` }}
              />
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
