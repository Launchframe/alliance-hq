"use strict";

/** Minimal stub so LastRank CLI can import HQ server modules under tsx. */
function noop() {
  return null;
}

module.exports = {
  useRouter: noop,
  usePathname: noop,
  useSearchParams: noop,
  useParams: noop,
  useSelectedLayoutSegment: noop,
  useSelectedLayoutSegments: noop,
  redirect: noop,
  permanentRedirect: noop,
  notFound: noop,
  forbidden: noop,
  unauthorized: noop,
};
