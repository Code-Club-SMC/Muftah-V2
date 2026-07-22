import { type LucideIcon, PlusIcon } from "lucide-react";
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
  icon: LucideIcon | React.ElementType;
  title: string;
  description: string;
  ctaText?: string;
  onAddChange?: (open: boolean) => void;
  className?: string;
};

export function GenericEmpty({
  icon: Icon,
  title,
  description,
  ctaText,
  onAddChange,
  className,
}: Props) {
  return (
    <Empty
      className={`flex-1 h-full flex flex-col items-center justify-center ${className}`}
    >
      <EmptyHeader className="space-y-2">
        <EmptyMedia variant="default">
          <Icon className="" />
        </EmptyMedia>
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
    </Empty>
  );
}
