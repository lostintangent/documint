// Shared compact leaf toolbar with icon buttons, dividers, and nested menus.
// This stays in one file because the compound API and its private views are
// small, tightly coupled, and easier to read together than split apart.
import { ChevronDown, type LucideIcon } from "lucide-react";
import {
  Children,
  isValidElement,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { LeafDivider } from "../LeafDivider";
import { getVisualViewportMetrics, resolveHorizontalOffset } from "../anchor/placement";
import { LeafButton } from "../LeafButton";
import { clx } from "../lib/clx";

type LeafToolbarProps = {
  children: ReactNode;
};

type LeafToolbarButtonProps = {
  active?: boolean;
  className?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

type LeafToolbarMenuProps = {
  active?: boolean;
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  label: string;
  onSelect: (value: string) => void;
};

type LeafToolbarMenuItemProps = {
  active?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  text: string;
  value: string;
};

const suppressToolbarEvent = (event: {
  preventDefault: () => void;
  stopPropagation: () => void;
}) => {
  event.preventDefault();
  event.stopPropagation();
};

const isPrimaryPointer = (event: ReactPointerEvent<HTMLButtonElement>) =>
  event.isPrimary && event.button === 0;

function LeafToolbarRoot({ children }: LeafToolbarProps) {
  return (
    <div className="documint-leaf-toolbar flex items-center gap-2">
      {Children.map(children, renderToolbarChild)}
    </div>
  );
}

function renderToolbarChild(child: ReactNode) {
  if (!isValidElement(child)) {
    return null;
  }

  if (child.type === LeafToolbarButton) {
    const props = child.props as LeafToolbarButtonProps;

    return <LeafToolbarIconButton {...props} />;
  }

  if (child.type === LeafToolbarDivider) {
    return <LeafDivider orientation="vertical" />;
  }

  if (child.type === LeafToolbarMenu) {
    const props = child.props as LeafToolbarMenuProps;

    return <LeafToolbarMenuView {...props} />;
  }

  return null;
}

function LeafToolbarIconButton({
  active = false,
  className,
  disabled = false,
  icon,
  label,
  onClick,
}: LeafToolbarButtonProps) {
  return (
    <LeafButton
      active={active}
      className={className}
      disabled={disabled}
      icon={icon}
      iconSize={15}
      onClick={suppressToolbarEvent}
      onPointerDown={(event) => {
        suppressToolbarEvent(event);

        if (!disabled && isPrimaryPointer(event)) {
          onClick();
        }
      }}
      title={label}
    />
  );
}

function LeafToolbarMenuView({
  active = false,
  children,
  className,
  icon,
  label,
  onSelect,
}: LeafToolbarMenuProps) {
  const menuShellRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuHorizontalOffset, setMenuHorizontalOffset] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuHorizontalOffset(null);
      return;
    }

    const updateMenuHorizontalOffset = () => {
      const menuShell = menuShellRef.current;
      const menu = menuRef.current;
      if (!menuShell || !menu) {
        return;
      }

      setMenuHorizontalOffset(resolveMenuHorizontalOffset(menuShell, menu));
    };

    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const resizeObserver = new ResizeObserver(updateMenuHorizontalOffset);
    resizeObserver.observe(menu);
    updateMenuHorizontalOffset();
    window.visualViewport?.addEventListener("resize", updateMenuHorizontalOffset);
    window.addEventListener("resize", updateMenuHorizontalOffset);

    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", updateMenuHorizontalOffset);
      window.removeEventListener("resize", updateMenuHorizontalOffset);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const menuShell = menuShellRef.current;
      const path = event.composedPath();

      if (menuShell && !path.includes(menuShell)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [isOpen]);

  return (
    <div className="relative inline-flex items-center" ref={menuShellRef}>
      <LeafToolbarMenuButton
        className={className}
        icon={icon}
        isActive={active}
        isOpen={isOpen}
        label={label}
        onClick={() => setIsOpen((open) => !open)}
      />
      {isOpen ? (
        <div
          // Menu surface intentionally uses arbitrary values for `top` offset
          // and `rounded` — both fall between Tailwind's scale steps in a way
          // that's visually perceptible (radius sandwiched between rounded-xl
          // and rounded-2xl, gap between mt-2.5 and mt-3). Snapping either
          // direction shifts the menu's chrome enough to read as "off."
          className="absolute top-[calc(100%+0.65rem)] left-0 grid gap-1 w-max min-w-max p-1.5 border border-leaf-menu-border rounded-[0.8rem] bg-leaf-bg [box-shadow:var(--documint-leaf-shadow,var(--documint-leaf-shadow-fallback))] text-leaf-text font-leaf text-sm"
          ref={menuRef}
          role="menu"
          style={resolveMenuPlacementStyle(menuHorizontalOffset)}
        >
          {Children.map(children, (child) =>
            renderToolbarMenuChild(child, (value) => {
              setIsOpen(false);
              onSelect(value);
            }),
          )}
        </div>
      ) : null}
    </div>
  );
}

