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
