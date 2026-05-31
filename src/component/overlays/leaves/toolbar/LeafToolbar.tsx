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
import { LeafDivider } from "../core/LeafDivider";
import { getVisualViewportMetrics, resolveHorizontalOffset } from "../core/placement";

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
  return <div className="documint-leaf-toolbar">{Children.map(children, renderToolbarChild)}</div>;
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
    <button
      aria-label={label}
      className={resolveClassName(
        "documint-leaf-toolbar-button",
        active ? "active" : null,
        className,
      )}
      disabled={disabled}
      onClick={suppressToolbarEvent}
      onPointerDown={(event) => {
        suppressToolbarEvent(event);

        if (!disabled && isPrimaryPointer(event)) {
          onClick();
        }
      }}
      title={label}
      type="button"
    >
      <ToolbarButtonIcon icon={icon} />
    </button>
  );
}

function ToolbarButtonIcon({ icon }: { icon: LucideIcon }) {
  const Icon = icon;
  return <Icon size={15} strokeWidth={2.2} />;
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
      const target = event.target;

      if (target instanceof Node && !menuShellRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [isOpen]);

  return (
    <div className="documint-leaf-toolbar-menu-shell" ref={menuShellRef}>
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
          className="documint-leaf-menu"
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
    <button
      aria-expanded={isOpen}
      aria-haspopup="menu"
      aria-label={label}
      aria-pressed={isActive}
      className={resolveClassName(
        "documint-leaf-toolbar-button",
        isOpen || isActive ? "active" : null,
        className,
      )}
      onClick={suppressToolbarEvent}
      onPointerDown={(event) => {
        suppressToolbarEvent(event);

        if (isPrimaryPointer(event)) {
          onClick();
        }
      }}
      title={label}
      type="button"
    >
      <Icon size={15} strokeWidth={2.2} />
      <ChevronDown
        className={resolveClassName(
          "documint-leaf-toolbar-menu-chevron",
          isOpen ? "is-open" : null,
        )}
        size={13}
        strokeWidth={2.2}
      />
    </button>
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
    <button
      className={resolveClassName("documint-leaf-menu-item", active ? "active" : null)}
      disabled={disabled}
      onClick={(event) => {
        suppressToolbarEvent(event);
        onSelect(value);
      }}
      onPointerDown={suppressToolbarEvent}
      role="menuitem"
      type="button"
    >
      <Icon size={15} strokeWidth={2.2} />
      <span>{text}</span>
    </button>
  );
}

function resolveClassName(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ");
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
