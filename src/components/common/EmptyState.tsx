"use client";

import { BrainCircuit, Zap, Layers } from "lucide-react";

interface EmptyStateProps {
  onNewChat: () => void;
}

export function EmptyState({ onNewChat }: EmptyStateProps) {
  return (
    <div className="max-w-md w-full p-8 space-y-8 text-center">
      <div className="space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <BrainCircuit className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Multi-AI Orchestrator</h2>
        <p className="text-muted-foreground">複数AIの思考を統合するエンジン</p>
      </div>

      <div className="space-y-3 text-left">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50">
          <Zap size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">厳密検証モード</p>
            <p className="text-xs text-muted-foreground">一方のAIが回答、もう一方が検証。事実誤認を自動発見</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50">
          <Layers size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">多角的レビューモード</p>
            <p className="text-xs text-muted-foreground">複数AIの回答を信頼構造付きで統合。一つのAIでは出せない結論へ</p>
          </div>
        </div>
      </div>

      <button
        onClick={onNewChat}
        className="w-full py-3 px-6 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors"
      >
        チャットを始める
      </button>
    </div>
  );
}
