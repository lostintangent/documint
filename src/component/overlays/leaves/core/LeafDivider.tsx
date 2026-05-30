type LeafDividerProps = {
  orientation?: "horizontal" | "vertical";
};

export function LeafDivider({ orientation = "horizontal" }: LeafDividerProps) {
  return (
    <div aria-hidden="true" className="documint-leaf-divider" data-orientation={orientation} />
  );
}
