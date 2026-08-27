import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'quick-react-smoke-'));
process.env.DEFAULT_DATABASE_FILE = join(temporaryDirectory, 'default.sqlite');
process.env.SKIP_SERVER_LISTEN = '1';
const originalFetch = globalThis.fetch;
let telegramWebhookUrl = '';
const directMailActions = [];
const tencentSesActions = [];
const telegramActions = [];
let telegramMessageId = 8000;
globalThis.fetch = async (input, init) => {
	const url = String(input);
	if (url === 'https://dm.aliyuncs.com/' || url === 'https://dm.ap-southeast-1.aliyuncs.com/') {
		const parameters = new URLSearchParams(String(init?.body ?? ''));
		const action = parameters.get('Action');
		directMailActions.push({ action, parameters });
		if (action === 'CreateTemplate') return Response.json({ RequestId: 'dm-create', TemplateId: 5001 });
		if (action === 'ModifyTemplate') return Response.json({ RequestId: 'dm-modify' });
		if (action === 'DescTemplate' && parameters.get('TemplateId') === '6002') return Response.json({ RequestId: 'dm-describe-import', TemplateId: 6002, TemplateName: 'cloud_otp',
			TemplateSubject: '云端验证码 {code}', TemplateText: '<p>云端验证码：{code}</p>', TemplateStatus: 2 });
		if (action === 'DescTemplate') return Response.json({ RequestId: 'dm-describe', TemplateId: 5001, TemplateName: 'email_verification_1_1',
			TemplateSubject: '验证码 {code}', TemplateText: '<p>验证码：{code}</p>', TemplateStatus: 2 });
		if (action === 'QueryTemplateByParam') {
			assert.equal(parameters.get('PageSize'), '20');
			return Response.json({ RequestId: 'dm-templates', TotalCount: 2, data: { template: [
			{ TemplateId: 5001, TemplateName: 'email_verification_1_1', TemplateStatus: 2 },
			{ TemplateId: 6002, TemplateName: 'cloud_otp', TemplateStatus: 2 },
			] } });
		}
		if (action === 'QueryMailAddressByParam') return Response.json({ RequestId: 'dm-addresses', TotalCount: 1, data: { mailAddress: [{
			AccountName: 'noreply@example.com', AccountStatus: 0, DomainStatus: 0, ReplyAddress: 'reply@example.com', ReplyStatus: 0, Sendtype: 'trigger',
		}] } });
		if (action === 'SingleSendMail') return Response.json({ RequestId: 'dm-send', EnvId: 'dm-message' });
		return Response.json({ RequestId: 'dm-unsupported', Code: 'Unsupported', Message: String(action) }, { status: 400 });
	}
	if (url === 'https://sts.aliyuncs.com/') {
		assert.equal(new Headers(init?.headers).get('x-acs-action'), 'GetCallerIdentity');
		return Response.json({ AccountId: '1688000000000000', IdentityType: 'RAMUser', PrincipalId: '2812345678901234', UserId: '2812345678901234', Arn: 'acs:ram::1688000000000000:user/smoke', RequestId: 'aliyun-sts-request' });
	}
	if (url === 'https://cam.tencentcloudapi.com/') {
		const action = new Headers(init?.headers).get('x-tc-action');
		if (action === 'GetUserAppId') return Response.json({ Response: { Uin: '10001', OwnerUin: '10001', AppId: 1250000001, RequestId: 'cam-request' } });
	}
	if (url === 'https://ses.tencentcloudapi.com/') {
		const action = new Headers(init?.headers).get('x-tc-action');
		const body = JSON.parse(String(init?.body ?? '{}'));
		tencentSesActions.push({ action, body, headers: new Headers(init?.headers) });
		if (action === 'ListEmailAddress') return Response.json({ Response: { EmailSenders: [{ EmailAddress: 'notice@example.net', EmailSenderName: 'Tencent Passport' }], RequestId: 'ses-addresses' } });
		if (action === 'CreateEmailTemplate') return Response.json({ Response: { TemplateID: 7001, RequestId: 'ses-create' } });
		if (action === 'UpdateEmailTemplate') return Response.json({ Response: { RequestId: 'ses-update' } });
		if (action === 'GetEmailTemplate') {
			const imported = body.TemplateID === 7002;
			const content = imported ? '腾讯云导入验证码：{{code}}' : '腾讯云验证码：{{code}}';
			return Response.json({ Response: { TemplateContent: {
				Html: Buffer.from(`<p>${content}</p>`).toString('base64'), Text: Buffer.from(content).toString('base64'),
			}, TemplateStatus: 0, TemplateName: imported ? 'tencent_cloud_otp' : 'email_verification_1', RequestId: `ses-template-${body.TemplateID}` } });
		}
		if (action === 'ListEmailTemplates') return Response.json({ Response: { TemplatesMetadata: [
			{ TemplateID: 7001, TemplateName: 'email_verification_1', TemplateStatus: 0 },
			{ TemplateID: 7002, TemplateName: 'tencent_cloud_otp', TemplateStatus: 0 },
		], TotalCount: 2, RequestId: 'ses-templates' } });
		if (action === 'SendEmail') return Response.json({ Response: { MessageId: 'ses-message', RequestId: 'ses-send' } });
		return Response.json({ Response: { Error: { Code: 'Unsupported', Message: String(action) }, RequestId: 'ses-unsupported' } }, { status: 400 });
	}
	if (!url.startsWith('https://api.telegram.org/bot')) return originalFetch(input, init);
	const method = url.slice(url.lastIndexOf('/') + 1);
	const body = init?.body ? JSON.parse(String(init.body)) : {};
	telegramActions.push({ method, body });
	if (method === 'getMe') return Response.json({ ok: true, result: { id: 10001, username: 'smoke_passport_bot', first_name: 'Smoke Bot' } });
	if (method === 'setWebhook') {
		telegramWebhookUrl = String(body.url ?? '');
		return Response.json({ ok: true, result: true });
	}
	if (method === 'deleteWebhook') {
		telegramWebhookUrl = '';
		return Response.json({ ok: true, result: true });
	}
	if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: telegramWebhookUrl, pending_update_count: 0 } });
	if (method === 'sendMessage') return Response.json({ ok: true, result: { message_id: ++telegramMessageId } });
	if (method === 'editMessageText') return Response.json({ ok: true, result: { message_id: body.message_id } });
	if (method === 'deleteMessage' || method === 'answerCallbackQuery') return Response.json({ ok: true, result: true });
	return Response.json({ ok: false, description: 'unsupported smoke method' }, { status: 400 });
};

