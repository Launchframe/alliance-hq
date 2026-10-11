import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, unknown[]>(),
  loadUserLocaleState: vi.fn(),
  loadUserLocaleStates: vi.fn(),
  cookie: undefined as string | undefined,
}));

vi.mock("@/lib/db", () => {
  const table = (name: string) => ({ name, id: `${name}.id`, email: `${name}.email`, discordUserId: `${name}.discordUserId`, hqUserId: `${name}.hqUserId`, locale: `${name}.locale` });
  const db = {
    select: () => ({
      from: (t: { name: string }) => {
        const rows = mocks.rows.get(t.name) ?? [];
        const query = {
          where: () => query,
          limit: () => Promise.resolve(rows),
          then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return query;
      },
    }),
  };
  return {
    getDb: () => db,
    schema: {
      hqUsers: table("hqUsers"),
      discordHqLinks: table("discordHqLinks"),
      discordUserPrefs: table("discordUserPrefs"),
    },
  };
});

vi.mock("@/lib/i18n/user-locale.server", () => ({
  loadUserLocaleState: mocks.loadUserLocaleState,
  loadUserLocaleStates: mocks.loadUserLocaleStates,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.cookie ? { value: mocks.cookie } : undefined),
  }),
}));

import {
  formatNotificationNumber,
  notificationTranslator,
  requestLocaleFallback,
  resolveDiscordRecipientLocales,
  resolveRecipientLocale,
} from "./locale.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.cookie = undefined;
});

describe("resolveRecipientLocale", () => {
  it("prefers the recipient's manual or LastRank locale over the fallback", async () => {
    mocks.loadUserLocaleState.mockResolvedValue({ locale: "pt-BR", source: "manual" });
    await expect(
      resolveRecipientLocale({ hqUserId: "u1", fallback: "id" }),
    ).resolves.toBe("pt-BR");
  });

  it("uses the fallback when the recipient has no preference signal", async () => {
    mocks.loadUserLocaleState.mockResolvedValue({ locale: "en-US", source: "default" });
    await expect(
      resolveRecipientLocale({ hqUserId: "u1", fallback: "id" }),
    ).resolves.toBe("id");
  });

  it("looks the recipient up by email when only an address is known", async () => {
    mocks.rows.set("hqUsers", [{ id: "u2" }]);
    mocks.loadUserLocaleState.mockResolvedValue({ locale: "id", source: "lastrank" });
    await expect(
      resolveRecipientLocale({ email: "Someone@Example.com" }),
    ).resolves.toBe("id");
    expect(mocks.loadUserLocaleState).toHaveBeenCalledWith("u2");
  });

  it("falls back to en-US for unknown recipients without a fallback", async () => {
    await expect(resolveRecipientLocale({ email: "new@example.com" })).resolves.toBe("en-US");
    await expect(
      resolveRecipientLocale({ email: "new@example.com", fallback: "pt-BR" }),
    ).resolves.toBe("pt-BR");
  });
});

describe("resolveDiscordRecipientLocales", () => {
  it("routes linked users through HQ and unlinked users through /language", async () => {
    mocks.rows.set("discordHqLinks", [
      { discordUserId: "d-linked", hqUserId: "u1" },
      { discordUserId: "d-auto", hqUserId: "u2" },
    ]);
    mocks.rows.set("discordUserPrefs", [
      { discordUserId: "d-linked", locale: "en-US" },
      { discordUserId: "d-auto", locale: "pt-BR" },
      { discordUserId: "d-unlinked", locale: "id" },
    ]);
    mocks.loadUserLocaleStates.mockResolvedValue(
      new Map([
        ["u1", { locale: "pt-BR", source: "manual" }],
        ["u2", { locale: "en-US", source: "default" }],
      ]),
    );

    const locales = await resolveDiscordRecipientLocales(["d-linked", "d-auto", "d-unlinked"]);
    expect(locales.get("d-linked")).toBe("pt-BR");
    expect(locales.get("d-auto")).toBe("en-US");
    expect(locales.get("d-unlinked")).toBe("id");
  });
});

describe("requestLocaleFallback", () => {
  it("reads the browser locale cookie and ignores unknown values", async () => {
    mocks.cookie = "pt-BR";
    await expect(requestLocaleFallback()).resolves.toBe("pt-BR");
    mocks.cookie = "fr";
    await expect(requestLocaleFallback()).resolves.toBeNull();
  });
});

describe("notificationTranslator", () => {
  it("translates notification copy in the recipient's locale", () => {
    const t = notificationTranslator("pt-BR", "notificationMessages.magicLink");
    expect(t("subject", { host: "hq.test" })).toBe("Entrar em hq.test");
  });

  it("formats numbers for the recipient's locale", () => {
    expect(formatNotificationNumber(1234567, "en-US")).toBe("1,234,567");
    expect(formatNotificationNumber(1234567, "pt-BR")).toBe("1.234.567");
  });
});
