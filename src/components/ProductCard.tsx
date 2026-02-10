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
      return "Out of stock";
    case "low":
      return "Low stock";
    case "high":
      return "In stock";
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
      toast.error("Cannot sell - out of stock");
      return;
    }
    setLoading("sell");
    const result = await onSell();
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "Failed to record sale");
    } else {
      toast.success("Sale recorded");
    }
  };

  const handleRestock = async () => {
    setLoading("restock");
    const result = await onRestock(1);
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "Failed to restock");
    } else {
      toast.success("Restocked +1");
    }
  };

  const handleAdjust = async () => {
    const qty = parseInt(adjustQty);
    if (isNaN(qty) || qty === 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    setLoading("adjust");
    const result = await onAdjust(qty, adjustNote);
    setLoading(null);
    setAdjustOpen(false);
    setAdjustQty("");
    setAdjustNote("");
    if (!result.success) {
      toast.error(result.error || "Failed to adjust");
    } else {
      toast.success(`Stock adjusted by ${qty > 0 ? "+" : ""}${qty}`);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-US", {
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
                    <>{product.stock} in stock</>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleRestock}
                  disabled={loading === "restock"}
                  className="action-btn action-btn-restock"
                  title="Restock +1"
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
                  title="Sell 1"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setAdjustOpen(true)}
                  className="action-btn action-btn-adjust"
                  title="Adjust"
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
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              Adjust inventory for {product.name}. Current stock:{" "}
              {product.stock}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="qty">Quantity Change</Label>
              <Input
                id="qty"
                type="number"
                placeholder="+10 or -5"
                value={adjustQty}
                onChange={(event) => setAdjustQty(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Enter positive number to add stock, negative to remove
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea
                id="note"
                placeholder="Reason for adjustment..."
                value={adjustNote}
                onChange={(event) => setAdjustNote(event.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdjust} disabled={loading === "adjust"}>
              {loading === "adjust" ? "Adjusting..." : "Apply Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
