import {
  Package,
  ShoppingBag,
  Settings,
  Store,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { SyncStatusIndicator } from "./SyncStatusIndicator";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { path: "/", label: "Inventory", icon: Package },
  { path: "/sold", label: "Sold", icon: ShoppingBag },
  { path: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  storeName?: string;
}

export function Sidebar({ storeName = "StockFlow" }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col bg-sidebar text-sidebar-foreground h-screen sticky top-0 transition-all duration-300 border-r border-sidebar-border",
        "bg-gradient-to-b from-sidebar to-[color:oklch(0.2_0.04_270)]",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        <div
          className={cn(
            "flex items-center gap-3",
            collapsed && "justify-center w-full",
          )}
        >
          <div className="w-9 h-9 rounded-full bg-sidebar-primary/20 border border-sidebar-primary/30 flex items-center justify-center">
            <Store className="h-4 w-4 text-sidebar-primary" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-semibold text-sm truncate max-w-[140px]">
                {storeName}
              </span>
              <span className="text-xs text-sidebar-foreground/60 capitalize">
                {role}
              </span>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 hover:bg-sidebar-accent rounded-md transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive &&
                  "bg-sidebar-accent text-sidebar-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
                collapsed && "justify-center",
              )}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border space-y-3">
        <div
          className={cn("flex", collapsed ? "justify-center" : "justify-start")}
        >
          <SyncStatusIndicator iconOnly={collapsed} />
        </div>

        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="w-full p-2 hover:bg-sidebar-accent rounded-md transition-colors flex justify-center"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          user && (
            <div className="space-y-2">
              <p className="text-xs text-sidebar-foreground/60 truncate">
                {user.email}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                className="w-full text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-xl"
              >
                Sign Out
              </Button>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
