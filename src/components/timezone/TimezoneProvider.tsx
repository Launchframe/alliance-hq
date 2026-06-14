"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocale } from "next-intl";

import {
  DEFAULT_ACCOUNT_TIMEZONE_ID,
  type AccountTimezoneId,
} from "@/lib/timezone/constants";
import {
  formatAccountDate,
  formatAccountDateTime,
} from "@/lib/timezone/format";

type TimezoneContextValue = {
  timezoneId: AccountTimezoneId;
  setTimezoneId: (timezoneId: AccountTimezoneId) => void;
};

const TimezoneContext = createContext<TimezoneContextValue>({
  timezoneId: DEFAULT_ACCOUNT_TIMEZONE_ID,
  setTimezoneId: () => {},
});

export function TimezoneProvider({
  initialTimezoneId,
  children,
}: {
  initialTimezoneId?: AccountTimezoneId;
  children: ReactNode;
}) {
  const [timezoneId, setTimezoneId] = useState<AccountTimezoneId>(
    initialTimezoneId ?? DEFAULT_ACCOUNT_TIMEZONE_ID,
  );

  const value = useMemo(
    () => ({ timezoneId, setTimezoneId }),
    [timezoneId],
  );

  return (
    <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>
  );
}

export function useAccountTimezone() {
  return useContext(TimezoneContext);
}

export function useFormatAccountDateTime() {
  const { timezoneId } = useAccountTimezone();
  const locale = useLocale();

  return useCallback(
    (
      value: Date | string,
      options?: Intl.DateTimeFormatOptions,
    ) =>
      formatAccountDateTime(value, {
        locale,
        timezoneId,
        ...options,
      }),
    [locale, timezoneId],
  );
}

export function useFormatAccountDate() {
  const { timezoneId } = useAccountTimezone();
  const locale = useLocale();

  return useCallback(
    (
      value: Date | string,
      options?: Intl.DateTimeFormatOptions,
    ) =>
      formatAccountDate(value, {
        locale,
        timezoneId,
        ...options,
      }),
    [locale, timezoneId],
  );
}

export function FormattedDateTime({
  value,
  ...options
}: {
  value: Date | string;
} & Intl.DateTimeFormatOptions) {
  const format = useFormatAccountDateTime();
  return <>{format(value, options)}</>;
}
