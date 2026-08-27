import { useEffect, useState } from 'react';
import type { CommonApi } from '@/utils/common/api.js';

export default function ExternalCallback({ commonApi }: { commonApi: CommonApi }) {
	const [message, setMessage] = useState('正在处理微信授权…');
	useEffect(() => {
		const query = new URLSearchParams(window.location.search);
		const provider = query.get('provider') || 'wechat';
		query.set('consume', '1');
		commonApi.apiFetch(`/api/accounts/external/${encodeURIComponent(provider)}?${query.toString()}`)
			.then(async (response) => {
				const result = await response.json().catch(() => ({}));
				if (response.ok) window.location.assign('/');
				else setMessage(result?.feedback?.message || '微信授权失败，请返回登录页重试');
			})
			.catch(() => setMessage('网络请求失败，请返回登录页重试'));
	}, [commonApi]);
	return <main style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}><h2>微信登录</h2><p>{message}</p></main>;
}
