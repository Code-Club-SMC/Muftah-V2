import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";

import {
  archiveCategoryFieldOptionFn,
  createCategoryFieldFn,
  createCategoryFieldOptionFn,
  createExpenseCategoryFn,
  deleteExpenseCategoryFn,
  listAllExpenseCategoriesFn,
  listCategoryFieldsFn,
  updateCategoryFieldFn,
  updateCategoryFieldOptionFn,
  updateExpenseCategoryFn,
} from "@/server-functions/finance/expense-categories-fn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const fieldTypeOptions = [
  { label: "Text", value: "text" },
  { label: "Textarea", value: "textarea" },
  { label: "Number", value: "number" },
  { label: "Date", value: "date" },
  { label: "Select", value: "select" },
  { label: "Boolean", value: "boolean" },
] as const;

type FieldType = (typeof fieldTypeOptions)[number]["value"];
type SetupStep = 1 | 2 | 3;

const toFieldKey = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const fieldTypeDescriptions: Record<FieldType, string> = {
  text: "Short text input. Good for things like technician name or machine code.",
  textarea: "Long text input. Use for detailed notes.",
  number: "Numeric value. Good for units, hours, and costs.",
  date: "Date picker input. Good for service date or due date.",
  select: "Pick one option from a list. Best for controlled values.",
  boolean: "Yes or No value.",
};

