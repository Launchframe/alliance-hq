import { countryFlagParts } from "@/lib/members/country-flag.shared";

type Props = {
  code: string | null | undefined;
  locale: string;
  className?: string;
};

export function CountryFlag({ code, locale, className }: Props) {
  const parts = countryFlagParts(code, locale);
  if (!parts) return null;
  return (
    <span
      role="img"
      aria-label={parts.name}
      className={className ?? "inline-block shrink-0 leading-none"}
    >
      {parts.emoji}
    </span>
  );
}
