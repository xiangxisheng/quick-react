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
				if (response.ok && result?.status === 'signed_in' && !result?.redirectTo) { setMessage('授权成功，请返回电脑页面'); return; }
				if (response.ok && result?.status === 'authorized') { setMessage('微信身份已确认，请返回电脑完成邮箱验证'); return; }
				if (response.ok) window.location.assign(result?.redirectTo || '/');
				else setMessage(result?.feedback?.message || '微信授权失败，请返回登录页重试');
			})
			.catch(() => setMessage('网络请求失败，请返回登录页重试'));
	}, [commonApi]);
	return <main style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}><h2>微信登录</h2><p>{message}</p></main>;
}
