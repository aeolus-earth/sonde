import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[300px] items-center justify-center p-6">
          <div className="max-w-md rounded-[8px] border border-border bg-surface p-6 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-status-failed" />
            <h2 className="mt-3 text-[15px] font-semibold text-text">
              Something went wrong
            </h2>
            <p className="mt-1 text-[13px] text-text-tertiary">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 rounded-[5.5px] bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-hover"
              >
                <RotateCcw className="h-3 w-3" />
                Try again
              </button>
              <a
                href="/"
                className="inline-flex items-center gap-1.5 rounded-[5.5px] border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
              >
                <Home className="h-3 w-3" />
                Dashboard
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
