import { useEffect, useRef, useState } from 'react';
import type { CommonApi } from '@/utils/common/api.js';

export default function WechatQrLogin({ commonApi }: { commonApi: CommonApi }) {
	const [state, setState] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading');
	const [message, setMessage] = useState('正在获取二维码…');
	const qrRef = useRef<HTMLDivElement>(null);
	const timerRef = useRef<number | undefined>(undefined);
	const load = () => { if (timerRef.current) window.clearInterval(timerRef.current); setState('loading'); setMessage('正在获取二维码…'); commonApi.apiFetch('/api/accounts/external/wechat?format=json').then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data?.feedback?.message || '获取二维码失败'); const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'; script.onload = () => { if (!qrRef.current) return; qrRef.current.innerHTML = ''; new (window as any).QRCode(qrRef.current, data.authorizationUrl); setState('ready'); setMessage('请使用微信扫描二维码'); timerRef.current = window.setInterval(async () => { const result = await (await commonApi.apiFetch(data.pollUrl)).json(); if (result.status === 'authenticated') { if (timerRef.current) window.clearInterval(timerRef.current); window.location.assign('/'); } else if (result.status === 'expired') { if (timerRef.current) window.clearInterval(timerRef.current); setState('expired'); setMessage('二维码已失效，请刷新后重新扫码'); } }, 2000); }; document.body.appendChild(script); }).catch((error) => { setState('error'); setMessage(error instanceof Error ? error.message : '获取二维码失败'); }); };
	useEffect(() => { load(); return () => { if (timerRef.current) window.clearInterval(timerRef.current); }; }, []);
  return <main style={{ maxWidth: 520, margin: '80px auto', padding: 24, textAlign: 'center' }}><h2>微信扫码登录</h2><div ref={qrRef} style={{ display: state === 'ready' ? 'inline-block' : 'none', margin: 24 }} /><p>{message}</p>{state !== 'loading' ? <button onClick={load}>刷新二维码</button> : null}</main>;
}
