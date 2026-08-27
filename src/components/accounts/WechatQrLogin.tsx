import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Space } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';

type ViewState = 'loading' | 'ready' | 'email' | 'code' | 'expired' | 'error';

export default function WechatQrLogin({ commonApi }: { commonApi: CommonApi }) {
	const [state, setState] = useState<ViewState>('loading'), [message, setMessage] = useState('正在获取二维码…');
	const [bindUrl, setBindUrl] = useState(''), [email, setEmail] = useState(''), [code, setCode] = useState('');
	const qrRef = useRef<HTMLDivElement>(null), timerRef = useRef<number | undefined>(undefined);
	const stopPolling = () => { if (timerRef.current) window.clearInterval(timerRef.current); timerRef.current = undefined; };
	const load = () => {
		stopPolling(); setState('loading'); setMessage('正在获取二维码…'); setBindUrl(''); setEmail(''); setCode('');
		commonApi.apiFetch('/api/accounts/external/wechat?format=json').then(async (response) => {
			const data = await response.json(); if (!response.ok) throw new Error(data?.feedback?.message || '获取二维码失败');
			const renderQr = () => { if (!qrRef.current) return; qrRef.current.innerHTML = ''; new (window as any).QRCode(qrRef.current, data.authorizationUrl); setState('ready'); setMessage('请使用微信扫描二维码'); };
			if ((window as any).QRCode) renderQr(); else { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'; script.onload = renderQr; document.head.appendChild(script); }
			timerRef.current = window.setInterval(async () => { const result = await (await commonApi.apiFetch(data.pollUrl)).json(); if (result.status === 'authenticated') { stopPolling(); window.location.assign('/'); } else if (result.status === 'needs_email') { stopPolling(); setBindUrl(result.bindUrl); setState('email'); setMessage('微信身份已确认，请验证邮箱'); } else if (result.status === 'expired') { stopPolling(); setState('expired'); setMessage('二维码已失效，请刷新后重新扫码'); } }, 2000);
		}).catch((error) => { setState('error'); setMessage(error instanceof Error ? error.message : '获取二维码失败'); });
	};
	const submit = async (step: 'email' | 'verify') => { const response = await commonApi.apiFetch(bindUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(step === 'email' ? { step, email } : { step, code }) }); const result = await response.json(); if (!response.ok) { setMessage(result?.feedback?.message || '邮箱验证失败'); return; } if (step === 'email') { setState('code'); setMessage('验证码已发送，请输入邮件中的验证码'); } else { setMessage('邮箱验证完成，正在登录…'); window.location.assign('/'); } };
	useEffect(() => { load(); return stopPolling; }, []);
	return <main style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}><h2>微信扫码登录</h2><div ref={qrRef} style={{ display: state === 'ready' ? 'inline-block' : 'none', margin: 24 }} />{state === 'email' ? <Space.Compact style={{ maxWidth: 420 }}><Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" /><Button type="primary" onClick={() => submit('email')}>发送验证码</Button></Space.Compact> : null}{state === 'code' ? <Space.Compact style={{ maxWidth: 420 }}><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="请输入 6 位验证码" /><Button type="primary" onClick={() => submit('verify')}>验证邮箱</Button></Space.Compact> : null}<Alert type={state === 'error' || state === 'expired' ? 'error' : 'info'} showIcon message={message} style={{ marginTop: 20 }} />{state === 'expired' || state === 'error' ? <Button onClick={load} style={{ marginTop: 16 }}>刷新二维码</Button> : null}</main>;
}
