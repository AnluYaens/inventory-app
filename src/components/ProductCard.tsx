import type { CachedProduct } from "@/lib/db";
import { AlertCircle, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface ProductCardProps {
  product: CachedProduct;
  onSell: () => Promise<{ success: boolean; error?: string }>;
  onRestock: (qty: number) => Promise<{ success: boolean; error?: string }>;
  onAdjust: (
    qtyChange: number,
    note: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

function getStockStatus(stock: number): "high" | "low" | "out" {
  if (stock === 0) return "out";
  if (stock <= 5) return "low";
  return "high";
}

function getStockLabel(status: "high" | "low" | "out"): string {
  switch (status) {
    case "out":
      return "Sin stock";
    case "low":
      return "Stock bajo";
    case "high":
      return "Con stock";
  }
}

export function ProductCard({
  product,
  onSell,
  onRestock,
  onAdjust,
}: ProductCardProps) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const stockStatus = getStockStatus(product.stock);

  const handleSell = async () => {
    if (product.stock <= 0) {
      toast.error("No se puede vender: sin stock");
      return;
    }
    setLoading("sell");
    const result = await onSell();
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "No se pudo registrar la venta");
    } else {
      toast.success("Venta registrada");
    }
  };

  const handleRestock = async () => {
    setLoading("restock");
    const result = await onRestock(1);
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "No se pudo reponer stock");
    } else {
      toast.success("Stock repuesto +1");
    }
  };

  const handleAdjust = async () => {
    const qty = parseInt(adjustQty);
    if (isNaN(qty) || qty === 0) {
      toast.error("Ingresa una cantidad valida");
      return;
    }
    setLoading("adjust");
    const result = await onAdjust(qty, adjustNote);
    setLoading(null);
    setAdjustOpen(false);
    setAdjustQty("");
    setAdjustNote("");
    if (!result.success) {
      toast.error(result.error || "No se pudo ajustar el stock");
    } else {
      toast.success(`Stock ajustado en ${qty > 0 ? "+" : ""}${qty}`);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("es-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  return (
    <>
      <div className="product-card animate-fade-in">
        <div className="flex gap-4">
          {/* Product Image */}
          <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl text-muted-foreground/50">📦</span>
            )}
          </div>

          {/* Product Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium text-sm truncate">{product.name}</h3>
                <p className="text-xs text-muted-foreground">
                  SKU: {product.sku}
                </p>
              </div>
              <span className="text-sm font-semibold text-primary flex-shrink-0">
                {formatPrice(product.price)}
              </span>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {product.category && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">
                  {product.category}
                </span>
              )}
              {product.size && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">
                  {product.size}
                </span>
              )}
              {product.color && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">
                  {product.color}
                </span>
              )}
            </div>

            {/* Stock & Actions */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "stock-badge",
                    stockStatus === "high" && "stock-badge-high",
                    stockStatus === "low" && "stock-badge-low",
                    stockStatus === "out" && "stock-badge-out",
                  )}
                >
                  {stockStatus === "out" ? (
                    <>
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {getStockLabel(stockStatus)}
                    </>
                  ) : (
                    <>{product.stock} en stock</>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleRestock}
                  disabled={loading === "restock"}
                  className="action-btn action-btn-restock"
                  title="Reponer +1"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  onClick={handleSell}
                  disabled={loading === "sell" || product.stock <= 0}
                  className={cn(
                    "action-btn action-btn-sell",
                    product.stock <= 0 && "opacity-50 cursor-not-allowed",
                  )}
                  title="Vender 1"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setAdjustOpen(true)}
                  className="action-btn action-btn-adjust"
                  title="Ajustar"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Adjust Dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar stock</DialogTitle>
            <DialogDescription>
              Ajusta inventario para {product.name}. Stock actual: {product.stock}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="qty">Cambio de cantidad</Label>
              <Input
                id="qty"
                type="number"
                placeholder="+10 o -5"
                value={adjustQty}
                onChange={(event) => setAdjustQty(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Usa positivo para sumar stock y negativo para restar
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Nota (opcional)</Label>
              <Textarea
                id="note"
                placeholder="Motivo del ajuste..."
                value={adjustNote}
                onChange={(event) => setAdjustNote(event.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAdjust} disabled={loading === "adjust"}>
              {loading === "adjust" ? "Ajustando..." : "Aplicar ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
