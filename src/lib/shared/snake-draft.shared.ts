/** Snake-draft distribution for balanced team filler assignment. */
export function assignSnakeDraft<T>(items: T[], teamCount: number, slotsPerTeam: number): T[][] {
  const perTeam: T[][] = Array.from({ length: teamCount }, () => []);

  for (let round = 0; round < slotsPerTeam; round++) {
    const forward = round % 2 === 0;
    for (let slot = 0; slot < teamCount; slot++) {
      const teamIndex = forward ? slot : teamCount - 1 - slot;
      const fillerIndex = round * teamCount + slot;
      if (fillerIndex < items.length) {
        perTeam[teamIndex]!.push(items[fillerIndex]!);
      }
    }
  }

  return perTeam;
}
