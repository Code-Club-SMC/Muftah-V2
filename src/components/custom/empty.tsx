import { type LucideIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type Props = {
  icon?: LucideIcon | React.ElementType;
  title: string;
  description: string;
  ctaText?: string;
  onAddChange?: (open: boolean) => void;
  className?: string;
  action?: ReactNode;
};

export function GenericEmpty({
  icon: Icon,
  title,
  description,
  ctaText,
  onAddChange,
  className,
  action,
}: Props) {
  return (
    <Empty
      className={`flex-1 h-full flex flex-col items-center justify-center ${className}`}
    >
      <EmptyHeader className="space-y-2">
        {Icon && <EmptyMedia variant="default"><Icon className="" /></EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {ctaText && onAddChange && (
        <EmptyContent className="flex-row justify-center gap-5">
          <Button onClick={() => onAddChange(true)}>
            <PlusIcon />
            {ctaText}
          </Button>
        </EmptyContent>
      )}
      {action && <EmptyContent className="flex-row justify-center">{action}</EmptyContent>}
    </Empty>
  );
}
