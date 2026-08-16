import React, { useState } from 'react';
import { Alert, Form, Input, Checkbox, Space, Button } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import type { CommonApi } from '@/utils/common/api.js';
import { CountdownDisplay } from '@/components/common/Countdown.js';
import { runAfterFeedback } from '@/utils/common/feedback.js';

type FormState = {
	username: string;
	password: string;
	password_confirm?: string;
	remember: boolean;
};

type SignFormProps = {
	commonApi: CommonApi;
};

const GTR = (a: string, params?: Record<string, string>): string => {
	return a;
}

const SignForm: React.FC<SignFormProps> = ({ commonApi }) => {
	const [formState, setFormState] = useState<FormState>({
		username: '',
		password: '',
		password_confirm: '',
		remember: false,
	});
	const [redirectDeadline, setRedirectDeadline] = useState<number>();

	const navigate = useNavigate();
	const location = useLocation();
	const initialData = (window as Window & { __INITIAL_DATA__?: { apiSuffix?: string; pageSuffix?: string } }).__INITIAL_DATA__;
	const apiSuffix = initialData?.apiSuffix ?? '';
	const pageSuffix = initialData?.pageSuffix ?? '';
	const routeName = pageSuffix && location.pathname.endsWith(pageSuffix)
		? location.pathname.slice(0, -pageSuffix.length)
		: location.pathname;
	const isSignUp = routeName === '/sign-up';

	const onFinish = async (values: FormState) => {
		try {
			const response = await commonApi.apiFetch(`/api/sign${apiSuffix}`, {
				method: isSignUp ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			});
			const result = await response.json() as { feedback?: { redirectAfter?: number } };
			const schedule = runAfterFeedback(result.feedback, () => {
				window.location.href = isSignUp ? `/sign${pageSuffix}` : `/panel/admin${pageSuffix}`;
			});
			setRedirectDeadline(schedule.deadline);
		} catch {
			// apiFetch 已统一展示接口错误，这里只阻止表单提交产生未处理异常。
		}
	};

	const onFinishFailed = (errorInfo: any) => {
		console.log('Failed:', errorInfo);
	};

	return (
		<div>
			<h1 style={{ textAlign: 'center', margin: '40px' }}>
				{isSignUp ? GTR('sign.register') : GTR('sign.login')}
			</h1>
			{redirectDeadline ? (
				<Alert
					type="success"
					showIcon
					message={<span>操作成功，<CountdownDisplay deadline={redirectDeadline} onFinish={() => undefined} /> 秒后跳转</span>}
					style={{ margin: '0 40px 24px' }}
				/>
			) : null}

			<Form
				name="basic"
				labelCol={{ span: 8 }}
				wrapperCol={{ span: 10 }}
				autoComplete="off"
				onFinish={onFinish}
				onFinishFailed={onFinishFailed}
				style={{ textAlign: 'center', margin: '0 40px' }}
			>
				<Form.Item
					label={GTR('sign.username')}
					name="username"
					rules={[{ required: true, message: GTR('table.please_enter', { title: GTR('sign.username') }) }]}
				>
					<Input
						value={formState.username}
						onChange={(e) => setFormState({ ...formState, username: e.target.value })}
					/>
				</Form.Item>

				<Form.Item
					label={GTR('sign.password')}
					name="password"
					rules={[{ required: true, message: GTR('table.please_enter', { title: GTR('sign.password') }) }]}
				>
					<Input.Password
						value={formState.password}
						onChange={(e) => setFormState({ ...formState, password: e.target.value })}
					/>
				</Form.Item>

				{isSignUp && (
					<Form.Item
						label={GTR('sign.confirmPassword')}
						name="password_confirm"
						rules={[{ required: true, message: 'Please confirm your password!' }]}
					>
						<Input.Password
							value={formState.password_confirm}
							onChange={(e) => setFormState({ ...formState, password_confirm: e.target.value })}
						/>
					</Form.Item>
				)}

				<Form.Item name="remember" valuePropName="checked" wrapperCol={{ span: 24 }}>
					<Checkbox
						checked={formState.remember}
						onChange={(e) => setFormState({ ...formState, remember: e.target.checked })}
					>
						Remember me
					</Checkbox>
				</Form.Item>

				<Form.Item wrapperCol={{ span: 24 }}>
					<Space wrap>
						{!isSignUp && (
							<Button type="link" onClick={() => navigate(`/sign-up${pageSuffix}`)}>
								{GTR('sign.register')}
							</Button>
						)}

						{isSignUp && (
							<Button type="link" onClick={() => navigate(`/sign${pageSuffix}`)}>
								{GTR('sign.login')}
							</Button>
						)}

						<Button type="primary" htmlType="submit">
							{GTR('sign.submit')}
						</Button>
					</Space>
				</Form.Item>
			</Form>
		</div>
	);
};

export default SignForm;
