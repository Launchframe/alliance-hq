export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordValidationCode =
  | "required"
  | "too_short"
  | "too_long"
  | "mismatch";

export function validatePasswordPair(input: {
  password: string;
  confirmPassword?: string;
}): PasswordValidationCode | null {
  const password = input.password;
  if (!password.trim()) {
    return "required";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return "too_short";
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return "too_long";
  }
  if (
    input.confirmPassword !== undefined &&
    password !== input.confirmPassword
  ) {
    return "mismatch";
  }
  return null;
}
