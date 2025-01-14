import React, { useState } from 'react';
import { Form, Input, Checkbox, Space, Button } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';

type FormState = {
	username: string;
	password: string;
	password_confirm?: string;
	remember: boolean;
};

type SignFormProps = {
	//GTR: (path: string, params?: Record<string, any>) => string;
};

const GTR = (a: string, params?: Record<string, string>): string => {
	return a;
}

const SignForm: React.FC<SignFormProps> = () => {
	const [formState, setFormState] = useState<FormState>({
		username: '',
		password: '',
		password_confirm: '',
		remember: false,
	});

	const navigate = useNavigate();
	const location = useLocation();
	const routeName = location.pathname;

	const onFinish = (values: FormState) => {
		console.log('Success:', values);
	};

	const onFinishFailed = (errorInfo: any) => {
		console.log('Failed:', errorInfo);
	};

	return (
		<div>
			<h1 style={{ textAlign: 'center', margin: '40px' }}>
				{routeName === '/sign-up' ? GTR('sign.register') : GTR('sign.login')}
			</h1>

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

				{routeName === '/sign-up' && (
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
						{routeName === '/sign-in' && (
							<Button type="link" onClick={() => navigate('/sign-up')}>
								{GTR('sign.register')}
							</Button>
						)}

						{routeName === '/sign-up' && (
							<Button type="link" onClick={() => navigate('/sign-in')}>
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
