import type { CachedProduct } from "@/lib/db";
import {
  AlertCircle,
  DollarSign,
  Minus,
  Plus,
} from "lucide-react";
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
import { toast } from "sonner";
import { getCategoryIcon } from "@/lib/categoryIcon";
import { getProductVisualTheme } from "@/lib/productVisualTheme";

interface ProductCardProps {
  product: CachedProduct;
  canManage: boolean;
  onSell: (buyerName?: string) => Promise<{ success: boolean; error?: string }>;
  onRestock: (qty: number) => Promise<{ success: boolean; error?: string }>;
  onUpdatePrice: (price: number) => Promise<{ success: boolean; error?: string }>;
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
  canManage,
  onSell,
  onRestock,
  onUpdatePrice,
}: ProductCardProps) {
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceValue, setPriceValue] = useState(String(product.price));
  const [sellOpen, setSellOpen] = useState(false);
  const [buyerName, setBuyerName] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const stockStatus = getStockStatus(product.stock);
  const categoryIcon = getCategoryIcon(product.category);
  const visualTheme = getProductVisualTheme(product.category, product.color);
  const showProductImage =
    Boolean(product.image_url) && failedImageUrl !== product.image_url;

  const handleOpenSell = () => {
    if (!canManage) {
      toast.error("Solo admin puede modificar inventario");
      return;
    }
    if (product.stock <= 0) {
      toast.error("No se puede vender: sin stock");
      return;
    }
    setBuyerName("");
    setSellOpen(true);
  };

  const handleSell = async () => {
    if (!canManage) {
      toast.error("Solo admin puede modificar inventario");
      return;
    }
    if (product.stock <= 0) {
      toast.error("No se puede vender: sin stock");
      return;
    }
    setLoading("sell");
    const result = await onSell(buyerName);
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "No se pudo registrar la venta");
    } else {
      setSellOpen(false);
      toast.success("Venta registrada");
    }
  };

  const handleRestock = async () => {
    if (!canManage) {
      toast.error("Solo admin puede modificar inventario");
      return;
    }
    setLoading("restock");
    const result = await onRestock(1);
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "No se pudo reponer stock");
    } else {
      toast.success("Stock repuesto +1");
    }
  };

  const handleOpenPrice = () => {
    if (!canManage) {
      toast.error("Solo admin puede cambiar precios");
      return;
    }
    setPriceValue(String(product.price));
    setPriceOpen(true);
  };

  const handleUpdatePrice = async () => {
    if (!canManage) {
      toast.error("Solo admin puede cambiar precios");
      return;
    }

    const parsedPrice = Number(priceValue);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error("Ingresa un precio valido");
      return;
    }

    setLoading("price");
    const result = await onUpdatePrice(parsedPrice);
    setLoading(null);
    if (!result.success) {
      toast.error(result.error || "No se pudo actualizar el precio");
      return;
    }

    setPriceOpen(false);
    toast.success("Precio actualizado");
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("es-US", {
      style: "currency",
      currency: "USD",
    }).format(price);
  };

  const renderActionButtons = (direction: "row" | "column") => (
    <div
      className={cn(
        "flex gap-1.5",
        direction === "column"
          ? "flex-col items-center w-11 shrink-0"
          : "items-center justify-end",
      )}
    >
      <button
        onClick={handleRestock}
        disabled={loading === "restock"}
        className={cn(
          "action-btn action-btn-restock",
          direction === "row" && "h-9 w-9",
        )}
        title="Reponer +1"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        onClick={handleOpenSell}
        disabled={loading === "sell" || product.stock <= 0}
        className={cn(
          "action-btn action-btn-sell",
          direction === "row" && "h-9 w-9",
          product.stock <= 0 && "opacity-50 cursor-not-allowed",
        )}
        title="Vender 1"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={handleOpenPrice}
        disabled={loading === "price"}
        className={cn(
          "action-btn action-btn-adjust",
          direction === "row" && "h-9 w-9",
        )}
        title="Editar precio"
      >
        <DollarSign className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      <div className="product-card animate-fade-in h-full">
        <div className="flex gap-3 items-start">
          {/* Product Image */}
          <div
            className={cn(
              "relative h-14 w-14 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border",
              showProductImage ? "bg-secondary border-transparent" : visualTheme.tileClassName,
            )}
          >
            {showProductImage ? (
              <img
                src={product.image_url ?? undefined}
                alt={product.name}
                className="w-full h-full object-cover"
                onError={() => setFailedImageUrl(product.image_url ?? null)}
              />
            ) : (
              <>
                <span className="text-2xl" aria-hidden="true">
                  {categoryIcon}
                </span>
                {product.color && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-white/80 shadow-sm",
                      visualTheme.swatchClassName,
                    )}
                    title={product.color}
                  />
                )}
              </>
            )}
          </div>

          {/* Product Info */}
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium text-sm leading-snug wrap-break-word">
                  {product.name}
                </h3>
                <p className="text-xs text-muted-foreground truncate max-w-full">
                  SKU: {product.sku}
                </p>
              </div>
              <span className="hidden sm:inline text-sm font-semibold text-primary shrink-0">
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
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground"
                  title={`Color: ${product.color}`}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full border border-white/80 shadow-sm",
                      visualTheme.swatchClassName,
                    )}
                  />
                  {product.color}
                </span>
              )}
            </div>

            {/* Mobile Price + Actions */}
            <div className="sm:hidden flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-primary shrink-0">
                {formatPrice(product.price)}
              </span>
              {canManage && (
                <div className="shrink-0">{renderActionButtons("row")}</div>
              )}
            </div>

            {/* Stock */}
            <div>
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
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Solo lectura. Admin puede editar stock y precio.
              </p>
            )}
          </div>

          {canManage && (
            <div className="hidden sm:flex">{renderActionButtons("column")}</div>
          )}
        </div>
      </div>

      {/* Price Dialog */}
      <Dialog
        open={sellOpen}
        onOpenChange={(open) => {
          if (loading === "sell") return;
          setSellOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar venta</DialogTitle>
            <DialogDescription>
              Puedes agregar el nombre de la compradora para exportarlo luego en Excel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor={`buyer-${product.id}`}>Nombre de la compradora (opcional)</Label>
            <Input
              id={`buyer-${product.id}`}
              type="text"
              placeholder="Ej. Maria"
              value={buyerName}
              onChange={(event) => setBuyerName(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Producto: {product.name} ({product.sku})
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSellOpen(false)}
              disabled={loading === "sell"}
            >
              Cancelar
            </Button>
            <Button onClick={handleSell} disabled={loading === "sell"}>
              {loading === "sell" ? "Registrando..." : "Confirmar venta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Price Dialog */}
      <Dialog open={priceOpen} onOpenChange={setPriceOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Actualizar precio</DialogTitle>
            <DialogDescription>
              Define el precio de venta para {product.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor={`price-${product.id}`}>Precio</Label>
            <Input
              id={`price-${product.id}`}
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={priceValue}
              onChange={(event) => setPriceValue(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Precio actual: {formatPrice(product.price)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdatePrice} disabled={loading === "price"}>
              {loading === "price" ? "Guardando..." : "Guardar precio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
