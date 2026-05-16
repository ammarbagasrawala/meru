/**
 * Icon wrapper — Lucide as the SF Symbols proxy.
 *
 * Why this wrapper: Apple's SF Symbols are stroke-based, optically balanced,
 * and consistently use ~1.5pt stroke weight at body sizes. Out of the box,
 * Lucide ships at strokeWidth=2 which reads as "Heroicons / generic open
 * source" rather than "iOS / macOS native." Forcing 1.5 globally is the
 * single highest-impact prop change for the Apple feel — confirmed by the
 * research in docs/research/apple-design/05-github-code-references.md §7.
 *
 * Usage:
 *   import { Icon } from "@/components/Icon";
 *   import { Lock, Plus, Shield } from "lucide-react";
 *   <Icon as={Lock} size={16} />
 *
 * SF Symbol → Lucide mapping (Provenant-relevant subset):
 *   lock.fill                 → Lock
 *   shield.lefthalf.filled    → Shield
 *   doc.text.viewfinder       → ScanText
 *   doc.text                  → FileText
 *   checkmark.seal            → BadgeCheck
 *   checkmark                 → Check
 *   xmark                     → X
 *   plus                      → Plus
 *   ellipsis                  → MoreHorizontal
 *   chevron.right             → ChevronRight
 *   arrow.up.right            → ArrowUpRight   (or use → for typographic)
 *   paperclip                 → Paperclip
 *   trash                     → Trash2
 *   magnifyingglass           → Search
 *   info.circle               → Info
 *   exclamationmark.triangle  → AlertTriangle
 *   line.3.horizontal         → Menu
 */
import type { ComponentType, SVGProps } from "react";

type LucideIcon = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number }
>;

export function Icon({
  as: Component,
  size = 18,
  strokeWidth = 1.5,
  className,
  ...rest
}: {
  as: LucideIcon;
  size?: number;
  strokeWidth?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "ref">) {
  return (
    <Component
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden
      {...rest}
    />
  );
}
