"use client";

import { useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrainCircuit } from "lucide-react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const supabase = createBrowserClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    if (error) { setError(error.message); setLoading(false); }
    else { setSuccess(true); setLoading(false); }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-md p-8 text-center space-y-4 bg-card border border-border rounded-2xl">
          <div className="text-4xl">📧</div>
          <h2 className="text-xl font-bold">確認メールを送信しました</h2>
          <p className="text-muted-foreground text-sm">メールのリンクをクリックして登録を完了してください</p>
          <Link href="/auth/login" className="block text-primary hover:underline text-sm">ログインへ戻る</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8 space-y-6 bg-card border border-border rounded-2xl shadow-sm">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-2">
            <BrainCircuit className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">アカウント作成</h1>
        </div>
        <form onSubmit={handleSignup} className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg"><p className="text-sm text-red-600">{error}</p></div>}
          <div className="space-y-1">
            <label className="text-sm font-medium">メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">パスワード（8文字以上）</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring text-sm" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {loading ? "作成中..." : "アカウントを作成"}
          </button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          すでにアカウントをお持ちの方は{" "}
          <Link href="/auth/login" className="text-primary hover:underline font-medium">ログイン</Link>
        </p>
      </div>
    </div>
  );
}
