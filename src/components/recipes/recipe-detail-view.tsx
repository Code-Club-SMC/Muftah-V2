import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Beaker,
  Box,
  Package,
  Info,
  ChevronLeft,
  Play,
  TrendingUp,
  Droplet,
  Calculator,
  LayoutDashboard,
  ClipboardList,
  Edit,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { InitiateProductionSheet } from "../productions/initiate-production-sheet";
import { format } from "date-fns";
import { getPlannedPackagingQuantity, normalizePackagingUsageBasis } from "@/lib/recipe-packaging";

type Recipe = {
  id: string;
  name: string;
  productId: string;
  product: { name: string };
  batchSize: string;
  batchUnit: string;
  targetUnitsPerBatch: number;
  containerType: string;
  containerPackagingId: string;
  containerPackaging: { name: string; costPerUnit: string | null };
  fillAmount: string | null;
  fillUnit: string | null;
  containersPerCarton: number | null;
  cartonPackagingId: string | null;
  cartonPackaging: { name: string; costPerUnit: string | null } | null;
  estimatedCostPerBatch: string | null;
  estimatedCostPerContainer: string | null;
  estimatedIngredientsCost: string | null;
  estimatedPackagingCost: string | null;
  createdAt: Date | string;
  ingredients: Array<{
    chemicalId: string;
    quantityPerBatch: string;
    chemical: { name: string; unit: string; costPerUnit: string | null };
  }>;
  packaging: Array<{
    packagingMaterialId: string;
    quantityPerContainer: string;
    usageBasis?: string | null;
    packagingMaterial: { name: string; costPerUnit: string | null };
  }>;
};

type Props = {
  recipe: Recipe;
};

