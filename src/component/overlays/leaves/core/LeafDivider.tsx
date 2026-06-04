// Horizontal (between sections of a vertical leaf) or vertical (between
// groups in a horizontal toolbar) divider line. Keeps the
// `leaf-divider` class name and `data-orientation` attribute because
// cross-element selector hooks in `overlays/styles.css` target them (e.g.
// comment-create animations, `.presence-divider` opacity reveal).

import { clx } from "./lib/clx";

type LeafDividerProps = {
  className?: string;
  orientation?: "horizontal" | "vertical";
};

export function LeafDivider({ className, orientation = "horizontal" }: LeafDividerProps) {
  const baseClassName =
    orientation === "horizontal"
      ? "leaf-divider flex-none bg-leaf-divider w-full h-px my-1"
      : "leaf-divider flex-none bg-leaf-divider justify-self-center w-px h-5";

  return (
    <div
      aria-hidden="true"
      className={clx(baseClassName, className)}
      data-orientation={orientation}
    />
  );
}
