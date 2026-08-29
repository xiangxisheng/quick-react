export const renderPrivacyHtml = (siteName = '本站', contactEmail = '') => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${siteName}隐私权政策</title>
<meta name="description" content="本站账号服务的隐私权政策，说明收集的信息、使用方式、共享范围以及用户的查询与删除方式。">
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 0 20px 64px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.8; color: #1f1f1f; background: #fff; }
main { max-width: 760px; margin: 0 auto; }
header { padding: 40px 0 8px; border-bottom: 1px solid #f0f0f0; margin-bottom: 24px; }
h1 { font-size: 28px; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 32px 0 8px; }
p, li { font-size: 15px; }
ul { padding-left: 22px; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
th, td { border: 1px solid #f0f0f0; padding: 8px 10px; text-align: left; vertical-align: top; }
th { background: #fafafa; font-weight: 600; }
.updated { color: #8c8c8c; font-size: 13px; margin: 0; }
.back { display: inline-block; margin-top: 40px; font-size: 14px; color: #1677ff; text-decoration: none; }
@media (prefers-color-scheme: dark) {
	body { background: #141414; color: #e6e6e6; }
	header, th, td { border-color: #303030; }
	th { background: #1d1d1d; }
	.updated { color: #8c8c8c; }
}
</style>
</head>
<body>
<main>
	<header>
		<h1>隐私权政策</h1>
		<p class="updated">最后更新日期：2026-08-27</p>
	</header>

	<p>本政策说明本站的账号服务（以下称“本服务”）在你注册、登录和使用账号功能时，会收集哪些信息、如何使用这些信息、在什么情况下共享，以及你可以如何查询和删除这些信息。请在使用本服务前阅读本政策。</p>

	<h2>一、我们收集的信息</h2>
	<table>
		<tr><th>类别</th><th>具体内容</th><th>收集场景</th></tr>
		<tr><td>账号标识</td><td>账号编号、用户名、昵称</td><td>创建账号、设置用户名或昵称时</td></tr>
		<tr><td>邮箱</td><td>邮箱地址及其验证状态</td><td>注册、绑定邮箱、发送验证码时</td></tr>
		<tr><td>登录凭据</td><td>密码的哈希值与强度特征；不保存密码明文</td><td>你主动设置或修改密码时</td></tr>
		<tr><td>第三方身份</td><td>第三方账号在本服务中的唯一标识、昵称，以及第三方在授权时返回的资料；Google 授权时还包含已验证的邮箱地址</td><td>使用微信、Google、Telegram 等方式登录或绑定时</td></tr>
		<tr><td>会话与安全信息</td><td>会话标识、登录时间、有效期、访问来源 IP</td><td>登录、保持登录状态、风险控制时</td></tr>
	</table>
	<p>本服务不收集与账号功能无关的信息，也不会主动收集你的通讯录、位置、相册等设备信息。</p>

	<h2>二、我们如何使用这些信息</h2>
	<ul>
		<li>创建和识别你的账号，维持登录状态；</li>
		<li>发送邮箱验证码，完成邮箱绑定与找回流程；</li>
		<li>把你的账号身份提供给你主动授权登录的业务站点（仅限账号编号、用户名、昵称和主邮箱）；</li>
		<li>防止账号被冒用，排查异常登录和滥用行为；</li>
		<li>履行法律法规要求的记录与配合义务。</li>
	</ul>
	<p>我们不会将上述信息用于广告投放，也不会用于与账号服务无关的用途。</p>

	<h2>三、信息的共享</h2>
	<ul>
		<li><strong>你授权的业务站点：</strong>当你使用本账号登录某个业务站点时，该站点会获得你的账号编号、用户名、昵称和主邮箱，用于在该站点识别你的身份。未经你发起的登录，不会发生这种共享。</li>
		<li><strong>必要的服务商：</strong>邮箱验证码通过云邮件服务发送，发送时会向服务商提供收件邮箱地址和验证码内容。</li>
		<li><strong>法律要求：</strong>在法律法规要求或为保护本服务及用户合法权益所必需时，可能依法披露相关信息。</li>
	</ul>
	<p>除上述情形外，我们不出售、不出租、不以其他方式向第三方提供你的个人信息。</p>

	<h2>四、Google 用户数据的使用</h2>
	<p>本服务通过 Google 账号登录时获取的信息（账号唯一标识、姓名、已验证的邮箱地址），仅用于在本服务中创建和识别你的账号。本服务对 Google 用户数据的接收、使用、存储和共享遵守
		<a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API 服务用户数据政策</a>，包括其中的“有限使用”（Limited Use）要求。我们不会将 Google 用户数据用于广告、不会出售，也不会用于训练通用人工智能模型。</p>

	<h2>五、信息的保存与删除</h2>
	<ul>
		<li>账号信息在账号存续期间保存；会话在有效期结束或你退出登录后失效。</li>
		<li>邮箱验证码在有效期结束后失效，不再用于验证。</li>
		<li>你可以在账户中心解绑不再使用的邮箱和第三方身份；主邮箱需要先切换到其它邮箱后才能解绑。</li>
		<li>你可以通过下方联系方式申请注销账号。账号注销后，我们会删除或匿名化处理与该账号相关的个人信息，法律法规要求保留的记录除外。</li>
	</ul>

	<h2>六、Cookie</h2>
	<p>本服务使用必要的 Cookie 维持登录状态和完成登录流程（例如会话标识、登录流程的临时状态）。这些 Cookie 设置了 HttpOnly 属性，无法被网页脚本读取，也不用于跨站跟踪或广告。禁用这些 Cookie 会导致无法登录。</p>

	<h2>七、未成年人</h2>
	<p>本服务不面向未满 14 周岁的未成年人。如果你是未成年人的监护人，发现被监护人在未取得你同意的情况下使用了本服务，请通过下方联系方式与我们联系，我们会协助删除相关账号信息。</p>

	<h2>八、政策更新</h2>
	<p>本政策可能因功能调整或法律要求而更新。更新后会修改本页顶部的“最后更新日期”；涉及重大变更的，会在你下次登录时提示。</p>

	<h2>九、联系我们</h2>
<p>如对本政策或你的个人信息有任何疑问、投诉或需要行使查询、更正、删除的权利，请联系：<strong>${contactEmail || '未配置'}</strong>。我们会在收到请求后的合理期限内回复。</p>

	<a class="back" href="/">← 返回首页</a>
</main>
</body>
</html>`;
