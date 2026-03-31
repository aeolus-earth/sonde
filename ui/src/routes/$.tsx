import { createRoute, Link } from "@tanstack/react-router";
import { Route as authenticatedRoute } from "./_authenticated";
import { SearchX } from "lucide-react";

function NotFound() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <div className="text-center">
        <SearchX className="mx-auto h-10 w-10 text-text-quaternary" />
        <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-text">
          Page not found
        </h1>
        <p className="mt-1 text-[13px] text-text-tertiary">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex rounded-[5.5px] bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "$",
  component: NotFound,
});
