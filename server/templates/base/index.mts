import { html, raw } from 'hono/html';
import type { InitialData } from '@shared/types/initial-data.mjs';

interface IndexData {
	title: string;
	description: string;
	canonical?: string;
	initialData: InitialData;
}

export const renderIndexHtml = (data: IndexData) => {
	const initialDataJson = JSON.stringify(data.initialData).replaceAll('<', '\\u003c');
	return html`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${data.title}</title>
  <meta name="description" content="${data.description}">
  ${data.canonical ? html`<link rel="canonical" href="${data.canonical}">` : ''}
  <meta property="og:title" content="${data.title}">
  <meta property="og:description" content="${data.description}">
  <meta property="og:type" content="website">
</head>
<body>
  <div id="root">
    <div class="app-loading" role="status" aria-live="polite">
      <div class="app-loading-card">
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <strong>${data.initialData.siteName}</strong>
        <span>正在加载页面…</span>
        <div class="app-loading-progress" role="progressbar" aria-label="页面加载中"><i></i></div>
      </div>
    </div>
  </div>
  <style>
    html, body { margin: 0; min-height: 100%; }
    .app-loading { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #405a75; color: #d8e5f0; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .app-loading-card { min-width: 210px; padding: 34px 42px 30px; display: flex; flex-direction: column; align-items: center; gap: 9px; border: 1px solid rgba(225, 239, 250, .22); border-radius: 20px; background: rgba(67, 92, 119, .88); box-shadow: 0 16px 42px rgba(19, 35, 52, .28); }
    .app-loading-card strong { max-width: 240px; overflow: hidden; color: #f2f7fb; font-size: 18px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .app-loading-spinner { width: 34px; height: 34px; margin-bottom: 8px; border: 3px solid rgba(220, 235, 247, .3); border-top-color: #f2f7fb; border-radius: 50%; animation: app-loading-spin .75s linear infinite; }
    .app-loading-card span::after { display: inline-block; width: 18px; text-align: left; content: ''; animation: app-loading-dots 1.4s steps(4, end) infinite; }
    .app-loading-progress { width: 100%; height: 4px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: rgba(220, 235, 247, .25); }
    .app-loading-progress i { display: block; width: 42%; height: 100%; border-radius: inherit; background: #c4e2f8; box-shadow: 0 0 10px rgba(196, 226, 248, .45); animation: app-loading-progress 1.35s ease-in-out infinite; }
    @keyframes app-loading-spin { to { transform: rotate(360deg); } }
    @keyframes app-loading-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75%, 100% { content: '...'; } }
    @keyframes app-loading-progress { 0% { transform: translateX(-120%); } 50% { transform: translateX(125%); } 100% { transform: translateX(245%); } }
  </style>
  <noscript>
    <h1>${data.initialData.siteName}</h1>
    <p>${data.description}</p>
    <p><a href="/page/privacy.html">隐私权政策</a> · <a href="/page/terms.html">服务条款</a></p>
  </noscript>
  <script>window.__INITIAL_DATA__=${raw(initialDataJson)};</script>
  <script src="/bundle.js.nocache" defer></script>
</body>
</html>`;
};
