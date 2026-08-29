import { useEffect, useState } from 'react';
import type { CommonApi } from '@/utils/common/api.js';

type CallbackResult = { ok: boolean; result: Record<string, any> };
const callbackRequests = new Map<string, Promise<CallbackResult>>();

const consumeCallback = (commonApi: CommonApi, url: string) => {
	let pending = callbackRequests.get(url);
	if (!pending) {
		pending = commonApi.apiFetch(url).then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }));
		callbackRequests.set(url, pending);
	}
	return pending;
};

export default function ExternalCallback({ commonApi }: { commonApi: CommonApi }) {
	const [message, setMessage] = useState('正在处理微信授权…');
	useEffect(() => {
		const query = new URLSearchParams(window.location.search);
		const provider = query.get('provider') || 'wechat';
		query.set('consume', '1');
		const url = `/api/accounts/external/${encodeURIComponent(provider)}?${query.toString()}`;
		consumeCallback(commonApi, url)
			.then(({ ok, result }) => {
				if (ok && result?.status === 'signed_in' && !result?.redirectTo) { setMessage('授权成功，请返回电脑页面'); return; }
				if (ok && result?.status === 'authorized') { setMessage('微信身份已确认，请返回电脑完成邮箱验证'); return; }
				if (ok) window.location.assign(result?.redirectTo || '/');
				else setMessage(result?.feedback?.message || '微信授权失败，请返回登录页重试');
			})
			.catch(() => setMessage('网络请求失败，请返回登录页重试'));
	}, [commonApi]);
	return <main style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}><h2>微信登录</h2><p>{message}</p></main>;
}
