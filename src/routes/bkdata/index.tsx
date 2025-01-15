import { Routes, Route } from 'react-router-dom';
import Panel from './panel';

function AppRouter() {

	return (
		<Routes>
			<Route path="/panel/*" element={<Panel />} />
		</Routes>
	);
}

export default AppRouter;
