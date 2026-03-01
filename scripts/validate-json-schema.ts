import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";

const [schemaPath, dataPath] = process.argv.slice(2);
if (!schemaPath || !dataPath) {
	console.error("Usage: validate-json-schema.ts <schema.json> <data.json>");
	process.exit(1);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
const data = JSON.parse(readFileSync(dataPath, "utf-8"));

const ajv = new Ajv2020();
const validate = ajv.compile(schema);

if (!validate(data)) {
	console.error("Validation failed:");
	console.error(JSON.stringify(validate.errors, null, 2));
	process.exit(1);
}
