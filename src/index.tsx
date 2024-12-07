// src/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';

const App = () => {
	return <h1>Hello, React with esbuild!</h1>;
};

const Root = () => {
	const root = ReactDOM.createRoot(document.getElementById('root')!);
	root.render(<App />);
}

Root();
