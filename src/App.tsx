import { useState } from "react";
import { Header } from "./components/Header";
import { FlowCanvas } from "./components/FlowCanvas";
import { NodePanel } from "./components/panel/NodePanel";
import { SettingsModal } from "./components/SettingsModal";
import type { NodeId } from "./state/schema";

export default function App() {
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1">
          <FlowCanvas onSelect={(id) => setSelected(id as NodeId)} selectedId={selected} />
        </div>
        {selected && <NodePanel nodeId={selected} onClose={() => setSelected(null)} />}
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
