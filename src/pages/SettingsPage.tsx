import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Store, Shield, Database, Wifi } from "lucide-react";
import { useSync } from "@/contexts/SyncContext";
import { db } from "@/lib/db";

interface StoreSettings {
  id: string;
  store_name: string;
  currency: string;
}

const currencies = [
  { value: "USD", label: "Dolar estadounidense ($)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "GBP", label: "Libra esterlina (£)" },
  { value: "JPY", label: "Yen japones (¥)" },
  { value: "CAD", label: "Dolar canadiense (C$)" },
  { value: "AUD", label: "Dolar australiano (A$)" },
];

export default function SettingsPage() {
  const { user, role, signOut } = useAuth();
  const {
    status,
    pendingCount,
    conflicts,
    isOnline,
    lastError,
    lastErrorDetails,
    lastSyncAt,
    lastSyncAttemptAt,
    retryCount,
    lastRetryAt,
  } = useSync();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localStorageSize, setLocalStorageSize] =
    useState<string>("Calculando...");

  useEffect(() => {
    fetchSettings();
    calculateStorageSize();
  }, []);

  async function fetchSettings() {
    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setSettings(data);
    } catch (err) {
      console.error("No se pudo obtener la configuracion:", err);
    } finally {
      setLoading(false);
    }
  }

  async function calculateStorageSize() {
    try {
      const productCount = await db.products.count();
      const eventCount = await db.eventQueue.count();
      setLocalStorageSize(
        `${productCount} productos, ${eventCount} eventos en cache`,
      );
    } catch {
      setLocalStorageSize("No se pudo calcular");
    }
  }

  async function handleSave() {
    if (!settings || role !== "admin") return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("store_settings")
        .update({
          store_name: settings.store_name,
          currency: settings.currency,
        })
        .eq("id", settings.id);

      if (error) throw error;
      toast.success("Configuracion guardada");
    } catch {
      toast.error("No se pudieron guardar los cambios");
    } finally {
      setSaving(false);
    }
  }

  async function clearLocalData() {
    try {
      await db.products.clear();
      await db.eventQueue.clear();
      await db.syncState.clear();
      toast.success("Datos locales eliminados");
      calculateStorageSize();
    } catch {
      toast.error("No se pudieron eliminar los datos locales");
    }
  }

  const roleLabel =
    role === "admin" ? "Administrador" : role === "staff" ? "Staff" : "Sin rol";
  const statusLabel = {
    offline: "Sin conexion",
    syncing: "Sincronizando",
    synced: "Sincronizado",
    conflict: "En conflicto",
  }[status];

  const formatDateTime = (value: string | null) =>
    value
      ? new Date(value).toLocaleString("es-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Sin registro";

  return (
    <AppLayout storeName={settings?.store_name}>
      <div className="p-4 space-y-6 max-w-xl mx-auto">
        <div>
          <h1 className="text-xl font-bold">Configuracion</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona la configuracion de tu tienda
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Store Settings */}
            <div className="bg-card rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Store className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Ajustes de la tienda</h2>
              </div>

              <div className="space-y-2">
                <label htmlFor="storeName" className="text-sm font-medium">
                  Nombre de la tienda
                </label>
                <Input
                  id="storeName"
                  value={settings?.store_name || ""}
                  onChange={(e) =>
                    setSettings((s) =>
                      s ? { ...s, store_name: e.target.value } : null,
                    )
                  }
                  disabled={role !== "admin"}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="currency" className="text-sm font-medium">
                  Moneda
                </label>
                <Select
                  value={settings?.currency || "USD"}
                  onValueChange={(value) =>
                    setSettings((s) => (s ? { ...s, currency: value } : null))
                  }
                  disabled={role !== "admin"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {role === "admin" && (
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full"
                >
                  {saving ? "Guardando..." : "Guardar cambios"}
                </Button>
              )}

              {role !== "admin" && (
                <p className="text-xs text-muted-foreground">
                  Solo administradores pueden modificar estos ajustes
                </p>
              )}
            </div>

            {/* Role Info */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Tu cuenta</h2>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{user?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rol</span>
                  <span className="capitalize font-medium">{roleLabel}</span>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={signOut}
                className="w-full mt-4"
              >
                Cerrar sesion
              </Button>
            </div>

            {/* Sync Status */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Estado de sincronizacion</h2>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Conexion</span>
                  <span
                    className={
                      isOnline ? "text-green-600" : "text-muted-foreground"
                    }
                  >
                    {isOnline ? "En linea" : "Sin conexion"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estado</span>
                  <span className="capitalize">{statusLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Eventos pendientes</span>
                  <span>{pendingCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Ultima sync exitosa
                  </span>
                  <span>{formatDateTime(lastSyncAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ultimo intento</span>
                  <span>{formatDateTime(lastSyncAttemptAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reintentos</span>
                  <span>{retryCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ultimo reintento</span>
                  <span>{formatDateTime(lastRetryAt)}</span>
                </div>
                {conflicts.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Conflictos</span>
                    <span className="text-destructive">{conflicts.length}</span>
                  </div>
                )}
                {lastError && (
                  <div className="pt-2 border-t border-border/60">
                    <p className="text-muted-foreground mb-1">
                      Ultimo error (usuario)
                    </p>
                    <p className="text-xs text-destructive break-words">
                      {lastError}
                    </p>
                    <p className="text-muted-foreground my-1">
                      Detalle tecnico (soporte)
                    </p>
                    <p className="text-xs text-destructive break-words">
                      {lastErrorDetails ?? "Sin detalle tecnico"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Local Data */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Datos locales</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {localStorageSize}
              </p>
              <Button
                variant="outline"
                onClick={clearLocalData}
                className="w-full"
              >
                Limpiar cache local
              </Button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
