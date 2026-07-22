// Install Buffer polyfill before any other imports that may need it.
import "@/lib/buffer-polyfill";

import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ThemeProvider } from "next-themes";
import NotFound from "@/components/errors/404-not-found";
import { Toaster } from "@/components/ui/sonner";
import TanStackQueryDevtools from "../integrations/react-query/devtools";
import appCss from "../styles.css?url";
import { TooltipProvider } from "@/components/ui/tooltip";

type MyRouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  errorComponent: () => <div>Error</div>,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider
          defaultTheme="dark"
          // attribute="class"
          enableColorScheme
          enableSystem
        >
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </ThemeProvider>
        <Toaster />
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}


// Few more criticall things to consider:
// . There should also be a clear indicators for gross period and payroll-cycle.
// . Right now the bradfordfactor is calculated wrongly it should be calculated per calendar year. What happening right now is that lets say that an employee is registered in march then continung from march every consecutive month his bradford factor value is calculated e.g March(0), April(5), ..., December(90)etc. After december his bradford value should get reseted to 0 automatically for the next year.
// . Currently when the employee is given advanced after its approved then in the salary slip that advance loan get populated automatically which is good but I want that there should be flexibility like lets say the employee requests that this loan should be divided by 3 or 6 or 12 months. Then that accuratly  divided amount should be populated on every month salary slip.
// . So my employee says that they currently allow exception for 14 days 