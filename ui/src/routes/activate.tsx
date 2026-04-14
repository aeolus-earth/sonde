import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { activationSupabase, clearActivationSession } from "@/lib/activation-supabase";
import {
  completeActivation,
  fetchActivationDetails,
  normalizeActivationCode,
  type DeviceActivationDetails,
} from "@/lib/device-activation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const ACTIVATION_CODE_STORAGE_KEY = "sonde-activation-code";

function ActivationPage() {
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const initialCode = normalizeActivationCode(searchParams.get("code") ?? "");
  const initialError = searchParams.get("error")?.trim() ?? "";

  const [draftCode, setDraftCode] = useState(initialCode);
  const [userCode, setUserCode] = useState(initialCode);
  const [session, setSession] = useState<Session | null>(null);
  const [details, setDetails] = useState<DeviceActivationDetails | null>(null);
  const [error, setError] = useState<string | null>(initialError || null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [decision, setDecision] = useState<"approve" | "deny" | null>(null);
  const [completed, setCompleted] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    let alive = true;

    activationSupabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) {
        setError(sessionError.message);
      }
      setSession(data.session ?? null);
      setLoadingSession(false);
    });

    const {
      data: { subscription },
    } = activationSupabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!alive) return;
      setSession(nextSession);
      setLoadingSession(false);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userCode || !session?.access_token || completed) {
      setDetails(null);
      setLoadingDetails(false);
      return;
    }

    let alive = true;
    setLoadingDetails(true);
    setError(null);

    void fetchActivationDetails(userCode, session.access_token)
      .then((nextDetails) => {
        if (!alive) return;
        setDetails(nextDetails);
        setLoadingDetails(false);
      })
      .catch((err: Error) => {
        if (!alive) return;
        setDetails(null);
        setLoadingDetails(false);
        setError(err.message);
      });

    return () => {
      alive = false;
    };
  }, [completed, session, userCode]);

  function updateBrowserUrl(nextCode: string): void {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextCode) {
      url.searchParams.set("code", nextCode);
    } else {
      url.searchParams.delete("code");
    }
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
  }

  function submitCode(event?: FormEvent<HTMLFormElement>): void {
    event?.preventDefault();
    const normalized = normalizeActivationCode(draftCode);
    if (!normalized) {
      setError("Enter the 8-character activation code from your terminal.");
      return;
    }
    setError(null);
    setCompleted(null);
    setDetails(null);
    setUserCode(normalized);
    setDraftCode(normalized);
    updateBrowserUrl(normalized);
  }

  async function signIn(): Promise<void> {
    const normalized = normalizeActivationCode(draftCode || userCode);
    if (!normalized) {
      setError("Enter the activation code from your terminal first.");
      return;
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(ACTIVATION_CODE_STORAGE_KEY, normalized);
    }
    setError(null);
    const redirectTo = `${window.location.origin}/activate/callback?user_code=${encodeURIComponent(
      normalized
    )}`;
    const { error: signInError } = await activationSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          hd: "aeolus.earth",
        },
      },
    });
    if (signInError) {
      setError(signInError.message);
    }
  }

  async function handleDecision(nextDecision: "approve" | "deny"): Promise<void> {
    if (!userCode) {
      setError("Enter the activation code from your terminal first.");
      return;
    }
    setDecision(nextDecision);
    setError(null);
    try {
      const nextDetails = await completeActivation(userCode, nextDecision, session);
      setDetails(nextDetails);
      setCompleted(nextDecision);
      await clearActivationSession();
      setSession(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ACTIVATION_CODE_STORAGE_KEY);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete activation.");
    } finally {
      setDecision(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-10 text-text">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="space-y-2">
          <p className="text-[12px] uppercase tracking-[0.16em] text-text-tertiary">
            Sonde Activation
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text">
            Complete CLI sign-in from any browser
          </h1>
          <p className="max-w-lg text-[14px] text-text-secondary">
            Enter the activation code from <code className="font-mono">sonde login</code>,
            then sign in with your Aeolus Google Workspace account to finish the CLI session.
          </p>
        </div>

        <Card className="border-border/80 bg-surface-raised">
          <CardHeader>
            <CardTitle>Activation code</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="flex gap-2" onSubmit={submitCode}>
              <Input
                autoCapitalize="characters"
                autoCorrect="off"
                className="font-mono tracking-[0.18em] uppercase"
                inputMode="text"
                maxLength={9}
                onChange={(event) => setDraftCode(event.target.value)}
                placeholder="ABCD-EFGH"
                value={draftCode}
              />
              <Button type="submit" variant="secondary">
                Use code
              </Button>
            </form>
            <p className="text-[12px] text-text-tertiary">
              The code is short-lived and can only be used once.
            </p>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-status-failed/40 bg-status-failed/10">
            <CardContent className="pt-3 text-status-failed">{error}</CardContent>
          </Card>
        )}

        {completed === "approve" && (
          <Card className="border-status-running/40 bg-status-running/10">
            <CardHeader>
              <CardTitle>CLI sign-in approved</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>Return to your terminal. Sonde should finish the login automatically.</p>
              {details?.host_label && (
                <p className="text-[12px] text-text-tertiary">
                  Approved for <code className="font-mono">{details.host_label}</code>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {completed === "deny" && (
          <Card className="border-border bg-surface">
            <CardHeader>
              <CardTitle>Activation cancelled</CardTitle>
            </CardHeader>
            <CardContent>
              Return to the terminal and run <code className="font-mono">sonde login</code> for a
              fresh activation code if you still want to sign in.
            </CardContent>
          </Card>
        )}

        {!completed && (
          <Card>
            <CardHeader>
              <CardTitle>Approve this CLI session</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!userCode && (
                <p className="text-text-secondary">
                  Enter the activation code from the terminal to continue.
                </p>
              )}

              {userCode && loadingSession && (
                <div className="flex items-center gap-2 text-text-secondary">
                  <Spinner className="h-4 w-4" />
                  <span>Checking the browser activation session…</span>
                </div>
              )}

              {userCode && !loadingSession && !session && (
                <>
                  <p className="text-text-secondary">
                    Sign in with your <code className="font-mono">@aeolus.earth</code> Google
                    account to approve this CLI login.
                  </p>
                  <Button onClick={() => void signIn()}>Sign in with Google</Button>
                </>
              )}

              {userCode && session && loadingDetails && (
                <div className="flex items-center gap-2 text-text-secondary">
                  <Spinner className="h-4 w-4" />
                  <span>Loading the pending CLI request…</span>
                </div>
              )}

              {userCode && session && details && !loadingDetails && (
                <>
                  <div className="grid gap-2 text-[13px] text-text-secondary sm:grid-cols-2">
                    <div>
                      <div className="text-text-tertiary">Requesting host</div>
                      <div className="font-mono text-text">
                        {details.host_label ?? "Unknown host"}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-tertiary">CLI version</div>
                      <div className="font-mono text-text">
                        {details.cli_version ?? "Unknown"}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-tertiary">Requested at</div>
                      <div className="text-text">
                        {new Date(details.requested_at).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-tertiary">Expires at</div>
                      <div className="text-text">
                        {new Date(details.expires_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {details.status !== "pending" ? (
                    <p className="text-text-secondary">
                      This activation is already {details.status}. Return to the terminal if it is
                      still waiting and start a new login if needed.
                    </p>
                  ) : (
                    <>
                      <p className="text-text-secondary">
                        Approve this request to finish sign-in on the terminal that started{" "}
                        <code className="font-mono">sonde login</code>.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          disabled={decision !== null}
                          onClick={() => void handleDecision("approve")}
                        >
                          {decision === "approve" ? "Approving…" : "Approve sign-in"}
                        </Button>
                        <Button
                          disabled={decision !== null}
                          onClick={() => void handleDecision("deny")}
                          variant="secondary"
                        >
                          {decision === "deny" ? "Cancelling…" : "Cancel"}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activate",
  component: ActivationPage,
});
