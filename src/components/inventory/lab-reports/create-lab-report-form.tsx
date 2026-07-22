import { useState, useEffect } from "react";
import { ResponsiveSheet } from "../../custom/responsive-sheet";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Badge } from "../../ui/badge";
import { Separator } from "../../ui/separator";
import {
    Plus,
    Trash2,
    CheckCircle2,
    XCircle,
    FlaskConical,
} from "lucide-react";
import { useCreateLabReport, useUpdateLabReport } from "@/hooks/inventory/use-lab-reports";

type CreateLabReportFormProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    chemicalId: string;
    chemicalName: string;
    editData?: {
        id: string;
        productName: string;
        stockNumber: string | null;
        lotNumber: string | null;
        analysisItems: AnalysisItem[];
        certifiedBy: string;
        certifierTitle: string | null;
        reportDate: string | Date;
        standardReference: string | null;
        notes: string | null;
    } | null;
};

type AnalysisItem = {
    item: string;
    requirement: string;
    result: string;
    passed: boolean;
};

const DEFAULT_ANALYSIS_ITEMS: AnalysisItem[] = [
    { item: "Appearance", requirement: "", result: "", passed: true },
    { item: "Color", requirement: "", result: "", passed: true },
    { item: "Odor", requirement: "", result: "", passed: true },
    { item: "pH", requirement: "", result: "", passed: true },
    { item: "Viscosity @ 25°C", requirement: "", result: "", passed: true },
    { item: "Specific Gravity", requirement: "", result: "", passed: true },
];

