import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "../../i18n";
import { RecoveryDialog } from "./RecoveryDialog";
import type { AutoSaveMetadata } from "../../services/auto-save";

vi.mock("@openreel/ui", async () => {
  const React = await import("react");
  const DialogContext = React.createContext<((open: boolean) => void) | null>(
    null,
  );
  const CollapsibleContext = React.createContext<{
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }>({ open: false });

  return {
    Dialog: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <DialogContext.Provider value={onOpenChange ?? null}>
        {children}
      </DialogContext.Provider>
    ),
    DialogContent: ({
      children,
      className: _className,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => {
      const onOpenChange = React.useContext(DialogContext);
      React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Escape") onOpenChange?.(false);
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
      }, [onOpenChange]);

      return (
        <div role="dialog" {...props}>
          <button aria-label="Close" onClick={() => onOpenChange?.(false)}>
            Close
          </button>
          {children}
        </div>
      );
    },
    DialogHeader: ({
      children,
      className: _className,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    DialogTitle: ({
      children,
      className: _className,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
    DialogDescription: ({
      children,
      className: _className,
      ...props
    }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
    Button: ({
      children,
      className: _className,
      variant: _variant,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
      <button {...props}>{children}</button>
    ),
    Collapsible: ({
      children,
      open,
      onOpenChange,
      className: _className,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      className?: string;
    }) => (
      <CollapsibleContext.Provider value={{ open, onOpenChange }}>
        {children}
      </CollapsibleContext.Provider>
    ),
    CollapsibleTrigger: ({
      children,
      className: _className,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const { open, onOpenChange } = React.useContext(CollapsibleContext);
      return (
        <button {...props} onClick={() => onOpenChange?.(!open)}>
          {children}
        </button>
      );
    },
    CollapsibleContent: ({
      children,
      className: _className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => {
      const { open } = React.useContext(CollapsibleContext);
      return open ? <div>{children}</div> : null;
    },
  };
});

describe("RecoveryDialog", () => {
  const mockOnRecover = vi.fn();
  const mockOnDismiss = vi.fn();

  const createSave = (overrides: Partial<AutoSaveMetadata> = {}): AutoSaveMetadata => ({
    id: "save-1",
    projectId: "project-1",
    projectName: "Test Project",
    timestamp: Date.now(),
    slot: 0,
    isRecovery: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  const renderDialog = async (
    saves: AutoSaveMetadata[],
    options: { onClearAll?: () => void } = {},
  ) => {
    render(
      <RecoveryDialog
        saves={saves}
        onRecover={mockOnRecover}
        onDismiss={mockOnDismiss}
        onClearAll={options.onClearAll}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  };

  it("renders dialog with most recent save", async () => {
    const saves = [createSave({ projectName: "My Video" })];
    await renderDialog(saves);

    expect(screen.getByText("Recover Your Work")).toBeInTheDocument();
    expect(screen.getByText("We found an unsaved project")).toBeInTheDocument();
    expect(screen.getByText("My Video")).toBeInTheDocument();
  });

  it("renders localized Chinese copy when language changes", async () => {
    await i18n.changeLanguage("zh-CN");
    const saves = [createSave({ projectName: "My Video" })];

    await renderDialog(saves);

    expect(screen.getByText("恢复你的工作")).toBeInTheDocument();
    expect(screen.getByText("发现一个未保存的项目")).toBeInTheDocument();
    expect(screen.queryByText(/welcome:recovery/)).not.toBeInTheDocument();
  });

  it("calls onRecover when recover button is clicked", async () => {
    const saves = [createSave({ id: "save-abc" })];
    await renderDialog(saves);

    fireEvent.click(screen.getByText("Recover Project"));
    await waitFor(() => {
      expect(mockOnRecover).toHaveBeenCalledWith("save-abc");
    });
  });

  it("calls onDismiss when Start Fresh is clicked", async () => {
    const saves = [createSave()];
    await renderDialog(saves);

    fireEvent.click(screen.getByText("Start Fresh"));
    await waitFor(() => {
      expect(mockOnDismiss).toHaveBeenCalled();
    });
  });

  it("calls onDismiss when close button is clicked", async () => {
    const saves = [createSave()];
    await renderDialog(saves);

    const closeButton = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeButton);
    await waitFor(() => {
      expect(mockOnDismiss).toHaveBeenCalled();
    });
  });

  it("calls onDismiss when Escape key is pressed", async () => {
    const saves = [createSave()];
    await renderDialog(saves);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(mockOnDismiss).toHaveBeenCalled();
    });
  });

  it("shows older saves toggle when multiple saves exist", async () => {
    const saves = [
      createSave({ id: "save-1", projectName: "Most Recent" }),
      createSave({ id: "save-2", projectName: "Older Save", timestamp: Date.now() - 3600000 }),
    ];
    await renderDialog(saves);

    expect(screen.getByText("1 older save available")).toBeInTheDocument();
  });

  it("expands older saves when toggle is clicked", async () => {
    const saves = [
      createSave({ id: "save-1", projectName: "Most Recent" }),
      createSave({ id: "save-2", projectName: "Older Save", timestamp: Date.now() - 3600000 }),
    ];
    await renderDialog(saves);

    fireEvent.click(screen.getByText("1 older save available"));
    await waitFor(() => {
      expect(screen.getByText("Older Save")).toBeInTheDocument();
    });
  });

  it("allows recovering older save", async () => {
    const saves = [
      createSave({ id: "save-1", projectName: "Most Recent" }),
      createSave({ id: "save-2", projectName: "Older Save", timestamp: Date.now() - 3600000 }),
    ];
    await renderDialog(saves);

    fireEvent.click(screen.getByText("1 older save available"));
    fireEvent.click(await screen.findByText("Older Save"));

    await waitFor(() => {
      expect(mockOnRecover).toHaveBeenCalledWith("save-2");
    });
  });

  it("displays relative time for recent saves", async () => {
    const saves = [createSave({ timestamp: Date.now() - 30000 })];
    await renderDialog(saves);

    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it("displays minutes ago for older saves", async () => {
    const saves = [createSave({ timestamp: Date.now() - 5 * 60 * 1000 })];
    await renderDialog(saves);

    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();
  });

  it("disables recover button while recovering", async () => {
    const saves = [createSave()];
    await renderDialog(saves);

    fireEvent.click(screen.getByText("Recover Project"));
    await waitFor(() => {
      expect(screen.getByText("Recovering...")).toBeInTheDocument();
    });
  });
});
