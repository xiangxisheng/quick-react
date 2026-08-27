import { useEffect } from 'react';
export default function OidcPopupCallback() {
  useEffect(() => { window.opener?.postMessage({ source: 'passport', status: 'success' }, window.location.origin); window.setTimeout(() => window.close(), 100); }, []);
  return <main style={{ padding: 48, textAlign: 'center' }}><h2>登录成功</h2><p>正在返回原页面…</p></main>;
}
