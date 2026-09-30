import type { FrameMindDesktopApi } from "../electron/contracts";

declare global {
  interface Window {
    frameMind: FrameMindDesktopApi;
  }
}

export {};
