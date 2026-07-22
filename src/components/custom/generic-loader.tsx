import { Spinner } from "../ui/spinner";

type LoaderProps = {
  title?: string;
  description?: string;
  className?: string;
};

export const GenericLoader = ({
  title,
  description,
  className,
}: LoaderProps) => {
  return (
    <div
      className={`flex h-full flex-1 items-center justify-center py-4 px-8 ${className}`}
    >
      <div className="flex flex-col items-center justify-center gap-y-6 p-6">
        <Spinner className="size-5" />
        <div className="flex flex-col items-center justify-center gap-y-2">
          {title && <h1 className="text-lg font-semibold">{title}</h1>}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
};
