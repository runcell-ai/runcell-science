import type * as React from 'react'
import { GripVerticalIcon } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'

import { cn } from '../../lib/utils'

type PanelGroupProps = React.ComponentPropsWithoutRef<
  typeof ResizablePrimitive.PanelGroup
>
type PanelProps = React.ComponentPropsWithoutRef<typeof ResizablePrimitive.Panel>
type HandleProps = React.ComponentPropsWithoutRef<
  typeof ResizablePrimitive.PanelResizeHandle
> & {
  withHandle?: boolean
}

function ResizablePanelGroup({ className, ...props }: PanelGroupProps) {
  return (
    <ResizablePrimitive.PanelGroup
      className={cn('flex h-full w-full', className)}
      {...props}
    />
  )
}

function ResizablePanel({ className, ...props }: PanelProps) {
  return (
    <ResizablePrimitive.Panel
      className={cn('rounded-md', className)}
      {...props}
    />
  )
}

function ResizableHandle({
  className,
  withHandle = false,
  ...props
}: HandleProps) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      className={cn(
        'relative flex w-px items-center justify-center bg-border outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2 focus-visible:ring-3 focus-visible:ring-ring/50',
        className
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-5 w-3 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground">
          <GripVerticalIcon className="size-3" />
        </div>
      ) : null}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export { ResizablePanel, ResizablePanelGroup, ResizableHandle }
