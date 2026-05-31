// Animated leaf row rendered inside the fixed overlay layer. Unlike
// `LeafAnchor`, this does not resolve document geometry; the layer
// positions it as editor chrome.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type OverlayLeafProps = {
  children: ReactNode;
  open: boolean;
};

const overlayLeafAnimationMs = 500;
// Gap reserved below the leaf so following overlay items clear its shadow
// while the leaf itself slides independently.
const overlayLeafClearancePx = 12;

type OverlayLeafSize = {
  height: number;
  width: number;
};

export function OverlayLeaf({ children, open }: OverlayLeafProps) {
  const [isPresent, setIsPresent] = useState(open);
  const [isVisible, setIsVisible] = useState(false);
  const [leafSize, setLeafSize] = useState<OverlayLeafSize>({ height: 0, width: 0 });
  const shellRef = useRef<HTMLDivElement | null>(null);
  const renderedChildrenRef = useRef<ReactNode>(children);

  if (open) {
    renderedChildrenRef.current = children;
  }

  useEffect(() => {
    if (open) {
      setIsPresent(true);
      setIsVisible(false);
      return;
    }

    setIsVisible(false);
    const timeoutId = window.setTimeout(() => setIsPresent(false), overlayLeafAnimationMs);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!open || !isPresent) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [isPresent, open]);

  useLayoutEffect(() => {
    if (!isPresent) {
      return;
    }

    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const updateSize = () => {
      setLeafSize((current) => {
        const next = {
          height: shell.offsetHeight + overlayLeafClearancePx,
          width: shell.offsetWidth,
        };
        return current.height === next.height && current.width === next.width ? current : next;
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(shell);
    return () => resizeObserver.disconnect();
  }, [isPresent]);

  if (!isPresent) {
    return null;
  }

  return (
    <div
      className="documint-overlay-leaf"
      data-state={isVisible ? "open" : "closed"}
      style={
        {
          "--documint-overlay-leaf-height": `${leafSize.height}px`,
          "--documint-overlay-leaf-width": `${leafSize.width}px`,
        } as CSSProperties
      }
    >
      <div className="documint-overlay-leaf-frame">
        <div className="documint-leaf-shell" ref={shellRef}>
          {renderedChildrenRef.current}
        </div>
      </div>
    </div>
  );
}
