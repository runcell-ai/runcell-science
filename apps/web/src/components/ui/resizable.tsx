import * as React from "react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

type PanelGroupProps = React.ComponentPropsWithoutRef<typeof ResizablePrimitive.PanelGroup>
type PanelProps = React.ComponentPropsWithoutRef<typeof ResizablePrimitive.Panel>
type HandleProps = React.ComponentPropsWithoutRef<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}

function ResizablePanelGroup({ className, ...props }: PanelGroupProps) {
  return (
    <ResizablePrimitive.PanelGroup
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  )
}

function ResizablePanel({ className, ...props }: PanelProps) {
  return (
    <ResizablePrimitive.Panel
      className={cn("rounded-md", className)}
      {...props}
    />
  )
}

function ResizableHandle({ className, withHandle = false, ...props }: HandleProps) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      className={cn("relative flex w-px bg-neutral-300 outline-hidden", className)}
      {...props}
    >
      {withHandle ? <div className="sr-only" aria-hidden /> : null}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export { ResizablePanel, ResizablePanelGroup, ResizableHandle }
