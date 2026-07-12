import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider, useAuth } from "../lib/auth";
import { canAccessPath } from "../lib/domain";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { FilingCabinetNav } from "@/components/filing-cabinet-nav";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Footwear Production Hub" },
      {
        name: "description",
        content: "Production planning and coordination for leather footwear manufacturing.",
      },
      { name: "author", content: "Footwear Production Hub" },
      { property: "og:title", content: "Footwear Production Hub" },
      {
        property: "og:description",
        content: "Production planning and coordination for leather footwear manufacturing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppGate />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AppGate() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const { user, profile, isLoading, signOut, isDemoMode } = useAuth();
  const isPublicRoute = currentPath === "/login";
  const isPurchaseOrdersImmersive = currentPath.startsWith("/purchase-orders");
  const isDashboardImmersive = currentPath === "/";
  const isImmersive = isPurchaseOrdersImmersive || isDashboardImmersive;

  useEffect(() => {
    if (!isPublicRoute && !isLoading && !user) {
      window.location.assign(`/login?redirect=${encodeURIComponent(currentPath)}`);
    }
  }, [currentPath, isLoading, isPublicRoute, user]);

  if (isPublicRoute) return <Outlet />;

  if (isLoading || (!user && !isPublicRoute)) {
    return <CenteredMessage title="Loading workspace" description="Checking your session." />;
  }

  if (!profile?.active || !profile.role) {
    return (
      <CenteredMessage
        title="Account pending"
        description="An Owner needs to activate your account and assign a role before you can use the hub."
        action={<Button onClick={signOut}>Sign out</Button>}
      />
    );
  }

  const canAccess = canAccessPath(profile.role, currentPath);

  return (
    <SidebarProvider>
      <div
        className={cn(
          "flex min-h-screen w-full bg-background",
          isPurchaseOrdersImmersive && "po-immersive-shell",
          isDashboardImmersive && "dashboard-immersive-shell",
        )}
      >
        {isImmersive ? null : <AppSidebar />}
        <div className="flex flex-1 flex-col">
          {isImmersive ? null : (
            <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-card px-4">
              <div className="flex items-center gap-3">
                <SidebarTrigger />
                <div className="text-sm font-medium text-muted-foreground">
                  Footwear Production Hub
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isDemoMode ? (
                  <div className="hidden rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning-foreground sm:block">
                    Demo Mode - sample data
                  </div>
                ) : null}
                <div className="hidden text-right text-xs text-muted-foreground sm:block">
                  <div>{profile.fullName || profile.email}</div>
                  <div>{profile.role}</div>
                </div>
                <Button variant="outline" size="sm" onClick={signOut}>
                  Logout
                </Button>
              </div>
            </header>
          )}
          <main
            className={cn(
              "flex-1 p-4 sm:p-6 lg:p-8",
              isPurchaseOrdersImmersive && "po-immersive-main",
              isDashboardImmersive && "dashboard-immersive-main",
            )}
          >
            {canAccess ? <Outlet /> : <RestrictedAccess />}
          </main>
        </div>
        {isDashboardImmersive ? null : <FilingCabinetNav />}
      </div>
    </SidebarProvider>
  );
}

function CenteredMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}

function RestrictedAccess() {
  return (
    <CenteredMessage
      title="Access restricted"
      description="Your role does not include this workspace area."
    />
  );
}