export const RecipeDetailView = ({ recipe }: Props) => {
  const navigate = useNavigate();
  const [initiateOpen, setInitiateOpen] = useState(false);

  const formatCurrency = (amount: string | number | null) => {
    if (amount === null) return "0.00";
    return Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="space-y-8 pb-10">
      {/* Header / Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/manufacturing/recipes" })}
            className="rounded-full"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">
                {recipe.name}
              </h1>
            </div>
            <p className="text-muted-foreground flex items-center gap-2 mt-1">
              <LayoutDashboard className="size-4" />
              {recipe.product.name}
              <span className="mx-1 opacity-30">•</span>
              <span className="text-xs italic">
                Created {format(new Date(recipe.createdAt), "PPP")}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              navigate({
                to: "/manufacturing/recipes",
                search: { edit: recipe.id } as any,
              })
            }
          >
            <Edit className="size-4 mr-2" />
            Edit Recipe
          </Button>
          <Button onClick={() => setInitiateOpen(true)}>
            <Play className="size-4 mr-2 fill-current" />
            Initiate Batch
          </Button>
        </div>
      </div>

      {/* Top Costing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-green-500 bg-green-50/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1 font-semibold uppercase tracking-wider">
              <TrendingUp className="size-3 text-green-600" />
              Cost per Unit
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-green-700">
              Rs. {formatCurrency(recipe.estimatedCostPerContainer)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-l-4 border-l-blue-500 bg-blue-50/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1 font-semibold uppercase tracking-wider">
              <Calculator className="size-3 text-blue-600" />
              Batch Cost
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-700">
              Rs. {formatCurrency(recipe.estimatedCostPerBatch)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-l-4 border-l-purple-500 bg-purple-50/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1 font-semibold uppercase tracking-wider">
              <Package className="size-3 text-purple-600" />
              Target Yield
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-700">
              {recipe.targetUnitsPerBatch} Units
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-l-4 border-l-amber-500 bg-amber-50/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs flex items-center gap-1 font-semibold uppercase tracking-wider">
              <Droplet className="size-3 text-amber-600" />
              Batch Size
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-700">
              {recipe.batchSize} {recipe.batchUnit}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-8">
          {/* Chemical Formulation */}
          <Card className="overflow-hidden border-none  ring-1 ring-border/50">
            <CardHeader className="bg-muted/30 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
                    <Beaker className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">
                      Chemical Formulation
                    </CardTitle>
                    <CardDescription>
                      BOM for {recipe.batchSize}
                      {recipe.batchUnit} batch
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="bg-background">
                  {recipe.ingredients.length} items
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recipe.ingredients.map((ing, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="size-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground border">
                        {(i + 1).toString().padStart(2, "0")}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          {ing.chemical.name}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          Cost: Rs. {formatCurrency(ing.chemical.costPerUnit)} /{" "}
                          {ing.chemical.unit}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-indigo-600">
                        {ing.quantityPerBatch} {ing.chemical.unit}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-tight mt-0.5">
                        Rs.{" "}
                        {formatCurrency(
                          Number(ing.quantityPerBatch) *
                          Number(ing.chemical.costPerUnit || 0),
                        )}{" "}
                        Total
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-muted/20 flex justify-between items-center font-bold text-sm">
                <p className="text-muted-foreground uppercase  text-[10px]">
                  Ingredients Subtotal
                </p>
                <p className="text-lg">
                  Rs. {formatCurrency(recipe.estimatedIngredientsCost)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Packaging Details */}
          <Card className="overflow-hidden border-none  ring-1 ring-border/50">
            <CardHeader className="bg-muted/30 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
                    <Box className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">
                      Packaging & Materials
                    </CardTitle>
                    <CardDescription>
                      Container and distribution components
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {/* Primary Container */}
                <div className="flex items-center justify-between p-4 bg-background">
                  <div className="flex items-center gap-4">
                    <div className="size-8 rounded-lg bg-amber-50 flex items-center justify-center border border-amber-200">
                      <Droplet className="size-4 text-amber-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">
                          {recipe.containerPackaging.name}
                        </p>
                        <Badge
                          variant="outline"
                          className="text-[9px] uppercase font-bold py-0 h-4 border-amber-200 text-amber-700 bg-amber-50"
                        >
                          Primary
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {recipe.fillAmount}
                        {recipe.fillUnit} Fill Amount
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">
                      {recipe.targetUnitsPerBatch} Units
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-tight mt-0.5">
                      Rs.{" "}
                      {formatCurrency(recipe.containerPackaging.costPerUnit)} /
                      unit
                    </p>
                  </div>
                </div>

                {/* Master Carton */}
                {recipe.cartonPackaging && (
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className="size-8 rounded-lg bg-orange-50 flex items-center justify-center border border-orange-200">
                        <Box className="size-4 text-orange-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">
                            {recipe.cartonPackaging.name}
                          </p>
                          <Badge
                            variant="outline"
                            className="text-[9px] uppercase font-bold py-0 h-4 border-orange-200 text-orange-700 bg-orange-50"
                          >
                            Master
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {recipe.containersPerCarton} units per bucket
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">
                        {recipe.containersPerCarton
                          ? Math.ceil(
                            recipe.targetUnitsPerBatch /
                            recipe.containersPerCarton,
                          )
                          : 0}{" "}
                        Buckets
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-tight mt-0.5">
                        Rs. {formatCurrency(recipe.cartonPackaging.costPerUnit)}{" "}
                        / bucket
                      </p>
                    </div>
                  </div>
                )}

                {/* Additional Packaging */}
                {recipe.packaging.map((pkg, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="size-8 rounded-lg bg-slate-50 flex items-center justify-center border border-slate-200">
                        <Package className="size-4 text-slate-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">
                            {pkg.packagingMaterial.name}
                          </p>
                          <Badge
                            variant="outline"
                            className="text-[9px] uppercase font-bold py-0 h-4"
                          >
                            Sticker
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {pkg.quantityPerContainer} {normalizePackagingUsageBasis(pkg.usageBasis) === "per_carton" ? "per carton" : "per unit"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">
                        {getPlannedPackagingQuantity({
                          quantityPerContainer: pkg.quantityPerContainer,
                          usageBasis: pkg.usageBasis,
                          targetUnits: recipe.targetUnitsPerBatch,
                          containersPerCarton: recipe.containersPerCarton,
                        }).toLocaleString()}{" "}
                        units
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-tight mt-0.5">
                        Rs. {formatCurrency(pkg.packagingMaterial.costPerUnit)}{" "}
                        / unit
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-4 bg-muted/20 flex justify-between items-center font-bold text-sm">
                <p className="text-muted-foreground uppercase  text-[10px]">
                  Packaging Subtotal
                </p>
                <p className="text-lg">
                  Rs. {formatCurrency(recipe.estimatedPackagingCost)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* Fast Info Card */}
          <Card className="border-none  ring-1 ring-border/50 overflow-hidden">
            <CardHeader className="bg-primary/5 pb-4 border-b border-primary/10">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="size-4 text-primary" />
                Batch Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground  flex items-center gap-1.5">
                  <Droplet className="size-3" /> Target Fill
                </p>
                <p className="text-sm font-semibold capitalize bg-muted/40 p-2 rounded-md border border-border/50">
                  {recipe.fillAmount} {recipe.fillUnit}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-foreground  flex items-center gap-1.5">
                  <Package className="size-3" /> Distribution
                </p>
                <p className="text-sm font-semibold capitalize bg-muted/40 p-2 rounded-md border border-border/50">
                  {recipe.containersPerCarton
                    ? `${recipe.containersPerCarton} Per Bucket`
                    : "Loose Units Only"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Quality/Notes Section */}
          <Card className="border-none  ring-1 ring-border/50 ">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                <Info className="size-4" />
                Technical Note
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-primary/80 leading-relaxed italic">
              This recipe configuration defines the Bill of Materials for a
              single production batch. Estimated costs are based on current
              inventory pricing.
            </CardContent>
          </Card>
        </div>
      </div>

      <InitiateProductionSheet
        open={initiateOpen}
        onOpenChange={setInitiateOpen}
        recipe={recipe as any}
      />
    </div>
  );
};
