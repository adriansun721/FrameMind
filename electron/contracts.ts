export const enum DesktopChannel {
  SaveProject = "project:save",
  OpenProject = "project:open",
}

export interface SaveProjectRequest {
  path: string | null;
  content: string;
}

export type SaveProjectResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" };

export type OpenProjectResult =
  | { status: "opened"; path: string; content: string }
  | { status: "cancelled" };

export interface FrameMindDesktopApi {
  saveProject(request: SaveProjectRequest): Promise<SaveProjectResult>;
  openProject(): Promise<OpenProjectResult>;
}
