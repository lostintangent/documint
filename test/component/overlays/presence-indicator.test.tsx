import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditorPresence } from "@/editor";
import { PresenceIndicator } from "@/component/overlays/PresenceIndicator";

const noop = () => {};

describe("PresenceIndicator", () => {
  test("pulses the avatar when requested", () => {
    const html = renderToStaticMarkup(
      <PresenceIndicator onSelect={noop} presence={createPresence(true)} />,
    );

    expect(html).toContain("presence-avatar");
    expect(html).toContain("is-pulsing");
  });

  test("keeps the avatar static by default", () => {
    const html = renderToStaticMarkup(
      <PresenceIndicator onSelect={noop} presence={createPresence(false)} />,
    );

    expect(html).toContain("presence-avatar");
    expect(html).not.toContain("is-pulsing");
  });
});

function createPresence(isOnUnresolvedCommentThread: boolean): EditorPresence {
  return {
    color: "#8b5cf6",
    commentThreadIndex: 0,
    cursor: { threadId: "thread" },
    cursorPoint: null,
    id: "user",
    isOnUnresolvedCommentThread,
    username: "Commenter",
    viewport: { scrollTop: 0, status: "visible" },
  };
}
