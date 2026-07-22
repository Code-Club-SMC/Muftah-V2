;

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { SlidersHorizontal, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  searchKey?: string;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  showSearch?: boolean;
  showViewOptions?: boolean;
  showPagination?: boolean;
  pageSize?: number;
  actions?: React.ReactNode;
  className?: string;
  emptyState?: React.ReactNode;
  loadingStateComponent?: React.ReactNode;
  showFooter?: boolean;
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  autoResetPageIndex?: boolean;
  totalRecords?: number;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Filter...",
  searchValue,
  isLoading = false,
  onSearchChange,
  showSearch = true,
  showViewOptions = true,
  showPagination = true,
  pageSize = 7,
  actions,
  className,
  emptyState,
  loadingStateComponent,
  showFooter = false,
  manualPagination = false,
  pageCount = -1,
  pagination,
  onPaginationChange,
  autoResetPageIndex = true,
  totalRecords,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    manualPagination,
    ...(pageCount !== -1 ? { pageCount } : {}),
    ...(onPaginationChange ? { onPaginationChange } : {}),
    autoResetPageIndex,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      ...(pagination !== undefined ? { pagination } : {}),
    },
    initialState: {
      ...(pagination === undefined ? { pagination: { pageSize } } : {}),
    },
  });

  const currentPage = table.getState().pagination.pageIndex;
  const totalPages = table.getPageCount();
  const showToolbar = showSearch || showViewOptions;

  return (
    <div
      className={cn(
        "w-full border border-border/60 bg-card rounded-xl overflow-hidden",
        className,
      )}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {showToolbar && (
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          {showSearch && (searchKey || onSearchChange) && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={
                  searchValue ??
                  (searchKey
                    ? (table.getColumn(searchKey)?.getFilterValue() as string)
                    : "") ??
                  ""
                }
                onChange={(event) => {
                  if (onSearchChange) {
                    onSearchChange(event.target.value);
                  } else if (searchKey) {
                    table
                      .getColumn(searchKey)
                      ?.setFilterValue(event.target.value);
                  }
                  table.setPageIndex(0);
                }}
                className="w-[250px] h-8 pl-8 bg-background border-border/60 rounded-md focus-visible:ring-2 focus-visible:ring-primary/20 text-[13px] shadow-none"
              />
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {actions}
            {showViewOptions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-border/60 rounded-md text-[13px] font-medium text-foreground hover:bg-muted/50 transition-colors gap-2"
                  >
                    <SlidersHorizontal className="size-3.5 text-muted-foreground" />
                    View
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-[180px] rounded-lg  border-border/60"
                >
                  {table
                    .getAllColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize rounded-md m-1 font-medium text-[13px] py-1.5"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {column.id}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="hover:bg-transparent border-b border-border/50"
              >
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="text-[12px] font-medium text-muted-foreground py-3 h-auto first:pl-5 last:pr-5 whitespace-nowrap"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-muted/30 border-b border-border/30 transition-colors last:border-0 data-[state=selected]:bg-muted"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="py-2.5 first:pl-5 last:pr-5"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center p-0"
                >
                  {/* {emptyState ?? (
                    <div className="flex flex-col items-center justify-center gap-1 py-10">
                      <p className="text-[13px] font-medium text-muted-foreground">No data available.</p>
                    </div>
                  )} */}
                  {isLoading ? loadingStateComponent : emptyState}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {showFooter && (
            <tfoot className="bg-muted/20 border-t border-border/50">
              {table.getFooterGroups().map((footerGroup) => (
                <TableRow
                  key={footerGroup.id}
                  className="hover:bg-transparent border-0"
                >
                  {footerGroup.headers.map((header) => (
                    <TableCell
                      key={header.id}
                      className="py-3 h-auto first:pl-5 last:pr-5"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.footer,
                            header.getContext(),
                          )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </tfoot>
          )}
        </Table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      {showPagination && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border/50 bg-muted/10">
          <div className="text-[13px] text-muted-foreground">
            Page{" "}
            <span className="font-medium text-foreground">
              {currentPage + 1}
            </span>{" "}
            of{" "}
            <span className="font-medium text-foreground">
              {Math.max(1, totalPages)}
            </span>
            <span className="mx-2 opacity-50">•</span>
            <span className="font-medium text-foreground">
              {totalRecords ?? table.getFilteredRowModel().rows.length}
            </span>{" "}
            records
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="h-8 px-3 rounded-md border-border/60 text-[13px] font-medium hover:bg-muted/50 disabled:opacity-50 transition-all shadow-none"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="h-8 px-3 rounded-md border-border/60 text-[13px] font-medium hover:bg-muted/50 disabled:opacity-50 transition-all shadow-none"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
