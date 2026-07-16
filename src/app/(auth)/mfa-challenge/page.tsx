"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

// Same Suspense split as login/page.tsx — `useSearchParams` needs it.
export default function MfaChallengePage() {
  return (
    <Suspense fallback={null}>
      <MfaChallengePageInner />
    </Suspense>
  );
}

function MfaChallengePageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("MfaChallengePage");

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvingFactor, setResolvingFactor] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // Reached mid-login (aal1) or via middleware redirect for a session
  // that hasn't completed its TOTP challenge yet. MVP supports a
  // single enrolled TOTP factor, matching the Settings enrollment
  // flow that only allows enrolling one at a time.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.mfa.listFactors().then(({ data, error: listError }) => {
      if (cancelled) return;
      if (listError) {
        setError(listError.message);
        setResolvingFactor(false);
        return;
      }
      const totp = data?.totp.find((f) => f.status === "verified");
      if (!totp) {
        // No verified factor after all (e.g. disabled from another
        // tab) — nothing to challenge, send them on.
        router.push(inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard");
        return;
      }
      setFactorId(totp.id);
      setResolvingFactor(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);

    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) {
      setError(verifyError.message);
      setLoading(false);
      return;
    }

    router.push(inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/dashboard");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">{t("title")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="code" className="text-muted-foreground">
                {t("codeLabel")}
              </Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={resolvingFactor}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading || resolvingFactor || code.length !== 6}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("verifying") : t("verify")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-primary hover:text-primary/80"
            >
              {t("signOut")}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
