import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  page: number;
  pageCount: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  className?: string;
}

const PAGE_SIBLINGS = 2;

export const CustomerPagination = ({
  page,
  pageCount,
  total,
  limit,
  onPageChange,
  onLimitChange,
  className,
}: Props) => {
  const pageSizeOptions = [10, 25, 50, 100];

  const getVisiblePages = () => {
    const pages: (number | "ellipsis")[] = [];
    const startPage = Math.max(2, page - PAGE_SIBLINGS);
    const endPage = Math.min(pageCount - 1, page + PAGE_SIBLINGS);

    pages.push(1);

    if (startPage > 2) pages.push("ellipsis");

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    if (endPage < pageCount - 1) pages.push("ellipsis");

    if (pageCount > 1) pages.push(pageCount);

    return pages;
  };

  if (pageCount <= 1) return null;

  return (
    <div className={cn("flex items-center justify-between px-1 py-2", className)}>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          Showing <span className="font-medium text-foreground">{(page - 1) * limit + 1}</span>–<span className="font-medium text-foreground">{Math.min(page * limit, total)}</span> of <span className="font-medium text-foreground">{total}</span>
        </span>
        {onLimitChange && (
          <Select
            value={limit.toString()}
            onValueChange={(v) => onLimitChange(Number(v))}
          >
            <SelectTrigger className="h-7 w-[80px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => onPageChange(Math.max(1, page - 1))}
              className={cn("cursor-pointer", page <= 1 && "pointer-events-none opacity-50")}
              text=""
            />
          </PaginationItem>

          {getVisiblePages().map((p, i) =>
            p === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  onClick={() => onPageChange(p as number)}
                  isActive={p === page}
                  className="cursor-pointer text-sm"
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}

          <PaginationItem>
            <PaginationNext
              onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              className={cn("cursor-pointer", page >= pageCount && "pointer-events-none opacity-50")}
              text=""
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
};
