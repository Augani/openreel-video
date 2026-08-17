import * as React from "react";
import { t } from "../../../../i18n";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class InspectorTabErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center text-xs text-fg-2">
          {t("This panel hit an error. Switch tabs and back to retry.")}</div>
      );
    }
    return this.props.children;
  }
}
