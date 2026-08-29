import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Space } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';

type ViewState = 'loading' | 'ready' | 'email' | 'code' | 'expired' | 'error';

let qrRequest: Promise<Record<string, any>> | undefined;
const requestQr = (commonApi: CommonApi, refresh = false) => {
	if (refresh) qrRequest = undefined;
	qrRequest ??= commonApi.apiFetch('/api/accounts/external/wechat?format=json').then((response) => response.json());
	return qrRequest;
};

export default function WechatQrLogin({ commonApi }: { commonApi: CommonApi }) {
	const [state, setState] = useState<ViewState>('loading'), [message, setMessage] = useState('正在获取二维码…');
	const [bindUrl, setBindUrl] = useState(''), [email, setEmail] = useState(''), [code, setCode] = useState(''), [submitting, setSubmitting] = useState(false);
	const qrRef = useRef<HTMLDivElement>(null), timerRef = useRef<number | undefined>(undefined);
	const stopPolling = () => { if (timerRef.current) window.clearInterval(timerRef.current); timerRef.current = undefined; };
	const load = (refresh = false) => {
		stopPolling(); setState('loading'); setMessage('正在获取二维码…'); setBindUrl(''); setEmail(''); setCode('');
		requestQr(commonApi, refresh).then((data) => {
			const renderQr = () => { if (!qrRef.current) return; qrRef.current.innerHTML = ''; new (window as any).QRCode(qrRef.current, data.authorizationUrl); setState('ready'); setMessage('请使用微信扫描二维码'); };
			if ((window as any).QRCode) renderQr(); else { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'; script.onload = renderQr; document.head.appendChild(script); }
			timerRef.current = window.setInterval(async () => { const result = await (await commonApi.apiFetch(data.pollUrl)).json(); if (result.status === 'authenticated') { stopPolling(); window.location.assign(result.redirectTo || '/'); } else if (result.status === 'needs_email') { stopPolling(); setBindUrl(result.bindUrl); setState('email'); setMessage('微信身份已确认，请验证邮箱'); } else if (result.status === 'expired') { stopPolling(); setState('expired'); setMessage('二维码已失效，请刷新后重新扫码'); } }, 2000);
		}).catch((error) => { setState('error'); setMessage(error instanceof Error ? error.message : '获取二维码失败'); });
	};
	const submit = async (step: 'email' | 'verify') => {
		if (step === 'email' && !email.trim()) { setMessage('请输入接收验证码的邮箱'); return; }
		if (step === 'verify' && !/^\d{6}$/.test(code.trim())) { setMessage('请输入 6 位数字验证码'); return; }
		if (step === 'email' && !await commonApi.modalConfirm([`验证码将发送到：${email.trim()}`, '请确认邮箱地址正确，发送后才能继续验证。'])) return;
		setSubmitting(true);
		try {
			const response = await commonApi.apiFetch(bindUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(step === 'email' ? { step, email: email.trim() } : { step, code: code.trim() }) });
			const result = await response.json();
			if (!response.ok) { setMessage(result?.feedback?.message || '邮箱验证失败，请检查后重试'); return; }
			if (step === 'email') { setState('code'); setMessage(`请到 ${email.trim()} 查收邮件，验证码已发送到该地址。`); }
			else { setMessage('邮箱验证完成，正在登录…'); window.location.assign(result.redirectTo || '/'); }
		} catch { setMessage('网络请求失败，请稍后重试'); }
		finally { setSubmitting(false); }
	};
	useEffect(() => { load(); return stopPolling; }, []);
	return <main style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}><h2>微信扫码登录</h2><div ref={qrRef} style={{ display: state === 'ready' ? 'inline-block' : 'none', margin: 24 }} />{state === 'email' ? <><Alert type="info" showIcon message="微信身份已确认，请输入用于 Accounts 的邮箱。验证码只会发送到你填写的地址。" style={{ marginTop: 20, marginBottom: 16, textAlign: 'left' }} /><Space.Compact style={{ maxWidth: 420, width: '100%' }}><Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" disabled={submitting} /><Button type="primary" loading={submitting} onClick={() => submit('email')}>发送验证码</Button></Space.Compact></> : null}{state === 'code' ? <><Alert type="info" showIcon message={message} style={{ marginTop: 20, marginBottom: 16, textAlign: 'left' }} /><Space.Compact style={{ maxWidth: 420, width: '100%' }}><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入 6 位验证码" maxLength={6} disabled={submitting} /><Button type="primary" loading={submitting} onClick={() => submit('verify')}>验证邮箱</Button></Space.Compact><Button type="link" disabled={submitting} onClick={() => { setState('email'); setCode(''); setMessage('请重新输入接收验证码的邮箱'); }}>更换邮箱</Button></> : null}{state !== 'email' && state !== 'code' ? <Alert type={state === 'error' || state === 'expired' ? 'error' : 'info'} showIcon message={message} style={{ marginTop: 20 }} /> : null}{state === 'expired' || state === 'error' ? <Button onClick={() => load(true)} style={{ marginTop: 16 }}>刷新二维码</Button> : null}</main>;
}
