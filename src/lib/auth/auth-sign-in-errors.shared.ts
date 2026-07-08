export type AuthSignInErrorMessageKey =
  | "errorOAuthAccountNotLinked"
  | "errorOAuthSignInRequired"
  | "errorConfiguration"
  | "errorCredentials"
  | "errorGeneric";

export function mapAuthSignInErrorCode(
  error: string | undefined,
): AuthSignInErrorMessageKey | null {
  const code = error?.trim();
  if (!code) {
    return null;
  }

  switch (code) {
    case "OAuthAccountNotLinked":
      return "errorOAuthAccountNotLinked";
    case "OAuthSignInRequired":
      return "errorOAuthSignInRequired";
    case "Configuration":
      return "errorConfiguration";
    case "CredentialsSignin":
      return "errorCredentials";
    default:
      return "errorGeneric";
  }
}

export function isOAuthAccountNotLinkedError(error: string | undefined): boolean {
  return error?.trim() === "OAuthAccountNotLinked";
}

export function isOAuthSignInRequiredError(error: string | undefined): boolean {
  return error?.trim() === "OAuthSignInRequired";
}
