import React from 'react';
import { useLocation } from 'react-router-dom';
import type { CommonApi } from '@/utils/common/api.js';
import FormPage from './panel/Form.js';

type SignFormProps = {
	commonApi: CommonApi;
};

const SignForm: React.FC<SignFormProps> = ({ commonApi }) => {
	const location = useLocation();
	const initialData = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string; pageSuffix?: string } }).__INITIAL_DATA__;
	const apiSuffix = initialData?.apiSuffix ?? '';
	const pageSuffix = initialData?.pageSuffix ?? '';
	const routeName = pageSuffix && location.pathname.endsWith(pageSuffix)
		? location.pathname.slice(0, -pageSuffix.length)
		: location.pathname;
	const isSignUp = routeName === '/sign-up';
	const signPath = `/api/sign${apiSuffix}?mode=${isSignUp ? 'sign-up' : 'sign'}`;

	return <FormPage
		commonApi={commonApi}
		apiPath={signPath}
		title={isSignUp ? '注册' : '登录'}
		submitMethod={isSignUp ? 'PUT' : 'POST'}
		redirectOnFeedback
		onSaved={() => isSignUp ? `/sign${pageSuffix}` : `/panel/admin${pageSuffix}`}
	/>;
};

export default SignForm;
