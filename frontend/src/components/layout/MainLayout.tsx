import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";

const navItems = [
  { path: "/", label: "Core Beamforming" },
  { path: "/5g", label: "5G" },
  { path: "/ultrasound", label: "Ultrasound" },
  { path: "/radar", label: "Radar" },
];

interface MainLayoutProps {
  children: ReactNode;
  controlPanel: ReactNode;
}

export default function MainLayout({ children, controlPanel }: MainLayoutProps) {
  const location = useLocation();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* Top nav */}
      <header className="h-11 flex items-center px-4 border-b border-border/50 bg-card/60 backdrop-blur-md flex-shrink-0">
        <div className="flex items-center gap-2 mr-6">
          <div className="w-2.5 h-2.5 rounded-full beam-gradient animate-pulse" />
          <span className="font-mono font-bold text-xs gradient-text tracking-wider">BEAMFORM</span>
        </div>
        <nav className="flex gap-0.5">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors rounded-md ${
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 beam-gradient rounded-md"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Main content: 30/70 split */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-[280px] flex-shrink-0 border-r border-border/50 overflow-hidden">
          {controlPanel}
        </aside>
        <main className="flex-1 p-3 overflow-auto min-h-0">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
