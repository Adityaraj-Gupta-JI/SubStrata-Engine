export interface ClerkConfigurationIssue {
  name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" | "CLERK_SECRET_KEY";
  reason: "missing" | "unicode_ellipsis" | "invalid_characters" | "invalid_format";
}

// Return names and categories only. Never include a configuration value in an error.
export function clerkConfigurationIssues(environment: Record<string, string | undefined>): ClerkConfigurationIssue[] {
  const names = ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"] as const;
  return names.flatMap<ClerkConfigurationIssue>(name => {
    const value = environment[name];
    if (!value) return [{ name, reason: "missing" as const }];
    if (value.includes("\u2026")) return [{ name, reason: "unicode_ellipsis" as const }];
    // Fetch header values must be ByteStrings. Keys also cannot contain whitespace.
    if (/[^\x21-\x7e]/.test(value)) return [{ name, reason: "invalid_characters" as const }];
    const prefix = name === "CLERK_SECRET_KEY" ? /^sk_(test|live)_.+$/ : /^pk_(test|live)_.+$/;
    if (!prefix.test(value)) return [{ name, reason: "invalid_format" as const }];
    return [];
  });
}
