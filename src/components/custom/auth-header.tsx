import { Link, useLocation } from "@tanstack/react-router";
import type { AllRoutes } from "@/lib/types";
import { buttonVariants } from "../ui/button";

export const Header = () => {
  const location = useLocation();
  const currentPath = location.pathname;
  const showAuthButtons = (
    ["/reset-password", "/forgot-password", "/2-fa"] as AllRoutes[]
  ).includes(currentPath as AllRoutes);

  return (
    <div className="flex justify-between items-center">
      {showAuthButtons && (
        <div className="flex items-center gap-2">
          <Link
            className={buttonVariants({ variant: "outline", size: "lg" })}
            to="/login"
          >
            Login
          </Link>
        </div>
      )}
    </div>
  );
};
