import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapSeedAdmins } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/login")({
  component: AdminLogin,
});

function normalize(raw: string) {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 10) return "+91" + digits;
  if (digits.length > 0) return "+" + digits;
  return "";
}

function AdminLogin() {
  const [identifier, setIdentifier] = useState("9098326235");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const bootstrap = useServerFn(bootstrapSeedAdmins);

  useEffect(() => {
    // Idempotent: ensures seeded super admin exists with default password on first visit
    bootstrap({ data: { password: "11223344@" } }).catch(() => {});
  }, [bootstrap]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const isEmail = identifier.includes("@");
      const { error } = isEmail
        ? await supabase.auth.signInWithPassword({ email: identifier, password })
        : await supabase.auth.signInWithPassword({ phone: normalize(identifier), password });
      if (error) throw error;
      toast.success("Welcome, admin");
      navigate({ to: "/admin/dashboard" });
    } catch (err: any) {
      toast.error(err?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Super Admin</h1>
            <p className="text-xs text-muted-foreground">Authorized personnel only</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ident">Mobile or Email</Label>
            <Input id="ident" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="9098326235" />
          </div>
          <div>
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
