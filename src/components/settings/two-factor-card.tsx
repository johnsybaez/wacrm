'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';

interface EnrollState {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function TwoFactorCard() {
  const t = useTranslations('Settings.profile');
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const refreshFactor = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const verified = data?.totp.find((f) => f.status === 'verified');
    setFactorId(verified?.id ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refreshFactor();
  }, [refreshFactor]);

  // Enrolling immediately on dialog open (rather than a separate
  // "start" click) keeps the flow to a single dialog with one visible
  // step — request the QR the moment the user signals intent.
  const startEnroll = async () => {
    setEnrollOpen(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error) {
      toast.error(error.message);
      setEnrollOpen(false);
      return;
    }
    setEnroll({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  };

  // Closing the dialog before verifying leaves an `unverified` factor
  // behind — clean it up so retrying doesn't accumulate orphans.
  const cancelEnroll = async () => {
    setEnrollOpen(false);
    const pending = enroll;
    setEnroll(null);
    setCode('');
    if (pending) {
      await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
    }
  };

  const handleVerify = async () => {
    if (!enroll) return;
    setVerifying(true);
    try {
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
      if (challengeError) {
        toast.error(challengeError.message);
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: challenge.id,
        code,
      });
      if (verifyError) {
        toast.error(verifyError.message);
        return;
      }
      toast.success(t('twoFactorEnabled'));
      setEnrollOpen(false);
      setEnroll(null);
      setCode('');
      await refreshFactor();
    } finally {
      setVerifying(false);
    }
  };

  const handleDisable = async () => {
    if (!factorId) return;
    setDisabling(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(t('twoFactorDisabled'));
      setDisableOpen(false);
      await refreshFactor();
    } finally {
      setDisabling(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="size-4 text-primary" />
            {t('twoFactorTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('twoFactorDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : factorId ? (
            <>
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              >
                {t('twoFactorEnabledBadge')}
              </Badge>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDisableOpen(true)}
              >
                {t('twoFactorDisable')}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={startEnroll}>
              <ShieldCheck className="size-4" />
              {t('twoFactorEnable')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={enrollOpen}
        onOpenChange={(open) => {
          if (!open) void cancelEnroll();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('twoFactorEnrollTitle')}</DialogTitle>
            <DialogDescription>{t('twoFactorEnrollDesc')}</DialogDescription>
          </DialogHeader>

          {enroll ? (
            <div className="flex flex-col items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- qr_code is a data: URI generated per-enrollment, not an optimizable static asset */}
              <img
                src={enroll.qrCode}
                alt={t('twoFactorQrAlt')}
                className="size-40 rounded-md bg-white p-2"
              />
              <p className="break-all rounded-md bg-muted px-3 py-2 text-center font-mono text-xs text-muted-foreground">
                {enroll.secret}
              </p>
              <div className="flex w-full flex-col gap-2">
                <Label htmlFor="totp-code" className="text-muted-foreground">
                  {t('twoFactorCodeLabel')}
                </Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center tracking-widest"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void cancelEnroll()}
              disabled={verifying}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleVerify}
              disabled={!enroll || verifying || code.length !== 6}
            >
              {verifying ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('twoFactorVerifying')}
                </>
              ) : (
                t('twoFactorVerify')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('twoFactorDisableConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('twoFactorDisableConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDisableOpen(false)}
              disabled={disabling}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={handleDisable} disabled={disabling}>
              {disabling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('twoFactorDisabling')}
                </>
              ) : (
                t('twoFactorDisableConfirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
