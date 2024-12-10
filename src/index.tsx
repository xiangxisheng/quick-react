// src/index.tsx
import type React from 'react';
import ReactDOM from 'react-dom/client';
import AppRouter from './route';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<AppRouter />);
