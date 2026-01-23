import { useEffect, useRef } from 'react';
import {
  Copy,
  Clipboard,
  Scissors,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronUp,
  ChevronDown,
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  FolderPlus,
  FolderOpen,
  Type,
  Square,
  Circle,
  Triangle,
  Star,
  Hexagon,
  Minus,
  Grid3X3,
  Ruler,
  ZoomIn,
  ZoomOut,
  Maximize,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Paintbrush,
  MousePointer,
} from 'lucide-react';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export type ContextMenuType = 'layer' | 'multi-layer' | 'canvas' | 'group';

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  divider?: boolean;
  submenu?: MenuItem[];
}

interface ContextMenuProps {
  position: ContextMenuPosition;
  type: ContextMenuType;
  onClose: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onBringToFront: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSendToBack: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onFlipHorizontal: () => void;
  onFlipVertical: () => void;
  onResetTransform: () => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
  onAddText: () => void;
  onAddShape: (type: 'rectangle' | 'ellipse' | 'triangle' | 'star' | 'polygon' | 'line') => void;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onAlignLeft: () => void;
  onAlignCenter: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignMiddle: () => void;
  onAlignBottom: () => void;
  isVisible: boolean;
  isLocked: boolean;
  showGrid: boolean;
  showRulers: boolean;
  hasClipboard: boolean;
  hasStyleClipboard: boolean;
  selectedCount: number;
}

