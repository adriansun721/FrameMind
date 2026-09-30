interface SaveProjectResult {
  status: "saved" | "cancelled";
  path?: string;
}

interface OpenProjectResult {
  status: "opened" | "cancelled";
  path?: string;
  content?: string;
}

interface FrameMindDesktopApi {
  saveProject(request: {
    path: string | null;
    content: string;
  }): Promise<SaveProjectResult>;
  openProject(): Promise<OpenProjectResult>;
}

declare global {
  interface Window {
    frameMind: FrameMindDesktopApi;
  }
}

export {};
