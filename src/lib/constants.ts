// constants.ts
// Navigation structure for the sidebar.
// Icons are imported from @/lib/nav-icons — keep this file data-only.

import {
  AccountsIcon,
  ApprovalIcon,
  AttendanceIcon,
  CustomersIcon,
  DashboardIcon,
  EmployeesIcon,
  ExpensesIcon,
  FactoryFloorIcon,
  FinanceIcon,
  HRIcon,
  InventoryIcon,
  InvoiceIcon,
  LedgerIcon,
  ManufacturingIcon,
  OperatorIcon,
  PayrollIcon,
  ProductionRunIcon,
  RecipesIcon,
  ReportsIcon,
  SalesIcon,
  SettingsIcon,
  SuppliersIcon,
  UserMgmtIcon,
  WarehouseIcon,
  OrderBookerIcon,
} from "@/components/custom/nav-icons";

import type { IconProps } from "@/components/custom/nav-icons";

export type { IconProps };

export interface NavigationItem {
  title: string;
  url: string;
  icon?: React.ComponentType<IconProps>;
  items?: NavigationItem[];
  exact?: boolean;
}

export const navigations: NavigationItem[] = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: DashboardIcon,
    items: [
      {
        title: "Command Center",
        url: "/dashboard",
        icon: DashboardIcon,
        exact: true,
      },
      {
        title: "Activity Timeline",
        url: "/dashboard/activity-timeline",
        icon: ReportsIcon,
      },
    ],
  },
  {
    title: "Manufacturing",
    url: "/manufacturing",
    icon: ManufacturingIcon,
    items: [
      {
        title: "Production Run",
        url: "/manufacturing/productions",
        icon: ProductionRunIcon,
      },
      {
        title: "Recipes",
        url: "/manufacturing/recipes",
        icon: RecipesIcon,
      },
    ],
  },
  {
    title: "Inventory Management",
    url: "/inventory",
    icon: InventoryIcon,
    items: [
      {
        title: "Warehouses",
        url: "/inventory/warehouses",
        icon: WarehouseIcon,
      },
      {
        title: "Factory-Floor",
        url: "/inventory/factory-floor",
        icon: FactoryFloorIcon,
      },
    ],
  },
  {
    title: "Suppliers",
    url: "/suppliers",
    icon: SuppliersIcon,
  },
  {
    title: "Sales",
    url: "/sales/new-invoice",
    icon: SalesIcon,
    items: [
      {
        title: "New Invoice",
        url: "/sales/new-invoice",
        icon: InvoiceIcon,
        exact: true,
      },
      {
        title: "Offline Invoices",
        url: "/sales/offline",
        icon: InvoiceIcon,
      },
      {
        title: "Orders",
        url: "/sales/orders",
        icon: InvoiceIcon,
      },
      {
        title: "Customers",
        url: "/sales/customers",
        icon: CustomersIcon,
      },
      {
        title: "Sales People",
        url: "/sales/people",
        icon: UserMgmtIcon,
      },
      {
        title: "Overview",
        url: "/sales/overview",
        icon: DashboardIcon,
      },
      {
        title: "Configurations",
        url: "/sales/configurations",
        icon: SettingsIcon,
      },
      {
        title: "Reconciliation",
        url: "/sales/reconciliation",
        icon: LedgerIcon,
      },
      {
        title: "Outstanding Recovery",
        url: "/sales/recovery",
        icon: LedgerIcon,
      },
    ],
  },
  {
    title: "Finance",
    url: "/finance",
    icon: FinanceIcon,
    items: [
      {
        title: "Accounts",
        url: "/finance/accounts",
        icon: AccountsIcon,
        exact: true,
      },
      {
        title: "Expenses",
        url: "/finance/expenses",
        icon: ExpensesIcon,
      },
      {
        title: "Ledger",
        url: "/finance/ledger",
        icon: LedgerIcon,
      },
      {
        title: "Payment Verification",
        url: "/finance/payment-verification",
        icon: LedgerIcon,
      },
    ],
  },
  {
    title: "Reports",
    url: "/reports",
    icon: ReportsIcon,
  },
  {
    title: "HR & Payroll",
    url: "/hr",
    icon: HRIcon,
    items: [
      {
        title: "Employees",
        url: "/hr/employees",
        icon: EmployeesIcon,
      },
      {
        title: "Attendance",
        url: "/hr/attendance",
        icon: AttendanceIcon,
        items: [
          {
            title: "Daily Attendance",
            url: "/hr/attendance",
            icon: AttendanceIcon,
            exact: true,
          },
          {
            title: "Offline Excel",
            url: "/hr/attendance/offline",
            icon: AttendanceIcon,
          },
        ],
      },
      {
        title: "Approval Center",
        url: "/hr/approvals",
        icon: ApprovalIcon,
      },
      {
        title: "Payroll",
        url: "/hr/payroll",
        icon: PayrollIcon,
      },
      {
        title: "Settings",
        url: "/hr/settings",
        icon: SettingsIcon,
      },
    ],
  },
  {
    title: "Operator Interface",
    url: "/operator",
    icon: OperatorIcon,
  },
  {
    title: "Order Booker Portal",
    url: "/order-booker",
    icon: OrderBookerIcon,
    items: [
      {
        title: "Dashboard",
        url: "/order-booker",
        icon: DashboardIcon,
        exact: true,
      },
      {
        title: "My Orders",
        url: "/order-booker/orders",
        icon: InvoiceIcon,
      },
      {
        title: "My Trips",
        url: "/order-booker/trips",
        icon: FactoryFloorIcon,
      },
      {
        title: "My Commission",
        url: "/order-booker/commission",
        icon: LedgerIcon,
      },
      {
        title: "Recoveries",
        url: "/order-booker/recoveries",
        icon: LedgerIcon,
      },
    ],
  },
  {
    title: "User Management",
    url: "/user-management",
    icon: UserMgmtIcon,
  },
];
