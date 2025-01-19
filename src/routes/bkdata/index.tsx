import type { CommonApi } from '@/utils/common/api';
import { Routes, Route } from 'react-router-dom';
import Panel from './panel';

type AppType = {
	commonApi: CommonApi;
};

function AppRouter({ commonApi }: AppType) {

	return (
		<Routes>
			<Route path="/panel/*" element={<Panel commonApi={commonApi} />} />
		</Routes>
	);
}

export default AppRouter;
