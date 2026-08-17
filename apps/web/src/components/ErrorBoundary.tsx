import React from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { t } from "../i18n";
import { useTranslation } from "react-i18next";

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
          <Text type="supporting" weight="medium" className="text-red-400 text-sm mb-2">
            {t("Something went wrong")}</Text>
          <Text type="supporting" color="secondary" className="text-text-muted text-xs mb-4 max-w-xs">
            {this.state.error?.message || "An unexpected error occurred"}
          </Text>
          <Button
            label={t("Retry")}
            variant="ghost"
            size="sm"
            onClick={this.handleRetry}
            className="px-4 py-2 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded transition-colors"
          />
        </div>
      );
    }

    return this.props.children;
  }
}

interface PanelErrorBoundaryProps {
  name: string;
  children: React.ReactNode;
}

export const PanelErrorBoundary: React.FC<PanelErrorBoundaryProps> = ({
  name,
  children,
}) => {
  const { t } = useTranslation();
  return (
  <ErrorBoundary
    fallback={
      <div className="flex-1 flex items-center justify-center p-4 text-center">
        <Text type="supporting" color="secondary" className="text-text-muted text-xs">
          {name} {t(" failed to load. Please refresh the page.")}</Text>
      </div>
    }
  >
    {children}
  </ErrorBoundary>
);
};
