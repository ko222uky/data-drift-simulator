import { Suspense } from "react";
import { Header } from "@/components/Header";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Drift Monitor" };

export default function LoginPage() {
  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-sm flex-col px-4 py-16">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </>
  );
}
