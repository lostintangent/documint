// Horizontal (between sections of a vertical leaf) or vertical (between
// groups in a horizontal toolbar) divider line. `.leaf-divider` in
// `overlays/styles.css` styles it by `data-orientation`, and cross-element
// selector hooks target the same class (e.g. comment-create animations,
// `.presence-divider` opacity reveal).

import { clx } from "./lib/clx";

type LeafDividerProps = {
  className?: string;
  orientation?: "horizontal" | "vertical";
};

export function LeafDivider({ className, orientation = "horizontal" }: LeafDividerProps) {
  return (
    <div
      aria-hidden="true"
      className={clx("leaf-divider", className)}
      data-orientation={orientation}
    />
  );
}
