// src/index.tsx
import type React from 'react';
import ReactDOM from 'react-dom/client';
import RouteIndex from './routes/index';

// 修改 root 元素的 CSS
const rootElement = document.getElementById('root');
if (rootElement) {
	rootElement.style.height = '100%';
	ReactDOM.createRoot(rootElement).render(<RouteIndex />);
}
