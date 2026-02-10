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
  { value: "USD", label: "US Dollar ($)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "GBP", label: "British Pound (£)" },
  { value: "JPY", label: "Japanese Yen (¥)" },
  { value: "CAD", label: "Canadian Dollar (C$)" },
  { value: "AUD", label: "Australian Dollar (A$)" },
];

export default function SettingsPage() {
  const { user, role, signOut } = useAuth();
  const { status, pendingCount, conflicts, isOnline } = useSync();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localStorageSize, setLocalStorageSize] =
    useState<string>("Calculating...");

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
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }

  async function calculateStorageSize() {
    try {
      const productCount = await db.products.count();
      const eventCount = await db.eventQueue.count();
      setLocalStorageSize(
        `${productCount} products, ${eventCount} events cached`,
      );
    } catch {
      setLocalStorageSize("Unable to calculate");
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
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function clearLocalData() {
    try {
      await db.products.clear();
      await db.eventQueue.clear();
      await db.syncState.clear();
      toast.success("Local data cleared");
      calculateStorageSize();
    } catch {
      toast.error("Failed to clear data");
    }
  }

  return (
    <AppLayout storeName={settings?.store_name}>
      <div className="p-4 space-y-6 max-w-xl mx-auto">
        <div>
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your store settings
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
                <h2 className="font-semibold">Store Settings</h2>
              </div>

              <div className="space-y-2">
                <label htmlFor="storeName" className="text-sm font-medium">
                  Store Name
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
                  Currency
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
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              )}

              {role !== "admin" && (
                <p className="text-xs text-muted-foreground">
                  Only admins can modify store settings
                </p>
              )}
            </div>

            {/* Role Info */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Your Account</h2>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span>{user?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span className="capitalize font-medium">{role}</span>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={signOut}
                className="w-full mt-4"
              >
                Sign Out
              </Button>
            </div>

            {/* Sync Status */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Sync Status</h2>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connection</span>
                  <span
                    className={
                      isOnline ? "text-green-600" : "text-muted-foreground"
                    }
                  >
                    {isOnline ? "Online" : "Offline"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="capitalize">{status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pending Events</span>
                  <span>{pendingCount}</span>
                </div>
                {conflicts.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Conflicts</span>
                    <span className="text-destructive">{conflicts.length}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Local Data */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Local Data</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {localStorageSize}
              </p>
              <Button
                variant="outline"
                onClick={clearLocalData}
                className="w-full"
              >
                Clear Local Cache
              </Button>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
