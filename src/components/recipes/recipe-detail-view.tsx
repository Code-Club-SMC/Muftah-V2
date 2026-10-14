import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import type { getRecipeFn } from "@/server-functions/inventory/recipes/get-single-recipe-fn";
import { normalizePackagingUsageBasis } from "@/lib/recipe-packaging";

type Recipe = Awaited<ReturnType<typeof getRecipeFn>>;
export const RecipeDetailView = ({ recipe }: { recipe: Recipe }) => {
  const navigate = useNavigate();
  const { data: viewer } = useViewerAccess();
  const canManage =
    !!viewer && hasPermission(viewer.permissions, "manufacturing.manage");
  const hasCartons =
    !!recipe.cartonPackagingId && (recipe.containersPerCarton ?? 0) > 0;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Button
        variant="outline"
        className="self-start"
        onClick={() => navigate({ to: "/manufacturing/recipes" })}
      >
        Back to formats
      </Button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{recipe.product.name}</p>
          <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight">
            {recipe.name}
          </h1>
        </div>
        {canManage && recipe.isActive && (
          <Button
            onClick={() =>
              navigate({
                to: "/manufacturing/recipes",
                search: { edit: recipe.id },
              })
            }
          >
            Edit format
          </Button>
        )}
      </header>
      {!recipe.isActive && (
        <Alert>
          <AlertDescription>
            This format is archived. Existing stock and records are kept.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Pack details</CardTitle>
          <CardDescription>
            Use these saved settings when recording the batch’s actual packing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">
                Content in one pack
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {recipe.fillAmount && recipe.fillUnit
                  ? `${Number(recipe.fillAmount)} ${recipe.fillUnit}`
                  : "Not configured"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Carton setup</dt>
              <dd className="mt-1 text-2xl font-semibold">
                {hasCartons
                  ? `${recipe.containersPerCarton} packs / carton`
                  : "Loose packs only"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Mixing formula</dt>
              <dd className="mt-1 font-medium">
                {recipe.formula?.name || "Not linked"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Low stock alert</dt>
              <dd className="mt-1 font-medium">
                {recipe.minimumStockLevel
                  ? `${recipe.minimumStockLevel} packs`
                  : "No minimum target"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Materials used</CardTitle>
          <CardDescription>
            These materials are deducted when actual packing is confirmed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span>
              {recipe.containerPackaging?.name ||
                "Pack material not configured"}
            </span>
            <strong>1 per pack</strong>
          </div>
          {hasCartons && (
            <div className="flex flex-wrap justify-between gap-2">
              <span>{recipe.cartonPackaging?.name}</span>
              <strong>1 per physical carton</strong>
            </div>
          )}
          {recipe.packaging.map((row) => (
            <div key={row.id} className="flex flex-wrap justify-between gap-2">
              <span>{row.packagingMaterial.name}</span>
              <strong>
                {Number(row.quantityPerContainer)}{" "}
                {normalizePackagingUsageBasis(row.usageBasis) === "per_carton"
                  ? "per carton"
                  : "per pack"}
              </strong>
            </div>
          ))}
        </CardContent>
      </Card>
      <Alert>
        <AlertDescription>
          {hasCartons
            ? "When recording a batch, enter full cartons, any partial carton, and sealed packs left outside cartons."
            : "Loose packs are sealed retail packs without cartons. Unpacked powder stays in the batch."}{" "}
          Record packing from the completed batch.
        </AlertDescription>
      </Alert>
      <details className="rounded-xl border p-5">
        <summary className="cursor-pointer font-medium">
          Reference cost estimate
        </summary>
        <p className="mt-4 text-sm">
          PKR{" "}
          {Number(recipe.estimatedCostPerContainer ?? 0).toLocaleString(
            "en-PK",
            { minimumFractionDigits: 2, maximumFractionDigits: 4 },
          )}{" "}
          per pack
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Based on the saved formula and packaging estimate. Actual costs come
          from production and the packing recorded on the batch.
        </p>
      </details>
    </div>
  );
};