try {
	const { app } = await import(`../dist/server.mjs?smoke=${Date.now()}`);
	const migratedDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(migratedDatabase.prepare("SELECT migration_status FROM global_sites WHERE site_key = 'passport'").get()?.migration_status, 'ready');
	assert.equal(migratedDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'passport_users'").get()?.name, 'passport_users');
	migratedDatabase.close();
	const request = async (host, path, options = {}) => {
		const headers = new Headers(options.headers);
		if (options.cookie) headers.set('cookie', options.cookie);
		if (options.body !== undefined) headers.set('content-type', 'application/json');
		return app.request(`http://${host}${path}`, {
			method: options.method,
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	};

	assert.equal((await request('localhost', '/api/health.php')).status, 200);
	assert.equal((await request('localhost', '/api/panel/admin/global/site/sites.php')).status, 401);
	const registration = await request('localhost', '/api/sign.php');
	const registrationFormResult = await registration.json();
	assert.equal(registrationFormResult.user, null);
	assert.equal(registrationFormResult.registrationAvailable, true);
	assert.ok(registrationFormResult.formPage);
	const registrationResponse = await request('localhost', '/api/sign.php', {
		method: 'PUT', body: { username: 'bootstrap_admin', password: 'test-password-123' },
	});
	assert.equal(registrationResponse.status, 201);
	const registrationResult = await registrationResponse.json();
	assert.ok(registrationResult.feedback);
	assert.equal(Object.hasOwn(registrationResult, 'message'), false);
	const login = await request('localhost', '/api/sign.php', {
		method: 'POST', body: { username: 'bootstrap_admin', password: 'test-password-123' },
	});
	assert.equal(login.status, 200);
	const loginResult = await login.json();
	assert.equal(loginResult.feedback.message, '登录成功');
	assert.equal(Object.hasOwn(loginResult, 'message'), false);
	const cookie = login.headers.get('set-cookie')?.split(';')[0];
	assert.ok(cookie);
	const invalidLogin = await request('localhost', '/api/sign.php', {
		method: 'POST', body: { username: 'bootstrap_admin', password: 'wrong-password' },
	});
	assert.equal(invalidLogin.status, 401);
	const invalidLoginResult = await invalidLogin.json();
	assert.equal(invalidLoginResult.feedback.message, '用户名或密码错误');
	assert.equal(invalidLoginResult.feedback.component, 'modal');
	assert.equal(invalidLoginResult.feedback.type, 'error');
	const missingApi = await request('localhost', '/api/not-found');
	assert.equal(missingApi.status, 404);
	const missingApiResult = await missingApi.json();
	assert.equal(missingApiResult.feedback.component, 'modal');
	assert.equal(missingApiResult.feedback.type, 'error');
	assert.equal(missingApiResult.feedback.message, '请求的资源不存在');

	const createSite = async (siteKey, extra = {}) => {
		assert.equal((await request('localhost', '/api/panel/admin/global/site/sites.php', {
			method: 'POST', cookie, body: { site_key: siteKey, name: siteKey, ...extra },
		})).status, 201);
		assert.equal((await request('localhost', `/api/panel/admin/global/site/sites.php/${siteKey}`, {
			method: 'POST', cookie,
		})).status, 200);
		assert.equal((await request('localhost', `/api/panel/admin/global/site/sites.php/${siteKey}`, {
			method: 'PUT', cookie, body: { status: 'enabled' },
		})).status, 200);
	};

	await createSite('site1');
	for (const hostname of ['site1.test', '*.wild.test']) {
		assert.equal((await request('localhost', '/api/panel/admin/global/site/hosts.php', {
			method: 'POST', cookie, body: { hostname, site_key: 'site1' },
		})).status, 201);
	}
	for (const hostname of ['passport.test', 'passport-alt.test']) {
		assert.equal((await request('localhost', '/api/panel/admin/global/site/hosts.php', {
			method: 'POST', cookie, body: { hostname, site_key: 'passport' },
		})).status, 201);
	}
	const sitesResult = await (await request('localhost', '/api/panel/admin/global/site/sites.php', { cookie })).json();
	assert.equal(sitesResult.table.columns[0]?.dataIndex, 'id');
	assert.ok(!sitesResult.table.columns.some((column) => column.dataIndex === 'passport_sso_enabled'));
	const hostsResult = await (await request('localhost', '/api/panel/admin/global/site/hosts.php', { cookie })).json();
	assert.equal(hostsResult.table.columns[0]?.dataIndex, 'id');
	const externalProvidersPath = '/api/panel/admin/accounts/external-providers.php';
	const externalProviders = await (await request('passport.test', externalProvidersPath, { cookie })).json();
	const createProviderAction = externalProviders.table.option.actions.toolbar.find((action) => action.key === 'create');
	assert.equal(createProviderAction.form, undefined);
	const secretColumn = externalProviders.table.columns.find((column) => column.dataIndex === 'client_secret');
	assert.equal(secretColumn.inputType, 'password');
	assert.equal(secretColumn.form.create.rules[0].required, true);
	assert.match(secretColumn.title, /微信 AppSecret/);
	assert.equal(secretColumn.hideInTable, true);
	assert.equal(externalProviders.table.columns.find((column) => column.dataIndex === 'id').form.edit, false);
	assert.equal((await request('passport.test', externalProvidersPath, {
		method: 'POST', cookie, body: { id: 'wechat', display_name: '微信', client_id: 'wechat-app-id', client_secret: 'wechat-app-secret', status: 'enabled' },
	})).status, 201);
	const createdProvider = await (await request('passport.test', `${externalProvidersPath}/wechat`, { cookie })).json();
	assert.equal(createdProvider.client_secret, '');
	assert.equal(createdProvider.secret_configured, '已配置');
	const localSiteSign = await (await request('site1.test', '/api/sign.php')).json();
	assert.equal(localSiteSign.formPage.fields[0].name, 'username');
	assert.match(await (await request('site1.test', '/')).text(), /<title>首页 \| site1<\/title>/);
	const accountsSettings = await (await request('site1.test', '/api/panel/admin/system/settings/accounts-oidc.php', { cookie })).json();
	assert.equal(accountsSettings.formPage.fields[0].name, 'enabled');
	const issuerSourceField = accountsSettings.formPage.fields.find((field) => field.name === 'issuerSource');
	const issuerField = accountsSettings.formPage.fields.find((field) => field.name === 'issuer');
	assert.ok(issuerSourceField.options.some((option) => option.value === 'https://passport.test' && option.fieldValues.issuer === 'https://passport.test'));
	assert.deepEqual(issuerField.readOnlyWhen, { field: 'issuerSource', notValues: ['__custom__'] });
	const oidcClients = await (await request('passport.test', '/api/panel/admin/accounts/oidc/clients.php', { cookie })).json();
	const redirectSourceColumn = oidcClients.table.columns.find((column) => column.dataIndex === 'redirect_uri_source');
	const redirectColumn = oidcClients.table.columns.find((column) => column.dataIndex === 'redirect_uris');
	const logoutPathColumn = oidcClients.table.columns.find((column) => column.dataIndex === 'backchannel_logout_path');
	assert.ok(redirectSourceColumn.options.some((option) => option.value === 'https://site1.test/api/accounts/oidc/callback' && option.fieldValues.backchannel_logout_path === '/api/accounts/oidc/backchannel-logout'));
	assert.deepEqual(redirectColumn.readOnlyWhen, { field: 'redirect_uri_source', notValues: ['__custom__'] });
	assert.deepEqual(logoutPathColumn.readOnlyWhen, { field: 'redirect_uri_source', notValues: ['__custom__'] });
	const botsPath = '/api/panel/admin/global/telegram/bots.php';
	assert.equal((await request('localhost', botsPath, {
		method: 'POST', cookie, body: { name: 'smoke-passport-bot', bot_token: '10001:smoke-token', webhook_hostname: 'passport.test' },
	})).status, 201);
	assert.equal(telegramWebhookUrl, 'https://passport.test/api/tgwebhook?bot_id=1');
	const botsResult = await (await request('localhost', botsPath, { cookie })).json();
	assert.equal(botsResult.table.columns[0]?.dataIndex, 'id');
	const bot = botsResult.table.dataSource.find((item) => item.name === 'smoke-passport-bot');
	assert.equal(bot.bot_username, 'smoke_passport_bot');
	assert.equal(Object.hasOwn(bot, 'bot_token'), false);
	assert.equal(Object.hasOwn(bot, 'secret_token'), false);
	assert.equal((await request('localhost', `${botsPath}/${bot.id}?action=test`, { method: 'POST', cookie })).status, 200);
	assert.equal((await request('localhost', `${botsPath}/${bot.id}`, {
		method: 'PUT', cookie, body: { webhook_hostname: 'passport-alt.test', __changedFields: ['webhook_hostname'] },
	})).status, 200);
	assert.equal(telegramWebhookUrl, 'https://passport-alt.test/api/tgwebhook?bot_id=1');
	assert.equal((await request('localhost', `${botsPath}/${bot.id}`, { method: 'DELETE', cookie })).status, 409);
	assert.equal((await request('localhost', `${botsPath}/${bot.id}`, {
		method: 'PUT', cookie, body: { status: 'disabled', __changedFields: ['status'] },
	})).status, 200);
	assert.equal(telegramWebhookUrl, '');
	assert.equal((await request('localhost', `${botsPath}/${bot.id}`, { method: 'DELETE', cookie })).status, 200);
	assert.equal((await request('localhost', botsPath, {
		method: 'POST', cookie, body: { name: 'smoke-webhook-bot', bot_token: '10002:smoke-token', secret_token: 'smoke-webhook-secret', webhook_hostname: 'passport-alt.test' },
	})).status, 201);
	const webhookBotsResult = await (await request('localhost', botsPath, { cookie })).json();
	const webhookBot = webhookBotsResult.table.dataSource.find((item) => item.name === 'smoke-webhook-bot');
	assert.ok(webhookBot?.id);
	const webhookPath = `/api/tgwebhook?bot_id=${webhookBot.id}`;
	assert.equal((await request('passport-alt.test', webhookPath)).status, 405);
	assert.equal((await request('passport.test', webhookPath, {
		method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'smoke-webhook-secret' }, body: { update_id: 7001 },
	})).status, 404);
	assert.equal((await request('passport-alt.test', webhookPath, {
		method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' }, body: { update_id: 7001 },
	})).status, 403);
	assert.equal((await request('passport-alt.test', webhookPath, {
		method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'smoke-webhook-secret' }, body: { update_id: 7001 },
	})).status, 200);
	assert.equal((await request('passport-alt.test', webhookPath, {
		method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'smoke-webhook-secret' }, body: { update_id: 7001 },
	})).status, 200);
	const webhookDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.equal(webhookDatabase.prepare(`SELECT status FROM passport_telegram_updates WHERE bot_id = ? AND update_id = ?`).get(webhookBot.id, 7001)?.status, 'completed');
	webhookDatabase.close();
	assert.equal((await request('localhost', `${botsPath}/${webhookBot.id}`, {
		method: 'PUT', cookie, body: { status: 'disabled', __changedFields: ['status'] },
	})).status, 200);
	assert.equal((await request('localhost', `${botsPath}/${webhookBot.id}`, { method: 'DELETE', cookie })).status, 409);
	assert.equal((await request('site1.test', '/api/health.php')).status, 200);
	assert.equal((await request('site1.test', '/api/panel/admin/global/site/sites.php', { cookie })).status, 404);
	assert.equal((await request('a.wild.test', '/api/panel/admin/global/site/sites.php', { cookie })).status, 404);
	assert.equal((await request('a.b.wild.test', '/api/panel/admin/global/site/sites.php', { cookie })).status, 200);

	await createSite('site2', { dsn: `sqlite://${join(temporaryDirectory, 'site2.sqlite')}` });
	assert.equal((await request('localhost', '/api/panel/admin/global/site/hosts.php', {
		method: 'POST', cookie, body: { hostname: 'site2.test', site_key: 'site2' },
	})).status, 201);
	const isolatedRegistration = await request('site2.test', '/api/sign.php');
	const isolatedRegistrationResult = await isolatedRegistration.json();
	assert.equal(isolatedRegistrationResult.user, null);
	assert.equal(isolatedRegistrationResult.registrationAvailable, true);
	assert.ok(isolatedRegistrationResult.formPage);
	assert.equal(isolatedRegistrationResult.formPage.fields[0].name, 'username');

	const credentialsPath = '/api/panel/admin/global/cloud/credentials.php';
	assert.equal((await request('localhost', credentialsPath, {
		method: 'POST', cookie, body: { name: 'smoke-s3', provider: 'other', access_key_id: 'smoke-key', access_key_secret: 'smoke-secret' },
	})).status, 201);
	const credentialsResult = await (await request('localhost', credentialsPath, { cookie })).json();
	assert.equal(credentialsResult.table.columns[0]?.dataIndex, 'id');
	const credential = credentialsResult.table.dataSource.find((item) => item.name === 'smoke-s3');
	assert.ok(credential?.id);
	assert.equal(Object.hasOwn(credential, 'access_key_secret'), false);
	const credentialDetail = await (await request('localhost', `${credentialsPath}/${credential.id}`, { cookie })).json();
	assert.equal(Object.hasOwn(credentialDetail, 'access_key_secret'), false);
	const credentialTest = await request('localhost', `${credentialsPath}/${credential.id}?action=test`, { method: 'POST', cookie });
	assert.equal(credentialTest.status, 200);
	assert.equal((await credentialTest.json()).feedback.message, '该自定义凭据暂不支持独立测试，请在 Bucket 配置中测试');

	const bucketsPath = '/api/panel/admin/global/cloud/object-storage/buckets.php';
	const discoveredBuckets = await (await request('localhost', `${bucketsPath}?action=discover&field=bucket&cloud_credential_id=${credential.id}`, { cookie })).json();
	assert.deepEqual(discoveredBuckets.options, []);
	assert.equal((await request('localhost', bucketsPath, {
		method: 'POST', cookie, body: { cloud_credential_id: credential.id, endpoint: 'https://s3.example.invalid', region: 'us-east-1', bucket: 'smoke-bucket', path_style: true },
	})).status, 201);
	const bucketsResult = await (await request('localhost', bucketsPath, { cookie })).json();
	assert.equal(bucketsResult.table.columns[0]?.dataIndex, 'id');
	const bucket = bucketsResult.table.dataSource.find((item) => item.bucket === 'smoke-bucket');
	assert.ok(bucket?.id);

	const bindingsPath = '/api/panel/admin/global/cloud/object-storage/bindings.php';
	assert.equal((await request('localhost', bindingsPath, {
		method: 'POST', cookie, body: { site_key: 'site1', bucket_id: bucket.id, purposes: ['uploads', 'attachments'], default_purposes: ['uploads'] },
	})).status, 201);
	const bindingsResult = await (await request('localhost', bindingsPath, { cookie })).json();
	assert.equal(bindingsResult.table.columns[0]?.dataIndex, 'id');
	assert.equal(bindingsResult.table.dataSource.length, 1);
	assert.deepEqual(bindingsResult.table.dataSource[0].purposes.sort(), ['attachments', 'uploads']);
	assert.deepEqual(bindingsResult.table.dataSource[0].default_purposes, ['uploads']);
	assert.equal((await request('localhost', '/api/panel/admin/global/cloud/object-storage/objects.php', { cookie })).status, 200);

	assert.equal((await request('localhost', credentialsPath, {
		method: 'POST', cookie, body: { name: 'smoke-aliyun-mail', provider: 'aliyun', access_key_id: 'aliyun-key', access_key_secret: 'aliyun-secret' },
	})).status, 201);
	const emailCredentialsResult = await (await request('localhost', credentialsPath, { cookie })).json();
	const emailCredential = emailCredentialsResult.table.dataSource.find((item) => item.name === 'smoke-aliyun-mail');
	assert.ok(emailCredential?.id);
	const aliyunCredentialTest = await request('localhost', `${credentialsPath}/${emailCredential.id}?action=test`, { method: 'POST', cookie });
	assert.equal(aliyunCredentialTest.status, 200);
	const aliyunCredentialTestResult = await aliyunCredentialTest.json();
	assert.equal(aliyunCredentialTestResult.identity.accountId, '1688000000000000');
	assert.match(aliyunCredentialTestResult.feedback.message, /账号 ID 1688000000000000/);
	const emailChannelsPath = '/api/panel/admin/global/cloud/email/channels.php';
	const discoveredMailAddresses = await (await request('localhost', `${emailChannelsPath}?action=discover&field=account_name&cloud_credential_id=${emailCredential.id}&region=cn-hangzhou`, { cookie })).json();
	assert.deepEqual(discoveredMailAddresses.options, [{ value: 'noreply@example.com', text: 'noreply@example.com', fieldValues: { reply_to_address: true } }]);
	assert.equal((await request('localhost', emailChannelsPath, {
		method: 'POST', cookie, body: { cloud_credential_id: emailCredential.id, region: 'cn-hangzhou', account_name: 'noreply@example.com', from_alias: 'Smoke Passport' },
	})).status, 201);
	const emailChannels = await (await request('localhost', emailChannelsPath, { cookie })).json();
	assert.equal(emailChannels.table.columns[0]?.dataIndex, 'id');
	assert.equal(emailChannels.table.columns.find((column) => column.dataIndex === 'cloud_credential_id')?.tableDisplay, 'reference');
	assert.equal(emailChannels.table.columns.find((column) => column.dataIndex === 'cloud_credential_id')?.tableDisplayTextField, 'credential_name');
	const emailRegionColumn = emailChannels.table.columns.find((column) => column.dataIndex === 'region');
	assert.deepEqual(emailRegionColumn.options, [
		{ value: 'cn-hangzhou', text: '华东1（杭州）（cn-hangzhou）', parentValue: String(emailCredential.id) },
		{ value: 'ap-southeast-1', text: '新加坡（ap-southeast-1）', parentValue: String(emailCredential.id) },
		{ value: 'us-east-1', text: '美国（弗吉尼亚）（us-east-1）', parentValue: String(emailCredential.id) },
		{ value: 'eu-central-1', text: '德国（法兰克福）（eu-central-1）', parentValue: String(emailCredential.id) },
	]);
	const emailChannel = emailChannels.table.dataSource.find((item) => item.account_name === 'noreply@example.com');
	assert.ok(emailChannel?.id);
	const emailTemplatesPath = '/api/panel/admin/global/cloud/email/templates.php';
	assert.equal((await request('localhost', emailTemplatesPath, {
		method: 'POST', cookie, body: { template_key: 'invalid_verification', template_type: 'email_verification', name: '无变量验证码', subject: '验证码', body_text: '验证码', body_html: '<p>验证码</p>' },
	})).status, 400);
	const directMailActionsBeforeTemplateCreate = directMailActions.length;
	assert.equal((await request('localhost', emailTemplatesPath, {
		method: 'POST', cookie, body: { template_key: 'email_verification', template_type: 'email_verification', name: '邮箱验证码', subject: '验证码 {{code}}', body_text: '验证码：{{code}}', body_html: '<p>验证码：{{code}}</p>' },
	})).status, 201);
	assert.equal((await request('localhost', emailTemplatesPath, {
		method: 'POST', cookie, body: { template_key: 'disabled_email_verification', template_type: 'email_verification', name: '停用邮箱验证码', subject: '验证码 {{code}}', body_text: '验证码：{{code}}', body_html: '<p>验证码：{{code}}</p>', status: 'disabled' },
	})).status, 201);
	assert.equal(directMailActions.length, directMailActionsBeforeTemplateCreate);
	const emailTemplates = await (await request('localhost', emailTemplatesPath, { cookie })).json();
	assert.equal(emailTemplates.table.columns[0]?.dataIndex, 'id');
	assert.equal(emailTemplates.table.columns.find((column) => column.dataIndex === 'body_text')?.tableDisplay, 'multiline');
	assert.equal(emailTemplates.table.columns.find((column) => column.dataIndex === 'body_html')?.tableDisplay, 'multiline');
	const syncTemplatesAction = emailTemplates.table.option.actions.toolbar.find((action) => action.key === 'sync');
	assert.equal(syncTemplatesAction?.label, '同步模板');
	assert.deepEqual(syncTemplatesAction.form.columns.map((column) => column.dataIndex), ['cloud_credential_id', 'region', 'template_type']);
	const publishTemplateAction = emailTemplates.table.option.actions.row.find((action) => action.key === 'publish');
	assert.deepEqual(publishTemplateAction.form.columns.map((column) => column.dataIndex), ['cloud_credential_id', 'region']);
	const emailTemplate = emailTemplates.table.dataSource.find((item) => item.template_key === 'email_verification');
	assert.ok(emailTemplate?.id);
	assert.equal(emailTemplates.table.dataSource.find((item) => item.template_key === 'disabled_email_verification')?.status, 'disabled');
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}`, {
		method: 'PUT', cookie, body: { body_html: '<p>验证码</p>', __changedFields: ['body_html'] },
	})).status, 400);
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=restore`, { method: 'POST', cookie })).status, 200);
	assert.equal(directMailActions.length, directMailActionsBeforeTemplateCreate);
	const restoredEmailTemplate = await (await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}`, { cookie })).json();
	assert.equal(restoredEmailTemplate.body_text, '您正在验证邮箱 {{email}}。\n验证码：{{code}}\n验证码将在 {{expires_minutes}} 分钟后失效，请勿向他人泄露。');
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=publish`, {
		method: 'POST', cookie, body: { cloud_credential_id: emailCredential.id, region: 'cn-hangzhou' },
	})).status, 200);
	assert.equal(directMailActions.at(-1)?.action, 'CreateTemplate');
	assert.equal(directMailActions.at(-1)?.parameters.get('TemplateSubject'), '您的邮箱验证码是 {code}');
	const emailBindingsPath = '/api/panel/admin/global/cloud/email/bindings.php';
	const reviewingBinding = await request('localhost', emailBindingsPath, {
		method: 'POST', cookie, body: { site_key: 'passport', channel_id: emailChannel.id, template_id: emailTemplate.id, is_default: true },
	});
	assert.equal(reviewingBinding.status, 400);
	assert.equal((await reviewingBinding.json()).feedback.message, '所选模板在该邮件通道使用的云凭据和 Region 审核中，审核通过后才能启用绑定');
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=refresh`, { method: 'POST', cookie })).status, 200);
	assert.equal(directMailActions.at(-1)?.action, 'DescTemplate');
	const testTemplateOptions = await (await request('localhost', `${emailChannelsPath}/${emailChannel.id}?action=templates&field=template_id`, { cookie })).json();
	assert.deepEqual(testTemplateOptions.options, [{ value: String(emailTemplate.id), text: '邮箱验证码 (email_verification)' }]);
	assert.equal((await request('localhost', `${emailChannelsPath}/${emailChannel.id}?action=test`, {
		method: 'POST', cookie, body: { to: 'recipient@example.com', template_id: emailTemplate.id, code: '654321' },
	})).status, 200);
	assert.equal(directMailActions.at(-1)?.parameters.has('Template'), false);
	assert.equal(directMailActions.at(-1)?.parameters.get('Subject'), '您的邮箱验证码是 654321');
	assert.equal(directMailActions.at(-1)?.parameters.get('HtmlBody'), '<p>您正在验证邮箱 recipient@example.com。</p><p>验证码：<strong>654321</strong></p><p>验证码将在 10 分钟后失效，请勿向他人泄露。</p>');
	const syncResponse = await request('localhost', `${emailTemplatesPath}?action=sync`, {
		method: 'POST', cookie, body: { cloud_credential_id: emailCredential.id, region: 'cn-hangzhou', template_type: 'email_verification' },
	});
	assert.equal(syncResponse.status, 200);
	const syncResult = await syncResponse.json();
	assert.equal(syncResult.updated, 1);
	assert.equal(syncResult.imported, 1);
	const staleReviewDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	staleReviewDatabase.prepare(`UPDATE global_cloud_email_template_publications SET status = 'reviewing'
		WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = 'cn-hangzhou'`).run(emailTemplate.id, emailCredential.id);
	staleReviewDatabase.close();
	const actionsBeforeStaleReviewPublish = directMailActions.length;
	const staleReviewPublish = await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=publish`, {
		method: 'POST', cookie, body: { cloud_credential_id: emailCredential.id, region: 'cn-hangzhou' },
	});
	assert.equal(staleReviewPublish.status, 200);
	assert.equal((await staleReviewPublish.json()).feedback.message, '模板内容未改动，无需重新提交审核');
	assert.equal(directMailActions.length, actionsBeforeStaleReviewPublish + 1);
	assert.equal(directMailActions.at(-1)?.action, 'DescTemplate');
	const legacyPublicationDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE);
	legacyPublicationDatabase.prepare(`UPDATE global_cloud_email_template_publications SET content_hash = 'legacy:' || (
		SELECT json_array(template_key, name, subject, body_html) FROM global_cloud_email_templates WHERE id = ?1
	) WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = 'cn-hangzhou'`).run(emailTemplate.id, emailCredential.id);
	legacyPublicationDatabase.close();
	const actionsBeforeUnchangedPublish = directMailActions.length;
	const unchangedPublish = await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=publish`, {
		method: 'POST', cookie, body: { cloud_credential_id: emailCredential.id, region: 'cn-hangzhou' },
	});
	assert.equal(unchangedPublish.status, 200);
	assert.equal((await unchangedPublish.json()).feedback.message, '模板内容未改动，无需重新提交审核');
	assert.equal(directMailActions.length, actionsBeforeUnchangedPublish);
	const normalizedPublicationDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	assert.match(normalizedPublicationDatabase.prepare(`SELECT content_hash FROM global_cloud_email_template_publications
		WHERE template_id = ?1 AND cloud_credential_id = ?2 AND region = 'cn-hangzhou'`).get(emailTemplate.id, emailCredential.id).content_hash, /^[0-9a-f]{64}$/);
	normalizedPublicationDatabase.close();
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=publish`, {
		method: 'POST', cookie, body: { cloud_credential_id: emailCredential.id, region: 'cn-hangzhou' },
	})).status, 200);
	assert.equal(directMailActions.length, actionsBeforeUnchangedPublish);
	const syncedTemplates = await (await request('localhost', emailTemplatesPath, { cookie })).json();
	const importedTemplate = syncedTemplates.table.dataSource.find((item) => item.template_key === `aliyun_${emailCredential.id}_cn_hangzhou_6002`);
	assert.equal(importedTemplate?.template_type, 'email_verification');
	assert.equal(importedTemplate?.body_text, '云端验证码：{{code}}');
	assert.equal((await request('localhost', credentialsPath, {
		method: 'POST', cookie, body: { name: 'smoke-tencent-mail', provider: 'tencent', access_key_id: 'tencent-secret-id', access_key_secret: 'tencent-secret-key' },
	})).status, 201);
	const tencentCredentials = await (await request('localhost', credentialsPath, { cookie })).json();
	const tencentCredential = tencentCredentials.table.dataSource.find((item) => item.name === 'smoke-tencent-mail');
	assert.ok(tencentCredential?.id);
	assert.equal((await request('localhost', `${credentialsPath}/${tencentCredential.id}?action=test`, { method: 'POST', cookie })).status, 200);
	const tencentAddresses = await (await request('localhost', `${emailChannelsPath}?action=discover&field=account_name&cloud_credential_id=${tencentCredential.id}&region=ap-hongkong`, { cookie })).json();
	assert.deepEqual(tencentAddresses.options, [{ value: 'notice@example.net', text: 'notice@example.net', fieldValues: { from_alias: 'Tencent Passport', reply_to_address: false } }]);
	assert.equal((await request('localhost', emailChannelsPath, {
		method: 'POST', cookie, body: { cloud_credential_id: tencentCredential.id, region: 'ap-hongkong', account_name: 'notice@example.net', from_alias: 'Tencent Passport' },
	})).status, 201);
	const channelsWithTencent = await (await request('localhost', emailChannelsPath, { cookie })).json();
	const tencentChannel = channelsWithTencent.table.dataSource.find((item) => item.account_name === 'notice@example.net');
	assert.ok(tencentChannel?.id);
	assert.deepEqual(channelsWithTencent.table.columns.find((column) => column.dataIndex === 'region').options.at(-1),
		{ value: 'ap-hongkong', text: '中国香港（ap-hongkong）', parentValue: String(tencentCredential.id) });
	assert.equal((await request('localhost', emailChannelsPath, {
		method: 'POST', cookie, body: { cloud_credential_id: tencentCredential.id, region: 'ap-hongkong', account_name: 'notice2@example.net', from_alias: 'Tencent Passport 2' },
	})).status, 201);
	const createsBeforeTencentPublish = tencentSesActions.filter((item) => item.action === 'CreateEmailTemplate').length;
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=publish`, {
		method: 'POST', cookie, body: { cloud_credential_id: tencentCredential.id, region: 'ap-hongkong' },
	})).status, 200);
	assert.equal(tencentSesActions.at(-1)?.action, 'CreateEmailTemplate');
	assert.equal(tencentSesActions.filter((item) => item.action === 'CreateEmailTemplate').length, createsBeforeTencentPublish + 1);
	assert.equal(tencentSesActions.at(-1)?.body.TemplateContent.Html, Buffer.from('<p>验证码：{{code}}</p>').toString('base64'));
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}?action=refresh`, { method: 'POST', cookie })).status, 200);
	assert.equal(tencentSesActions.at(-1)?.action, 'GetEmailTemplate');
	const tencentTemplateOptions = await (await request('localhost', `${emailChannelsPath}/${tencentChannel.id}?action=templates&field=template_id`, { cookie })).json();
	assert.deepEqual(tencentTemplateOptions.options, [{ value: String(emailTemplate.id), text: '邮箱验证码 (email_verification)' }]);
	assert.equal((await request('localhost', `${emailChannelsPath}/${tencentChannel.id}?action=test`, {
		method: 'POST', cookie, body: { to: 'recipient@example.com', template_id: emailTemplate.id, code: '778899' },
	})).status, 200);
	assert.equal(tencentSesActions.at(-1)?.action, 'SendEmail');
	assert.equal(tencentSesActions.at(-1)?.headers.get('x-tc-region'), 'ap-hongkong');
	assert.deepEqual(tencentSesActions.at(-1)?.body.Template, { TemplateID: 7001, TemplateData: JSON.stringify({ code: '778899', email: 'recipient@example.com', expires_minutes: '10' }) });
	const tencentSync = await request('localhost', `${emailTemplatesPath}?action=sync`, {
		method: 'POST', cookie, body: { cloud_credential_id: tencentCredential.id, region: 'ap-hongkong', template_type: 'email_verification' },
	});
	assert.equal(tencentSync.status, 200);
	const tencentSyncResult = await tencentSync.json();
	assert.equal(tencentSyncResult.updated, 1);
	assert.equal(tencentSyncResult.imported, 1);
	const templatesWithTencent = await (await request('localhost', emailTemplatesPath, { cookie })).json();
	assert.ok(templatesWithTencent.table.dataSource.some((item) => item.template_key === `tencent_${tencentCredential.id}_ap_hongkong_7002`));
	assert.equal((await request('localhost', emailBindingsPath, {
		method: 'POST', cookie, body: { site_key: 'passport', channel_id: emailChannel.id, template_id: emailTemplate.id, is_default: true },
	})).status, 201);
	const emailBindings = await (await request('localhost', emailBindingsPath, { cookie })).json();
	assert.equal(emailBindings.table.columns[0]?.dataIndex, 'id');
	assert.deepEqual(emailBindings.table.columns.find((column) => column.dataIndex === 'channel_id')?.tableDisplay, 'reference');
	assert.equal(emailBindings.table.columns.find((column) => column.dataIndex === 'channel_id')?.tableDisplayTextField, 'account_name');
	assert.equal(emailBindings.table.columns.find((column) => column.dataIndex === 'template_id')?.tableDisplayTextField, 'template_name');
	const emailBinding = emailBindings.table.dataSource[0];
	assert.equal(emailBinding.is_default, 1);
	assert.equal((await request('localhost', `${emailBindingsPath}/${emailBinding.id}`, { method: 'DELETE', cookie })).status, 409);
	assert.equal((await request('localhost', `${emailBindingsPath}/${emailBinding.id}`, {
		method: 'PUT', cookie, body: { status: 'disabled', __changedFields: ['status'] },
	})).status, 200);
	assert.equal((await request('localhost', `${emailBindingsPath}/${emailBinding.id}`, { method: 'DELETE', cookie })).status, 200);
	assert.equal((await request('localhost', `${emailTemplatesPath}/${emailTemplate.id}`, { method: 'DELETE', cookie })).status, 409);
	assert.equal((await request('localhost', `${emailChannelsPath}/${emailChannel.id}`, { method: 'DELETE', cookie })).status, 409);
	assert.equal((await request('localhost', `${credentialsPath}/${emailCredential.id}`, {
		method: 'PUT', cookie, body: { provider: 'aws', __changedFields: ['provider'] },
	})).status, 409);
	const { createAliyunDirectMailAdapter, getAliyunDirectMailEndpoint } = await import('../server/cloud/providers/aliyun-direct-mail.mts');
	assert.equal(getAliyunDirectMailEndpoint('cn-hangzhou'), 'https://dm.aliyuncs.com/');
	assert.equal(getAliyunDirectMailEndpoint('ap-southeast-1'), 'https://dm.ap-southeast-1.aliyuncs.com/');
	assert.equal(getAliyunDirectMailEndpoint('us-east-1'), 'https://dm.us-east-1.aliyuncs.com/');
	assert.equal(getAliyunDirectMailEndpoint('eu-central-1'), 'https://dm.eu-central-1.aliyuncs.com/');
	const emailSendResult = await createAliyunDirectMailAdapter({
		id: emailChannel.id, provider: 'aliyun', cloud_credential_id: emailCredential.id, region: 'cn-hangzhou',
		account_name: 'noreply@example.com', from_alias: 'Smoke Passport', reply_to_address: 0,
		access_key_id: 'aliyun-key', access_key_secret: 'aliyun-secret',
	}).send({
		to: 'recipient@example.com', subject: '验证码 123456', text: '验证码：123456', html: '<p>验证码：123456</p>',
		template: { providerTemplateId: '5001', variables: { code: '123456' } },
	});
	assert.equal(emailSendResult.messageId, 'dm-message');
	assert.equal(directMailActions.at(-1)?.action, 'SingleSendMail');
	assert.deepEqual(JSON.parse(directMailActions.at(-1)?.parameters.get('Template')), { TemplateId: '5001', TemplateData: { code: '123456' } });
	assert.equal(directMailActions.at(-1)?.parameters.has('HtmlBody'), false);
	assert.equal((await request('localhost', emailBindingsPath, {
		method: 'POST', cookie, body: { site_key: 'passport', channel_id: emailChannel.id, template_id: emailTemplate.id, is_default: true },
	})).status, 201);
	assert.equal((await request('localhost', `${botsPath}/${webhookBot.id}`, {
		method: 'PUT', cookie, body: { status: 'enabled', __changedFields: ['status'] },
	})).status, 200);
	const postTelegramUpdate = (body) => request('passport-alt.test', webhookPath, {
		method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'smoke-webhook-secret' }, body,
	});
	assert.equal((await postTelegramUpdate({ update_id: 7002, message: {
		message_id: 10, chat: { id: 9001, type: 'private' }, from: { id: 9001, first_name: 'Smoke User' }, text: '/start',
	} })).status, 200);
	assert.equal(telegramActions.at(-1)?.method, 'sendMessage');
	const firstMenuMessageId = telegramActions.at(-1)?.body ? telegramMessageId : 0;
	assert.equal((await postTelegramUpdate({ update_id: 7003, callback_query: {
		id: 'callback-bind', from: { id: 9001, first_name: 'Smoke User' }, data: 'menu:bind_email',
		message: { message_id: firstMenuMessageId, chat: { id: 9001, type: 'private' } },
	} })).status, 200);
	assert.equal((await postTelegramUpdate({ update_id: 7004, message: {
		message_id: 11, chat: { id: 9001, type: 'private' }, from: { id: 9001, first_name: 'Smoke User' }, text: 'user@example.com',
	} })).status, 200);
	const firstOtpTemplate = JSON.parse(directMailActions.filter((item) => item.action === 'SingleSendMail').at(-1)?.parameters.get('Template'));
	const firstOtp = firstOtpTemplate.TemplateData.code;
	assert.match(firstOtp, /^\d{6}$/);
	const actionsBeforeVerification = telegramActions.length;
	const verificationUpdate = { update_id: 7005, message: {
		message_id: 12, chat: { id: 9001, type: 'private' }, from: { id: 9001, first_name: 'Smoke User' }, text: firstOtp,
	} };
	assert.equal((await postTelegramUpdate(verificationUpdate)).status, 200);
	assert.equal((await postTelegramUpdate(verificationUpdate)).status, 200);
	assert.equal(telegramActions.length, actionsBeforeVerification + 2);
	const identityDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	const firstIdentity = identityDatabase.prepare(`SELECT CAST(a.user_id AS TEXT) AS user_id, e.email FROM passport_telegram_accounts a
		JOIN passport_user_emails ue ON ue.user_id = a.user_id JOIN passport_emails e ON e.id = ue.email_id
		WHERE a.bot_id = ? AND a.telegram_user_id = ?`).get(webhookBot.id, 9001);
	assert.equal(firstIdentity?.email, 'user@example.com');
	assert.match(firstIdentity?.user_id ?? '', /^\d+$/);
	identityDatabase.close();

	assert.equal((await postTelegramUpdate({ update_id: 7006, message: {
		message_id: 20, chat: { id: 9002, type: 'private' }, from: { id: 9002, first_name: 'Second User' }, text: '/start',
	} })).status, 200);
	const secondMenuMessageId = telegramMessageId;
	assert.equal((await postTelegramUpdate({ update_id: 7007, callback_query: {
		id: 'callback-bind-second', from: { id: 9002, first_name: 'Second User' }, data: 'menu:bind_email',
		message: { message_id: secondMenuMessageId, chat: { id: 9002, type: 'private' } },
	} })).status, 200);
	assert.equal((await postTelegramUpdate({ update_id: 7008, message: {
		message_id: 21, chat: { id: 9002, type: 'private' }, from: { id: 9002, first_name: 'Second User' }, text: 'user@example.com',
	} })).status, 200);
	const secondOtpTemplate = JSON.parse(directMailActions.filter((item) => item.action === 'SingleSendMail').at(-1)?.parameters.get('Template'));
	assert.equal((await postTelegramUpdate({ update_id: 7009, message: {
		message_id: 22, chat: { id: 9002, type: 'private' }, from: { id: 9002, first_name: 'Second User' }, text: secondOtpTemplate.TemplateData.code,
	} })).status, 200);
	const choiceEdit = telegramActions.filter((item) => item.method === 'editMessageText').at(-1);
	const linkChoice = choiceEdit?.body.reply_markup.inline_keyboard.flat().find((item) => String(item.callback_data).startsWith('identity:link:'));
	assert.ok(linkChoice?.callback_data);
	assert.equal((await postTelegramUpdate({ update_id: 7010, callback_query: {
		id: 'callback-link-second', from: { id: 9002, first_name: 'Second User' }, data: linkChoice.callback_data,
		message: { message_id: secondMenuMessageId, chat: { id: 9002, type: 'private' } },
	} })).status, 200);
	const linkedDatabase = new DatabaseSync(process.env.DEFAULT_DATABASE_FILE, { readOnly: true });
	const linkedUsers = linkedDatabase.prepare(`SELECT CAST(user_id AS TEXT) AS user_id FROM passport_telegram_accounts WHERE bot_id = ? ORDER BY telegram_user_id`).all(webhookBot.id);
	assert.equal(linkedUsers.length, 2);
	assert.equal(linkedUsers[0].user_id, linkedUsers[1].user_id);
	linkedDatabase.close();

	const publicDocument = await (await request('localhost', '/')).text();
	assert.equal(publicDocument.includes('站点管理'), false);
	const adminDocument = await (await request('localhost', '/', { cookie })).text();
	assert.equal(adminDocument.includes('站点管理'), true);
	assert.equal(adminDocument.includes('邮件推送'), true);
	console.log('multi-site smoke test passed');
} finally {
	globalThis.fetch = originalFetch;
	await rm(temporaryDirectory, { recursive: true, force: true });
}
