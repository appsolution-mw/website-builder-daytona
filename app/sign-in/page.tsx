"use client";

import { FormEvent, useState, useTransition } from "react";
import { Github, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Authentication failed";
}

export default function SignInPage() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const callbackURL = "/";
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({ email, password, callbackURL })
          : await authClient.signUp.email({
              name: name.trim() || email,
              email,
              password,
              callbackURL,
            });

      if (result.error) {
        setError(authErrorMessage(result.error));
        return;
      }
      window.location.assign(callbackURL);
    });
  }

  function signInWithGitHub(): void {
    setError(null);
    startTransition(async () => {
      const result = await authClient.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
      if (result.error) {
        setError(authErrorMessage(result.error));
      }
    });
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "sign-in" ? "Sign in" : "Create account"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={isPending}
            onClick={signInWithGitHub}
          >
            <Github />
            Continue with GitHub
          </Button>

          <form className="space-y-3" onSubmit={submit}>
            {mode === "sign-up" && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="pl-9"
                    autoComplete="name"
                  />
                </div>
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                  autoComplete="email"
                  required
                />
              </div>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Password</span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pl-9"
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  required
                />
              </div>
            </label>

            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {mode === "sign-in" ? "Sign in" : "Sign up"}
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setError(null);
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            }}
          >
            {mode === "sign-in" ? "Create an account" : "Use an existing account"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
