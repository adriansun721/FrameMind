export interface BendingRelease { my: boolean; mz: boolean; }
export interface MemberEndReleases { start: BendingRelease; end: BendingRelease; }

export function validateMemberEndReleases(value: unknown): MemberEndReleases {
  const object = (input: unknown, keys: string[]) => {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))) {
      throw new Error("杆端释放必须明确两端的局部 My/Mz 布尔值；不支持轴向、剪切或扭转释放");
    }
    return input as Record<string, unknown>;
  };
  const ends = object(value, ["start", "end"]);
  const end = (value: unknown): BendingRelease => {
    const input = object(value, ["my", "mz"]);
    if (typeof input.my !== "boolean" || typeof input.mz !== "boolean") throw new Error("局部 My/Mz 释放必须是布尔值");
    return { my: input.my, mz: input.mz };
  };
  return { start: end(ends.start), end: end(ends.end) };
}

export function hasMemberReleases(member: { endReleases?: MemberEndReleases }): boolean {
  return Boolean(member.endReleases && [member.endReleases.start, member.endReleases.end].some((end) => end.my || end.mz));
}

export function releaseLabel(end?: BendingRelease): string {
  return end?.my && end.mz ? "释放 My、Mz" : end?.my ? "释放 My" : end?.mz ? "释放 Mz" : "刚接";
}
