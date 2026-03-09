import { createSlidesSessionStore } from "./slides-session-store";

export function createSlidesTextController(options: {
  getSlides: Parameters<typeof createSlidesSessionStore>[0]["getSlides"];
  getLengthValue: () => string;
  getSlidesOcrEnabled: () => boolean;
}) {
  return createSlidesSessionStore(options);
}
