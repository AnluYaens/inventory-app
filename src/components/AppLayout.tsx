import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileSidebar } from "@/components/MobileSidebar";

interface AppLayoutProps {
  children: ReactNode;
  storeName?: string;
}

export function AppLayout({
  children,
  storeName = "AMEN",
}: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-background">
      {/* Desktop Sidebar */}
      <Sidebar storeName={storeName} />

      {/* Mobile Header */}
      <div className="flex flex-col flex-1 w-full">
        <header className="md:hidden sticky top-0 z-40 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <button className="p-2 -ml-2 hover:bg-secondary rounded-lg transition-colors touch-target">
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border"
            >
              <MobileSidebar
                storeName={storeName}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <SyncStatusIndicator iconOnly />
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto pb-20 md:h-screen md:pb-0">
          {children}
        </main>

        {/* Bottom Nav (Mobile Only) */}
        <BottomNav />
      </div>
    </div>
  );
}
