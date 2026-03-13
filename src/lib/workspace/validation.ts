export function validateWorkspaceName(name: string): string | null {
  if (name.startsWith(".")) {
    return `Invalid workspace name '${name}': must not start with '.'`;
  }
  if (name.includes("/")) {
    return `Invalid workspace name '${name}': must not contain '/'`;
  }
  if (name.includes("..")) {
    return `Invalid workspace name '${name}': must not contain '..'`;
  }
  if (/\s/.test(name)) {
    return `Invalid workspace name '${name}': must not contain whitespace`;
  }
  return null;
}
