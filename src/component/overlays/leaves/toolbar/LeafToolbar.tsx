// Shared compact leaf toolbar with icon buttons, dividers, and nested menus.
// This stays in one file because the compound API and its private views are
// small, tightly coupled, and easier to read together than split apart.
import { ChevronDown, type LucideIcon } from "lucide-react";
import {
  Children,
  isValidElement,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

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

type LeafToolbarDividerProps = {
  className?: string;
};

type LeafToolbarMenuProps = {
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  label: string;
  onSelect: (value: string) => void;
};

type LeafToolbarMenuItemProps = {
  disabled?: boolean;
  icon: LucideIcon;
  text: string;
  value: string;
};

type LeafToolbarMenuDividerProps = {
  className?: string;
};

const keepSelectionActive = (event: ReactPointerEvent<HTMLButtonElement>) => {
  event.preventDefault();
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

    return (
      <LeafToolbarGroup>
        <LeafToolbarIconButton {...props} />
      </LeafToolbarGroup>
    );
  }

  if (child.type === LeafToolbarDivider) {
    const { className } = child.props as LeafToolbarDividerProps;

    return <div className={resolveClassName("documint-leaf-toolbar-divider", className)} />;
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
  icon: Icon,
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
      onPointerDown={(event) => {
        keepSelectionActive(event);

        if (!disabled && isPrimaryPointer(event)) {
          onClick();
        }
      }}
      title={label}
      type="button"
    >
      <Icon size={15} strokeWidth={2.2} />
    </button>
  );
}

function LeafToolbarMenuView({ children, className, icon, label, onSelect }: LeafToolbarMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  return (
    <LeafToolbarGroup>
      <div className="documint-leaf-toolbar-menu-shell" ref={rootRef}>
        <LeafToolbarMenuButton
          className={className}
          icon={icon}
          isOpen={isOpen}
          label={label}
          onClick={() => setIsOpen((open) => !open)}
        />
        {isOpen ? (
          <div className="documint-leaf-menu" role="menu">
            {Children.map(children, (child) =>
              renderToolbarMenuChild(child, (value) => {
                setIsOpen(false);
                onSelect(value);
              }),
            )}
          </div>
        ) : null}
      </div>
    </LeafToolbarGroup>
  );
}

function LeafToolbarMenuButton({
  className,
  icon: Icon,
  isOpen,
  label,
  onClick,
}: {
  className?: string;
  icon: LucideIcon;
  isOpen: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      aria-haspopup="menu"
      aria-label={label}
      className={resolveClassName(
        "documint-leaf-toolbar-button",
        isOpen ? "active" : null,
        className,
      )}
      onPointerDown={(event) => {
        keepSelectionActive(event);

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
    const { className } = child.props as LeafToolbarMenuDividerProps;

    return (
      <div className={resolveClassName("documint-leaf-menu-divider", className)} role="separator" />
    );
  }

  if (child.type !== LeafToolbarMenuItem) {
    return null;
  }

  const { disabled = false, icon: Icon, text, value } = child.props as LeafToolbarMenuItemProps;

  return (
    <button
      className="documint-leaf-menu-item"
      disabled={disabled}
      onPointerDown={(event) => {
        keepSelectionActive(event);

        if (!disabled && isPrimaryPointer(event)) {
          onSelect(value);
        }
      }}
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

function LeafToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="documint-leaf-toolbar-group">{children}</div>;
}

function LeafToolbarButton(_props: LeafToolbarButtonProps) {
  return null;
}

function LeafToolbarDivider(_props: LeafToolbarDividerProps) {
  return null;
}

function LeafToolbarMenu(_props: LeafToolbarMenuProps) {
  return null;
}

function LeafToolbarMenuItem(_props: LeafToolbarMenuItemProps) {
  return null;
}

function LeafToolbarMenuDivider(_props: LeafToolbarMenuDividerProps) {
  return null;
}

type LeafToolbarComponent = typeof LeafToolbarRoot & {
  Button: typeof LeafToolbarButton;
  Divider: typeof LeafToolbarDivider;
  Menu: typeof LeafToolbarMenu;
  MenuDivider: typeof LeafToolbarMenuDivider;
  MenuItem: typeof LeafToolbarMenuItem;
};

export const LeafToolbar = Object.assign(LeafToolbarRoot, {
  Button: LeafToolbarButton,
  Divider: LeafToolbarDivider,
  Menu: LeafToolbarMenu,
  MenuDivider: LeafToolbarMenuDivider,
  MenuItem: LeafToolbarMenuItem,
}) satisfies LeafToolbarComponent;
