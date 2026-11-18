import React from "react";
import { Button } from "@openreel/ui";


interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Component error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center bg-background-secondary/50 rounded-lg m-2">
          <span className="font-medium text-red-400 text-sm mb-2">
            Something went wrong
          </span>
          <span className="font-normal text-text-muted text-xs mb-4 max-w-xs">
            {this.state.error?.message || "An unexpected error occurred"}
          </span>
          <Button onClick={this.handleRetry} type="button" aria-label="Retry" className="inline-flex min-w-0 items-center justify-center gap-1.5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 hover:text-fg px-4 py-2 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded transition-colors">
            <span className="truncate">{"Retry"}</span>
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface PanelErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
  /** For overlays mounted outside a panel slot, where the message would disturb layout. */
  silent?: boolean;
}

export const PanelErrorBoundary: React.FC<PanelErrorBoundaryProps> = ({
  name,
  children,
  silent,
}) => (
  <ErrorBoundary
    fallback={
      silent ? <></> : <div className="flex-1 flex items-center justify-center p-4 text-center">
        <span className="font-normal text-text-muted text-xs">
          {name} failed to load. Please refresh the page.
        </span>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
);
