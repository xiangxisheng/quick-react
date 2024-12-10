import React from 'react';
import { BrowserRouter as Router, Route, Routes, useNavigate } from 'react-router-dom';
import Table from './table';

const App1 = () => {
	const navigate = useNavigate();
	function handleClick() {
		navigate('/table');
	}
	return (
		<>
			<h1>Hello, React with esbuild!</h1>
			<button onClick={handleClick}>Fetch</button>
		</>
	);
};

function AppRouter() {
	return (
		<Router>
			<Routes>
				<Route path="/" element={<App1 />} />
				<Route path="/table" element={<Table />} />
				<Route path="/api/*" element={<Table />} />
			</Routes>
		</Router>
	);
}

export default AppRouter;
