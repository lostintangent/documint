// Horizontal (between sections of a vertical leaf) or vertical (between
// groups in a horizontal toolbar) divider line. Keeps the
// `documint-leaf-divider` class name and `data-orientation` attribute
// because some non-migrated CSS still targets them — see
// `overlays/leaves/styles.css` for the fallback rules and animation hooks.

type LeafDividerProps = {
  orientation?: "horizontal" | "vertical";
};

export function LeafDivider({ orientation = "horizontal" }: LeafDividerProps) {
  const className =
    orientation === "horizontal"
      ? "documint-leaf-divider flex-none bg-leaf-divider w-full h-px my-1"
      : "documint-leaf-divider flex-none bg-leaf-divider justify-self-center w-px h-5";

  return <div aria-hidden="true" className={className} data-orientation={orientation} />;
}
