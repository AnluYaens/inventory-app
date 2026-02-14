import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { BrandLogo } from "@/components/BrandLogo";
import { appNavItems } from "@/components/navItems";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface MobileSidebarProps {
  storeName?: string;
  onNavigate?: () => void;
}

export function MobileSidebar({
  storeName = "AMEN",
  onNavigate,
}: MobileSidebarProps) {
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <BrandLogo containerClassName="h-10 w-10 rounded-full" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{storeName}</p>
            <p className="text-xs capitalize text-sidebar-foreground/80">
              {role ?? "staff"}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {appNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive &&
                  "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]",
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-sidebar-border p-4">
        <SyncStatusIndicator iconOnly />
        {user && (
          <div className="space-y-2">
            <p className="truncate text-xs text-sidebar-foreground/85">
              {user.email}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                onNavigate?.();
                void signOut();
              }}
              className="h-10 w-full rounded-xl text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Cerrar sesion
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
