export function redirect() {
  throw new Error("redirect");
}

export const Link = ({
  children,
}: {
  children?: unknown;
}) => children;

export function usePathname() {
  return "/";
}

export function useRouter() {
  return { push: () => {}, replace: () => {}, back: () => {} };
}

export function getPathname() {
  return "/";
}
