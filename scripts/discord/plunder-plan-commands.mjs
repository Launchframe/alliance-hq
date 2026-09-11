import { readFileSync } from "node:fs";
const en = JSON.parse(readFileSync(new URL("../../messages/en-US.json", import.meta.url), "utf8")).plunderPlan;
const pt = JSON.parse(readFileSync(new URL("../../messages/pt-BR.json", import.meta.url), "utf8")).plunderPlan;
const text = (name, key) => ({ name, type: 3, description: en[key], description_localizations: { "pt-BR": pt[key] }, required: false });

export const PLUNDER_PLAN_COMMAND = {
  name: "plunder-plan", type: 1, dm_permission: false,
  description: en.commands.root, description_localizations: { "pt-BR": pt.commands.root },
  options: Object.keys(en.commands).filter((name) => name !== "root").map((name) => ({
    name, type: 1, description: en.commands[name], description_localizations: { "pt-BR": pt.commands[name] },
    ...(name === "schedule" ? { options: [text("date", "date"), { ...text("view", "calendar"), choices: [{ name: en.day, name_localizations: { "pt-BR": pt.day }, value: "day" }, { name: en.week, name_localizations: { "pt-BR": pt.week }, value: "week" }] }] } : {}),
    ...(name === "notifications" ? { options: [
      { name: "enabled", type: 5, description: en.notifications.enableDigest, description_localizations: { "pt-BR": pt.notifications.enableDigest } },
      { name: "channel", type: 7, channel_types: [0, 5], description: en.notifications.channel, description_localizations: { "pt-BR": pt.notifications.channel } },
      { name: "time", type: 3, description: en.notifications.time, description_localizations: { "pt-BR": pt.notifications.time } },
      { name: "language", type: 3, description: en.notifications.language, description_localizations: { "pt-BR": pt.notifications.language }, choices: [{ name: "en-US", value: "en-US" }, { name: "pt-BR", value: "pt-BR" }] },
    ] } : {}),
  })),
};
