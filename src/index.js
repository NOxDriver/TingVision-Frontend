import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

if (typeof window !== 'undefined' && !window.__tingVisionAbortListenerAdded) {
  window.__tingVisionAbortListenerAdded = true;

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    if (!reason) {
      return;
    }

    const message = typeof reason?.message === 'string' ? reason.message.toLowerCase() : '';

    const isAbortError =
      reason?.name === 'AbortError' ||
      reason?.code === 'aborted' ||
      reason?.code === 'cancelled' ||
      message.includes('aborted') ||
      message.includes('signal is aborted without reason');

    if (isAbortError) {
      event.preventDefault();
    }
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