export const CreateLabReportForm = ({
    open,
    onOpenChange,
    chemicalId,
    chemicalName,
    editData,
}: CreateLabReportFormProps) => {
    const createReport = useCreateLabReport();
    const updateReport = useUpdateLabReport();
    const isEditMode = !!editData;

    const [productName, setProductName] = useState(editData?.productName || chemicalName);
    const [stockNumber, setStockNumber] = useState(editData?.stockNumber || "");
    const [lotNumber, setLotNumber] = useState(editData?.lotNumber || "");
    const [certifiedBy, setCertifiedBy] = useState(editData?.certifiedBy || "");
    const [certifierTitle, setCertifierTitle] = useState(editData?.certifierTitle || "");
    const [reportDate, setReportDate] = useState(
        editData?.reportDate
            ? new Date(editData.reportDate).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0],
    );
    const [standardReference, setStandardReference] = useState(editData?.standardReference || "ISO 9001:2015");
    const [notes, setNotes] = useState(editData?.notes || "");
    const [analysisItems, setAnalysisItems] = useState<AnalysisItem[]>(
        editData?.analysisItems || DEFAULT_ANALYSIS_ITEMS,
    );

    // Reset form when editData changes (switching between create and edit)
    useEffect(() => {
        if (editData) {
            setProductName(editData.productName);
            setStockNumber(editData.stockNumber || "");
            setLotNumber(editData.lotNumber || "");
            setCertifiedBy(editData.certifiedBy);
            setCertifierTitle(editData.certifierTitle || "");
            setReportDate(new Date(editData.reportDate).toISOString().split("T")[0]);
            setStandardReference(editData.standardReference || "ISO 9001:2015");
            setNotes(editData.notes || "");
            setAnalysisItems(editData.analysisItems);
        } else {
            setProductName(chemicalName);
            setStockNumber("");
            setLotNumber("");
            setCertifiedBy("");
            setCertifierTitle("");
            setReportDate(new Date().toISOString().split("T")[0]);
            setStandardReference("ISO 9001:2015");
            setNotes("");
            setAnalysisItems(DEFAULT_ANALYSIS_ITEMS);
        }
    }, [editData, chemicalName]);

    const addItem = () => {
        setAnalysisItems([
            ...analysisItems,
            { item: "", requirement: "", result: "", passed: true },
        ]);
    };

    const removeItem = (index: number) => {
        setAnalysisItems(analysisItems.filter((_, i) => i !== index));
    };

    const updateItem = (
        index: number,
        field: keyof AnalysisItem,
        value: string | boolean,
    ) => {
        const updated = [...analysisItems];
        updated[index] = { ...updated[index], [field]: value };
        setAnalysisItems(updated);
    };

    const isFormValid = () => {
        if (!productName.trim() || !certifiedBy.trim() || !reportDate) return false;
        if (analysisItems.length === 0) return false;
        return analysisItems.every(
            (item) =>
                item.item.trim() && item.requirement.trim() && item.result.trim(),
        );
    };

    const handleSubmit = () => {
        if (!isFormValid()) return;

        const formData = {
            productName: productName.trim(),
            stockNumber: stockNumber.trim() || undefined,
            lotNumber: lotNumber.trim() || undefined,
            analysisItems,
            certifiedBy: certifiedBy.trim(),
            certifierTitle: certifierTitle.trim() || undefined,
            reportDate,
            standardReference: standardReference.trim() || undefined,
            notes: notes.trim() || undefined,
        };

        if (isEditMode && editData) {
            updateReport.mutate(
                {
                    data: {
                        reportId: editData.id,
                        ...formData,
                    },
                },
                {
                    onSuccess: () => {
                        onOpenChange(false);
                    },
                },
            );
        } else {
            createReport.mutate(
                {
                    data: {
                        chemicalId,
                        ...formData,
                    },
                },
                {
                    onSuccess: () => {
                        onOpenChange(false);
                        // Reset form
                        setProductName(chemicalName);
                        setStockNumber("");
                        setLotNumber("");
                        setCertifiedBy("");
                        setCertifierTitle("");
                        setReportDate(new Date().toISOString().split("T")[0]);
                        setAnalysisItems(DEFAULT_ANALYSIS_ITEMS);
                        setNotes("");
                    },
                },
            );
        }
    };

    const isPending = isEditMode ? updateReport.isPending : createReport.isPending;

    return (
        <ResponsiveSheet
            open={open}
            onOpenChange={onOpenChange}
            title={isEditMode ? "Edit Certificate of Analysis" : "New Certificate of Analysis"}
            description={isEditMode ? `Update lab report for ${chemicalName}` : `Create a lab report for ${chemicalName}`}
            icon={FlaskConical}
            className="min-w-[720px]"
        >
            <div className="space-y-6 py-4">
                {/* Product Details */}
                <div>
                    <h4 className="text-xs font-black uppercase  text-muted-foreground mb-3">
                        Product Details
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2 space-y-1.5">
                            <Label className="text-xs font-semibold">Product Name *</Label>
                            <Input
                                value={productName}
                                onChange={(e) => setProductName(e.target.value)}
                                placeholder="e.g., Dexin Tile & Surface Cleaner"
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Stock Number</Label>
                            <Input
                                value={stockNumber}
                                onChange={(e) => setStockNumber(e.target.value)}
                                placeholder="e.g., DC001"
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">
                                Product Lot Number
                            </Label>
                            <Input
                                value={lotNumber}
                                onChange={(e) => setLotNumber(e.target.value)}
                                placeholder="e.g., 25022025"
                                className="h-9"
                            />
                        </div>
                    </div>
                </div>

                <Separator />

                {/* Analysis Items */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-black uppercase  text-muted-foreground">
                            Analysis Results
                        </h4>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={addItem}
                        >
                            <Plus className="size-3 mr-1" />
                            Add Item
                        </Button>
                    </div>

                    <div className="space-y-2">
                        {/* Header */}
                        <div className="grid grid-cols-[2fr_2fr_2fr_80px_32px] gap-2 px-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Analysis Item
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Requirement
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Result
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">
                                Status
                            </span>
                            <span />
                        </div>

                        {analysisItems.map((item, index) => (
                            <div
                                key={index}
                                className="grid grid-cols-[2fr_2fr_2fr_80px_32px] gap-2 items-center"
                            >
                                <Input
                                    value={item.item}
                                    onChange={(e) => updateItem(index, "item", e.target.value)}
                                    placeholder="e.g., pH"
                                    className="h-8 text-sm"
                                />
                                <Input
                                    value={item.requirement}
                                    onChange={(e) =>
                                        updateItem(index, "requirement", e.target.value)
                                    }
                                    placeholder="e.g., 5-7"
                                    className="h-8 text-sm"
                                />
                                <Input
                                    value={item.result}
                                    onChange={(e) => updateItem(index, "result", e.target.value)}
                                    placeholder="e.g., 6.5"
                                    className="h-8 text-sm"
                                />
                                <div className="flex justify-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className={`h-7 px-2 text-xs font-bold ${item.passed
                                            ? "text-emerald-600 hover:text-emerald-700"
                                            : "text-red-600 hover:text-red-700"
                                            }`}
                                        onClick={() => updateItem(index, "passed", !item.passed)}
                                    >
                                        {item.passed ? (
                                            <>
                                                <CheckCircle2 className="size-3 mr-1" />
                                                Pass
                                            </>
                                        ) : (
                                            <>
                                                <XCircle className="size-3 mr-1" />
                                                Fail
                                            </>
                                        )}
                                    </Button>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeItem(index)}
                                    disabled={analysisItems.length <= 1}
                                >
                                    <Trash2 className="size-3" />
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>

                <Separator />

                {/* Certification */}
                <div>
                    <h4 className="text-xs font-black uppercase  text-muted-foreground mb-3">
                        Certification
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Certified By *</Label>
                            <Input
                                value={certifiedBy}
                                onChange={(e) => setCertifiedBy(e.target.value)}
                                placeholder="Full name"
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Title</Label>
                            <Input
                                value={certifierTitle}
                                onChange={(e) => setCertifierTitle(e.target.value)}
                                placeholder="e.g., Chemical Engineer"
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Report Date *</Label>
                            <Input
                                type="date"
                                value={reportDate}
                                onChange={(e) => setReportDate(e.target.value)}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">
                                Standard Reference
                            </Label>
                            <Input
                                value={standardReference}
                                onChange={(e) => setStandardReference(e.target.value)}
                                placeholder="e.g., ISO 9001:2015"
                                className="h-9"
                            />
                        </div>
                    </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                        Additional Notes
                    </Label>
                    <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Any additional remarks about the analysis..."
                        rows={2}
                    />
                </div>

                {/* Summary */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 bg-muted/30 rounded-lg border">
                    <FlaskConical className="size-4 shrink-0" />
                    <span>
                        {analysisItems.length} analysis items •{" "}
                        <span className="text-emerald-600 font-bold">
                            {analysisItems.filter((i) => i.passed).length} passed
                        </span>{" "}
                        •{" "}
                        <span className="text-red-600 font-bold">
                            {analysisItems.filter((i) => !i.passed).length} failed
                        </span>
                    </span>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!isFormValid() || isPending}
                        className="bg-primary"
                    >
                        {isPending
                            ? (isEditMode ? "Saving..." : "Creating...")
                            : (isEditMode ? "Save Changes" : "Create Certificate")}
                    </Button>
                </div>
            </div>
        </ResponsiveSheet>
    );
};
