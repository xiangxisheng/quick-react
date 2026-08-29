export const passwordMinimumLength = 8;

export const passwordError = (password: string) => password.length < passwordMinimumLength
	? `密码至少需要 ${passwordMinimumLength} 个字符`
	: undefined;

export const assertPassword = (password: string) => {
	const error = passwordError(password);
	if (error) throw new Error(error);
};