function resolveMenuHorizontalOffset(menuShell: HTMLElement, menu: HTMLElement): number {
  const viewport = getVisualViewportMetrics();

  return resolveHorizontalOffset({
    anchorViewportLeft: menuShell.getBoundingClientRect().left - viewport.offsetLeft,
    floatingWidth: menu.getBoundingClientRect().width,
  });
}

function resolveMenuPlacementStyle(horizontalOffset: number | null): CSSProperties {
  if (horizontalOffset === null) {
    return {
      left: 0,
      position: "fixed",
      top: 0,
      visibility: "hidden",
    };
  }

  return { left: `${horizontalOffset}px` };
}

function LeafToolbarMenuButton({
  className,
  icon: Icon,
  isActive,
  isOpen,
  label,
  onClick,
}: {
  className?: string;
  icon: LucideIcon;
  isActive: boolean;
  isOpen: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <LeafButton
      aria-expanded={isOpen}
      aria-haspopup="menu"
      aria-pressed={isActive}
      active={isOpen || isActive}
      className={clx("gap-1", className)}
      icon={Icon}
      iconSize={15}
      onClick={suppressToolbarEvent}
      onPointerDown={(event) => {
        suppressToolbarEvent(event);

        if (isPrimaryPointer(event)) {
          onClick();
        }
      }}
      title={label}
    >
      <ChevronDown
        className={clx(
          "transition-transform duration-150 ease-in-out will-change-transform",
          isOpen ? "rotate-180" : null,
        )}
        size={13}
        strokeWidth={2.2}
      />
    </LeafButton>
  );
}

function renderToolbarMenuChild(child: ReactNode, onSelect: (value: string) => void) {
  if (!isValidElement(child)) {
    return null;
  }

  if (child.type === LeafToolbarMenuDivider) {
    return <LeafDivider />;
  }

  if (child.type !== LeafToolbarMenuItem) {
    return null;
  }

  const {
    active = false,
    disabled = false,
    icon: Icon,
    text,
    value,
  } = child.props as LeafToolbarMenuItemProps;

  return (
    <LeafButton
      active={active}
      disabled={disabled}
      icon={Icon}
      iconSize={15}
      label={text}
      onClick={(event) => {
        suppressToolbarEvent(event);
        onSelect(value);
      }}
      onPointerDown={suppressToolbarEvent}
      role="menuitem"
    />
  );
}

function LeafToolbarButton(_props: LeafToolbarButtonProps) {
  return null;
}

function LeafToolbarDivider() {
  return null;
}

function LeafToolbarMenu(_props: LeafToolbarMenuProps) {
  return null;
}

function LeafToolbarMenuItem(_props: LeafToolbarMenuItemProps) {
  return null;
}

function LeafToolbarMenuDivider() {
  return null;
}

export const LeafToolbar = Object.assign(LeafToolbarRoot, {
  Button: LeafToolbarButton,
  Divider: LeafToolbarDivider,
  Menu: LeafToolbarMenu,
  MenuDivider: LeafToolbarMenuDivider,
  MenuItem: LeafToolbarMenuItem,
});
