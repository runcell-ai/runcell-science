import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import './App.css'

function PanelTitle({ label }: { label: string }) {
  return <h2 className="panel-title">{label}</h2>
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="panel-placeholder">
      <PanelTitle label={label} />
    </div>
  )
}

function App() {
  return (
    <TooltipProvider>
      <div className="app-shell">
        <ResizablePanelGroup direction="horizontal" className="shell-grid">
          <ResizablePanel defaultSize={22} minSize={16} maxSize={32} className="panel">
            <PanelTitle label="Sessions" />
            <ScrollArea className="panel-scroll">
              <div className="panel-empty-state">
                <Placeholder label="No sessions" />
              </div>
            </ScrollArea>
            <div className="panel-footer">
              <Button disabled>New session</Button>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={46} minSize={36} className="panel">
            <PanelTitle label="Chat" />
            <div className="chat-shell">
              <div className="chat-content">
                <p>No active conversation</p>
              </div>
              <div className="chat-input-row">
                <Textarea rows={3} placeholder="Message" readOnly />
                <Button disabled>Send</Button>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={32} minSize={24} className="panel">
            <PanelTitle label="Artifacts / Extensions" />
            <div className="artifacts-shell">
              <p>No artifact selected</p>
              <Separator className="artifacts-separator" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Input value="" placeholder="Artifact path" readOnly />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Artifact preview target</TooltipContent>
              </Tooltip>
              <Sheet>
                <SheetTrigger asChild>
                  <Button className="artifacts-button" variant="outline">
                    Open panel
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Artifacts</SheetTitle>
                    <SheetDescription>No artifact selected.</SheetDescription>
                  </SheetHeader>
                </SheetContent>
              </Sheet>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  )
}

export default App
