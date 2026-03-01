import { bold, dim } from "./output";

export interface Column<T> {
	header: string;
	value: (row: T, i: number) => string;
	render?: (row: T, i: number) => string;
}

export function renderTable<T>(
	columns: Column<T>[],
	rows: T[],
	options?: {
		marker?: (row: T) => boolean;
		gap?: number;
		afterRow?: (row: T, i: number) => string;
	},
): string {
	const gap = options?.gap ?? 4;
	const gapStr = " ".repeat(gap);

	// Compute max width per column (header width is minimum)
	const widths = columns.map((col) => {
		let max = col.header.length;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (!row) continue;
			const len = col.value(row, i).length;
			if (len > max) max = len;
		}
		return max;
	});

	// Header
	let out = "  ";
	for (let c = 0; c < columns.length; c++) {
		const col = columns[c];
		if (!col) continue;
		const w = widths[c] ?? 0;
		if (c > 0) out += gapStr;
		out += `${dim(col.header)}${" ".repeat(w - col.header.length)}`;
	}
	out += "\n";

	// Rows
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!row) continue;

		const prefix = options?.marker ? (options.marker(row) ? `${bold("*")} ` : "  ") : "  ";
		out += prefix;

		for (let c = 0; c < columns.length; c++) {
			const col = columns[c];
			if (!col) continue;
			const w = widths[c] ?? 0;
			if (c > 0) out += gapStr;

			const plainLen = col.value(row, i).length;
			const display = col.render ? col.render(row, i) : col.value(row, i);
			out += `${display}${" ".repeat(Math.max(0, w - plainLen))}`;
		}

		out += "\n";

		if (options?.afterRow) {
			out += options.afterRow(row, i);
		}
	}

	return out;
}