export function ContextMenu({
  position,
  type,
  onClose,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onSelectAll,
  onToggleVisibility,
  onToggleLock,
  onBringToFront,
  onBringForward,
  onSendBackward,
  onSendToBack,
  onGroup,
  onUngroup,
  onFlipHorizontal,
  onFlipVertical,
  onResetTransform,
  onCopyStyle,
  onPasteStyle,
  onAddText,
  onAddShape,
  onToggleGrid,
  onToggleRulers,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onAlignLeft,
  onAlignCenter,
  onAlignRight,
  onAlignTop,
  onAlignMiddle,
  onAlignBottom,
  isVisible,
  isLocked,
  showGrid,
  showRulers,
  hasClipboard,
  hasStyleClipboard,
  selectedCount,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      if (position.x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8;
      }
      if (position.y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [position]);

  const getMenuItems = (): MenuItem[] => {
    if (type === 'canvas') {
      return [
        { label: 'Paste', icon: <Clipboard size={14} />, shortcut: '⌘V', action: onPaste, disabled: !hasClipboard },
        { label: 'Paste Style', icon: <Paintbrush size={14} />, shortcut: '⌘⇧V', action: onPasteStyle, disabled: !hasStyleClipboard },
        { label: '', action: () => {}, divider: true },
        { label: 'Select All', icon: <MousePointer size={14} />, shortcut: '⌘A', action: onSelectAll },
        { label: '', action: () => {}, divider: true },
        { label: 'Add Text', icon: <Type size={14} />, shortcut: 'T', action: onAddText },
        {
          label: 'Add Shape',
          icon: <Square size={14} />,
          action: () => {},
          submenu: [
            { label: 'Rectangle', icon: <Square size={14} />, action: () => onAddShape('rectangle') },
            { label: 'Ellipse', icon: <Circle size={14} />, action: () => onAddShape('ellipse') },
            { label: 'Triangle', icon: <Triangle size={14} />, action: () => onAddShape('triangle') },
            { label: 'Star', icon: <Star size={14} />, action: () => onAddShape('star') },
            { label: 'Polygon', icon: <Hexagon size={14} />, action: () => onAddShape('polygon') },
            { label: 'Line', icon: <Minus size={14} />, action: () => onAddShape('line') },
          ],
        },
        { label: '', action: () => {}, divider: true },
        { label: showGrid ? 'Hide Grid' : 'Show Grid', icon: <Grid3X3 size={14} />, shortcut: "⌘'", action: onToggleGrid },
        { label: showRulers ? 'Hide Rulers' : 'Show Rulers', icon: <Ruler size={14} />, shortcut: '⌘R', action: onToggleRulers },
        { label: '', action: () => {}, divider: true },
        { label: 'Zoom In', icon: <ZoomIn size={14} />, shortcut: '⌘+', action: onZoomIn },
        { label: 'Zoom Out', icon: <ZoomOut size={14} />, shortcut: '⌘-', action: onZoomOut },
        { label: 'Zoom to Fit', icon: <Maximize size={14} />, shortcut: '⌘0', action: onZoomFit },
      ];
    }

    if (type === 'multi-layer') {
      return [
        { label: 'Cut', icon: <Scissors size={14} />, shortcut: '⌘X', action: onCut },
        { label: 'Copy', icon: <Copy size={14} />, shortcut: '⌘C', action: onCopy },
        { label: 'Paste', icon: <Clipboard size={14} />, shortcut: '⌘V', action: onPaste, disabled: !hasClipboard },
        { label: 'Duplicate', icon: <Copy size={14} />, shortcut: '⌘D', action: onDuplicate },
        { label: 'Delete', icon: <Trash2 size={14} />, shortcut: '⌫', action: onDelete },
        { label: '', action: () => {}, divider: true },
        { label: `Group ${selectedCount} Layers`, icon: <FolderPlus size={14} />, shortcut: '⌘G', action: onGroup },
        { label: '', action: () => {}, divider: true },
        {
          label: 'Align',
          icon: <AlignLeft size={14} />,
          action: () => {},
          submenu: [
            { label: 'Align Left', icon: <AlignLeft size={14} />, action: onAlignLeft },
            { label: 'Align Center', icon: <AlignCenter size={14} />, action: onAlignCenter },
            { label: 'Align Right', icon: <AlignRight size={14} />, action: onAlignRight },
            { label: '', action: () => {}, divider: true },
            { label: 'Align Top', icon: <AlignStartVertical size={14} />, action: onAlignTop },
            { label: 'Align Middle', icon: <AlignCenterVertical size={14} />, action: onAlignMiddle },
            { label: 'Align Bottom', icon: <AlignEndVertical size={14} />, action: onAlignBottom },
          ],
        },
        { label: '', action: () => {}, divider: true },
        { label: 'Bring to Front', icon: <ArrowUpToLine size={14} />, shortcut: '⌘⇧]', action: onBringToFront },
        { label: 'Send to Back', icon: <ArrowDownToLine size={14} />, shortcut: '⌘⇧[', action: onSendToBack },
      ];
    }

    if (type === 'group') {
      return [
        { label: 'Cut', icon: <Scissors size={14} />, shortcut: '⌘X', action: onCut },
        { label: 'Copy', icon: <Copy size={14} />, shortcut: '⌘C', action: onCopy },
        { label: 'Paste', icon: <Clipboard size={14} />, shortcut: '⌘V', action: onPaste, disabled: !hasClipboard },
        { label: 'Duplicate', icon: <Copy size={14} />, shortcut: '⌘D', action: onDuplicate },
        { label: 'Delete', icon: <Trash2 size={14} />, shortcut: '⌫', action: onDelete },
        { label: '', action: () => {}, divider: true },
        { label: 'Ungroup', icon: <FolderOpen size={14} />, shortcut: '⌘⇧G', action: onUngroup },
        { label: '', action: () => {}, divider: true },
        { label: isVisible ? 'Hide' : 'Show', icon: isVisible ? <EyeOff size={14} /> : <Eye size={14} />, shortcut: '⌘⇧H', action: onToggleVisibility },
        { label: isLocked ? 'Unlock' : 'Lock', icon: isLocked ? <Unlock size={14} /> : <Lock size={14} />, shortcut: '⌘⇧L', action: onToggleLock },
        { label: '', action: () => {}, divider: true },
        { label: 'Bring to Front', icon: <ArrowUpToLine size={14} />, shortcut: '⌘⇧]', action: onBringToFront },
        { label: 'Bring Forward', icon: <ChevronUp size={14} />, shortcut: '⌘]', action: onBringForward },
        { label: 'Send Backward', icon: <ChevronDown size={14} />, shortcut: '⌘[', action: onSendBackward },
        { label: 'Send to Back', icon: <ArrowDownToLine size={14} />, shortcut: '⌘⇧[', action: onSendToBack },
        { label: '', action: () => {}, divider: true },
        { label: 'Flip Horizontal', icon: <FlipHorizontal size={14} />, action: onFlipHorizontal },
        { label: 'Flip Vertical', icon: <FlipVertical size={14} />, action: onFlipVertical },
        { label: 'Reset Transform', icon: <RotateCcw size={14} />, action: onResetTransform },
      ];
    }

    return [
      { label: 'Cut', icon: <Scissors size={14} />, shortcut: '⌘X', action: onCut },
      { label: 'Copy', icon: <Copy size={14} />, shortcut: '⌘C', action: onCopy },
      { label: 'Paste', icon: <Clipboard size={14} />, shortcut: '⌘V', action: onPaste, disabled: !hasClipboard },
      { label: 'Duplicate', icon: <Copy size={14} />, shortcut: '⌘D', action: onDuplicate },
      { label: 'Delete', icon: <Trash2 size={14} />, shortcut: '⌫', action: onDelete },
      { label: '', action: () => {}, divider: true },
      { label: 'Copy Style', icon: <Paintbrush size={14} />, shortcut: '⌘⌥C', action: onCopyStyle },
      { label: 'Paste Style', icon: <Paintbrush size={14} />, shortcut: '⌘⌥V', action: onPasteStyle, disabled: !hasStyleClipboard },
      { label: '', action: () => {}, divider: true },
      { label: isVisible ? 'Hide' : 'Show', icon: isVisible ? <EyeOff size={14} /> : <Eye size={14} />, shortcut: '⌘⇧H', action: onToggleVisibility },
      { label: isLocked ? 'Unlock' : 'Lock', icon: isLocked ? <Unlock size={14} /> : <Lock size={14} />, shortcut: '⌘⇧L', action: onToggleLock },
      { label: '', action: () => {}, divider: true },
      { label: 'Bring to Front', icon: <ArrowUpToLine size={14} />, shortcut: '⌘⇧]', action: onBringToFront },
      { label: 'Bring Forward', icon: <ChevronUp size={14} />, shortcut: '⌘]', action: onBringForward },
      { label: 'Send Backward', icon: <ChevronDown size={14} />, shortcut: '⌘[', action: onSendBackward },
      { label: 'Send to Back', icon: <ArrowDownToLine size={14} />, shortcut: '⌘⇧[', action: onSendToBack },
      { label: '', action: () => {}, divider: true },
      { label: 'Flip Horizontal', icon: <FlipHorizontal size={14} />, action: onFlipHorizontal },
      { label: 'Flip Vertical', icon: <FlipVertical size={14} />, action: onFlipVertical },
      { label: 'Reset Transform', icon: <RotateCcw size={14} />, action: onResetTransform },
    ];
  };

  const renderMenuItem = (item: MenuItem, index: number) => {
    if (item.divider) {
      return <div key={index} className="h-px bg-border my-1" />;
    }

    if (item.submenu) {
      return (
        <div key={index} className="relative group/submenu">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent rounded-sm transition-colors"
          >
            {item.icon && <span className="text-muted-foreground">{item.icon}</span>}
            <span className="flex-1 text-left">{item.label}</span>
            <ChevronUp size={12} className="text-muted-foreground rotate-90" />
          </button>
          <div className="absolute left-full top-0 ml-1 hidden group-hover/submenu:block">
            <div className="bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
              {item.submenu.map((subItem, subIndex) => renderMenuItem(subItem, subIndex))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <button
        key={index}
        onClick={() => {
          if (!item.disabled) {
            item.action();
            onClose();
          }
        }}
        disabled={item.disabled}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs rounded-sm transition-colors ${
          item.disabled
            ? 'text-muted-foreground/50 cursor-not-allowed'
            : 'text-foreground hover:bg-accent'
        }`}
      >
        {item.icon && <span className={item.disabled ? 'text-muted-foreground/50' : 'text-muted-foreground'}>{item.icon}</span>}
        <span className="flex-1 text-left">{item.label}</span>
        {item.shortcut && (
          <span className="text-[10px] text-muted-foreground font-mono">{item.shortcut}</span>
        )}
      </button>
    );
  };

  const menuItems = getMenuItems();

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[200px] animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menuItems.map((item, index) => renderMenuItem(item, index))}
    </div>
  );
}
