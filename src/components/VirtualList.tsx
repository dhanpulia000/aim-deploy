import type { ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";

export type VirtualListProps<T> = {
  items: T[];
  itemContent: (index: number, item: T) => ReactNode;
  onEndReached?: () => void;
  height?: number | string;
  overscan?: number;
  className?: string;
};

export default function VirtualList<T>({
  items,
  itemContent,
  onEndReached,
  height = "70vh",
  overscan = 200,
  className
}: VirtualListProps<T>) {
  return (
    <div className={className} style={{ height }}>
      <Virtuoso
        data={items}
        overscan={overscan}
        endReached={onEndReached}
        itemContent={(index, item) => itemContent(index, item as T)}
      />
    </div>
  );
}

