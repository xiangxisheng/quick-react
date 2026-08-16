const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const prismaDir = path.join(projectDir, 'prisma');
const sitesDir = path.join(projectDir, 'server', 'sites');
const siteKeyPattern = /^[a-z][a-z0-9_]*$/;
const modelPattern = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm;

const validate = () => {
	const errors = [];
	const modelOwners = new Map();
	const schemaFiles = fs.existsSync(prismaDir)
		? fs.readdirSync(prismaDir).filter((file) => file.endsWith('.prisma')).sort()
		: [];
	for (const file of schemaFiles) {
		const siteKey = file.replace(/\.prisma$/, '');
		if (!siteKeyPattern.test(siteKey)) errors.push(`Invalid schema site key: ${siteKey}`);
		const source = fs.readFileSync(path.join(prismaDir, file), 'utf8');
		for (const match of source.matchAll(modelPattern)) {
			const model = match[1];
			if (!model.startsWith(`${siteKey}_`) || !/^[a-z][a-z0-9_]*$/.test(model)) {
				errors.push(`${file}: model ${model} must use the ${siteKey}_ prefix and lowercase snake_case`);
			}
			const owner = modelOwners.get(model);
			if (owner) errors.push(`Duplicate physical table ${model} in ${owner} and ${file}`);
			else modelOwners.set(model, file);
		}
	}
	if (fs.existsSync(sitesDir)) {
		for (const entry of fs.readdirSync(sitesDir, { withFileTypes: true })) {
			if (entry.isDirectory() && !siteKeyPattern.test(entry.name)) errors.push(`Invalid code site directory: ${entry.name}`);
		}
	}
	if (errors.length) throw new Error(`Site schema validation failed:\n${errors.join('\n')}`);
};

if (require.main === module) validate();
module.exports = { validate };
