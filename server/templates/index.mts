import { html, raw } from 'hono/html';

interface MenuItem {
	label: string;
	key: string;
	icon: string;
}

interface IndexData {
	title: string;
	description: string;
	canonical?: string;
	menu: MenuItem[];
}

export const renderIndexHtml = (data: IndexData) => {
	const menuJson = JSON.stringify(data.menu).replaceAll('<', '\\u003c');
	return html`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${data.title} | Quick React</title>
  <meta name="description" content="${data.description}">
  ${data.canonical ? html`<link rel="canonical" href="${data.canonical}">` : ''}
  <meta property="og:title" content="${data.title}">
  <meta property="og:description" content="${data.description}">
  <meta property="og:type" content="website">
</head>
<body>
  <div id="root"></div>
  <script>window.__INITIAL_MENU__=${raw(menuJson)};</script>
  <script src="/bundle.js"></script>
</body>
</html>`;
};
