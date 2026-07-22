import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getEntityRecipeRatesFn,
  getEntityRecipeRatesForEntityFn,
  getRecipeRatesForEntityFn,
  upsertEntityRecipeRateFn,
  deleteEntityRecipeRateFn,
} from "@/server-functions/sales/entity-recipe-rates-fn";
import type { EntityRecipeRateEntityType } from "@/lib/sales/entity-recipe-rate-config";

export const entityRecipeRateKeys = {
  all: ["entity-recipe-rates"] as const,
  list: (filters?: { entityType?: EntityRecipeRateEntityType; entityId?: string }) =>
    [...entityRecipeRateKeys.all, "list", filters] as const,
  forEntity: (entityType: EntityRecipeRateEntityType, entityId: string) =>
    [...entityRecipeRateKeys.all, "forEntity", entityType, entityId] as const,
  ratesForEntity: (entityType: EntityRecipeRateEntityType, entityId: string) =>
    [...entityRecipeRateKeys.all, "rates", entityType, entityId] as const,
};

export function useGetEntityRecipeRates(filters?: {
  entityType?: EntityRecipeRateEntityType;
  entityId?: string;
}) {
  return useQuery({
    queryKey: entityRecipeRateKeys.list(filters),
    queryFn: () => getEntityRecipeRatesFn({ data: filters || {} }),
  });
}

export function useGetEntityRecipeRatesForEntity(
  entityType: EntityRecipeRateEntityType,
  entityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: entityRecipeRateKeys.forEntity(entityType, entityId),
    queryFn: () => getEntityRecipeRatesForEntityFn({ data: { entityType, entityId } }),
    enabled: enabled && !!entityId,
  });
}

export function useGetRecipeRatesForEntity(
  entityType: EntityRecipeRateEntityType,
  entityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: entityRecipeRateKeys.ratesForEntity(entityType, entityId),
    queryFn: () => getRecipeRatesForEntityFn({ data: { entityType, entityId } }),
    enabled: enabled && !!entityId,
  });
}

export function useUpsertEntityRecipeRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertEntityRecipeRateFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entityRecipeRateKeys.all });
    },
  });
}

export function useDeleteEntityRecipeRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteEntityRecipeRateFn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: entityRecipeRateKeys.all });
    },
  });
}
