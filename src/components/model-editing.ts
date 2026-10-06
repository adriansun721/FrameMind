import type { MemberEndReleases } from "../domain/member-releases";
export interface NodeDraft { x: string; y: string; z: string; }
export interface MemberDraft { startNodeId: string; endNodeId: string; materialId: string; sectionId: string; rotationDegrees: string; endReleases?: MemberEndReleases; }
