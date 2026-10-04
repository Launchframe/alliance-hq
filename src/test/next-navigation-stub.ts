export function redirect() {
  throw new Error("redirect");
}

export function notFound() {
  throw new Error("notFound");
}

export function useRouter() {
  return { push: () => {}, replace: () => {}, back: () => {} };
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}
