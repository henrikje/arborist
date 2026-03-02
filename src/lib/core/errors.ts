export class ArbError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ArbError";
	}
}

export class ArbAbort extends Error {
	constructor(message = "Aborted.") {
		super(message);
		this.name = "ArbAbort";
	}
}
