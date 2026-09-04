import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Spinner — PHASE 07 design-system primitive (§32 loading states).
 * Token-driven (currentColor) so it inherits text color context.
 */
function Spinner({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("animate-spin", className)}
      role="presentation"
      aria-hidden="true"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  )
}

export { Spinner }
