// Shared compact toolbar for leaf chrome. Houses icon buttons, vertical
// dividers, and dropdown menus with optional separators. Stays in one
// file because the compound API and its internal views are small, tightly
// coupled, and easier to read together than split apart.
//
// Callers write declarative JSX:
//
//   <LeafToolbar>
//     <LeafToolbar.Button icon={Foo} label="..." onClick={...} />
//     <LeafToolbar.Divider />
//     <LeafToolbar.Menu icon={Bar} label="..." onSelect={...}>
//       <LeafToolbar.MenuItem icon={Baz} text="..." value="..." />
//       <LeafToolbar.MenuDivider />
//       <LeafToolbar.MenuItem icon={Qux} text="..." value="..." />
//     </LeafToolbar.Menu>
//   </LeafToolbar>
//
// The `LeafToolbar.*` sub-components are zero-render markers. The root
// inspects each child's `type` reference, identifies which marker it
// matches, and routes to the matching internal View component.

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
import { getVisualViewportMetrics, resolveHorizontalOffset } from "../../../anchors/placement";
import { LeafButton } from "../LeafButton";
import { clx } from "../lib/clx";

/* === Public compound API === */

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

function LeafToolbarRoot({ children }: LeafToolbarProps) {
  return (
    <div className="py-1.5 px-2.5 flex items-center gap-2">
      {Children.map(children, renderToolbarChild)}
    </div>
  );
}

// Compound-API marker stubs. They render nothing on their own —
// `renderToolbarChild` / `renderToolbarMenuChild` identify them by
// reference and route to the matching internal View.
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

/* === Internal views === */

function renderToolbarChild(child: ReactNode) {
  if (!isValidElement(child)) return null;

  if (child.type === LeafToolbarButton) {
    return <LeafToolbarIconButton {...(child.props as LeafToolbarButtonProps)} />;
  }
  if (child.type === LeafToolbarDivider) {
    return <LeafDivider orientation="vertical" />;
  }
  if (child.type === LeafToolbarMenu) {
    return <LeafToolbarMenuView {...(child.props as LeafToolbarMenuProps)} />;
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

  // Horizontal placement. The popover renders twice on open: first
  // `position: fixed; visibility: hidden` so we can read its rendered
  // width (see `resolveMenuPlacementStyle(null)`), then re-rendered at
  // the computed `left` offset. `useLayoutEffect` runs the measurement
  // before paint so the user never sees the off-screen first pass.
  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuHorizontalOffset(null);
      return;
    }

    const updateMenuHorizontalOffset = () => {
      const menuShell = menuShellRef.current;
      const menu = menuRef.current;
      if (!menuShell || !menu) return;
      setMenuHorizontalOffset(resolveMenuHorizontalOffset(menuShell, menu));
    };

    const menu = menuRef.current;
    if (!menu) return;

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

  // Outside-click dismissal. `composedPath()` walks across shadow-DOM
  // boundaries so portaled overlays don't fool the "is this in the menu?"
  // check; `capture: true` runs before any descendant handler.
  useEffect(() => {
    if (!isOpen) return;

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
      {isOpen && (
        <div
          className={MENU_SURFACE_CLASS}
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
      )}
    </div>
  );
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
      // Show active state whenever the menu is open OR the action it
      // represents is currently active (e.g. a formatting mark applied).
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
          isOpen && "rotate-180",
        )}
        size={13}
        strokeWidth={2.2}
      />
    </LeafButton>
  );
}

function renderToolbarMenuChild(child: ReactNode, onSelect: (value: string) => void) {
  if (!isValidElement(child)) return null;

  if (child.type === LeafToolbarMenuDivider) return <LeafDivider />;
  if (child.type !== LeafToolbarMenuItem) return null;

  const { active = false, disabled = false, icon: Icon, text, value } =
    child.props as LeafToolbarMenuItemProps;

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

/* === Utilities === */

// Menu surface styling. Offset from the toolbar button by 0.625rem
// (matches `top-2.5`) via `calc(100%+...)` so the menu floats just
// below the trigger across button heights.
const MENU_SURFACE_CLASS =
  "absolute top-[calc(100%+0.625rem)] left-0 grid gap-1 w-max min-w-max p-1.5 border border-leaf-border rounded-xl bg-leaf-bg [box-shadow:var(--documint-leaf-shadow,var(--leaf-shadow-fallback))] text-leaf-text font-leaf text-sm";

// Suppresses the browser's default click handling so the toolbar's own
// pointerdown logic owns the interaction (avoids stealing focus from
// the editor surface, double-firing, etc.).
const suppressToolbarEvent = (event: {
  preventDefault: () => void;
  stopPropagation: () => void;
}) => {
  event.preventDefault();
  event.stopPropagation();
};

// Filters out secondary mouse buttons and multi-touch pointers so the
// toolbar reacts only to the primary tap/click.
const isPrimaryPointer = (event: ReactPointerEvent<HTMLButtonElement>) =>
  event.isPrimary && event.button === 0;

function resolveMenuHorizontalOffset(menuShell: HTMLElement, menu: HTMLElement): number {
  const viewport = getVisualViewportMetrics();

  return resolveHorizontalOffset({
    anchorViewportLeft: menuShell.getBoundingClientRect().left - viewport.offsetLeft,
    floatingWidth: menu.getBoundingClientRect().width,
  });
}

// During the first measurement pass `menuHorizontalOffset` is null;
// position the menu off-screen-but-rendered so its width is readable
// without flashing.
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
