export type NetworkErrorClass = "offline" | "auth" | "not-found" | "unknown";

const OFFLINE_PATTERNS = [
	"Could not resolve host",
	"Connection refused",
	"Failed to connect",
	"Network is unreachable",
	"No route to host",
	"Operation timed out",
	"Connection timed out",
	"SSL_ERROR_SYSCALL",
	"unable to access",
	"couldn't connect to server",
];

const AUTH_PATTERNS = [
	"HTTP 401",
	"HTTP 403",
	"Authentication failed",
	"could not read Username",
	"terminal prompts disabled",
	"Invalid username or password",
	"The requested URL returned error: 401",
	"The requested URL returned error: 403",
];

const NOT_FOUND_PATTERNS = [
	"HTTP 404",
	"Repository not found",
	"does not appear to be a git repository",
	"The requested URL returned error: 404",
];

function matchesAny(stderr: string, patterns: string[]): boolean {
	return patterns.some((p) => stderr.includes(p));
}

export function classifyNetworkError(stderr: string): NetworkErrorClass {
	if (matchesAny(stderr, OFFLINE_PATTERNS)) return "offline";
	if (matchesAny(stderr, AUTH_PATTERNS)) return "auth";
	if (matchesAny(stderr, NOT_FOUND_PATTERNS)) return "not-found";
	return "unknown";
}

export function isNetworkError(stderr: string): boolean {
	return classifyNetworkError(stderr) === "offline";
}

const HINTS: Record<NetworkErrorClass, string | null> = {
	offline: "network unreachable \u2014 check your connection",
	auth: "authentication failed \u2014 check your credentials or token",
	"not-found": "repository not found \u2014 verify the remote URL",
	unknown: null,
};

export function networkErrorHint(errorClass: NetworkErrorClass): string | null {
	return HINTS[errorClass];
}
