import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { ReactNode } from "react";

type TooltipWrapperProps = {
  children: ReactNode;
  tooltipContent: ReactNode; // Changed from string to ReactNode
  side?: "top" | "right" | "bottom" | "left";
  contentClassName?: string;
};

export function TooltipWrapper({
  children,
  tooltipContent,
  side = "top",
  contentClassName,
}: TooltipWrapperProps) {
  if (!tooltipContent) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className={contentClassName}>
          {typeof tooltipContent === "string" ? (
            <p>{tooltipContent}</p>
          ) : (
            tooltipContent
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
