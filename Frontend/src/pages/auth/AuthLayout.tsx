import type { ReactNode } from "react";
import "./auth.css";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="auth-error">{message}</p>;
}
