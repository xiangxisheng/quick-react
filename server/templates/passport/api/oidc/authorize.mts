import { escapeHtml } from '@server/common/html.mjs';

export const renderAuthorizeError = (message: string, signPath: string) => `<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<title>授权失败</title>
	<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5;color:#222;margin:0;padding:48px 20px}.card{max-width:560px;margin:10vh auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:28px;box-shadow:0 8px 30px #0000000d}h1{font-size:20px;margin:0 0 16px}p{line-height:1.7;word-break:break-word;color:#555}a{display:inline-block;margin-top:12px;color:#1677ff;text-decoration:none}</style>
</head>
<body><main class="card"><h1>无法完成授权</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(signPath)}">返回 Passport 登录</a></main></body>
</html>`;
