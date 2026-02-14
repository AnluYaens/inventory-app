import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { appNavItems } from "@/components/navItems";

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="bottom-nav md:hidden">
      {appNavItems.map((item) => {
        const isActive = location.pathname === item.path;
        const Icon = item.icon;

        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "bottom-nav-item touch-target",
              isActive && "bottom-nav-item-active",
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
