import { useSuspenseQuery } from "@tanstack/react-query";
import { getFormulasFn } from "@/server-functions/manufacturing/formulas/get-formulas-fn";
import { FormulasTable } from "./formulas-table";
import { CreateFormulaDialog } from "./create-formula-dialog";
import { useState } from "react";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { ProductionListFilters } from "@/components/production/production-list-filters";
import { ProductionListKpis } from "@/components/production/production-list-kpis";
import type { ProductionListFilters as Filters } from "@/lib/production/list-filters";

export const FormulasContainer = ({
  initialSearch = "",
}: {
  initialSearch?: string;
}) => {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState<Filters<"active" | "inactive">>({});
  const { data: viewerAccess } = useViewerAccess();
  const canManage =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.manage");
  const { data } = useSuspenseQuery({
    queryKey: ["formulas", { ...pagination, search, ...filters }],
    queryFn: () =>
      getFormulasFn({
        data: {
          ...pagination,
          search,
          from: filters.from,
          to: filters.to,
          statusFilter: filters.status,
        },
      }),
  });

  const formulasList = data?.formulas || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        {canManage && <CreateFormulaDialog />}
      </div>
      <ProductionListFilters
        value={filters}
        onChange={(value) => {
          setFilters(value);
          setPagination((current) => ({ ...current, pageIndex: 0 }));
        }}
        statuses={[
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ]}
      />
      <ProductionListKpis
        items={[
          {
            label: "Mixing formulas",
            value: data.kpis.total,
            description: "All matching formulas",
          },
          {
            label: "Active formulas",
            value: data.kpis.active,
            description: "Available for mixing",
          },
          {
            label: "Inactive formulas",
            value: data.kpis.inactive,
            description: "Disabled formulas",
          },
          {
            label: "Products",
            value: data.kpis.products,
            description: "Distinct products in matching formulas",
          },
        ]}
      />
      <FormulasTable
        data={formulasList}
        pagination={pagination}
        onPaginationChange={setPagination}
        totalCount={data.totalCount}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPagination((current) => ({ ...current, pageIndex: 0 }));
        }}
      />
    </div>
  );
};
