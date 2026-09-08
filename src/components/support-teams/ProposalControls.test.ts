import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en-US.json";
import pt from "../../../messages/pt-BR.json";
import { ProposalControls, type ProposalBoardAdapter } from "./ProposalControls";
import { applyProposalCommand, proposalSnapshot } from "@/lib/support-teams/proposal.shared";
import { emptyBoard } from "@/lib/support-teams/policy.shared";
import type { SupportActor, SupportRosterMember } from "@/lib/support-teams/types.shared";

const actor: SupportActor = { allianceId: "a", principalId: "owner", canRead: true, canWrite: true, override: true, linkedMemberIds: [] };
const roster = [{ id: "r", rank: 4, name: "Lead", draftStintToken: "private", proposalVoterIds: [] }] as unknown as SupportRosterMember[];
const board = applyProposalCommand(emptyBoard("a"), roster, actor, { kind: "createProposal", proposalId: "p", expectedVersion: 0 }, { id: "created", at: "2026-09-10T00:00:00Z", idempotencyKey: "created" }).board;
const snapshot = proposalSnapshot(board, roster, actor, "p");

describe("proposal board integration adapter", () => {
  it.each([["en-US", en], ["pt-BR", pt]] as const)("renders approved localized controls and delegates the board for %s", (locale, messages) => {
    let adapter: ProposalBoardAdapter | undefined;
    const controls = createElement(ProposalControls, { snapshot, publishedVersion: 0, canCreate: true, onRefresh: () => {}, onCreated: () => {}, renderBoard: (value) => { adapter = value; return createElement("div", { "data-board": "parent" }); } });
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as unknown as ComponentProps<typeof NextIntlClientProvider>, controls));
    expect(html).toContain(messages.supportTeams.proposals.title);
    expect(html).toContain(messages.supportTeams.proposals.majorityHint);
    expect(html).toContain('data-board="parent"');
    expect(adapter?.snapshot).toBe(snapshot);
    expect(adapter?.canMoveMember("r", null)).toBe(false);
    expect(adapter?.canMoveMember("unknown", snapshot.teams[0].id)).toBe(false);
    expect(adapter?.canSwapMembers("r", "unknown")).toBe(false);
    expect(html).not.toContain("private");
  });
});
