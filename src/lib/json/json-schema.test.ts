import { describe, expect, test } from "bun:test";
import { toJSONSchema, z } from "zod";
import {
	BranchJsonOutputSchema,
	DiffJsonOutputSchema,
	ListJsonEntrySchema,
	LogJsonOutputSchema,
	RepoListJsonEntrySchema,
	StatusJsonOutputSchema,
} from "./json-types";

describe("json-schema stability", () => {
	test("StatusJsonOutputSchema", () => {
		expect(toJSONSchema(StatusJsonOutputSchema, { target: "draft-2020-12" })).toMatchSnapshot();
	});

	test("LogJsonOutputSchema", () => {
		expect(toJSONSchema(LogJsonOutputSchema, { target: "draft-2020-12" })).toMatchSnapshot();
	});

	test("DiffJsonOutputSchema", () => {
		expect(toJSONSchema(DiffJsonOutputSchema, { target: "draft-2020-12" })).toMatchSnapshot();
	});

	test("BranchJsonOutputSchema", () => {
		expect(toJSONSchema(BranchJsonOutputSchema, { target: "draft-2020-12" })).toMatchSnapshot();
	});

	test("ListJsonEntrySchema (array)", () => {
		expect(toJSONSchema(z.array(ListJsonEntrySchema), { target: "draft-2020-12" })).toMatchSnapshot();
	});

	test("RepoListJsonEntrySchema (array)", () => {
		expect(toJSONSchema(z.array(RepoListJsonEntrySchema), { target: "draft-2020-12" })).toMatchSnapshot();
	});
});
