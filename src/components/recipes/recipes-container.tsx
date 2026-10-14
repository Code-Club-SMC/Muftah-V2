import { useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";
import { getProductsFn } from "@/server-functions/inventory/get-products-fn";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field, FieldLabel } from "../ui/field";
import { NativeSelect } from "../ui/native-select";
import { Alert, AlertDescription } from "../ui/alert";
import { RecipeCard } from "./recipe-card";
import { CreateRecipeForm } from "./create-recipe-from";
import { ProductsTable } from "./products-table";

const route = getRouteApi("/_protected/manufacturing/recipes/");
function ProductManagement() {
  const { data } = useSuspenseQuery({
    queryKey: ["products"],
    queryFn: getProductsFn,
  });
  return <ProductsTable products={data} />;
}

export const RecipesContainer = () => {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const { data: recipes } = useSuspenseQuery({
    queryKey: ["recipes"],
    queryFn: getRecipesFn,
  });
  const { data: viewer } = useViewerAccess();
  const canManage =
    !!viewer && hasPermission(viewer.permissions, "manufacturing.manage");
  const canManageProducts =
    !!viewer &&
    hasPermission(viewer.permissions, "inventory.manage") &&
    hasPermission(viewer.permissions, "inventory.view");
  const [creating, setCreating] = useState(false);
  const [managingProducts, setManagingProducts] = useState(false);
  const [query, setQuery] = useState("");
  const [productId, setProductId] = useState("");
  const editing = search.edit
    ? recipes.find((row) => row.id === search.edit)
    : undefined;
  const closeEditor = (open: boolean) => {
    if (!open) {
      setCreating(false);
      void navigate({
        to: ".",
        search: (previous) => ({ ...previous, edit: undefined }),
      });
    }
  };
  if (canManage && (creating || editing))
    return (
      <CreateRecipeForm
        key={editing?.id ?? "new"}
        onOpenChange={closeEditor}
        initialRecipe={editing}
      />
    );
  if (canManageProducts && managingProducts)
    return (
      <div className="flex flex-col gap-5">
        <Button
          variant="outline"
          className="self-start"
          onClick={() => setManagingProducts(false)}
        >
          Back to packaging formats
        </Button>
        <ProductManagement />
      </div>
    );
  const products = [
    ...new Map(recipes.map((row) => [row.productId, row.product])).values(),
  ];
  const needle = query.trim().toLowerCase();
  const filtered = recipes.filter(
    (row) =>
      (!productId || row.productId === productId) &&
      `${row.name} ${row.product.name} ${Number(row.fillAmount)} ${row.fillUnit ?? ""}`
        .toLowerCase()
        .includes(needle),
  );
  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertDescription>
          Set up the packs your factory uses here. To record finished packing,
          open a completed batch.
        </AlertDescription>
      </Alert>
      {search.edit && !editing && (
        <Alert>
          <AlertDescription>
            This format is no longer in the active list.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <Field className="min-w-0 flex-1 basis-56">
          <FieldLabel htmlFor="format-search">Find a pack</FieldLabel>
          <Input
            id="format-search"
            className="h-12"
            placeholder="Search name, product or pack size"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field className="w-full sm:w-52">
          <FieldLabel htmlFor="product-filter">Product</FieldLabel>
          <NativeSelect
            id="product-filter"
            className="w-full [&_select]:h-12"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">All products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {canManage && (
          <Button className="h-12" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            New packaging format
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">
          {filtered.length} {filtered.length === 1 ? "format" : "formats"}
        </p>
        {canManageProducts && (
          <Button variant="ghost" onClick={() => setManagingProducts(true)}>
            Manage products
          </Button>
        )}
      </div>
      {filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              canManage={canManage}
              onEdit={() => {
                void navigate({
                  to: ".",
                  search: (previous) => ({ ...previous, edit: recipe.id }),
                });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6 sm:p-10">
          <h2 className="text-lg font-semibold">
            {recipes.length
              ? "No matching formats"
              : "No packaging formats yet"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {recipes.length
              ? "Try another name or clear the filters."
              : canManage
                ? "Create a format with the pack size and materials used on your factory floor."
                : "Ask your manager to set up the product’s packaging formats."}
          </p>
          {recipes.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setProductId("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
