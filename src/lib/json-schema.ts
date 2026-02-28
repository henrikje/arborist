import { type ZodType, toJSONSchema } from "zod";

export function printSchema(schema: ZodType): void {
	const jsonSchema = toJSONSchema(schema, { target: "draft-2020-12" });
	process.stdout.write(`${JSON.stringify(jsonSchema, null, 2)}\n`);
}
