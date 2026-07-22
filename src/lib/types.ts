import type { LinkProps, RegisteredRouter } from "@tanstack/react-router";

export type AllRoutes = LinkProps<RegisteredRouter>["to"];

export interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  latitude: string;
  longitude: string;
  type: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
