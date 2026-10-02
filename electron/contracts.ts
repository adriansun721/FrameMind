export const enum DesktopChannel {
  SaveProject = "project:save",
  OpenProject = "project:open",
  SetTheme = "app:theme",
}

export type AppTheme = "dark" | "light";

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
  setTheme(theme: AppTheme): Promise<void>;
  saveProject(request: SaveProjectRequest): Promise<SaveProjectResult>;
  openProject(): Promise<OpenProjectResult>;
}
