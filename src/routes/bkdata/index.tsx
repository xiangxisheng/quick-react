import { Routes, Route } from 'react-router-dom';
import Panel from './panel';

type AppType = {
	api_fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function AppRouter({ api_fetch }: AppType) {

	return (
		<Routes>
			<Route path="/panel/*" element={<Panel api_fetch={api_fetch} />} />
		</Routes>
	);
}

export default AppRouter;