export function ExpenseCategoriesManager() {
  const qc = useQueryClient();
  const [currentStep, setCurrentStep] = useState<SetupStep>(1);

  const [categoryName, setCategoryName] = useState("");
  const [categoryIcon, setCategoryIcon] = useState("");
  const [categorySortOrder, setCategorySortOrder] = useState("0");

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const [fieldKey, setFieldKey] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [fieldSortOrder, setFieldSortOrder] = useState("0");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldPlaceholder, setFieldPlaceholder] = useState("");

  const [optionValue, setOptionValue] = useState("");
  const [optionLabel, setOptionLabel] = useState("");
  const [optionSortOrder, setOptionSortOrder] = useState("0");
  const [selectedOptionFieldId, setSelectedOptionFieldId] = useState("");

  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ["expense-categories", "all"],
    queryFn: () => listAllExpenseCategoriesFn(),
  });

  const activeCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId),
    [categories, selectedCategoryId],
  );

  const { data: fields = [], isLoading: isLoadingFields } = useQuery({
    queryKey: ["expense-categories", "fields", selectedCategoryId],
    queryFn: () => listCategoryFieldsFn({ data: { categoryId: selectedCategoryId } }),
    enabled: !!selectedCategoryId,
  });

  const selectFields = useMemo(
    () => fields.filter((field) => field.fieldType === "select"),
    [fields],
  );

  const selectedOptionField = useMemo(
    () => fields.find((field) => field.id === selectedOptionFieldId),
    [fields, selectedOptionFieldId],
  );

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["expense-categories"] }),
      qc.invalidateQueries({ queryKey: ["expenses"] }),
    ]);
  };

  const createCategory = useMutation({
    mutationFn: createExpenseCategoryFn,
    onSuccess: async () => {
      await refreshAll();
      setCategoryName("");
      setCategoryIcon("");
      setCategorySortOrder("0");
      toast.success("Category created");
    },
    onError: (error) => toast.error(error.message || "Failed to create category"),
  });

  const updateCategory = useMutation({
    mutationFn: updateExpenseCategoryFn,
    onSuccess: refreshAll,
    onError: (error) => toast.error(error.message || "Failed to update category"),
  });

  const archiveCategory = useMutation({
    mutationFn: deleteExpenseCategoryFn,
    onSuccess: async () => {
      await refreshAll();
      toast.success("Category archived");
      if (activeCategory?.id === selectedCategoryId) {
        setSelectedCategoryId("");
      }
    },
    onError: (error) => toast.error(error.message || "Failed to archive category"),
  });

  const createField = useMutation({
    mutationFn: createCategoryFieldFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-categories", "fields", selectedCategoryId] });
      await refreshAll();
      setFieldKey("");
      setFieldLabel("");
      setFieldType("text");
      setFieldSortOrder("0");
      setFieldRequired(false);
      setFieldPlaceholder("");
      toast.success("Field created");
    },
    onError: (error) => toast.error(error.message || "Failed to create field"),
  });

  const updateField = useMutation({
    mutationFn: updateCategoryFieldFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-categories", "fields", selectedCategoryId] });
      await refreshAll();
    },
    onError: (error) => toast.error(error.message || "Failed to update field"),
  });

  const createOption = useMutation({
    mutationFn: createCategoryFieldOptionFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-categories", "fields", selectedCategoryId] });
      await refreshAll();
      setOptionValue("");
      setOptionLabel("");
      setOptionSortOrder("0");
      toast.success("Option created");
    },
    onError: (error) => toast.error(error.message || "Failed to create option"),
  });

  const archiveOption = useMutation({
    mutationFn: archiveCategoryFieldOptionFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-categories", "fields", selectedCategoryId] });
      await refreshAll();
      toast.success("Option archived");
    },
    onError: (error) => toast.error(error.message || "Failed to archive option"),
  });

  const updateOption = useMutation({
    mutationFn: updateCategoryFieldOptionFn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["expense-categories", "fields", selectedCategoryId] });
      await refreshAll();
    },
    onError: (error) => toast.error(error.message || "Failed to update option"),
  });

  const startTutorial = () => {
    const tour = driver({
      showProgress: true,
      allowClose: true,
      steps: [
        {
          popover: {
            title: "Expense Schema Setup",
            description:
              "This wizard helps you configure expenses in 3 simple steps: categories, fields, and select options.",
          },
        },
        {
          element: '[data-tour="wizard-steps"]',
          popover: {
            title: "Step Tracker",
            description: "Use these buttons to move between setup steps at any time.",
          },
        },
        {
          element: '[data-tour="active-panel"]',
          popover: {
            title: "Current Step",
            description:
              "This section changes based on the selected step and shows exactly what to configure next.",
          },
        },
        {
          element: '[data-tour="helper-box"]',
          popover: {
            title: "What This Means",
            description:
              "Each step includes plain-language guidance so non-technical users can configure safely.",
          },
        },
        {
          element: '[data-tour="wizard-nav"]',
          popover: {
            title: "Next / Back",
            description:
              "Use Next and Back to follow the setup flow. You can rerun this tutorial anytime with the tutorial button.",
          },
        },
        {
          element: '[data-tour="tutorial-btn"]',
          popover: {
            title: "Replay Tutorial Anytime",
            description: "Click this button anytime to restart the guided tour.",
          },
        },
      ],
    });

    tour.drive();
  };

  const canGoNext = currentStep === 1 ? Boolean(selectedCategoryId) : true;

  const goToStep = (step: SetupStep) => {
    setCurrentStep(step);
  };

  const goBack = () => {
    setCurrentStep((prev) => {
      if (prev === 1) return 1;
      if (prev === 2) return 1;
      return 2;
    });
  };

  const goNext = () => {
    setCurrentStep((prev) => {
      if (prev === 3) return 3;
      if (prev === 2) return 3;
      return 2;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold uppercase tracking-wide">Setup Wizard</h2>
          <p className="text-sm text-muted-foreground">
            Configure your expense schema in 3 simple steps.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          onClick={startTutorial}
          data-tour="tutorial-btn"
        >
          <BookOpen className="size-4 mr-2" />
          Start Tutorial
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-3" data-tour="wizard-steps">
        <Button
          type="button"
          variant={currentStep === 1 ? "default" : "outline"}
          className="rounded-none justify-start"
          onClick={() => goToStep(1)}
        >
          1. Categories
        </Button>
        <Button
          type="button"
          variant={currentStep === 2 ? "default" : "outline"}
          className="rounded-none justify-start"
          onClick={() => goToStep(2)}
          disabled={!selectedCategoryId}
        >
          2. Fields
        </Button>
        <Button
          type="button"
          variant={currentStep === 3 ? "default" : "outline"}
          className="rounded-none justify-start"
          onClick={() => goToStep(3)}
          disabled={!selectedCategoryId}
        >
          3. Select Options
        </Button>
      </div>

      <div className="border border-border p-4 bg-muted/15" data-tour="helper-box">
        {currentStep === 1 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Step 1:</span> Create categories such as Utilities, Maintenance, or Transport. Then click Configure to choose which category you are setting up.
          </p>
        ) : null}
        {currentStep === 2 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Step 2:</span> Add fields users should fill while recording an expense for <span className="font-semibold text-foreground">{activeCategory?.name ?? "the selected category"}</span>.
          </p>
        ) : null}
        {currentStep === 3 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Step 3:</span> For any field of type Select, add allowed choices (for example: Diesel, Petrol, CNG).
          </p>
        ) : null}
      </div>

      <section className="space-y-4" data-tour="active-panel">
        {currentStep === 1 ? (
          <>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Create Category</h3>
              <div className="grid md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Category Name</Label>
                  <Input
                    placeholder="e.g., Utilities"
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                    className="rounded-none"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Icon (Optional)</Label>
                  <Input
                    placeholder="Optional icon name"
                    value={categoryIcon}
                    onChange={(event) => setCategoryIcon(event.target.value)}
                    className="rounded-none"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sort Order</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    value={categorySortOrder}
                    onChange={(event) => setCategorySortOrder(event.target.value)}
                    className="rounded-none"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    className="rounded-none w-full"
                    onClick={() => {
                      if (!categoryName.trim()) {
                        toast.error("Category name is required");
                        return;
                      }
                      createCategory.mutate({
                        data: {
                          name: categoryName.trim(),
                          icon: categoryIcon.trim() || undefined,
                          sortOrder: Number(categorySortOrder) || 0,
                        },
                      });
                    }}
                    disabled={createCategory.isPending}
                  >
                    Add Category
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Categories</h3>
              {isLoadingCategories ? (
                <p className="text-sm text-muted-foreground">Loading categories...</p>
              ) : (
                <div className="space-y-2">
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="border border-border p-3 rounded-none flex flex-col md:flex-row md:items-center gap-2 justify-between"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{category.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Display order: {category.sortOrder}</span>
                          {!category.isActive && <Badge variant="outline">Inactive</Badge>}
                          {category.isArchived && <Badge variant="destructive">Archived</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          variant={selectedCategoryId === category.id ? "default" : "outline"}
                          className="rounded-none"
                          onClick={() => {
                            setSelectedCategoryId(category.id);
                            setSelectedOptionFieldId("");
                            setCurrentStep(2);
                          }}
                        >
                          Use This Category
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-none"
                          onClick={() =>
                            updateCategory.mutate({
                              data: { id: category.id, isActive: !category.isActive },
                            })
                          }
                        >
                          {category.isActive ? "Hide" : "Show"}
                        </Button>
                        {!category.isArchived && (
                          <Button
                            variant="destructive"
                            className="rounded-none"
                            onClick={() => archiveCategory.mutate({ data: { id: category.id } })}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}

        {currentStep === 2 ? (
          !selectedCategoryId ? (
            <p className="text-sm text-muted-foreground">
              Please pick a category in Step 1 first.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  Add Fields for {activeCategory?.name}
                </h3>
                <div className="grid md:grid-cols-6 gap-2">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Field Key (Optional)</Label>
                    <Input
                      placeholder="Auto-generated from label"
                      value={fieldKey}
                      onChange={(event) => setFieldKey(event.target.value)}
                      className="rounded-none"
                    />
                    <p className="text-[11px] text-muted-foreground">Leave blank to auto-generate from Field Label.</p>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Field Label</Label>
                    <Input
                      placeholder="e.g., Machine Name"
                      value={fieldLabel}
                      onChange={(event) => setFieldLabel(event.target.value)}
                      className="rounded-none"
                    />
                    <p className="text-[11px] text-muted-foreground">This is what your client will see in forms and tables.</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Field Type</Label>
                    <Select value={fieldType} onValueChange={(value: FieldType) => setFieldType(value)}>
                      <SelectTrigger className="rounded-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-none">
                        {fieldTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">{fieldTypeDescriptions[fieldType]}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sort</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={fieldSortOrder}
                      onChange={(event) => setFieldSortOrder(event.target.value)}
                      className="rounded-none"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-4 gap-2 items-end">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Placeholder (Optional)</Label>
                    <Input
                      placeholder="Example value shown in input"
                      value={fieldPlaceholder}
                      onChange={(event) => setFieldPlaceholder(event.target.value)}
                      className="rounded-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 border border-border px-3 h-10">
                    <Checkbox
                      id="field-required"
                      checked={fieldRequired}
                      onCheckedChange={(checked) => setFieldRequired(Boolean(checked))}
                    />
                    <Label htmlFor="field-required">Required</Label>
                  </div>
                  <Button
                    className="rounded-none"
                    onClick={() => {
                      if (!fieldLabel.trim()) {
                        toast.error("Field label is required");
                        return;
                      }

                      const computedKey = toFieldKey(fieldKey.trim() || fieldLabel.trim());
                      if (!computedKey) {
                        toast.error("Please provide a valid field label or key");
                        return;
                      }

                      createField.mutate({
                        data: {
                          categoryId: selectedCategoryId,
                          key: computedKey,
                          label: fieldLabel.trim(),
                          fieldType,
                          isRequired: fieldRequired,
                          sortOrder: Number(fieldSortOrder) || 0,
                          placeholder: fieldPlaceholder.trim() || undefined,
                        },
                      });
                    }}
                    disabled={createField.isPending}
                  >
                    Add Field
                  </Button>
                </div>
              </div>

              <Separator />

              {isLoadingFields ? (
                <p className="text-sm text-muted-foreground">Loading fields...</p>
              ) : fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fields configured yet for this category.</p>
              ) : (
                <div className="space-y-2">
                  {fields.map((field) => (
                    <div key={field.id} className="border border-border p-3 rounded-none space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">
                            {field.label} <span className="text-muted-foreground">({field.key})</span>
                          </p>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                            <span>Field type: {field.fieldType}</span>
                            <span>Display order: {field.sortOrder}</span>
                            {field.isRequired && <Badge variant="outline">Required</Badge>}
                            {!field.isActive && <Badge variant="destructive">Inactive</Badge>}
                            {field.fieldType === "select" && (
                              <Badge variant="outline">{field.options.length} options</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {field.fieldType === "select" ? (
                            <Button
                              variant="outline"
                              className="rounded-none"
                              onClick={() => {
                                setSelectedOptionFieldId(field.id);
                                setCurrentStep(3);
                              }}
                            >
                              Manage Options
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            className="rounded-none"
                            onClick={() =>
                              updateField.mutate({
                                data: { id: field.id, isRequired: !field.isRequired },
                              })
                            }
                          >
                            {field.isRequired ? "Make Optional" : "Make Required"}
                          </Button>
                          <Button
                            variant="outline"
                            className="rounded-none"
                            onClick={() =>
                              updateField.mutate({
                                data: { id: field.id, isActive: !field.isActive },
                              })
                            }
                          >
                            {field.isActive ? "Hide Field" : "Show Field"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        ) : null}

        {currentStep === 3 ? (
          !selectedCategoryId ? (
            <p className="text-sm text-muted-foreground">
              Please pick a category in Step 1 first.
            </p>
          ) : selectFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This category has no Select-type fields yet. Add a field with type Select in Step 2.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide">
                  Manage Select Options for {activeCategory?.name}
                </h3>
                <div className="grid md:grid-cols-4 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Select Field</Label>
                    <Select
                      value={selectedOptionFieldId}
                      onValueChange={setSelectedOptionFieldId}
                    >
                      <SelectTrigger className="rounded-none">
                        <SelectValue placeholder="Choose a field" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none">
                        {selectFields.map((field) => (
                          <SelectItem key={field.id} value={field.id}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Option Value</Label>
                    <Input
                      placeholder="e.g., diesel"
                      value={optionValue}
                      onChange={(event) => setOptionValue(event.target.value)}
                      className="rounded-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Option Label</Label>
                    <Input
                      placeholder="e.g., Diesel"
                      value={optionLabel}
                      onChange={(event) => setOptionLabel(event.target.value)}
                      className="rounded-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sort</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={optionSortOrder}
                      onChange={(event) => setOptionSortOrder(event.target.value)}
                      className="rounded-none"
                    />
                  </div>
                </div>
                <Button
                  className="rounded-none"
                  disabled={!selectedOptionFieldId || createOption.isPending || !selectedOptionField?.isActive}
                  onClick={() => {
                    if (!selectedOptionFieldId) {
                      toast.error("Please select a field");
                      return;
                    }
                    if (!optionValue.trim() || !optionLabel.trim()) {
                      toast.error("Value and label are required for options");
                      return;
                    }

                    createOption.mutate({
                      data: {
                        fieldId: selectedOptionFieldId,
                        value: optionValue.trim(),
                        label: optionLabel.trim(),
                        sortOrder: Number(optionSortOrder) || 0,
                      },
                    });
                  }}
                >
                  Add Option
                </Button>
              </div>

              <Separator />

              {!selectedOptionFieldId ? (
                <p className="text-sm text-muted-foreground">Choose a Select field to view and manage its options.</p>
              ) : (
                <div className="space-y-2">
                  {(selectedOptionField?.options ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No options added yet for this field.</p>
                  ) : (
                    selectedOptionField?.options.map((option) => (
                      <div
                        key={option.id}
                        className="flex items-center justify-between border border-border px-2 py-1"
                      >
                        <div className="text-xs flex flex-wrap items-center gap-2">
                          <span>
                            {option.label} ({option.value})
                          </span>
                          {!option.isActive && (
                            <Badge variant="destructive" className="rounded-none">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-none h-7"
                            onClick={() =>
                              updateOption.mutate({
                                data: { id: option.id, isActive: !option.isActive },
                              })
                            }
                          >
                            {option.isActive ? "Hide" : "Show"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="rounded-none h-7"
                            onClick={() => archiveOption.mutate({ data: { id: option.id } })}
                          >
                            Archive
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )
        ) : null}
      </section>

      <div className="flex items-center justify-between gap-2" data-tour="wizard-nav">
        <Button
          type="button"
          variant="outline"
          className="rounded-none"
          disabled={currentStep === 1}
          onClick={goBack}
        >
          <ArrowLeft className="size-4 mr-2" />
          Back
        </Button>

        <Button
          type="button"
          className="rounded-none"
          disabled={currentStep === 3 || !canGoNext}
          onClick={goNext}
        >
          Next
          <ArrowRight className="size-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
