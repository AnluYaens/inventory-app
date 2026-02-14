import { Package, Settings, ShoppingBag } from "lucide-react";

export const appNavItems = [
  { path: "/", label: "Inventario", icon: Package },
  { path: "/sold", label: "Ventas", icon: ShoppingBag },
  { path: "/settings", label: "Configuracion", icon: Settings },
] as const;
