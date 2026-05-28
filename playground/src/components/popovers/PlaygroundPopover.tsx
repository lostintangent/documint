import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

type PlaygroundPopoverProps = {
  ariaLabel: string;
  children: ReactNode | ((popover: { close: () => void }) => ReactNode);
  containerClassName?: string;
  flyoutClassName?: string;
  icon: ReactNode;
  iconClassName?: string;
  iconStyle?: CSSProperties;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: PlaygroundPopoverSize;
  showSwatch?: boolean;
};

type PlaygroundPopoverSize = "sm" | "md" | "lg";

const popoverWidthClassNameBySize: Record<PlaygroundPopoverSize, string> = {
  sm: "w-[min(14rem,calc(100vw_-_3rem))]",
  md: "w-[min(24rem,calc(100vw_-_3rem))] max-[700px]:portrait:w-[min(18rem,calc(100vw_-_1rem))]",
  lg: "w-[min(28rem,calc(100vw_-_1.5rem))] max-[700px]:portrait:w-[min(20rem,calc(100vw_-_1rem))]",
};

export const popoverHeaderClassName = "flex items-center justify-between gap-3";
export const popoverTitleClassName = "font-controls text-[0.95rem]";
export const popoverControlClassName =
  "font-controls cursor-pointer border border-border/[0.14] bg-background/[0.9]";

export function PlaygroundPopover({
  ariaLabel,
  children,
  containerClassName,
  flyoutClassName = "",
  icon,
  iconClassName,
  iconStyle,
  open: controlledOpen,
  onOpenChange,
  size = "md",
  showSwatch = true,
}: PlaygroundPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean | ((current: boolean) => boolean)) => {
      const resolvedOpen = typeof nextOpen === "function" ? nextOpen(open) : nextOpen;
      onOpenChange?.(resolvedOpen);

      if (controlledOpen == null) {
        setUncontrolledOpen(resolvedOpen);
      }
    },
    [controlledOpen, onOpenChange, open],
  );

  const close = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        popoverRef.current &&
        event.target instanceof Node &&
        !popoverRef.current.contains(event.target)
      ) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return (
    <div
      className={`relative${containerClassName ? ` ${containerClassName}` : ""}`}
      ref={popoverRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="font-controls inline-flex cursor-pointer items-center gap-[0.2rem] rounded-[0.8rem] border-0 bg-transparent px-[0.2rem] py-[0.35rem] text-inherit transition-colors duration-[140ms] hover:bg-border/[0.06]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-[1.3rem] w-[1.3rem] flex-none items-center justify-center rounded-full border${
            showSwatch ? " border-border/[0.14]" : " border-transparent bg-transparent"
          }${iconClassName ? ` ${iconClassName}` : ""}`}
          style={showSwatch ? iconStyle : undefined}
        >
          {icon}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`transition-transform duration-[140ms]${open ? " rotate-180" : ""}`}
          size={14}
          strokeWidth={2.1}
        />
      </button>
      {open ? (
        <div
          className={`font-controls absolute top-[calc(100%+0.5rem)] right-0 z-[2] grid gap-[0.85rem] rounded-2xl border border-border/[0.12] bg-background/[0.96] p-4 shadow-popover ${popoverWidthClassNameBySize[size]} ${flyoutClassName}`}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      ) : null}
    </div>
  );
}
