import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BeamformingSimulator } from "@/components/BeamformingSimulator";
import { FiveGSimulator } from "@/components/FiveGSimulator";
import { UltrasoundSimulator } from "@/components/UltrasoundSimulator";
import { RadarSimulator } from "@/components/RadarSimulator";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Beamforming Simulator" },
      {
        name: "description",
        content: "Interactive 2D beamforming simulator with 5G, ultrasound, and radar modules",
      },
    ],
  }),
});

function Index() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-border px-4 py-3 flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight text-foreground">Beamforming Simulator</h1>
        <span className="text-xs text-muted-foreground">Phased Array Visualization</span>
      </header>

      {/* Main content with tabs */}
      <Tabs defaultValue="beamforming" className="flex-1 flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-4 py-2">
          <TabsList>
            <TabsTrigger value="beamforming">Core Beamforming</TabsTrigger>
            <TabsTrigger value="5g">5G Network</TabsTrigger>
            <TabsTrigger value="ultrasound">Ultrasound</TabsTrigger>
            <TabsTrigger value="radar">Radar</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <TabsContent value="beamforming" className="mt-0 h-full">
            <BeamformingSimulator />
          </TabsContent>
          <TabsContent value="5g" className="mt-0 h-full">
            <FiveGSimulator />
          </TabsContent>
          <TabsContent value="ultrasound" className="mt-0 h-full">
            <UltrasoundSimulator />
          </TabsContent>
          <TabsContent value="radar" className="mt-0 h-full">
            <RadarSimulator />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
