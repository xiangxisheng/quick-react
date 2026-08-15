import { html, raw } from 'hono/html';

interface MenuItem {
	label: string;
	key: string;
	icon: string;
}

interface InitialData {
	apiSuffix: string;
	pageSuffix: string;
	siteNavigation: MenuItem[];
}

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
  <title>${data.title} | Quick React</title>
  <meta name="description" content="${data.description}">
  ${data.canonical ? html`<link rel="canonical" href="${data.canonical}">` : ''}
  <meta property="og:title" content="${data.title}">
  <meta property="og:description" content="${data.description}">
  <meta property="og:type" content="website">
</head>
<body>
  <div id="root"></div>
  <script>window.__INITIAL_DATA__=${raw(initialDataJson)};</script>
  <script src="/bundle.js"></script>
</body>
</html>`;
};
